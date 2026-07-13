// ── Safe History Storage ─────────────────────────
// Stores thumbnails + metadata, not full-size base64.

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
    // Filter out corrupted entries
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
      // Drop oldest items until under quota
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

  const entry = {
    id: 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    fileName: window.AppState?.image?.originalFile?.name || 'unknown.jpg',
    createdAt: new Date().toISOString(),
    thumbnail: thumbnail || '',
    classificationSummary: clsSummary,
    detectionSummary: detSummary.map(d => ({ class: d.class, count: d.count, topScore: d.score })),
    totalObjects,
    processingTimeMs: processingTimeMs || 0
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
    div.innerHTML = `
      <div class="history-thumb">
        ${entry.thumbnail ? `<img src="${entry.thumbnail}" alt="${entry.fileName}" loading="lazy">` : '<div class="history-no-thumb">📷</div>'}
      </div>
      <div class="history-info">
        <div class="history-name">${escapeHtml(entry.fileName)}</div>
        <div class="history-meta">${formatDate(entry.createdAt)} • ${entry.totalObjects || 0} vật thể</div>
        <div class="history-tags">
          ${(entry.classificationSummary || []).slice(0, 2).map(p =>
            `<span class="history-tag">${translateLabel(p.label)} ${(p.probability * 100).toFixed(0)}%</span>`
          ).join('')}
          ${(entry.detectionSummary || []).slice(0, 2).map(d =>
            `<span class="history-tag">${translateLabel(d.class)} ${d.count}</span>`
          ).join('')}
        </div>
      </div>
    `;
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

window.getHistory = getHistory;
window.addHistoryEntry = addHistoryEntry;
window.renderHistory = renderHistory;
window.clearHistory = clearHistory;
