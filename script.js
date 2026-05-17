// ──────────────────────────────────────────────
//  AI Vision Pro — script.js
// ──────────────────────────────────────────────

// ── State ──────────────────────────────────────
let classifierModel = null;
let detectorModel   = null;
let webcamStream    = null;
let webcamRunning   = false;
let totalImages     = 0;
let totalObjects    = 0;
let analysisHistory = [];
let liveDetecting   = false;
let liveDetectRaf   = null;
let lastAnalysis    = null;
let currentMode     = 'upload';
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

// ── Load Models ─────────────────────────────────
async function loadModels() {
    const dot = document.querySelector('#model-status .pulse-dot');
    dot.className = 'pulse-dot loading';
    navStatusText.textContent = 'Đang tải mô hình AI…';
    try {
        classifierModel = await mobilenet.load({ version: 2, alpha: 1.0 });
        try {
            detectorModel = await cocoSsd.load({ base: 'mobilenet_v2' });
        } catch (e) {
            console.warn('mobilenet_v2 không khả dụng, dùng mô hình mặc định:', e);
            detectorModel = await cocoSsd.load();
        }
        dot.className = 'pulse-dot success';
        navStatusText.textContent = 'Hệ thống AI sẵn sàng';
        statusText.textContent = 'Hệ thống sẵn sàng';
        if (typeof setModelsReady === 'function') setModelsReady(true);
        else if (!previewImage.hidden && previewImage.src) analyzeBtn.disabled = false;
    } catch (err) {
        dot.className = 'pulse-dot error';
        navStatusText.textContent = 'Lỗi tải mô hình!';
        if (typeof hideZoneSkeleton === 'function') hideZoneSkeleton();
        console.error(err);
    }
}
loadModels();
loadHistoryFromStorage();

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
    if (!lastAnalysis?.rawDetections) return;

    const filtered = applyDetectionFilters(lastAnalysis.rawDetections);
    lastAnalysis.detections = filtered;

    detTags.innerHTML = '';
    detectionsSection.hidden = true;
    if (filtered.length) {
        renderDetectionTags(filtered);
        detectionsSection.hidden = false;
    }
    if (typeof updateResultsUI === 'function') updateResultsUI(lastAnalysis.predictions || [], filtered);

    generateDescription(lastAnalysis.predictions || [], filtered);

    const doBBoxes = document.getElementById('opt-bboxes').checked;
    if (currentMode === 'upload' && !previewImage.hidden) {
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
    currentMode = mode;
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
    if (file.size > 20 * 1024 * 1024) {
        alert('Tệp quá lớn. Vui lòng chọn ảnh dưới 20MB.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        if (typeof showPreviewImage === 'function') showPreviewImage(e.target.result);
        else {
            previewImage.src = e.target.result;
            previewImage.hidden = false;
            document.getElementById('upload-placeholder').hidden = true;
            resetBtn.hidden = false;
        }
        resultsSection.hidden = true;
        const ctx = detCanvas.getContext('2d');
        ctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
        if (window.modelsReady) analyzeBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

// ── Reset ────────────────────────────────────────
resetBtn.addEventListener('click', () => {
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
    if (!classifierModel || !detectorModel) {
        if (!silent) alert('Mô hình AI chưa sẵn sàng, vui lòng đợi giây lát!');
        return null;
    }
    const doClassify = document.getElementById('opt-classify').checked;
    const doDetect   = document.getElementById('opt-detect').checked;
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

    try {
        const tasks = [];
        if (doClassify) tasks.push(classifierModel.classify(imgEl));
        else tasks.push(Promise.resolve([]));
        if (doDetect) tasks.push(detectorModel.detect(imgEl));
        else tasks.push(Promise.resolve([]));

        const [predictions, detections] = await Promise.all(tasks);

        const rawDetections = detections;
        const filtered = applyDetectionFilters(rawDetections);

        if (doDetect && filtered.length > 0) {
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

        if (doClassify && predictions.length > 0) {
            classifyLabel.hidden = false;
            renderPredictions(predictions);
        }

        const description = generateDescription(predictions, filtered);
        if (!silent) {
            statusText.textContent = 'Phân tích hoàn tất!';
            document.querySelector('#result-dot').className = 'pulse-dot success';
        }

        const result = {
            src: imgEl.src || captureImageDataUrl(imgEl),
            predictions,
            rawDetections,
            detections: filtered,
            description,
            time: new Date().toISOString()
        };
        lastAnalysis = result;

        if (!skipHistory) {
            totalImages++;
            statTotal.textContent = totalImages;
            addToHistory(result);
        }
        return result;

    } catch (err) {
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

// ── History ──────────────────────────────────────
function addToHistory(result) {
    const empty = historyList.querySelector('.history-empty');
    if (empty) empty.remove();

    const label = result.predictions?.[0]?.className?.split(',')[0] || 'Hình ảnh';
    const time  = new Date(result.time).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
    const id    = result.id || Date.now().toString();
    result.id = id;

    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.id = id;
    item.innerHTML = `
        <img class="history-thumb" src="${result.src}" alt="${label}">
        <div class="history-info">
            <div class="history-label">${translateLabel(label)}</div>
            <div class="history-meta">${result.detections?.length || 0} vật thể · ${time}</div>
        </div>`;
    item.addEventListener('click', () => restoreFromHistory(id));
    historyList.prepend(item);
    analysisHistory.unshift(result);

    while (historyList.querySelectorAll('.history-item').length > MAX_HISTORY) {
        historyList.lastElementChild?.remove();
        analysisHistory.pop();
    }
    saveHistoryToStorage();
    restoreFromHistory(id);
}

function restoreFromHistory(id) {
    const entry = analysisHistory.find(h => h.id === id);
    if (!entry) return;

    historyList.querySelectorAll('.history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
    });

    lastAnalysis = {
        ...entry,
        rawDetections: entry.rawDetections || entry.detections || []
    };
    const filtered = applyDetectionFilters(lastAnalysis.rawDetections);
    lastAnalysis.detections = filtered;
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

    if (currentMode === 'upload' && entry.src) {
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

function saveHistoryToStorage() {
    try {
        const payload = analysisHistory.slice(0, MAX_HISTORY).map(h => ({
            id: h.id, src: h.src, predictions: h.predictions,
            rawDetections: h.rawDetections, detections: h.detections,
            description: h.description, time: h.time
        }));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Không lưu được lịch sử:', e);
    }
}

function loadHistoryFromStorage() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return;
        const items = JSON.parse(raw);
        if (!Array.isArray(items) || !items.length) return;

        const empty = historyList.querySelector('.history-empty');
        if (empty) empty.remove();

        analysisHistory = items;
        statTotal.textContent = items.length;
        items.forEach(entry => {
            const label = entry.predictions?.[0]?.className?.split(',')[0] || 'Hình ảnh';
            const time  = new Date(entry.time).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
            const item = document.createElement('div');
            item.className = 'history-item';
            item.dataset.id = entry.id;
            item.innerHTML = `
                <img class="history-thumb" src="${entry.src}" alt="${label}">
                <div class="history-info">
                    <div class="history-label">${translateLabel(label)}</div>
                    <div class="history-meta">${entry.detections?.length || 0} vật thể · ${time}</div>
                </div>`;
            item.addEventListener('click', () => restoreFromHistory(entry.id));
            historyList.appendChild(item);
        });
    } catch (e) {
        console.warn('Không đọc được lịch sử:', e);
    }
}

function clearHistory() {
    historyList.innerHTML = `<div class="history-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" opacity="0.3">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg><p>Chưa có ảnh nào được phân tích</p></div>`;
    analysisHistory = [];
    localStorage.removeItem(HISTORY_KEY);
    statTotal.textContent = '0';
}

// ── Export Result ────────────────────────────────
function exportResult() {
    const latest = lastAnalysis || analysisHistory[0];
    if (!latest) { alert('Chưa có kết quả để xuất!'); return; }
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
    a.click(); URL.revokeObjectURL(url);
}

function exportAnnotatedImage() {
    const latest = lastAnalysis;
    if (!latest?.src) { alert('Chưa có ảnh để xuất!'); return; }

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
    img.onerror = () => alert('Không thể tải ảnh để xuất.');
    img.src = latest.src;
}

// ── Live Webcam Detection ────────────────────────
let liveBusy = false;

function stopLiveDetection() {
    liveDetecting = false;
    if (optAutoShow) optAutoShow.checked = false;
    liveBadge.hidden = true;
    if (liveDetectRaf) cancelAnimationFrame(liveDetectRaf);
    liveDetectRaf = null;
}

async function liveDetectionLoop() {
    if (!liveDetecting || !webcamRunning) return;
    liveDetectRaf = requestAnimationFrame(liveDetectionLoop);

    if (liveBusy || !detectorModel || webcamVideo.readyState < 2) return;
    if (!document.getElementById('opt-detect').checked) return;

    liveBusy = true;
    try {
        const detections = await detectorModel.detect(webcamVideo);
        const filtered = applyDetectionFilters(detections);
        if (document.getElementById('opt-bboxes').checked) {
            drawBoundingBoxes(webcamVideo, webcamCanvas, filtered);
        } else {
            const ctx = webcamCanvas.getContext('2d');
            ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
        }
    } catch (e) {
        console.warn('Live detect:', e);
    } finally {
        liveBusy = false;
    }
}

optAutoShow?.addEventListener('change', () => {
    if (optAutoShow.checked) {
        if (!webcamRunning) {
            optAutoShow.checked = false;
            alert('Hãy bật camera trước.');
            return;
        }
        if (typeof startShowRecognize === 'function') startShowRecognize();
    } else if (typeof stopShowRecognize === 'function') {
        stopShowRecognize();
        const ctx = webcamCanvas.getContext('2d');
        ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
    }
});

confSlider.addEventListener('change', () => {
    saveLabelFilterState();
    refreshDetectionDisplay();
});

confSlider.addEventListener('input', () => {
    if (lastAnalysis?.rawDetections) refreshDetectionDisplay();
});

// ── Webcam ───────────────────────────────────────
startWebcamBtn.addEventListener('click', async () => {
    if (!window.modelsReady) {
        alert('Mô hình AI chưa tải xong, vui lòng đợi thêm vài giây.');
        return;
    }
    try {
        if (typeof startWebcamWithMode === 'function') await startWebcamWithMode();
        else {
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            webcamVideo.srcObject = webcamStream;
            webcamVideo.hidden = false;
            webcamPlaceholder.hidden = true;
            startWebcamBtn.hidden = true;
            stopWebcamBtn.hidden = false;
            webcamCaptureBtn.disabled = false;
            webcamRunning = true;
            if (typeof startShowRecognize === 'function') startShowRecognize();
        }
    } catch (e) {
        alert('Không thể truy cập camera: ' + e.message);
    }
});

stopWebcamBtn.addEventListener('click', () => {
    if (typeof stopShowRecognize === 'function') stopShowRecognize();
    else stopLiveDetection();
    if (webcamStream) { webcamStream.getTracks().forEach(t => t.stop()); webcamStream = null; }
    webcamVideo.hidden = true;
    webcamPlaceholder.hidden = false;
    startWebcamBtn.hidden = false;
    stopWebcamBtn.hidden  = true;
    webcamCaptureBtn.disabled = true;
    const flipBtn = document.getElementById('flip-camera-btn');
    if (flipBtn) flipBtn.hidden = true;
    webcamRunning = false;
    const ctx = webcamCanvas.getContext('2d');
    ctx.clearRect(0, 0, webcamCanvas.width, webcamCanvas.height);
});

webcamCaptureBtn.addEventListener('click', async () => {
    if (!webcamRunning || !classifierModel || !detectorModel) return;
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

initLabelFilter();
