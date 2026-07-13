// ──────────────────────────────────────────────
//  AI Vision Pro — script.js
//  Refactored for Phase 2: AppState, Toast, ImageProcessor, HistorySafe, CameraManager
// ──────────────────────────────────────────────

// ── Alias AppState (backward compat, remove Phase 3) ──
// Generate thumbnail from canvas (alias for backward compat)
function generateThumbnail(imgEl) {
  const c = document.createElement('canvas');
  c.width = 320;
  const w = imgEl.naturalWidth || imgEl.width || 1;
  const h = imgEl.naturalHeight || imgEl.height || 1;
  c.height = Math.round(320 * (h / w));
  c.getContext('2d').drawImage(imgEl, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

// ponytail: aliases kept for features.js & live-recognize.js interop. Remove when those migrate.
Object.defineProperties(window, {
  classifierModel: { get: function() { return window.AppState.models.classifier.instance; }, set: function(v) { window.AppState.models.classifier.instance = v; } },
  detectorModel:   { get: function() { return window.AppState.models.detector.instance; },   set: function(v) { window.AppState.models.detector.instance = v; } },
  webcamStream:    { get: function() { return window.AppState.camera.stream; },               set: function(v) { window.AppState.camera.stream = v; } },
  webcamRunning:   { get: function() { return window.AppState.camera.isRunning; },            set: function(v) { window.AppState.camera.isRunning = v; } },
  currentMode:     { get: function() { return window.AppState.ui.activeMode; },               set: function(v) { window.AppState.ui.activeMode = v; } },
  lastAnalysis:    { get: function() { return window.AppState.analysis.lastResult; },         set: function(v) { window.AppState.analysis.lastResult = v; } },
  liveDetectRaf:   { get: function() { return window.AppState.camera.rafId; },                set: function(v) { window.AppState.camera.rafId = v; } },
  liveDetecting:   { get: function() { return window.AppState.camera.isPaused; },             set: function(v) { window.AppState.camera.isPaused = v; } }
});

// Legacy globals — kept for features.js that read them directly
var totalImages  = 0;
var totalObjects = 0;
var analysisHistory = [];
var liveBusy     = false;

const HISTORY_KEY        = 'ai-vision-history';
const LABEL_FILTER_KEY   = 'ai-vision-label-filter';
const MAX_HISTORY        = 15;

const COCO_CLASSES = [
    'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat',
    'traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog',
    'horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella',
    'handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite',
    'baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle',
    'wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange',
    'broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant',
    'bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone',
    'microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors',
    'teddy bear','hair drier','toothbrush'
];

const LABEL_PRESETS = {
    'person-phone': ['person', 'cell phone'],
    vehicles: ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'airplane', 'train', 'boat'],
    animals: ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe']
};

const activeLabelFilters = new Set();

// ── DOM Refs ────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const previewImage    = document.getElementById('preview-image');
const detCanvas       = document.getElementById('detection-canvas');
const analyzeBtn      = document.getElementById('analyze-btn');
const analyzeBtnText  = document.getElementById('analyze-btn-text');
const resetBtn        = document.getElementById('reset-btn');
const resultsSection  = document.getElementById('results-section');
const predictionList  = document.getElementById('prediction-list');
const statusText      = document.getElementById('status-text');
const aiDescText      = document.getElementById('ai-description-text');
const navStatusText   = document.getElementById('nav-status-text');
const modelStatusEl   = document.getElementById('model-status');
const detTags         = document.getElementById('detection-tags');
const detectionsSection = document.getElementById('detections-section');
const classifyLabel   = document.getElementById('classify-label');
const historyList     = document.getElementById('history-list');
const confSlider      = document.getElementById('confidence-slider');
const confValue       = document.getElementById('confidence-value');
const statTotal       = document.getElementById('stat-total');
const statObjects     = document.getElementById('stat-objects');
const webcamVideo     = document.getElementById('webcam-video');
const webcamCanvas    = document.getElementById('webcam-canvas');
const webcamPlaceholder = document.getElementById('webcam-placeholder');
const startWebcamBtn  = document.getElementById('start-webcam-btn');
const stopWebcamBtn   = document.getElementById('stop-webcam-btn');
const webcamCaptureBtn = document.getElementById('webcam-capture-btn');
const optLiveWrap      = document.getElementById('opt-live-wrap');
const optAutoShow      = document.getElementById('opt-auto-show');
const liveBadge           = document.getElementById('live-badge');
const optLabelFilter      = document.getElementById('opt-label-filter');
const labelFilterBody     = document.getElementById('label-filter-body');
const labelFilterChips    = document.getElementById('label-filter-chips');
const labelFilterInput    = document.getElementById('label-filter-input');
const labelFilterDropdown = document.getElementById('label-filter-dropdown');
const labelFilterHint     = document.getElementById('label-filter-hint');
const optDetect           = document.getElementById('opt-detect');

// ── Load model-loading hooks ───────────────────
// model-loader.js handles all state transitions.
// script.js just listens.
function __syncAppStateAliases() {
  // no-op: aliases auto-sync via getters
}

// ── Slider ──────────────────────────────────────
confSlider.addEventListener('input', () => {
    confValue.textContent = confSlider.value + '%';
    confSlider.style.setProperty('--val', confSlider.value + '%');
});
confSlider.dispatchEvent(new Event('input'));

// ── Label Filter ─────────────────────────────────
function normalizeClassId(name) {
    return (name || '').toLowerCase().trim();
}

function isLabelFilterActive() {
    return optLabelFilter?.checked && activeLabelFilters.size > 0;
}

function applyDetectionFilters(detections) {
    const threshold = parseInt(confSlider.value, 10) / 100;
    let list = detections.filter(d => d.score >= threshold);
    if (isLabelFilterActive()) {
        list = list.filter(d => activeLabelFilters.has(normalizeClassId(d.class)));
    }
    return list;
}

function updateLabelFilterHint() {
    if (!labelFilterHint) return;
    if (!optLabelFilter?.checked) {
        labelFilterHint.textContent = 'Bật lọc và thêm nhãn để giới hạn vật thể hiển thị';
        labelFilterHint.classList.remove('active');
        return;
    }
    if (activeLabelFilters.size === 0) {
        labelFilterHint.textContent = 'Đã bật lọc — thêm ít nhất một nhãn (vd: person, cell phone)';
        labelFilterHint.classList.add('active');
    } else {
        labelFilterHint.textContent = `Đang lọc ${activeLabelFilters.size} nhãn — chỉ hiển thị vật thể khớp`;
        labelFilterHint.classList.add('active');
    }
}

function syncLabelFilterUi() {
    const detectOn = optDetect?.checked;
    if (labelFilterBody) {
        labelFilterBody.classList.toggle('is-disabled', !detectOn);
    }
    updateLabelFilterHint();
}

function renderLabelChips() {
    if (!labelFilterChips) return;
    labelFilterChips.innerHTML = '';
    activeLabelFilters.forEach(id => {
        const chip = document.createElement('span');
        chip.className = 'label-chip';
        chip.innerHTML = `
            <span>${translateLabel(id)}</span>
            <button type="button" class="label-chip-remove" data-id="${id}" aria-label="Xóa ${id}">×</button>`;
        chip.querySelector('.label-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeLabelFilter(id);
        });
        labelFilterChips.appendChild(chip);
    });
}

function addLabelFilter(classId, options = {}) {
    const { silent = false } = options;
    const id = normalizeClassId(classId);
    if (!COCO_CLASSES.includes(id)) return false;
    if (activeLabelFilters.has(id)) return false;
    activeLabelFilters.add(id);
    renderLabelChips();
    updateLabelFilterHint();
    saveLabelFilterState();
    if (!silent) refreshDetectionDisplay();
    return true;
}

function removeLabelFilter(classId, options = {}) {
    const { silent = false } = options;
    const id = normalizeClassId(classId);
    if (!activeLabelFilters.delete(id)) return;
    renderLabelChips();
    updateLabelFilterHint();
    saveLabelFilterState();
    if (!silent) refreshDetectionDisplay();
}

function clearLabelFilters(options = {}) {
    const { silent = false } = options;
    activeLabelFilters.clear();
    renderLabelChips();
    updateLabelFilterHint();
    saveLabelFilterState();
    if (!silent) refreshDetectionDisplay();
}

function searchCocoLabels(query, limit = 8) {
    const q = normalizeClassId(query);
    if (!q) return COCO_CLASSES.slice(0, limit).map(id => ({ id, en: id, vi: translateLabel(id) }));
    return COCO_CLASSES
        .filter(id => {
            const vi = translateLabel(id);
            return id.includes(q) || vi.toLowerCase().includes(q);
        })
        .slice(0, limit)
        .map(id => ({ id, en: id, vi: translateLabel(id) }));
}

function resolveLabelFromQuery(query) {
    const q = normalizeClassId(query);
    if (!q) return null;
    if (COCO_CLASSES.includes(q)) return q;
    const exactVi = COCO_CLASSES.find(id => translateLabel(id).toLowerCase() === q);
    if (exactVi) return exactVi;
    const matches = searchCocoLabels(q, 1);
    return matches[0]?.id || null;
}

let dropdownHighlight = -1;

function hideLabelDropdown() {
    if (labelFilterDropdown) labelFilterDropdown.hidden = true;
    dropdownHighlight = -1;
}

function showLabelDropdown(items) {
    if (!labelFilterDropdown) return;
    labelFilterDropdown.innerHTML = '';
    dropdownHighlight = -1;

    if (!items.length) {
        labelFilterDropdown.innerHTML = '<div class="label-dropdown-empty">Không tìm thấy nhãn</div>';
    } else {
        items.forEach((item, i) => {
            if (activeLabelFilters.has(item.id)) return;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'label-dropdown-item';
            row.dataset.index = String(i);
            row.innerHTML = `<span>${item.vi}</span><span class="ld-en">${item.en}</span>`;
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                pickLabelFromDropdown(item.id);
            });
            labelFilterDropdown.appendChild(row);
        });
        if (!labelFilterDropdown.children.length) {
            labelFilterDropdown.innerHTML = '<div class="label-dropdown-empty">Tất cả nhãn đã được chọn</div>';
        }
    }
    labelFilterDropdown.hidden = false;
}

function pickLabelFromDropdown(classId) {
    if (addLabelFilter(classId)) {
        labelFilterInput.value = '';
        hideLabelDropdown();
        if (!optLabelFilter.checked) {
            optLabelFilter.checked = true;
            saveLabelFilterState();
        }
    }
}

function commitLabelInput() {
    const id = resolveLabelFromQuery(labelFilterInput.value);
    if (!id) {
        labelFilterInput.classList.add('shake');
        setTimeout(() => labelFilterInput.classList.remove('shake'), 400);
        return;
    }
    pickLabelFromDropdown(id);
}

function refreshDetectionDisplay() {
    const la = window.AppState.analysis.lastResult;
    if (!la?.rawDetections) return;

    const filtered = applyDetectionFilters(la.rawDetections);
    la.detections = filtered;

    detTags.innerHTML = '';
    detectionsSection.hidden = true;
    if (filtered.length) {
        renderDetectionTags(filtered);
        detectionsSection.hidden = false;
    }
    if (typeof updateResultsUI === 'function') updateResultsUI(la.predictions || [], filtered);

    generateDescription(la.predictions || [], filtered);

    const doBBoxes = document.getElementById('opt-bboxes').checked;
    if (window.currentMode === 'upload' && !previewImage.hidden) {
        if (doBBoxes && filtered.length) drawBoundingBoxes(previewImage, detCanvas, filtered);
        else {
            const ctx = detCanvas.getContext('2d');
            ctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
        }
    }
}

function saveLabelFilterState() {
    try {
        localStorage.setItem(LABEL_FILTER_KEY, JSON.stringify({
            enabled: !!optLabelFilter?.checked,
            labels: [...activeLabelFilters]
        }));
    } catch (e) { /* ignore quota */ }
}

function loadLabelFilterState() {
    try {
        const raw = localStorage.getItem(LABEL_FILTER_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.enabled && optLabelFilter) optLabelFilter.checked = true;
        (data.labels || []).forEach(id => addLabelFilter(id, { silent: true }));
    } catch (e) { /* ignore */ }
    syncLabelFilterUi();
}

function initLabelFilter() {
    if (!labelFilterInput) return;

    labelFilterInput.addEventListener('input', () => {
        const items = searchCocoLabels(labelFilterInput.value);
        if (labelFilterInput.value.trim()) showLabelDropdown(items);
        else hideLabelDropdown();
    });

    labelFilterInput.addEventListener('focus', () => {
        showLabelDropdown(searchCocoLabels(labelFilterInput.value));
    });

    labelFilterInput.addEventListener('keydown', (e) => {
        const items = [...labelFilterDropdown.querySelectorAll('.label-dropdown-item')];
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            dropdownHighlight = Math.min(dropdownHighlight + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('highlight', i === dropdownHighlight));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            dropdownHighlight = Math.max(dropdownHighlight - 1, 0);
            items.forEach((el, i) => el.classList.toggle('highlight', i === dropdownHighlight));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (dropdownHighlight >= 0 && items[dropdownHighlight]) {
                items[dropdownHighlight].dispatchEvent(new MouseEvent('mousedown'));
            } else {
                commitLabelInput();
            }
        } else if (e.key === 'Escape') {
            hideLabelDropdown();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.label-input-wrap')) hideLabelDropdown();
    });

    optLabelFilter?.addEventListener('change', () => {
        updateLabelFilterHint();
        saveLabelFilterState();
        refreshDetectionDisplay();
    });

    optDetect?.addEventListener('change', syncLabelFilterUi);

    document.querySelectorAll('.preset-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            if (preset === 'clear') {
                clearLabelFilters();
                return;
            }
            const ids = LABEL_PRESETS[preset];
            if (!ids) return;
            if (!optLabelFilter.checked) optLabelFilter.checked = true;
            ids.forEach(id => addLabelFilter(id, { silent: true }));
            saveLabelFilterState();
            updateLabelFilterHint();
            refreshDetectionDisplay();
        });
    });

    loadLabelFilterState();
}

// ── Mode Switch ─────────────────────────────────
function switchMode(mode) {
    window.currentMode = mode;
    document.getElementById('panel-upload').hidden = mode !== 'upload';
    document.getElementById('panel-webcam').hidden = mode !== 'webcam';
    document.getElementById('tab-upload').classList.toggle('active', mode === 'upload');
    document.getElementById('tab-webcam').classList.toggle('active', mode === 'webcam');
    optLiveWrap.hidden = mode !== 'webcam';
    const optTtsWrap = document.getElementById('opt-tts-wrap');
    if (optTtsWrap) optTtsWrap.hidden = mode !== 'webcam';
    if (mode !== 'webcam') {
        if (typeof stopShowRecognize === 'function') stopShowRecognize();
        else stopLiveDetection();
        // Cleanup camera when leaving webcam
        if (window.AppState.camera.isRunning) stopCamera();
    }
    resultsSection.hidden = true;
}

// ── File Upload ─────────────────────────────────
document.getElementById('browse-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const files = [...(e.target.files || [])];
    if (files.length > 1 && typeof enqueueBatchFiles === 'function') enqueueBatchFiles(files);
    else if (files[0]) handleFile(files[0]);
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-active'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length > 1 && typeof enqueueBatchFiles === 'function') enqueueBatchFiles(files);
    else if (files[0]) handleFile(files[0]);
});

function handleFile(file) {
    // Phase 2: validate before reading
    const validation = validateImage(file);
    if (!validation.valid) {
        showToast({ type: 'error', title: 'Tệp không hợp lệ', message: validation.error, duration: 4000 });
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        if (typeof showPreviewImage === 'function') showPreviewImage(e.target.result);
        else {
            // Revoke old URL if any
            var oldSrc = previewImage.src;
            if (oldSrc && oldSrc.startsWith('blob:')) {
                URL.revokeObjectURL(oldSrc);
            }
            previewImage.src = e.target.result;
            previewImage.hidden = false;
            document.getElementById('upload-placeholder').hidden = true;
            resetBtn.hidden = false;
        }
        resultsSection.hidden = true;
        const ctx = detCanvas.getContext('2d');
        ctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
        // Check any model ready
        if (window.AppState && window.AppState.anyModelReady()) analyzeBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

// ── Reset ────────────────────────────────────────
resetBtn.addEventListener('click', () => {
    var oldSrc = previewImage.src;
    if (oldSrc && oldSrc.startsWith('blob:')) {
        URL.revokeObjectURL(oldSrc);
    }
    previewImage.src = '';
    const pv = document.getElementById('preview-viewport');
    if (pv) pv.hidden = true;
    document.getElementById('upload-placeholder').hidden = false;
    resetBtn.hidden = true;
    analyzeBtn.disabled = true;
    resultsSection.hidden = true;
    fileInput.value = '';
    if (typeof resetPreviewTransform === 'function') resetPreviewTransform();
    const ctx = detCanvas.getContext('2d');
    ctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
});

// ── Analyze Image ────────────────────────────────
analyzeBtn.addEventListener('click', () => runAnalysis(previewImage, detCanvas));

async function runAnalysis(imgEl, canvas, options = {}) {
    const { silent = false, skipHistory = false } = options;
    var st = window.AppState;
    var classifier = st.models.classifier.instance;
    var detector   = st.models.detector.instance;

    if (!classifier && !detector) {
        if (!silent) showToast({ type: 'error', title: 'Mô hình chưa sẵn sàng', message: 'Chưa có mô hình AI nào hoạt động. Vui lòng đợi hoặc thử tải lại.', duration: 4000 });
        return null;
    }
    const doClassify = document.getElementById('opt-classify').checked && classifier;
    const doDetect   = document.getElementById('opt-detect').checked && detector;
    const doBBoxes   = document.getElementById('opt-bboxes').checked;

    if (!silent) {
        analyzeBtn.disabled = true;
        analyzeBtnText.textContent = 'Đang xử lý…';
        if (typeof showZoneSkeleton === 'function') showZoneSkeleton('Đang nhận diện…', 'analyze');
    }
    resultsSection.hidden = false;
    predictionList.innerHTML = '';
    detTags.innerHTML = '';
    detectionsSection.hidden = true;
    classifyLabel.hidden = true;
    if (!silent) {
        aiDescText.textContent = 'Đang phân tích…';
        statusText.textContent = 'Đang nhận diện…';
        document.querySelector('#result-dot').className = 'pulse-dot loading';
    }

    // Phase 2: Use inference canvas for large images
    var inferenceCanvas = null;
    var inferenceScaleX = 1, inferenceScaleY = 1;
    var effectiveImgEl = imgEl;

    try {
        // Wait for image to load if needed
        if (!imgEl.complete || imgEl.naturalWidth === 0) {
            await new Promise(function(resolve, reject) {
                imgEl.onload = resolve;
                imgEl.onerror = function() { reject(new Error('Image decode failed')); };
                // If already errored, trigger onerror
                if (imgEl.naturalWidth === 0 && !imgEl.complete) {
                    // still loading
                }
            });
        }

        // Create inference canvas (resized if needed)
        var proc = createInferenceCanvas(imgEl);
        inferenceCanvas = proc.canvas;
        inferenceScaleX = proc.scaleX;
        inferenceScaleY = proc.scaleY;

        // Use canvas for detection, original image for classification (MobileNet handles any size)
        var detectSource = (doDetect && detector) ? inferenceCanvas : imgEl;
        var classifySource = (doClassify && classifier) ? imgEl : imgEl;

        var t0 = performance.now();
        var tasks = [];
        var classTime = 0, detectTime = 0;

        if (doClassify && classifier) {
            var ct0 = performance.now();
            tasks.push(classifier.classify(classifySource).then(function(r) { classTime = performance.now() - ct0; return r; }));
        } else {
            tasks.push(Promise.resolve([]));
        }
        if (doDetect && detector) {
            var dt0 = performance.now();
            tasks.push(detector.detect(detectSource).then(function(r) { detectTime = performance.now() - dt0; return r; }));
        } else {
            tasks.push(Promise.resolve([]));
        }

        const [predictions, detections] = await Promise.all(tasks);
        var totalTime = performance.now() - t0;

        var rawDetections = detections;
        var filtered = applyDetectionFilters(rawDetections);

        // Scale detection bboxes from inference canvas coords to display coords
        if (filtered.length > 0 && inferenceCanvas && (inferenceCanvas.width !== imgEl.naturalWidth || inferenceCanvas.height !== imgEl.naturalHeight)) {
            // For display, we need to map back to original image coords first, then to canvas display coords
            // getImageMetrics handles the display mapping from original image coords
            // So we scale detections back to original image coords
            filtered = filtered.map(function(d) {
                return {
                    class: d.class,
                    score: d.score,
                    bbox: [
                        d.bbox[0] * inferenceScaleX,
                        d.bbox[1] * inferenceScaleY,
                        d.bbox[2] * inferenceScaleX,
                        d.bbox[3] * inferenceScaleY
                    ]
                };
            });
        }

        if (doDetect && detector && filtered.length > 0) {
            renderDetectionTags(filtered);
            detectionsSection.hidden = false;
            if (doBBoxes) drawBoundingBoxes(imgEl, canvas, filtered);
            totalObjects += filtered.length;
            statObjects.textContent = totalObjects;
        } else if (doBBoxes && canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        if (typeof updateResultsUI === 'function') updateResultsUI(predictions, filtered);
        else if (typeof renderResultTable === 'function') renderResultTable(filtered);

        if (doClassify && classifier && predictions.length > 0) {
            classifyLabel.hidden = false;
            renderPredictions(predictions);
        }

        const description = generateDescription(predictions, filtered);
        if (!silent) {
            statusText.textContent = 'Phân tích hoàn tất!';
            document.querySelector('#result-dot').className = 'pulse-dot success';
        }

        // Store in AppState
        const result = {
            src: imgEl.src || captureImageDataUrl(imgEl),
            predictions: predictions,
            rawDetections: rawDetections,
            detections: filtered,
            description: description,
            time: new Date().toISOString(),
            classificationTimeMs: classTime || null,
            detectionTimeMs: detectTime || null,
            totalTimeMs: totalTime
        };
        st.analysis.lastResult = result;
        st.analysis.isRunning = false;
        st.analysis.completedAt = Date.now();
        st.analysis.totalTimeMs = totalTime;

        if (!skipHistory) {
            totalImages++;
            statTotal.textContent = totalImages;
            addToHistory(result);
        }
        return result;

    } catch (err) {
        st.analysis.isRunning = false;
        if (!silent) {
            statusText.textContent = 'Lỗi phân tích!';
            document.querySelector('#result-dot').className = 'pulse-dot error';
            aiDescText.textContent = 'Đã xảy ra lỗi khi nhận diện. Vui lòng thử lại.';
        }
        console.error(err);
        return null;
    } finally {
        if (!silent) {
            analyzeBtn.disabled = false;
            analyzeBtnText.textContent = 'Bắt đầu nhận diện';
            if (typeof hideZoneSkeleton === 'function') hideZoneSkeleton();
        }
    }
}

function captureImageDataUrl(imgEl) {
    const c = document.createElement('canvas');
    const w = imgEl.naturalWidth || imgEl.videoWidth || imgEl.width;
    const h = imgEl.naturalHeight || imgEl.videoHeight || imgEl.height;
    if (!w || !h) return '';
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(imgEl, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
}

// ── Draw Bounding Boxes ──────────────────────────
function getImageMetrics(imgEl, canvas) {
    const natW = imgEl.naturalWidth || imgEl.videoWidth || imgEl.width;
    const natH = imgEl.naturalHeight || imgEl.videoHeight || imgEl.height;
    const rect = imgEl.getBoundingClientRect();
    const container = canvas.parentElement.getBoundingClientRect();
    const dispW = rect.width || container.width;
    const dispH = rect.height || container.height;
    const imgRatio = natW / natH;
    const boxRatio = dispW / dispH;
    let drawW, drawH, offsetX, offsetY;
    if (imgRatio > boxRatio) {
        drawW = dispW;
        drawH = dispW / imgRatio;
        offsetX = 0;
        offsetY = (dispH - drawH) / 2;
    } else {
        drawH = dispH;
        drawW = dispH * imgRatio;
        offsetX = (dispW - drawW) / 2;
        offsetY = 0;
    }
    return { natW, natH, drawW, drawH, offsetX, offsetY, dispW, dispH };
}

function drawBoundingBoxes(imgEl, canvas, detections) {
    const { natW, natH, drawW, drawH, offsetX, offsetY, dispW, dispH } = getImageMetrics(imgEl, canvas);
    canvas.width  = Math.round(dispW);
    canvas.height = Math.round(dispH);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scaleX = drawW / natW;
    const scaleY = drawH / natH;

    detections.forEach((det, i) => {
        const [x, y, w, h] = det.bbox;
        const sx = offsetX + x * scaleX, sy = offsetY + y * scaleY;
        const sw = w * scaleX, sh = h * scaleY;
        if (typeof drawBoxOnContext === 'function') {
            drawBoxOnContext(ctx, sx, sy, sw, sh, det, i, 1);
        }
    });
}

// ── Render Detection Tags ────────────────────────
function renderDetectionTags(detections) {
    const counts = {};
    detections.forEach(d => {
        counts[d.class] = counts[d.class] || { count: 0, score: 0 };
        counts[d.class].count++;
        counts[d.class].score = Math.max(counts[d.class].score, d.score);
    });
    Object.entries(counts).forEach(([cls, info], i) => {
        const tag = document.createElement('div');
        tag.className = 'det-tag';
        tag.style.animationDelay = `${i * 0.06}s`;
        tag.innerHTML = `${info.count > 1 ? info.count + '× ' : ''}${translateLabel(cls)} <span class="conf">${(info.score*100).toFixed(0)}%</span>`;
        detTags.appendChild(tag);
    });
}

// ── Render Classification Predictions ───────────
function renderPredictions(predictions) {
    predictions.slice(0, 5).forEach((p, i) => {
        const pct = (p.probability * 100).toFixed(1);
        const item = document.createElement('div');
        item.className = 'prediction-item';
        item.style.animationDelay = `${i * 0.07}s`;
        item.innerHTML = `
            <div class="pred-rank">${i + 1}</div>
            <div class="pred-info">
                <div class="pred-name">${p.className.split(',')[0]}</div>
                <div class="pred-vi">${translateLabel(p.className.split(',')[0])}</div>
            </div>
            <div class="pred-bar-wrap">
                <div class="pred-bar-bg"><div class="pred-bar" data-width="${pct}"></div></div>
                <span class="pred-pct">${pct}%</span>
            </div>`;
        predictionList.appendChild(item);
    });
    // Animate bars
    requestAnimationFrame(() => {
        document.querySelectorAll('.pred-bar').forEach(bar => {
            bar.style.width = bar.dataset.width + '%';
        });
    });
}

// ── Generate Smart Description ───────────────────
function generateDescription(predictions, detections) {
    let desc = '';
    const topName = predictions[0]?.className?.split(',')[0] || '';
    const topConf = predictions[0] ? (predictions[0].probability * 100).toFixed(0) : 0;

    const counts = {};
    detections.forEach(d => counts[d.class] = (counts[d.class] || 0) + 1);
    const objList = Object.keys(counts);

    if (objList.length > 0) {
        const parts = objList.map(k => `${counts[k] > 1 ? counts[k] + ' ' : ''}${translateLabel(k)}`);
        desc = `Tôi phát hiện ${parts.join(', ')} trong ảnh. `;
        if (topName) desc += `Hình ảnh được phân loại chủ yếu là "${translateLabel(topName)}" (${topConf}%).`;
        if (parseInt(topConf) > 85) desc = '✨ ' + desc;
    } else if (topName) {
        desc = `Hình ảnh này có vẻ là về "${translateLabel(topName)}" với độ chính xác khoảng ${topConf}%.`;
        if (parseInt(topConf) > 90) desc = '🎯 ' + desc;
    } else {
        desc = 'Không thể xác định rõ nội dung hình ảnh. Hãy thử ảnh rõ hơn.';
    }
    aiDescText.textContent = desc;
    return desc;
}

// ── History (uses history-safe.js) ──────────────
function addToHistory(result) {
    const empty = historyList.querySelector('.history-empty');
    if (empty) empty.remove();

    const label = result.predictions?.[0]?.className?.split(',')[0] || 'Hình ảnh';
    const time  = new Date(result.time).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
    const id    = result.id || Date.now().toString();

    // Generate thumbnail from image element
    var thumb = '';
    var img = document.getElementById('preview-image');
    if (img && img.complete && img.naturalWidth > 0) {
        thumb = generateThumbnail(img);
    }

    // Save via history-safe module
    addHistoryItem({
        id: id,
        fileName: label,
        createdAt: Date.now(),
        thumbnail: thumb,
        classificationSummary: result.predictions?.slice(0, 3).map(function(p) { return p.className.split(',')[0] + ' (' + (p.probability * 100).toFixed(0) + '%)'; }).join('; ') || '',
        detectionSummary: (result.detections || []).slice(0, 5).map(function(d) { return translateLabel(d.class) + ' (' + (d.score * 100).toFixed(0) + '%)'; }).join(', ') || '',
        totalObjects: (result.detections || []).length,
        processingTimeMs: result.totalTimeMs || 0
    });

    // Render in UI
    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.id = id;
    item.innerHTML = `
        <img class="history-thumb" src="${thumb || result.src}" alt="${label}">
        <div class="history-info">
            <div class="history-label">${translateLabel(label)}</div>
            <div class="history-meta">${result.detections?.length || 0} vật thể · ${time}</div>
        </div>`;
    item.addEventListener('click', () => restoreFromHistory(id));
    historyList.prepend(item);
    result.id = id;
    analysisHistory.unshift(result);

    while (historyList.querySelectorAll('.history-item').length > MAX_HISTORY) {
        var last = historyList.lastElementChild;
        if (last) last.remove();
        analysisHistory.pop();
    }
}

function restoreFromHistory(id) {
    // Try new storage first, fall back to old in-memory
    var entry = analysisHistory.find(function(h) { return h.id === id; });
    if (!entry) return;

    historyList.querySelectorAll('.history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });

    window.lastAnalysis = {
        ...entry,
        rawDetections: entry.rawDetections || entry.detections || []
    };
    const filtered = applyDetectionFilters(window.lastAnalysis.rawDetections);
    window.lastAnalysis.detections = filtered;
    resultsSection.hidden = false;
    predictionList.innerHTML = '';
    detTags.innerHTML = '';
    detectionsSection.hidden = true;
    classifyLabel.hidden = true;

    if (entry.predictions?.length) {
        classifyLabel.hidden = false;
        renderPredictions(entry.predictions);
    }
    if (filtered.length) {
        renderDetectionTags(filtered);
        detectionsSection.hidden = false;
    }
    if (typeof updateResultsUI === 'function') updateResultsUI(entry.predictions || [], filtered);
    aiDescText.textContent = generateDescription(entry.predictions || [], filtered);
    statusText.textContent = 'Đã tải lại kết quả';
    document.querySelector('#result-dot').className = 'pulse-dot success';

    if (window.currentMode === 'upload' && entry.src) {
        previewImage.src = entry.src;
        previewImage.hidden = false;
        document.getElementById('upload-placeholder').hidden = true;
        resetBtn.hidden = false;
        analyzeBtn.disabled = false;
        if (document.getElementById('opt-bboxes').checked && filtered.length) {
            const redraw = () => drawBoundingBoxes(previewImage, detCanvas, filtered);
            previewImage.onload = redraw;
            if (previewImage.complete) redraw();
        }
    }
}

// Save reference to history-safe.js handler before we override
var __origClearHistory = window.clearHistory;
function clearHistory() {
    if (typeof __origClearHistory === 'function') __origClearHistory();
    else try { localStorage.removeItem(HISTORY_KEY); } catch(e) {}
    analysisHistory = [];
    statTotal.textContent = '0';
}

// ── Load history from safe storage on init ──────
function loadHistoryFromStorage() {
    var items = window.getHistory();
    if (!items || !items.length) return;

    const empty = historyList.querySelector('.history-empty');
    if (empty) empty.remove();

    var reconstructed = [];
    items.forEach(function(entry) {
        var label = entry.classificationSummary?.split(';')[0]?.split('(')[0]?.trim() || 'Hình ảnh';
        var time = new Date(entry.createdAt).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
        var id = entry.id;
        var item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.id = id;
        item.innerHTML = `
            <img class="history-thumb" src="${entry.thumbnail || ''}" alt="${label}">
            <div class="history-info">
                <div class="history-label">${label}</div>
                <div class="history-meta">${entry.totalObjects || 0} vật thể · ${time}</div>
            </div>`;
        item.addEventListener('click', function() {
            // Currently only UI recall — full result data no longer in storage
            showToast({ type: 'info', title: 'Thông tin', message: 'Chi tiết phân tích không còn trong lịch sử. Vui lòng phân tích lại.', duration: 3000 });
        });
        historyList.appendChild(item);
        reconstructed.push({ id: id, label: label });
    });
    analysisHistory = [];
}

// ── Export Result ────────────────────────────────
function exportResult() {
    var latest = window.AppState.analysis.lastResult || analysisHistory[0];
    if (!latest) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để xuất!', duration: 3000 }); return; }
    const lines  = [
        '=== AI Vision Pro — Kết quả nhận diện ===',
        `Thời gian: ${new Date().toLocaleString('vi-VN')}`,
        '',
        '--- Phân loại (MobileNet) ---',
        ...(latest.predictions || []).map((p,i) => `  ${i+1}. ${p.className.split(',')[0]} — ${(p.probability*100).toFixed(1)}%`),
        '',
        '--- Vật thể phát hiện (COCO-SSD) ---',
        ...(latest.detections || []).map(d => `  • ${translateLabel(d.class)} — ${(d.score*100).toFixed(0)}%`),
        '',
        '--- Mô tả AI ---',
        latest.description || ''
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'ket-qua-nhandien.txt' });
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function exportAnnotatedImage() {
    var latest = window.AppState.analysis.lastResult;
    if (!latest?.src) { showToast({ type: 'warning', title: 'Chưa có ảnh', message: 'Chưa có ảnh để xuất!', duration: 3000 }); return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const natScale = Math.max(1, c.width / 600);
        (latest.detections || []).forEach((det, i) => {
            const [x, y, w, h] = det.bbox;
            if (typeof drawBoxOnContext === 'function') {
                drawBoxOnContext(ctx, x, y, w, h, det, i, natScale);
            }
        });

        const a = Object.assign(document.createElement('a'), {
            href: c.toDataURL('image/png'),
            download: 'anh-nhandien.png'
        });
        a.click();
    };
    img.onerror = function() {
        showToast({ type: 'error', title: 'Lỗi', message: 'Không thể tải ảnh để xuất.', duration: 3000 });
    };
    img.src = latest.src;
}

function exportJSON() {
    var latest = window.AppState.analysis.lastResult || analysisHistory[0];
    if (!latest) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để xuất!', duration: 3000 }); return; }
    var data = {
        time: latest.time,
        classification: (latest.predictions || []).map(function(p) { return { label: p.className, confidence: p.probability }; }),
        detections: (latest.detections || []).map(function(d) { return { label: d.class, confidence: d.score, bbox: d.bbox }; }),
        description: latest.description
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = Object.assign(document.createElement('a'), { href: url, download: 'ket-qua.json' });
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function exportCSV() {
    var latest = window.AppState.analysis.lastResult || analysisHistory[0];
    if (!latest) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để xuất!', duration: 3000 }); return; }
    var rows = [['Nhãn', 'Độ tin cậy', 'x', 'y', 'w', 'h']];
    (latest.detections || []).forEach(function(d) {
        rows.push([d.class, d.score.toFixed(3), d.bbox[0].toFixed(1), d.bbox[1].toFixed(1), d.bbox[2].toFixed(1), d.bbox[3].toFixed(1)]);
    });
    var csv = rows.map(function(r) { return r.join(','); }).join('\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = Object.assign(document.createElement('a'), { href: url, download: 'ket-qua.csv' });
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function speakResults() {
    var latest = window.AppState.analysis.lastResult || analysisHistory[0];
    if (!latest) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để đọc!', duration: 3000 }); return; }
    if (!window.speechSynthesis) { showToast({ type: 'warning', title: 'Không hỗ trợ TTS', message: 'Trình duyệt không hỗ trợ đọc giọng nói.', duration: 3000 }); return; }
    var text = latest.description || 'Không có mô tả.';
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    window.speechSynthesis.speak(utterance);
}

// ── Live Webcam Detection (delegated to live-recognize.js, kept for backward compat) ──
function stopLiveDetection() {
    window.liveDetecting = false;
    if (window.AppState.camera.rafId) {
        cancelAnimationFrame(window.AppState.camera.rafId);
        window.AppState.camera.rafId = null;
    }
    if (typeof window.stopShowRecognize === 'function') window.stopShowRecognize();
}
// ponytail: liveDetectionLoop removed — use live-recognize.js showRecognizeLoop instead.
// optAutoShow listener removed — handled in live-recognize.js only.

confSlider.addEventListener('change', () => {
    saveLabelFilterState();
    refreshDetectionDisplay();
});

confSlider.addEventListener('input', () => {
    var la = window.AppState.analysis.lastResult;
    if (la?.rawDetections) refreshDetectionDisplay();
});

// ── Webcam (uses camera-manager.js) ──
startWebcamBtn.addEventListener('click', function() {
    if (!window.AppState.anyModelReady()) {
        showToast({ type: 'warning', title: 'Mô hình chưa sẵn sàng', message: 'Vui lòng đợi mô hình AI tải xong.', duration: 4000 });
        return;
    }
    startCamera().then(function() {
        webcamCaptureBtn.disabled = false;
        if (typeof startShowRecognize === 'function') startShowRecognize();
    }).catch(function(err) {
        webcamCaptureBtn.disabled = true;
    });
});

stopWebcamBtn.addEventListener('click', function() {
    if (typeof stopShowRecognize === 'function') stopShowRecognize();
    else stopLiveDetection();
    stopCamera();
    webcamCaptureBtn.disabled = true;
    const ctx = webcamCanvas.getContext('2d');
    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
});

webcamCaptureBtn.addEventListener('click', async () => {
    if (!window.webcamRunning || !window.classifierModel || !window.detectorModel) return;
    if (typeof stopShowRecognize === 'function') stopShowRecognize();
    else stopLiveDetection();
    const offscreen = document.createElement('canvas');
    offscreen.width  = webcamVideo.videoWidth;
    offscreen.height = webcamVideo.videoHeight;
    offscreen.getContext('2d').drawImage(webcamVideo, 0, 0);
    const img = new Image();
    img.src = offscreen.toDataURL('image/jpeg', 0.9);
    img.onload = async () => {
        await runAnalysis(img, webcamCanvas);
    };
});

// ── Flip camera ──
document.getElementById('flip-camera-btn')?.addEventListener('click', function() {
    window.facingMode = window.facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
});

// ── Translation Dictionary ───────────────────────
function translateLabel(label) {
    const dict = {
        // Animals
        'person':'người','dog':'chó','cat':'mèo','bird':'chim','horse':'ngựa',
        'cow':'bò','sheep':'cừu','elephant':'voi','bear':'gấu','zebra':'ngựa vằn',
        'giraffe':'hươu cao cổ','rabbit':'thỏ','fish':'cá',
        'hamster':'chuột hamster','fox':'cáo','squirrel':'sóc','monkey':'khỉ',
        'lion':'sư tử','tiger':'hổ','wolf':'sói','duck':'vịt','chicken':'gà',
        'pig':'lợn','frog':'ếch','snake':'rắn','turtle':'rùa','kangaroo':'chuột túi',
        'koala':'koala','panda':'gấu trúc','crab':'cua','lobster':'tôm hùm',
        // Vehicles
        'car':'ô tô','truck':'xe tải','bus':'xe buýt','motorcycle':'xe máy',
        'bicycle':'xe đạp','airplane':'máy bay','boat':'thuyền','train':'tàu hỏa',
        // Objects
        'bottle':'chai nước','cup':'cái cốc','bowl':'bát đĩa','wine glass':'ly rượu',
        'fork':'nĩa','knife':'dao','spoon':'thìa','chair':'ghế','couch':'ghế sofa',
        'bed':'giường','dining table':'bàn ăn','table':'bàn','toilet':'bồn cầu',
        'tv':'TV/Tivi','laptop':'máy tính xách tay','mouse':'chuột máy tính',
        'remote':'điều khiển từ xa','keyboard':'bàn phím','cell phone':'điện thoại',
        'book':'sách','clock':'đồng hồ','vase':'lọ hoa','scissors':'kéo',
        'teddy bear':'gấu bông','hair drier':'máy sấy tóc','toothbrush':'bàn chải đánh răng',
        // Food
        'banana':'chuối','apple':'táo','sandwich':'bánh mì sandwich','orange':'cam',
        'broccoli':'súp lơ','carrot':'cà rốt','hot dog':'bánh mì hot dog',
        'pizza':'bánh pizza','donut':'bánh vòng','cake':'bánh kem',
        // Nature
        'potted plant':'cây cảnh','flower':'hoa','tree':'cây',
        // Sports & accessories
        'sports ball':'bóng thể thao','kite':'con diều','baseball bat':'gậy bóng chày',
        'baseball glove':'găng tay bóng chày','skateboard':'ván trượt',
        'surfboard':'ván lướt sóng','tennis racket':'vợt tennis',
        // Specific breeds / types
        'golden retriever':'chó Golden Retriever','labrador retriever':'chó Labrador',
        'poodle':'chó Poodle','german shepherd':'chó German Shepherd',
        'persian cat':'mèo Ba Tư','siamese cat':'mèo Xiêm','tabby':'mèo mướp',
        'egyptian cat':'mèo Ai Cập',
        // Misc
        'backpack':'ba lô','umbrella':'ô/dù','handbag':'túi xách',
        'tie':'cà vạt','suitcase':'vali','fire hydrant':'họng cứu hỏa',
        'stop sign':'biển dừng','parking meter':'đồng hồ đỗ xe',
        'bench':'ghế dài','traffic light':'đèn giao thông',
        'beach':'bãi biển','mountain':'núi','building':'tòa nhà',
        'food':'thức ăn','drink':'đồ uống','sky':'bầu trời','road':'con đường',
        'sports car':'xe thể thao','mountain bike':'xe đạp địa hình',
        'monitor':'màn hình máy tính','microwave':'lò vi sóng',
        'oven':'lò nướng','toaster':'máy nướng bánh','sink':'bồn rửa',
        'refrigerator':'tủ lạnh','hair brush':'bàn chải tóc'
    };
    const low = label.toLowerCase();
    for (const key of Object.keys(dict)) {
        if (low.includes(key)) return dict[key];
    }
    return label;
}

// ── Init ──
initLabelFilter();
loadHistoryFromStorage();

// Kick off model loading — this was the critical missing call.
// modelLoader.init() is defined in js/model-loader.js and handles
// independent status for MobileNet and COCO-SSD with 30s timeout.
if (typeof modelLoader !== 'undefined' && modelLoader.init) {
    modelLoader.init();
}

// Update nav status based on AppState
function __pollAppState() {
    var st = window.AppState;
    var navDot = document.querySelector('#model-status .pulse-dot');
    if (st.anyModelReady()) {
        if (navDot) navDot.className = 'pulse-dot success';
        navStatusText.textContent = 'Hệ thống AI sẵn sàng';
        statusText.textContent = 'Sẵn sàng';
    } else if (st.models.classifier.status === 'loading' || st.models.detector.status === 'loading') {
        if (navDot) navDot.className = 'pulse-dot loading';
        navStatusText.textContent = 'Đang tải mô hình AI…';
    } else if (st.models.classifier.status === 'error' && st.models.detector.status === 'error') {
        if (navDot) navDot.className = 'pulse-dot error';
        navStatusText.textContent = 'Lỗi tải mô hình';
    }
}
setInterval(__pollAppState, 2000);
__pollAppState();
