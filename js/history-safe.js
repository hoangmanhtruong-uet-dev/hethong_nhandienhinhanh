// ── Safe History Storage ─────────────────────────
// Stores thumbnails + metadata + full raw data for restore.

const HISTORY_KEY = 'ai-vision-history';
const MAX_HISTORY_ITEMS = 50;
const THUMB_MAX_DIM = 320;
const THUMB_QUALITY = 0.75;

function getHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && item.id);
  } catch (e) {
    console.warn('History parse error, resetting:', e);
    return [];
  }
}

function saveHistoryList(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      while (list.length > 0) {
        list.shift();
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
          showToast({ type: 'warning', title: 'Lịch sử đầy', message: 'Đã xóa bớt lịch sử cũ để giải phóng dung lượng.', duration: 4000 });
          return;
        } catch (inner) {
          // keep dropping
        }
      }
    } else {
      console.warn('History save error:', e);
    }
  }
}

function createThumbnail(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      let scale = 1;
      if (w > THUMB_MAX_DIM || h > THUMB_MAX_DIM) {
        if (w > h) { scale = THUMB_MAX_DIM / w; } else { scale = THUMB_MAX_DIM / h; }
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function addHistoryEntry({ src, predictions, detections, processingTimeMs }) {
  const history = getHistory();
  const thumbnail = await createThumbnail(src);

  const clsSummary = (predictions || []).slice(0, 3).map(p => ({
    label: p.className?.split(',')[0]?.trim() || 'unknown',
    probability: p.probability
  }));

  const detSummary = buildDetectionSummary(detections || []);
  const totalObjects = (detections || []).length;

  // Store full raw data so restore works across sessions
  const rawPredictions = (predictions || []).slice(0, 10).map(p => ({
    className: p.className,
    probability: p.probability
  }));
  const rawDetections = (detections || []).slice(0, 50).map(d => ({
    class: d.class,
    score: d.score,
    bbox: d.bbox ? [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]] : [0, 0, 0, 0]
  }));

  const entry = {
    id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    fileName: window.AppState?.image?.originalFile?.name || 'unknown.jpg',
    createdAt: new Date().toISOString(),
    thumbnail: thumbnail || '',
    classificationSummary: clsSummary,
    detectionSummary: detSummary.map(d => ({ class: d.class, count: d.count, topScore: d.score })),
    totalObjects,
    processingTimeMs: processingTimeMs || 0,
    rawPredictions: rawPredictions,
    rawDetections: rawDetections,
    src: src || ''
  };

  history.unshift(entry);
  while (history.length > MAX_HISTORY_ITEMS) history.pop();

  saveHistoryList(history);
  return entry;
}

function renderHistory() {
  const history = getHistory();
  const container = document.getElementById('history-list');
  if (!container) return;
  container.innerHTML = '';

  if (!history.length) {
    container.innerHTML = '<div class="history-empty">Chưa có lịch sử phân tích.</div>';
    return;
  }

  history.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.id = entry.id;
    div.innerHTML = `
      <div class="history-thumb">
        ${entry.thumbnail ? `<img src="${entry.thumbnail}" alt="${escapeHtml(entry.fileName)}" loading="lazy">` : '<div class="history-no-thumb">📷</div>'}
      </div>
      <div class="history-info">
        <div class="history-name">${escapeHtml(entry.fileName)}</div>
        <div class="history-meta">${formatDate(entry.createdAt)} • ${entry.totalObjects || 0} vật thể</div>
        <div class="history-tags">
          ${(entry.classificationSummary || []).slice(0, 2).map(p =>
            `<span class="history-tag">${escapeHtml(translateLabel(p.label))} ${(p.probability * 100).toFixed(0)}%</span>`
          ).join('')}
          ${(entry.detectionSummary || []).slice(0, 2).map(d =>
            `<span class="history-tag">${escapeHtml(translateLabel(d.class))} ${d.count}</span>`
          ).join('')}
        </div>
      </div>
    `;
    // Ponytail: defer to restoreFromHistory when script.js is loaded; fallback on dead toast until then
    div.addEventListener('click', function() {
      if (typeof window.restoreFromHistory === 'function') {
        window.restoreFromHistory(entry.id);
      } else if (typeof window.restoreHistoryFromEntry === 'function') {
        window.restoreHistoryFromEntry(entry);
      } else {
        showToast({ type: 'info', title: 'Thông tin', message: 'Chi tiết phân tích không còn trong lịch sử. Vui lòng phân tích lại.', duration: 3000 });
      }
    });
    container.appendChild(div);
  });
}

function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    showToast({ type: 'info', title: 'Đã xóa lịch sử', message: 'Toàn bộ lịch sử phân tích đã được xóa.', duration: 3000 });
  } catch (e) {
    showToast({ type: 'error', title: 'Lỗi xóa lịch sử', message: 'Không thể xóa lịch sử.', duration: 3000 });
  }
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

// ── Restore full analysis from stored history entry ──
function restoreHistoryFromEntry(entry) {
  if (!entry) return;

  const preds = entry.rawPredictions || [];
  const dets = entry.rawDetections || [];
  const desc = generateDescription(preds, dets);

  const result = {
    id: entry.id,
    src: entry.src || '',
    predictions: preds,
    rawDetections: dets,
    detections: dets,
    description: desc,
    time: entry.createdAt,
    totalTimeMs: entry.processingTimeMs || 0
  };

  window.lastAnalysis = { ...result, rawDetections: dets, detections: dets };
  window.AppState.analysis.lastResult = result;

  // Re-render UI
  const filtered = (typeof applyDetectionFilters === 'function') ? applyDetectionFilters(dets) : dets;
  window.lastAnalysis.detections = filtered;
  document.getElementById('results-section').hidden = false;

  const pl = document.getElementById('prediction-list');
  if (pl) pl.innerHTML = '';
  const dt = document.getElementById('detection-tags');
  if (dt) dt.innerHTML = '';
  document.getElementById('detections-section').hidden = true;
  document.getElementById('classify-label').hidden = true;

  if (preds.length) {
    document.getElementById('classify-label').hidden = false;
    if (typeof renderPredictions === 'function') renderPredictions(preds);
  }
  if (filtered.length) {
    if (typeof renderDetectionTags === 'function') renderDetectionTags(filtered);
    document.getElementById('detections-section').hidden = false;
  }
  if (typeof window.updateResultsUI === 'function') window.updateResultsUI(preds, filtered);
  const aiDesc = document.getElementById('ai-description-text');
  if (aiDesc) aiDesc.textContent = desc;
  const st = document.getElementById('status-text');
  if (st) st.textContent = 'Đã tải lại kết quả';
  const dot = document.querySelector('#result-dot');
  if (dot) dot.className = 'pulse-dot success';

  // Restore preview if in upload mode
  if (window.currentMode === 'upload' && entry.src) {
    const pi = document.getElementById('preview-image');
    if (pi) {
      pi.src = entry.src;
      pi.hidden = false;
      document.getElementById('upload-placeholder').hidden = true;
    }
    const rb = document.getElementById('reset-btn');
    if (rb) rb.hidden = false;
    const ab = document.getElementById('analyze-btn');
    if (ab) ab.disabled = false;
    const doBBoxes = document.getElementById('opt-bboxes')?.checked;
    const detCanvas = document.getElementById('detection-canvas');
    if (doBBoxes && filtered.length && typeof drawBoundingBoxes === 'function') {
      const redraw = () => drawBoundingBoxes(pi, detCanvas, filtered);
      pi.onload = redraw;
      if (pi.complete) redraw();
    }
  }

  // Highlight in history list
  document.querySelectorAll('#history-list .history-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === entry.id);
  });
}

// Alias for backward compat with script.js
window.addHistoryItem = addHistoryEntry;
// Guard for translateLabel if not yet loaded (defined in features.js)
if (typeof window.translateLabel !== 'function') {
  window.translateLabel = function(l) { return l || ''; };
}
// Guard for buildDetectionSummary if not yet loaded (defined in features.js)
if (typeof window.buildDetectionSummary !== 'function') {
  window.buildDetectionSummary = function(d) { return d || []; };
}
// Guard for generateDescription
if (typeof window.generateDescription !== 'function') {
  window.generateDescription = function(p, d) { return ''; };
}

window.getHistory = getHistory;
window.addHistoryEntry = addHistoryEntry;
window.renderHistory = renderHistory;
window.clearHistory = clearHistory;
window.restoreHistoryFromEntry = restoreHistoryFromEntry;
