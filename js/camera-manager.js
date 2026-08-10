// ── Camera Manager ───────────────────────────────
// ponytail: Phase 3 - integrate into AppState fully. For now wraps existing camera globals.

const CAMERA_TIMEOUT_MS = 15000;

const CAMERA_ERROR_MESSAGES = {
  NotAllowedError: 'Bạn chưa cấp quyền truy cập camera. Hãy cho phép quyền camera trong trình duyệt và thử lại.',
  NotFoundError: 'Không tìm thấy camera trên thiết bị.',
  NotReadableError: 'Camera đang được ứng dụng khác sử dụng hoặc không thể truy cập.',
  OverconstrainedError: 'Camera không hỗ trợ cấu hình được yêu cầu.',
  SecurityError: 'Trình duyệt đã chặn quyền camera vì lý do bảo mật.'
};
const CAMERA_UNKNOWN_ERROR = 'Không thể khởi động camera. Vui lòng kiểm tra thiết bị và thử lại.';

let cameraStream = null;
let cameraRafId = null;
let cameraErrorPanel = null;
let cameraErrorPanelInitialized = false;

function createCameraErrorPanel() {
  if (cameraErrorPanelInitialized) return cameraErrorPanel;
  cameraErrorPanel = document.createElement('div');
  cameraErrorPanelInitialized = true;
  cameraErrorPanel.id = 'camera-error-panel';
  cameraErrorPanel.className = 'camera-error-panel';
  cameraErrorPanel.hidden = true;
  cameraErrorPanel.innerHTML = `
    <div class="camera-error-icon">⚠️</div>
    <div class="camera-error-title">Lỗi Camera</div>
    <div class="camera-error-message"></div>
    <div class="camera-error-actions">
      <button id="camera-retry-btn" class="btn btn-primary">Thử lại</button>
      <button id="camera-back-btn" class="btn btn-secondary">Quay lại tải ảnh</button>
    </div>
  `;
  // Insert after webcam container
  const wc = document.querySelector('.webcam-container');
  if (wc && wc.parentNode) {
    wc.parentNode.insertBefore(cameraErrorPanel, wc.nextSibling);
  } else {
    document.body.appendChild(cameraErrorPanel);
  }

  document.getElementById('camera-retry-btn')?.addEventListener('click', async () => {
    hideCameraError();
    try {
      await startCamera();
    } catch (e) {
      showCameraError(e);
    }
  });

  document.getElementById('camera-back-btn')?.addEventListener('click', () => {
    hideCameraError();
    stopCamera();
    // Switch to upload mode
    if (typeof switchMode === 'function') switchMode('upload');
  });

  return cameraErrorPanel;
}

function showCameraError(error) {
  const panel = createCameraErrorPanel();
  const msg = panel.querySelector('.camera-error-message');
  if (msg) {
    msg.textContent = CAMERA_ERROR_MESSAGES[error.name] || error.message || CAMERA_UNKNOWN_ERROR;
  }
  panel.hidden = false;
  const wc = document.querySelector('.webcam-container');
  if (wc) wc.hidden = true;
  if (window.AppState) {
    window.AppState.camera.isRunning = false;
    window.AppState.camera.stream = null;
  }
}

function hideCameraError() {
  if (cameraErrorPanel) cameraErrorPanel.hidden = true;
  const wc = document.querySelector('.webcam-container');
  if (wc) wc.hidden = false;
}

async function startCamera() {
  // Stop existing stream first
  stopCameraTracks();

  hideCameraError();

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Trình duyệt không hỗ trợ camera.');
  }

  const constraints = {
    video: {
      facingMode: window.facingMode || 'environment',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  let stream;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia(constraints),
      new Promise((_, reject) =>
        setTimeout(() => reject(new DOMException('Timeout', 'NotReadableError')), CAMERA_TIMEOUT_MS)
      )
    ]);
  } catch (err) {
    if (err.name === 'AbortError' || err.message === 'Timeout') {
      throw new DOMException('Không thể khởi động camera trong thời gian chờ.', 'NotReadableError');
    }
    throw err;
  }

  cameraStream = stream;
  const video = document.getElementById('webcam-video');
  if (video) {
    video.srcObject = stream;
    await video.play();
  }

  if (window.AppState) {
    window.AppState.camera.stream = stream;
    window.AppState.camera.isRunning = true;
    window.AppState.camera.isPaused = false;
  }

  window.webcamRunning = true; // Legacy compat
}

function stopCameraTracks() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const video = document.getElementById('webcam-video');
  if (video) {
    video.srcObject = null;
  }
  if (window.AppState) {
    window.AppState.camera.stream = null;
    window.AppState.camera.isRunning = false;
  }
  window.webcamRunning = false;
}

function stopCamera() {
  stopCameraTracks();
  // Cancel RAF
  if (cameraRafId) {
    cancelAnimationFrame(cameraRafId);
    cameraRafId = null;
  }
  // Also stop showRecognize if active
  if (typeof stopShowRecognize === 'function') stopShowRecognize();
  if (typeof window.stopShowRecognize === 'function') window.stopShowRecognize();
  if (window.AppState) {
    window.AppState.camera.rafId = null;
  }
}

// Override legacy stopCamera if defined
if (typeof window.stopCamera === 'undefined') {
  window.stopCamera = stopCamera;
} else {
  const origStop = window.stopCamera;
  window.stopCamera = function() {
    stopCamera();
    origStop();
  };
}

window.startCamera = startCamera;
window.showCameraError = showCameraError;
window.hideCameraError = hideCameraError;
// cameraStream / cameraRafId defined at top. No global alias needed — AppState owns these.
