// ── Model Loader ───────────────────────────────────
// Manages MobileNet & COCO-SSD loading with independent 4-state lifecycle.

const MODEL_TIMEOUT_MS = 30000;

const MODEL_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error'
});

const MODEL_NAMES = {
  classifier: 'MobileNet',
  detector: 'COCO-SSD'
};

function initModelState(name) {
  return {
    name,
    instance: null,
    status: MODEL_STATES.IDLE,
    error: null,
    loadTimeMs: null,
    loadPromise: null
  };
}

async function loadClassifier() {
  const state = window.AppState.models.classifier;
  if (state.status === MODEL_STATES.LOADING) return state.loadPromise;
  if (state.status === MODEL_STATES.READY && state.instance) return state.instance;

  state.status = MODEL_STATES.LOADING;
  state.error = null;
  state.loadPromise = null;

  const start = performance.now();
  state.loadPromise = Promise.race([
    loadMobileNetInternal(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), MODEL_TIMEOUT_MS)
    )
  ]);

  try {
    const model = await state.loadPromise;
    state.instance = model;
    state.status = MODEL_STATES.READY;
    state.loadTimeMs = performance.now() - start;
    window.classifierModel = model;
    updateModelUI();
    return model;
  } catch (err) {
    state.status = MODEL_STATES.ERROR;
    state.error = err.message || 'Lỗi tải MobileNet';
    state.loadTimeMs = performance.now() - start;
    window.classifierModel = null;
    updateModelUI();
    throw err;
  }
}

function loadMobileNetInternal() {
  return new Promise((resolve, reject) => {
    if (typeof mobilenet === 'undefined') {
      reject(new Error('MobileNet library not loaded'));
      return;
    }
    mobilenet.load().then(resolve).catch(reject);
  });
}

async function loadDetector() {
  const state = window.AppState.models.detector;
  if (state.status === MODEL_STATES.LOADING) return state.loadPromise;
  if (state.status === MODEL_STATES.READY && state.instance) return state.instance;

  state.status = MODEL_STATES.LOADING;
  state.error = null;
  state.loadPromise = null;

  const start = performance.now();
  state.loadPromise = Promise.race([
    loadCocoSsdInternal(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), MODEL_TIMEOUT_MS)
    )
  ]);

  try {
    const model = await state.loadPromise;
    state.instance = model;
    state.status = MODEL_STATES.READY;
    state.loadTimeMs = performance.now() - start;
    window.detectorModel = model;
    updateModelUI();
    return model;
  } catch (err) {
    state.status = MODEL_STATES.ERROR;
    state.error = err.message || 'Lỗi tải COCO-SSD';
    state.loadTimeMs = performance.now() - start;
    window.detectorModel = null;
    updateModelUI();
    throw err;
  }
}

function loadCocoSsdInternal() {
  return new Promise((resolve, reject) => {
    if (typeof cocoSsd === 'undefined') {
      reject(new Error('COCO-SSD library not loaded'));
      return;
    }
    cocoSsd.load().then(resolve).catch(reject);
  });
}

function retryModel(modelKey) {
  const state = window.AppState.models[modelKey];
  if (!state || state.status === MODEL_STATES.LOADING) return;
  if (modelKey === 'classifier') loadClassifier().catch(() => {});
  else if (modelKey === 'detector') loadDetector().catch(() => {});
}

let __lastNotifiedState = { classifier: 'idle', detector: 'idle' };

function updateModelUI() {
  const cls = window.AppState.models.classifier;
  const det = window.AppState.models.detector;

  // Update status badges
  const clsBadge = document.getElementById('model-status-classifier');
  const detBadge = document.getElementById('model-status-detector');
  if (clsBadge) { clsBadge.textContent = getStatusText(cls.status); clsBadge.className = `model-badge model-${cls.status}`; }
  if (detBadge) { detBadge.textContent = getStatusText(det.status); detBadge.className = `model-badge model-${det.status}`; }

  // Update retry buttons
  const clsRetry = document.getElementById('retry-classifier');
  const detRetry = document.getElementById('retry-detector');
  if (clsRetry) clsRetry.disabled = cls.status !== MODEL_STATES.ERROR;
  if (detRetry) detRetry.disabled = det.status !== MODEL_STATES.ERROR;

  // Handle overlay & skeleton
  const anyReady = window.AppState.anyModelReady();
  const bothError = !anyReady && cls.status === MODEL_STATES.ERROR && det.status === MODEL_STATES.ERROR;

  if (anyReady) {
    if (typeof hideZoneSkeleton === 'function') hideZoneSkeleton();
    if (__lastNotifiedState.classifier !== cls.status || __lastNotifiedState.detector !== det.status) {
      showToast({ type: 'success', title: 'Mô hình AI sẵn sàng', message: getReadyMessage(), duration: 3000 });
    }
  } else if (bothError) {
    if (typeof showZoneSkeleton === 'function') showZoneSkeleton('Không thể tải mô hình AI. Kiểm tra kết nối mạng/CDN.', 'model');
    if (__lastNotifiedState.classifier !== cls.status || __lastNotifiedState.detector !== det.status) {
      showToast({ type: 'error', title: 'Lỗi tải mô hình', message: 'Cả MobileNet và COCO-SSD đều lỗi. Kiểm tra mạng/CDN.', duration: 0 });
    }
  } else if (cls.status === MODEL_STATES.LOADING || det.status === MODEL_STATES.LOADING) {
    if (typeof showZoneSkeleton === 'function') showZoneSkeleton('Đang tải mô hình AI…', 'model');
  }

  __lastNotifiedState = { classifier: cls.status, detector: det.status };

  // Enable/disable analyze button based on model state
  if (window.AppState.anyModelReady()) {
    const previewVisible = document.getElementById('preview-image') && !document.getElementById('preview-image').hidden;
    if (typeof analyzeBtn !== 'undefined' && analyzeBtn) analyzeBtn.disabled = !previewVisible;
  } else {
    if (typeof analyzeBtn !== 'undefined' && analyzeBtn) analyzeBtn.disabled = true;
  }
}

function getStatusText(status) {
  const map = {
    idle: 'Chưa tải',
    loading: 'Đang tải…',
    ready: 'Sẵn sàng',
    error: 'Lỗi'
  };
  return map[status] || status;
}

function getReadyMessage() {
  const parts = [];
  if (window.AppState.models.classifier.status === MODEL_STATES.READY) parts.push('MobileNet');
  if (window.AppState.models.detector.status === MODEL_STATES.READY) parts.push('COCO-SSD');
  return parts.join(' & ') + ' đã sẵn sàng.';
}

async function loadAllModels() {
  // Load both in parallel, each independent
  const promises = [];
  promises.push(loadClassifier().catch(() => {}));
  promises.push(loadDetector().catch(() => {}));
  await Promise.allSettled(promises);
  return {
    classifier: window.AppState.models.classifier.status,
    detector: window.AppState.models.detector.status
  };
}

window.loadAllModels = loadAllModels;
window.loadClassifier = loadClassifier;
window.loadDetector = loadDetector;
window.retryModel = retryModel;
window.MODEL_STATES = MODEL_STATES;

// ── Public API ──
const modelLoader = {
  init: loadAllModels,
  loadClassifier,
  loadDetector,
  retryModel,
  MODEL_STATES
};
window.modelLoader = modelLoader;
