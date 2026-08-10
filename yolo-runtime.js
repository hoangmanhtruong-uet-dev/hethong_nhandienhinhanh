(() => {
  'use strict';

  const INPUT_SIZE = 640;
  const MODEL_URL = '/assets/models/yolov8n.onnx';
  const RUNTIME_URL = '/vendor/ort.webgpu.min.js';
  const COCO_LABELS = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light',
    'fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow',
    'elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee',
    'skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle',
    'wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange',
    'broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed',
    'dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven',
    'toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'
  ];

  let session = null;
  let loadingPromise = null;
  let executionProvider = 'none';

  function deviceAssessment() {
    const memory = Number(navigator.deviceMemory || 0);
    const cores = Number(navigator.hardwareConcurrency || 0);
    const saveData = Boolean(navigator.connection?.saveData);
    const weak = saveData || (memory > 0 && memory < 4) || (cores > 0 && cores < 4);
    return { weak, memory, cores, saveData, webgpu: Boolean(navigator.gpu) };
  }

  function loadScript(src) {
    if (window.ort) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Không tải được ONNX Runtime Web.'));
      document.head.appendChild(script);
    });
  }

  async function load(options = {}) {
    if (session) return { provider: executionProvider };
    if (loadingPromise) return loadingPromise;
    const assessment = deviceAssessment();
    if (assessment.weak && !options.force) {
      const error = new Error('Thiết bị được đánh giá là cấu hình thấp; dùng COCO-SSD để tránh treo ứng dụng.');
      error.code = 'WEAK_DEVICE';
      throw error;
    }
    loadingPromise = (async () => {
      await loadScript(RUNTIME_URL);
      window.ort.env.wasm.wasmPaths = '/vendor/';
      window.ort.env.wasm.numThreads = assessment.cores >= 6 ? 2 : 1;
      window.ort.env.wasm.proxy = false;
      const providers = assessment.webgpu ? ['webgpu', 'wasm'] : ['wasm'];
      try {
        session = await window.ort.InferenceSession.create(MODEL_URL, {
          executionProviders: providers,
          graphOptimizationLevel: 'all',
          executionMode: 'sequential',
        });
        executionProvider = assessment.webgpu ? 'webgpu' : 'wasm';
      } catch (primaryError) {
        if (!assessment.webgpu) throw primaryError;
        session = await window.ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ['wasm'], graphOptimizationLevel: 'all', executionMode: 'sequential',
        });
        executionProvider = 'wasm';
      }
      return { provider: executionProvider };
    })();
    try {
      return await loadingPromise;
    } catch (error) {
      session = null;
      throw error;
    } finally {
      loadingPromise = null;
    }
  }

  function prepare(source) {
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const scale = Math.min(INPUT_SIZE / sourceWidth, INPUT_SIZE / sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    const padX = Math.floor((INPUT_SIZE - width) / 2);
    const padY = Math.floor((INPUT_SIZE - height) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = 'rgb(114,114,114)';
    context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    context.drawImage(source, padX, padY, width, height);
    const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
    const plane = INPUT_SIZE * INPUT_SIZE;
    const input = new Float32Array(plane * 3);
    for (let pixel = 0; pixel < plane; pixel += 1) {
      input[pixel] = rgba[pixel * 4] / 255;
      input[plane + pixel] = rgba[pixel * 4 + 1] / 255;
      input[plane * 2 + pixel] = rgba[pixel * 4 + 2] / 255;
    }
    return { input, scale, padX, padY, sourceWidth, sourceHeight };
  }

  function iou(a, b) {
    const left = Math.max(a.bbox[0], b.bbox[0]);
    const top = Math.max(a.bbox[1], b.bbox[1]);
    const right = Math.min(a.bbox[0] + a.bbox[2], b.bbox[0] + b.bbox[2]);
    const bottom = Math.min(a.bbox[1] + a.bbox[3], b.bbox[1] + b.bbox[3]);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a.bbox[2] * a.bbox[3] + b.bbox[2] * b.bbox[3] - intersection;
    return union > 0 ? intersection / union : 0;
  }

  function decode(output, transform, threshold, nmsThreshold) {
    const dims = output.dims;
    const data = output.data;
    const channelsFirst = dims.length === 3 && dims[1] <= 100;
    const count = channelsFirst ? dims[2] : dims[1];
    const channels = channelsFirst ? dims[1] : dims[2];
    const at = (box, channel) => channelsFirst ? data[channel * count + box] : data[box * channels + channel];
    const candidates = [];
    for (let box = 0; box < count; box += 1) {
      let classId = 0;
      let score = 0;
      for (let channel = 4; channel < Math.min(channels, 84); channel += 1) {
        const value = at(box, channel);
        if (value > score) { score = value; classId = channel - 4; }
      }
      if (score < threshold) continue;
      const cx = at(box, 0); const cy = at(box, 1);
      const width = at(box, 2); const height = at(box, 3);
      const x = Math.max(0, (cx - width / 2 - transform.padX) / transform.scale);
      const y = Math.max(0, (cy - height / 2 - transform.padY) / transform.scale);
      const right = Math.min(transform.sourceWidth, (cx + width / 2 - transform.padX) / transform.scale);
      const bottom = Math.min(transform.sourceHeight, (cy + height / 2 - transform.padY) / transform.scale);
      if (right <= x || bottom <= y) continue;
      candidates.push({ class: COCO_LABELS[classId] || `class_${classId}`, score, bbox: [x, y, right - x, bottom - y] });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = [];
    for (const candidate of candidates.slice(0, 300)) {
      if (selected.every(item => item.class !== candidate.class || iou(item, candidate) < nmsThreshold)) selected.push(candidate);
      if (selected.length >= 100) break;
    }
    return selected;
  }

  async function detect(source, options = {}) {
    await load(options);
    const transform = prepare(source);
    const tensor = new window.ort.Tensor('float32', transform.input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const feeds = { [session.inputNames[0]]: tensor };
    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];
    return decode(output, transform, Number(options.threshold || 0.45), Number(options.nmsThreshold || 0.45));
  }

  window.VisionYolo = {
    load,
    detect,
    deviceAssessment,
    get status() { return session ? 'ready' : loadingPromise ? 'loading' : 'idle'; },
    get provider() { return executionProvider; },
    labels: COCO_LABELS,
  };
})();
