// ── AI Vision Pro — Pro Features Module ──

const BBOX_STYLE_KEY = 'ai-vision-bbox-style';
const MAX_BATCH_FILES = 5;

// modelsReady defined in app-state.js already — do not redefine.
if (!('modelsReady' in window)) {
  Object.defineProperty(window, 'modelsReady', {
    get: function() { return window.AppState && window.AppState.anyModelReady(); },
    set: function(v) { /* no-op, kept for compat */ }
  });
}

let batchQueue = [];
let batchProcessing = false;
let previewZoom = 1;
let previewPanX = 0;
let previewPanY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };

const zoneSkeleton     = document.getElementById('zone-skeleton');
const skeletonText     = document.getElementById('skeleton-text');
const previewViewport  = document.getElementById('preview-viewport');
const previewStage     = document.getElementById('preview-stage');
const zoomLevelEl      = document.getElementById('zoom-level');
const zoomResetBtn     = document.getElementById('zoom-reset');
const bboxColorInput   = document.getElementById('bbox-color');
const bboxWidthSlider  = document.getElementById('bbox-width');
const bboxWidthValue   = document.getElementById('bbox-width-value');
const bboxShowConf     = document.getElementById('bbox-show-conf');
const resultTableBody  = document.getElementById('result-table-body');
const resultTableEmpty = document.getElementById('result-table-empty');
const utilitiesBar     = document.getElementById('utilities-bar');
const batchProgress    = document.getElementById('batch-progress');
const batchBarFill     = document.getElementById('batch-bar-fill');
const batchStatusText  = document.getElementById('batch-status-text');

const PALETTE = ['#6366f1','#a855f7','#10b981','#f59e0b','#ec4899','#3b82f6'];

// ── Bounding box style ───────────────────────────
function getBboxStyle() {
    return {
        color: bboxColorInput?.value || '#6366f1',
        lineWidth: parseFloat(bboxWidthSlider?.value || 3),
        showConf: bboxShowConf?.checked !== false
    };
}

function getBoxColor(index, customColor) {
    if (index === 0 && customColor) return customColor;
    return PALETTE[index % PALETTE.length];
}

function drawBoxOnContext(ctx, sx, sy, sw, sh, det, index, natScale = 1) {
    const style = getBboxStyle();
    const color = index === 0 ? style.color : getBoxColor(index, null);
    const lw = style.lineWidth * natScale;

    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(sx, sy, sw, sh);

    const vi = translateLabel(det.class);
    const label = style.showConf
        ? `${vi} ${(det.score * 100).toFixed(0)}%`
        : vi;
    const fontSize = Math.max(11, 13 * natScale);
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const tw = ctx.measureText(label).width;
    const lh = fontSize + 10;
    ctx.fillStyle = color;
    ctx.fillRect(sx - 1, sy - lh, tw + 14, lh);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, sx + 6, sy - 6);
}

function saveBboxStyle() {
    try {
        localStorage.setItem(BBOX_STYLE_KEY, JSON.stringify(getBboxStyle()));
    } catch (e) { /* ignore */ }
}

function loadBboxStyle() {
    try {
        const raw = localStorage.getItem(BBOX_STYLE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.color && bboxColorInput) bboxColorInput.value = s.color;
        if (s.lineWidth && bboxWidthSlider) bboxWidthSlider.value = s.lineWidth;
        if (bboxShowConf) bboxShowConf.checked = s.showConf !== false;
        if (bboxWidthValue) bboxWidthValue.textContent = (bboxWidthSlider?.value || 3) + 'px';
    } catch (e) { /* ignore */ }
}

function onBboxStyleChange() {
    saveBboxStyle();
    if (typeof refreshDetectionDisplay === 'function') refreshDetectionDisplay();
}

// ── Skeleton overlay ─────────────────────────────
function showZoneSkeleton(message, mode = 'model') {
    if (!zoneSkeleton) return;
    dropZone?.classList.add('zone-locked');
    zoneSkeleton.hidden = false;
    zoneSkeleton.classList.toggle('skeleton-analyze', mode === 'analyze');
    if (skeletonText) skeletonText.textContent = message;
    analyzeBtn && (analyzeBtn.disabled = true);
}

function hideZoneSkeleton() {
    if (!zoneSkeleton) return;
    zoneSkeleton.hidden = true;
    dropZone?.classList.remove('zone-locked');
    if (window.AppState && window.AppState.anyModelReady() && !previewImage?.hidden && previewImage?.src) {
        analyzeBtn && (analyzeBtn.disabled = false);
    }
}

function setModelsReady(ready) {
    // ponytail: backward compat bridge — uses AppState status instead.
    if (ready) {
        if (window.AppState.models.classifier.status === 'idle') window.AppState.models.classifier.status = 'ready';
        if (window.AppState.models.detector.status === 'idle') window.AppState.models.detector.status = 'ready';
    }
    hideZoneSkeleton();
}

// ── Preview zoom / pan ───────────────────────────
function applyPreviewTransform() {
    if (!previewStage) return;
    previewStage.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewZoom})`;
    if (zoomLevelEl) zoomLevelEl.textContent = Math.round(previewZoom * 100) + '%';
}

function resetPreviewTransform() {
    previewZoom = 1;
    previewPanX = 0;
    previewPanY = 0;
    applyPreviewTransform();
}

function showPreviewImage(src) {
    if (!previewImage || !previewViewport) return;
    document.getElementById('upload-placeholder').hidden = true;
    previewViewport.hidden = false;
    previewImage.src = src;
    resetPreviewTransform();
    resetBtn && (resetBtn.hidden = false);
    if (window.AppState && window.AppState.anyModelReady()) analyzeBtn.disabled = false;
}

function initPreviewZoom() {
    if (!previewViewport || !previewStage) return;

    previewViewport.addEventListener('wheel', (e) => {
        if (previewViewport.hidden) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        previewZoom = Math.min(5, Math.max(0.5, previewZoom + delta));
        applyPreviewTransform();
    }, { passive: false });

    previewStage.addEventListener('mousedown', (e) => {
        if (previewViewport.hidden || e.button !== 0) return;
        isPanning = true;
        panStart = { x: e.clientX - previewPanX, y: e.clientY - previewPanY };
        previewStage.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        previewPanX = e.clientX - panStart.x;
        previewPanY = e.clientY - panStart.y;
        applyPreviewTransform();
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
        previewStage?.classList.remove('is-panning');
    });

    zoomResetBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        resetPreviewTransform();
        if (window.AppState?.analysis?.lastResult?.detections?.length && !previewImage.hidden) {
            drawBoundingBoxes(previewImage, detCanvas, window.AppState.analysis.lastResult.detections);
        }
    });

    previewImage?.addEventListener('load', () => {
        if (window.AppState?.analysis?.lastResult?.detections?.length) {
            drawBoundingBoxes(previewImage, detCanvas, window.AppState.analysis.lastResult.detections);
        }
    });
}

// ── Result analytics table ───────────────────────
function buildDetectionSummary(detections) {
    const map = new Map();
    detections.forEach(d => {
        const key = d.class;
        if (!map.has(key)) {
            map.set(key, { class: key, score: d.score, count: 0, bbox: d.bbox });
        }
        const row = map.get(key);
        row.count++;
        if (d.score > row.score) {
            row.score = d.score;
            row.bbox = d.bbox;
        }
    });
    return [...map.values()].sort((a, b) => b.score - a.score);
}

function renderResultTable(detections) {
    if (!resultTableBody) return;
    resultTableBody.innerHTML = '';
    const rows = buildDetectionSummary(detections || []);

    if (resultTableEmpty) {
        resultTableEmpty.hidden = rows.length > 0;
    }
    if (utilitiesBar) {
        utilitiesBar.hidden = !window.AppState?.analysis?.lastResult;
    }

    rows.forEach((row, i) => {
        const [x, y, w, h] = row.bbox || [0, 0, 0, 0];
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${i * 0.04}s`;
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><code>${row.class}</code></td>
            <td>${translateLabel(row.class)}</td>
            <td><span class="conf-cell">${(row.score * 100).toFixed(0)}%</span></td>
            <td>${row.count}</td>
            <td class="bbox-coords">${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}</td>`;
        resultTableBody.appendChild(tr);
    });

    if (statObjects) statObjects.textContent = detections?.length || 0;
}

function updateResultsUI(predictions, detections) {
    renderResultTable(detections);
    if (detections?.length) {
        detectionsSection.hidden = false;
    }
}

// ── Export JSON / CSV ────────────────────────────
function getExportPayload() {
    const latest = window.AppState?.analysis?.lastResult;
    if (!latest) return null;
    return {
        exportedAt: new Date().toISOString(),
        image: latest.src ? '(base64 embedded)' : null,
        classification: (latest.predictions || []).map((p, i) => ({
            rank: i + 1,
            label: p.className.split(',')[0],
            labelVi: translateLabel(p.className.split(',')[0]),
            probability: p.probability,
            percent: +(p.probability * 100).toFixed(2)
        })),
        detections: (latest.detections || []).map((d, i) => {
            const [x, y, w, h] = d.bbox;
            return {
                id: i + 1,
                class: d.class,
                labelVi: translateLabel(d.class),
                score: d.score,
                confidencePercent: +(d.score * 100).toFixed(2),
                bbox: { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
            };
        }),
        description: latest.description || ''
    };
}

function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

function exportJSON() {
    const payload = getExportPayload();
    if (!payload) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để xuất!', duration: 3000 }); return; }
    downloadBlob(JSON.stringify(payload, null, 2), 'ket-qua-nhandien.json', 'application/json');
}

function exportCSV() {
    const latest = window.AppState?.analysis?.lastResult;
    if (!latest?.detections?.length) { showToast({ type: 'warning', title: 'Chưa có dữ liệu', message: 'Chưa có vật thể để xuất CSV!', duration: 3000 }); return; }
    const header = 'id,class,label_vi,confidence,x,y,width,height';
    const lines = latest.detections.map((d, i) => {
        const [x, y, w, h] = d.bbox;
        return [i + 1, d.class, translateLabel(d.class), (d.score * 100).toFixed(2),
            Math.round(x), Math.round(y), Math.round(w), Math.round(h)].join(',');
    });
    downloadBlob([header, ...lines].join('\n'), 'ket-qua-nhandien.csv', 'text/csv;charset=utf-8');
}

// ── Text-to-Speech ───────────────────────────────
let speechUtterance = null;

function speakResults() {
    const latest = window.AppState?.analysis?.lastResult;
    if (!latest) { showToast({ type: 'warning', title: 'Chưa có kết quả', message: 'Chưa có kết quả để đọc!', duration: 3000 }); return; }
    if (!('speechSynthesis' in window)) {
        showToast({ type: 'warning', title: 'Không hỗ trợ TTS', message: 'Trình duyệt không hỗ trợ Text-to-Speech.', duration: 3000 });
        return;
    }
    window.speechSynthesis.cancel();
    const rows = buildDetectionSummary(latest.detections || []);
    let text = latest.description || '';
    if (!text && rows.length) {
        text = 'Phát hiện: ' + rows.map(r =>
            `${translateLabel(r.class)} ${(r.score * 100).toFixed(0)} phần trăm`
        ).join(', ');
    }
    if (!text) { showToast({ type: 'info', title: 'Không có nội dung', message: 'Không có nội dung để đọc.', duration: 3000 }); return; }

    speechUtterance = new SpeechSynthesisUtterance(text);
    speechUtterance.lang = 'vi-VN';
    speechUtterance.rate = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const vi = voices.find(v => v.lang.startsWith('vi'));
    if (vi) speechUtterance.voice = vi;
    window.speechSynthesis.speak(speechUtterance);
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ── Batch processing ─────────────────────────────
function setBatchProgress(current, total, label) {
    if (!batchProgress) return;
    batchProgress.hidden = total <= 1;
    const pct = total ? (current / total) * 100 : 0;
    if (batchBarFill) batchBarFill.style.width = pct + '%';
    if (batchStatusText) {
        batchStatusText.textContent = label || `Đang xử lý ${current}/${total}…`;
    }
}

async function processBatchQueue() {
    if (batchProcessing || !batchQueue.length) return;
    batchProcessing = true;
    const total = batchQueue.length;
    let index = 0;

    showZoneSkeleton('Đang phân tích hàng loạt…', 'analyze');

    while (batchQueue.length) {
        const item = batchQueue.shift();
        index++;
        setBatchProgress(index, total, `Ảnh ${index}/${total}: ${item.name}`);

        await new Promise((resolve) => {
            const img = new Image();
            img.onload = async () => {
                AppState.resetImage();
                AppState.image.originalFile = item.file;
                AppState.image.originalUrl = item.objectUrl;
                AppState.image.displaySource = item.objectUrl;
                AppState.image.width = item.width;
                AppState.image.height = item.height;
                showPreviewImage(item.objectUrl);
                await runAnalysis(img, detCanvas, { skipHistory: false });
                resolve();
            };
            img.onerror = resolve;
            img.src = item.objectUrl;
        });
    }

    batchProcessing = false;
    setBatchProgress(0, 0, '');
    if (batchProgress) batchProgress.hidden = true;
    hideZoneSkeleton();
}

function enqueueBatchFiles(files) {
    const candidates = [...files].slice(0, MAX_BATCH_FILES);
    const list = candidates.filter(file => validateImageFile(file).valid);
    if (!list.length) return;
    if (files.length > MAX_BATCH_FILES) {
        showToast({ type: 'warning', title: 'Giới hạn batch', message: `Chỉ xử lý tối đa ${MAX_BATCH_FILES} ảnh mỗi lần.`, duration: 3000 });
    }

    batchQueue = [];
    let loaded = 0;
    const finishLoading = () => {
        if (loaded !== list.length) return;
        if (batchQueue.length === 1) {
            const item = batchQueue[0];
            AppState.resetImage();
            AppState.image.originalFile = item.file;
            AppState.image.originalUrl = item.objectUrl;
            AppState.image.displaySource = item.objectUrl;
            AppState.image.width = item.width;
            AppState.image.height = item.height;
            showPreviewImage(item.objectUrl);
            batchQueue = [];
        } else if (batchQueue.length > 1) {
            processBatchQueue();
        }
    };
    list.forEach(file => {
        const objectUrl = URL.createObjectURL(file);
        decodeImage(objectUrl).then((decoded) => {
            const dimensions = validateImageDimensions(decoded);
            loaded++;
            if (!dimensions.valid) {
                URL.revokeObjectURL(objectUrl);
                finishLoading();
                return;
            }
            batchQueue.push({
                name: file.name,
                file: file,
                objectUrl: objectUrl,
                width: dimensions.width,
                height: dimensions.height
            });
            finishLoading();
        }).catch(() => {
            URL.revokeObjectURL(objectUrl);
            loaded++;
            finishLoading();
        });
    });
}

// ── Init ─────────────────────────────────────────
function initProFeatures() {
    loadBboxStyle();
    // Phase 2: skeleton managed by model-loader.js. Don't show here.

    bboxColorInput?.addEventListener('input', onBboxStyleChange);
    bboxWidthSlider?.addEventListener('input', () => {
        if (bboxWidthValue) bboxWidthValue.textContent = bboxWidthSlider.value + 'px';
        onBboxStyleChange();
    });
    bboxShowConf?.addEventListener('change', onBboxStyleChange);

    initPreviewZoom();
}

initProFeatures();

// Global exports for HTML onclick & script.js
window.exportJSON = exportJSON;
window.exportCSV = exportCSV;
window.speakResults = speakResults;
window.renderResultTable = renderResultTable;
window.updateResultsUI = updateResultsUI;
window.showPreviewImage = showPreviewImage;
window.showZoneSkeleton = showZoneSkeleton;
window.hideZoneSkeleton = hideZoneSkeleton;
window.setModelsReady = setModelsReady;
window.getBboxStyle = getBboxStyle;
window.drawBoxOnContext = drawBoxOnContext;
window.enqueueBatchFiles = enqueueBatchFiles;
window.buildDetectionSummary = buildDetectionSummary;
window.resetPreviewTransform = resetPreviewTransform;
// window.modelsReady removed Phase 2 — use getter above.
