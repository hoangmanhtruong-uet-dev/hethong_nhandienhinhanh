// ── Image Processor ──────────────────────────────
// Safe image validation, resize for inference, scale tracking.

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
const INFERENCE_MAX_DIM = 1600;
const MAX_IMAGE_PIXELS = 20 * 1024 * 1024; // Guard against decompression bombs / UI freezes
const VALID_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function validateImageFile(file) {
  if (!file) return { valid: false, error: 'Không có file nào được chọn.' };

  if (!VALID_MIME_TYPES.has(file.type)) {
    // Fallback: check extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return { valid: false, error: 'Định dạng file không được hỗ trợ. Chỉ chấp nhận JPEG, PNG, WebP.' };
    }
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File quá lớn (tối đa ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB).` };
  }

  return { valid: true, error: null, file };
}

function decodeImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể giải mã ảnh. File có thể bị hỏng hoặc không đúng định dạng.'));
    img.src = src;
  });
}

function validateImageDimensions(img) {
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;
  if (!width || !height) {
    return { valid: false, error: 'Không thể xác định kích thước ảnh.' };
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return {
      valid: false,
      error: `Ảnh có độ phân giải quá lớn (${width}×${height}). Vui lòng dùng ảnh không quá ${Math.round(MAX_IMAGE_PIXELS / 1000000)} megapixel.`
    };
  }
  return { valid: true, width, height };
}

function createInferenceCanvas(img, maxDim) {
  const limit = maxDim || INFERENCE_MAX_DIM;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  let scale = 1;

  if (w > limit || h > limit) {
    if (w > h) { scale = limit / w; } else { scale = limit / h; }
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  // Return scaleX/scaleY for backward compat with script.js bbox scaling
  return { canvas, scaleX: scale, scaleY: scale };
}

function computeBboxScale(imgNaturalW, imgNaturalH, previewEl) {
  // Returns { scaleX, scaleY } to convert coords from inference canvas to display
  const displayW = previewEl.clientWidth || previewEl.width || imgNaturalW;
  const displayH = previewEl.clientHeight || previewEl.height || imgNaturalH;
  return {
    scaleX: displayW / imgNaturalW,
    scaleY: displayH / imgNaturalH
  };
}

// Alias for backward compat
window.validateImage = validateImageFile;
window.validateImageFile = validateImageFile;
window.decodeImage = decodeImage;
window.validateImageDimensions = validateImageDimensions;
window.createInferenceCanvas = createInferenceCanvas;
window.computeBboxScale = computeBboxScale;
