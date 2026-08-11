(() => {
  'use strict';

  const currentHost = location.hostname || '127.0.0.1';
  const defaultApiBase = location.port === '5500'
    ? `http://${currentHost}:8000/api`
    : `${location.origin}/api`;
  const API_BASE = (window.VISION_API_URL || defaultApiBase).replace(/\/$/, '');
  const API_ORIGIN = API_BASE.replace(/\/api$/, '');
  const VERSION_TOKEN = '__VISION_APP_VERSION__';
  const BUILD_TOKEN = '__VISION_BUILD_ID__';
  const APP_VERSION = VERSION_TOKEN.startsWith('__') ? '1.1.0-dev' : VERSION_TOKEN;
  const APP_BUILD = BUILD_TOKEN.startsWith('__') ? 'local' : BUILD_TOKEN;
  const APP_VERSION_LABEL = `${APP_VERSION}+${APP_BUILD}`;
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_PIXELS = 20 * 1024 * 1024;
  const PUBLIC_ROUTES = new Set(['onboarding', 'login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'two-factor']);
  const SCREENS = [
    ['onboarding', 'Chào mừng', 'waving_hand'],
    ['login', 'Đăng nhập', 'login'],
    ['register', 'Tạo tài khoản', 'person_add'],
    ['forgot-password', 'Quên mật khẩu', 'key'],
    ['two-factor', 'Xác minh 2FA', 'password'],
    ['two-factor-setup', 'Thiết lập 2FA', 'qr_code_2'],
    ['recovery-codes', 'Mã khôi phục', 'key'],
    ['permissions', 'Cấp quyền Camera', 'photo_camera'],
    ['scanner', 'Scanner AI', 'document_scanner'],
    ['processing', 'Đang xử lý AI', 'neurology'],
    ['result', 'Chi tiết kết quả', 'frame_inspect'],
    ['edit', 'Chỉnh sửa nhãn AI', 'edit_note'],
    ['history', 'Lịch sử quét', 'history'],
    ['collections', 'Bộ sưu tập', 'collections_bookmark'],
    ['collection', 'Chi tiết bộ sưu tập', 'folder_open'],
    ['settings', 'Cài đặt', 'settings'],
    ['account', 'Tài khoản', 'account_circle'],
    ['security', 'Bảo mật & API', 'shield_lock'],
    ['install', 'Cài đặt ứng dụng', 'install_mobile'],
    ['sync', 'Ngoại tuyến & Đồng bộ', 'sync'],
    ['models', 'Trung tâm Mô hình AI', 'model_training'],
    ['app-update', 'Cập nhật ứng dụng', 'system_update'],
    ['team', 'Nhóm & Thành viên', 'groups'],
    ['forbidden', 'Không có quyền truy cập', 'lock'],
    ['privacy', 'Quyền riêng tư & Dữ liệu', 'shield_lock'],
    ['about', 'Thông tin ứng dụng', 'info'],
    ['offline', 'Lỗi kết nối mạng', 'wifi_off'],
    ['unsupported', 'Ảnh không hợp lệ', 'broken_image'],
    ['empty', 'Trạng thái trống', 'inbox'],
    ['share', 'Chia sẻ & Xuất', 'ios_share'],
    ['delete-confirm', 'Xác nhận xóa', 'delete_forever'],
    ['reset-password', 'Đặt lại mật khẩu', 'password'],
    ['verify-email', 'Xác minh email', 'mark_email_read'],
  ];
  const PRODUCT_ROUTES = new Set([
    'scanner', 'history', 'collections', 'settings', 'account', 'security',
    'install', 'sync', 'models', 'team', 'privacy', 'about',
  ]);

  const state = {
    route: 'onboarding',
    params: new URLSearchParams(),
    drawerOpen: false,
    stream: null,
    cameraFacingMode: localStorage.getItem('vision-camera-facing') || 'environment',
    cameraDeviceId: null,
    cameraDevices: [],
    cameraSwitching: false,
    cameraError: '',
    currentFile: null,
    currentImageUrl: '',
    currentResult: null,
    scans: [],
    collections: [],
    selectedCollection: null,
    collectionItems: [],
    models: {
      classifier: null,
      detector: null,
      detectorPromise: null,
      status: 'loading',
      yoloStatus: 'idle',
      yoloProvider: 'none',
      yoloError: '',
      yoloFallback: false,
    },
    modelStats: [],
    modelStatsLoaded: false,
    analysisProgress: 12,
    advancedAnalyzing: false,
    backendOnline: null,
    authChecked: false,
    user: null,
    sessions: [],
    apiKeys: [],
    securityEvents: [],
    teamMembers: [],
    twoFactorChallenge: '',
    twoFactorSetup: null,
    recoveryCodes: [],
    newApiKey: '',
    system: { database: 'unknown', storage: 'unknown' },
    storageEstimate: { usage: 0, quota: 0 },
    pwa: {
      deferredPrompt: null,
      installed: matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone),
      updateReady: false,
      registration: null,
    },
    modelPreferences: {
      active: localStorage.getItem('vision-active-model') || 'hybrid',
      threshold: Number(localStorage.getItem('vision-confidence-threshold') || .55),
      powerSave: localStorage.getItem('vision-power-save') === '1',
    },
    settings: {
      save_history: true,
      share_analytics: false,
      local_processing_preferred: true,
      theme: localStorage.getItem('vision-theme') || 'dark',
    },
  };

  const app = document.getElementById('app');
  document.documentElement.dataset.theme = state.settings.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : state.settings.theme;

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const icon = (name, extra = '') => `<span class="material-symbols-rounded ${extra}" aria-hidden="true">${name}</span>`;
  const pct = value => `${Math.round(Number(value || 0) * 100)}%`;
  const mediaUrl = path => path?.startsWith('http') || path?.startsWith('blob:') || path?.startsWith('data:')
    ? path : `${API_ORIGIN}${path || ''}`;
  const formatDate = value => value ? new Date(value).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }) : 'Vừa xong';

  function toast(message, type = 'success') {
    const root = document.getElementById('toast-root');
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  async function api(path, options = {}) {
    const { timeoutMs = path === '/analysis/advanced' ? 60000 : 30000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...fetchOptions,
        signal: controller.signal,
      });
      state.backendOnline = true;
    } catch (cause) {
      state.backendOnline = false;
      const offline = !navigator.onLine || cause instanceof TypeError;
      const error = new Error(cause?.name === 'AbortError'
        ? 'Máy chủ phản hồi quá chậm. Hãy thử lại sau.'
        : offline
          ? 'Không có kết nối mạng. Kết quả xử lý trên máy vẫn được giữ.'
          : 'Không thể kết nối máy chủ.');
      error.code = cause?.name === 'AbortError' ? 'client_timeout' : 'network_error';
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      let detail = `Lỗi ${response.status}`;
      let code = `http_${response.status}`;
      let requestId = response.headers.get('x-request-id') || '';
      try {
        const body = await response.json();
        detail = typeof body.detail === 'string' ? body.detail : detail;
        code = body.code || code;
        requestId = body.request_id || requestId;
      } catch (_) { /* response is not JSON */ }
      if (response.status === 429 && detail === `Lỗi ${response.status}`) detail = 'Quá nhiều yêu cầu. Hãy đợi rồi thử lại.';
      if ([502, 503].includes(response.status) && detail === `Lỗi ${response.status}`) detail = 'Dịch vụ phụ trợ đang gián đoạn. Hãy thử lại sau.';
      if (response.status === 504 && detail === `Lỗi ${response.status}`) detail = 'Máy chủ xử lý quá thời gian.';
      const error = new Error(detail);
      error.status = response.status;
      error.code = code;
      error.requestId = requestId;
      error.retryAfter = Number(response.headers.get('retry-after') || 0);
      throw error;
    }
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : response;
  }

  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '') || (localStorage.getItem('vision-onboarded') ? 'scanner' : 'onboarding');
    const [route, query = ''] = raw.split('?');
    state.route = SCREENS.some(item => item[0] === route) ? route : 'scanner';
    state.params = new URLSearchParams(query);
  }

  function go(route, params = {}) {
    const query = new URLSearchParams(params).toString();
    location.hash = `#/${route}${query ? `?${query}` : ''}`;
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
    const video = document.getElementById('scanner-video');
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }

  function screenTitle(route) {
    return SCREENS.find(item => item[0] === route)?.[1] || 'Vision AI';
  }

  function rail() {
    const nav = [
      ['scanner', 'Scanner', 'document_scanner'],
      ['history', 'Lịch sử', 'history'],
      ['collections', 'Bộ sưu tập', 'collections_bookmark'],
      ['settings', 'Cài đặt', 'settings'],
    ];
    return `<aside class="desktop-rail">
      <div class="brand"><span class="brand-mark">${icon('frame_inspect')}</span><span class="brand-copy">Vision AI<small>Neural scanner</small></span></div>
      <div class="rail-label">Không gian làm việc</div>
      <nav class="rail-nav">${nav.map(([route, label, symbol]) => `<a class="rail-link ${state.route === route ? 'active' : ''}" href="#/${route}">${icon(symbol)}<span>${label}</span></a>`).join('')}</nav>
      <div class="rail-label">Hệ thống Vision AI</div>
      <button class="rail-link btn-block" data-action="drawer">${icon('apps')}<span>Tất cả tính năng</span></button>
      <div class="model-pill"><strong><i class="status-dot ${state.models.status === 'ready' ? 'ready' : state.models.status === 'error' ? 'error' : ''}"></i>${state.models.status === 'ready' ? 'AI sẵn sàng' : state.models.status === 'error' ? 'AI ngoại tuyến' : 'Đang tải mô hình'}</strong><span>MobileNet · COCO-SSD</span></div>
    </aside>`;
  }

  function topbar(title = screenTitle(state.route), back = false) {
    return `<header class="topbar">
      <button class="icon-btn" data-action="${back ? 'back' : 'drawer'}" aria-label="${back ? 'Quay lại' : 'Mở danh sách màn hình'}">${icon(back ? 'arrow_back' : 'menu')}</button>
      <h1>${esc(title)}</h1>
      <button class="icon-btn" data-action="more" aria-label="Tùy chọn">${icon('more_vert')}</button>
    </header>`;
  }

  function bottomNav() {
    return `<nav class="bottom-nav" aria-label="Điều hướng chính">
      ${[['scanner','Scanner','document_scanner'],['history','Lịch sử','history'],['settings','Cài đặt','settings']].map(([route,label,symbol]) => `<button class="nav-btn ${state.route === route || (route === 'history' && ['collections','collection'].includes(state.route)) ? 'active' : ''}" data-go="${route}">${icon(symbol)}<span>${label}</span></button>`).join('')}
    </nav>`;
  }

  function drawer() {
    if (!state.drawerOpen) return '';
    return `<div class="sheet-backdrop" data-action="close-drawer"><aside class="drawer" onclick="event.stopPropagation()">
      <div class="row between"><div class="brand" style="padding:0">${icon('frame_inspect')}<span>Vision AI</span></div><button class="icon-btn" data-action="close-drawer">${icon('close')}</button></div>
      <h2>Điều hướng hệ thống</h2>
      ${SCREENS.filter(([route]) => PRODUCT_ROUTES.has(route)).map(([route,label,symbol], index) => `<a class="screen-link ${state.route === route ? 'active' : ''}" href="#/${route}"><span class="screen-number">${String(index + 1).padStart(2,'0')}</span>${icon(symbol)}<span>${label}</span></a>`).join('')}
    </aside></div>`;
  }

  function shell(content, options = {}) {
    const { chrome = true, title, back = false } = options;
    return `<div class="app-frame">${rail()}<main class="page-stage"><section class="phone-shell">
      ${chrome ? topbar(title, back) : ''}${content}${chrome ? bottomNav() : ''}${drawer()}
    </section></main></div>`;
  }

  function imageBlock(result, editable = false) {
    const source = result?.image_url ? mediaUrl(result.image_url) : state.currentImageUrl;
    return `<div class="result-image">
      ${source ? `<img src="${esc(source)}" alt="Ảnh đang nhận diện">` : `<div class="scanner-grid"></div><div class="state-page" style="min-height:100%">${icon('image_search')}<p>Không có ảnh nhận diện</p></div>`}
      ${result ? `<div class="bbox"><span class="bbox-label">${esc(result.primary_label || 'OBJECT_DETECTED')} · ${pct(result.confidence)}</span></div>` : ''}
      ${editable ? `<span class="tag active" style="position:absolute;right:10px;bottom:10px">SCAN_COMPLETE</span>` : ''}
    </div>`;
  }

  function noResultPage(title = 'Chưa có kết quả') {
    return shell(`<main class="page"><div class="state-page"><div class="state-icon">${icon('image_search')}</div><h2>${esc(title)}</h2><p>Hãy chụp hoặc tải một ảnh lên để Vision AI phân tích trước.</p><button class="btn btn-primary" data-go="scanner">${icon('document_scanner')} Mở Scanner</button></div></main>`, { title: 'Vision AI', back: true });
  }

  function onboardingPage() {
    return shell(`<main class="page no-chrome onboarding">
      <div class="onboarding-visual">${icon('frame_inspect')}</div>
      <div class="onboarding-copy"><div class="eyebrow">Vision AI · v${esc(APP_VERSION)}</div><h1>Nhận diện thế giới bằng AI</h1><p class="lead">Quét hình ảnh, phân loại vật thể và tổ chức kết quả trong vài giây. Ảnh được ưu tiên xử lý ngay trên thiết bị.</p>
      <button class="btn btn-primary btn-block" style="margin-top:24px" data-go="login">${icon('login')} Bắt đầu</button><p class="tiny muted" style="text-align:center;margin-top:13px">${icon('lock')} Bảo mật và riêng tư theo mặc định</p></div>
    </main>`, { chrome: false });
  }

  function authShell(content) {
    return shell(`<main class="page no-chrome auth-page"><div class="auth-grid"></div><section class="auth-panel">
      <div class="auth-logo">${icon('frame_inspect')}</div>${content}
    </section></main>`, { chrome: false });
  }

  function loginPage() {
    return authShell(`<div class="auth-heading"><div class="eyebrow">Scanner AI · Secure access</div><h1>Chào mừng trở lại</h1><p>Đăng nhập để tiếp tục quét và quản lý dữ liệu riêng của bạn.</p></div>
      <form id="login-form" class="stack auth-form">
        <div class="field"><label for="login-email">Tài khoản (Email)</label><input class="input" id="login-email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required></div>
        <div class="field"><div class="row between"><label for="login-password">Mật khẩu bảo mật</label><a class="text-link" href="#/forgot-password">Quên mật khẩu?</a></div><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" minlength="8" required></div>
        <label class="check-row"><input name="remember" type="checkbox"><span>Giữ tôi đăng nhập trên thiết bị này</span></label>
        <button class="btn btn-primary btn-block" type="submit">${icon('login')} Đăng nhập</button>
      </form><div class="auth-footer">Chưa có tài khoản? <a class="text-link" href="#/register">Tạo tài khoản</a></div>`);
  }

  function registerPage() {
    return authShell(`<div class="auth-heading"><div class="eyebrow">Vision AI · New identity</div><h1>Tạo tài khoản</h1><p>Mỗi tài khoản có lịch sử quét, bộ sưu tập và API key riêng.</p></div>
      <form id="register-form" class="stack auth-form">
        <div class="field"><label for="register-name">Tên hiển thị</label><input class="input" id="register-name" name="display_name" autocomplete="name" minlength="2" required></div>
        <div class="field"><label for="register-email">Email</label><input class="input" id="register-email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="register-password">Mật khẩu (tối thiểu 8 ký tự)</label><input class="input" id="register-password" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <button class="btn btn-primary btn-block" type="submit">${icon('person_add')} Tạo tài khoản</button>
      </form><div class="auth-footer">Đã có tài khoản? <a class="text-link" href="#/login">Đăng nhập</a></div>`);
  }

  function forgotPasswordPage() {
    return authShell(`<div class="auth-heading"><div class="eyebrow">Account recovery</div><h1>Khôi phục mật khẩu</h1><p>Nhập email. Hệ thống luôn trả về cùng một thông báo để tránh lộ tài khoản.</p></div>
      <form id="forgot-form" class="stack auth-form"><div class="field"><label for="forgot-email">Email</label><input class="input" id="forgot-email" name="email" type="email" autocomplete="email" required></div><button class="btn btn-primary btn-block" type="submit">${icon('outgoing_mail')} Gửi hướng dẫn</button></form>
      <div class="auth-footer"><a class="text-link" href="#/login">${icon('arrow_back')} Quay lại đăng nhập</a></div>`);
  }

  function resetPasswordPage() {
    const token = state.params.get('token') || '';
    return authShell(`<div class="auth-heading"><div class="eyebrow">Account recovery</div><h1>Đặt lại mật khẩu</h1><p>Liên kết chỉ sử dụng được một lần và sẽ hết hạn theo cấu hình máy chủ.</p></div>
      <form id="reset-password-form" class="stack auth-form"><input name="token" type="hidden" value="${esc(token)}"><div class="field"><label for="reset-password">Mật khẩu mới</label><input class="input" id="reset-password" name="new_password" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label for="reset-confirm">Xác nhận mật khẩu</label><input class="input" id="reset-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="10" required></div><button class="btn btn-primary btn-block" type="submit">${icon('password')} Đặt lại mật khẩu</button></form>`);
  }

  function verifyEmailPage() {
    const token = state.params.get('token') || '';
    return authShell(`<div class="auth-heading"><div class="eyebrow">Verified identity</div><h1>Xác minh email</h1><p>Nhấn xác nhận để hoàn tất liên kết email với tài khoản Vision AI.</p></div><form id="verify-email-form" class="stack auth-form"><input name="token" type="hidden" value="${esc(token)}"><button class="btn btn-primary btn-block" type="submit" ${token ? '' : 'disabled'}>${icon('mark_email_read')} Xác minh email</button></form>`);
  }

  function twoFactorPage() {
    return authShell(`<div class="auth-heading"><div class="eyebrow">Bảo vệ tài khoản</div><h1>Xác minh 2 bước</h1><p>Nhập mã 6 số đang hiển thị trong ứng dụng Authenticator.</p></div>
      <form id="two-factor-login-form" class="stack auth-form"><div class="field"><label for="two-factor-code">Mã xác thực hoặc mã khôi phục</label><input class="input mono" id="two-factor-code" name="code" autocomplete="one-time-code" minlength="6" maxlength="20" required autofocus></div><button class="btn btn-primary btn-block" type="submit">${icon('verified_user')} Xác minh</button></form><p class="tiny muted" style="text-align:center">Mỗi mã khôi phục chỉ sử dụng được một lần.</p>
      <div class="auth-footer"><a class="text-link" href="#/login">${icon('arrow_back')} Quay lại đăng nhập</a></div>`);
  }

  function twoFactorSetupPage() {
    const setup = state.twoFactorSetup;
    if (!setup) return shell(`<main class="page"><div class="state-page"><div class="processing-orb">${icon('qr_code_2')}</div><h2>Đang tạo khóa bảo mật...</h2></div></main>`, { title: 'Thiết lập 2FA', back: true });
    return shell(`<main class="page"><div class="card" style="text-align:center"><div class="eyebrow">Authenticator</div><h2>Quét mã QR</h2><p class="lead">Dùng Google Authenticator, Microsoft Authenticator hoặc Authy.</p><img src="${esc(setup.qr_data_url)}" alt="Mã QR thiết lập 2FA" style="width:220px;max-width:100%;background:#fff;padding:12px;border-radius:16px"><p class="tiny muted">Không quét được? Nhập khóa thủ công:</p><code class="new-key" style="display:block;word-break:break-all">${esc(setup.secret)}</code></div>
      <form id="two-factor-enable-form" class="stack" style="margin-top:16px"><div class="field"><label for="two-factor-enable-code">Mã xác minh 6 số</label><input class="input mono" id="two-factor-enable-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button class="btn btn-primary btn-block" type="submit">${icon('shield_lock')} Bật xác thực 2 lớp</button></form></main>`, { title: 'Thiết lập 2FA', back: true });
  }

  function recoveryCodesPage() {
    if (!state.recoveryCodes.length) return noResultPage('Không có mã khôi phục mới');
    return shell(`<main class="page"><div class="card"><div class="eyebrow">Chỉ hiển thị một lần</div><h2>Lưu mã khôi phục</h2><p class="lead">Mỗi mã dùng được một lần khi bạn không còn truy cập Authenticator. Hãy lưu ở nơi an toàn.</p><div class="recovery-grid">${state.recoveryCodes.map(code => `<code>${esc(code)}</code>`).join('')}</div></div><div class="button-grid" style="margin-top:16px"><button class="btn btn-primary" data-action="copy-recovery-codes">${icon('content_copy')} Sao chép</button><button class="btn btn-secondary" data-action="download-recovery-codes">${icon('download')} Tải tệp</button></div><button class="btn btn-ghost btn-block" style="margin-top:10px" data-action="finish-recovery-codes">Tôi đã lưu mã</button></main>`, { title: 'Mã khôi phục', back: false });
  }

  function permissionsPage() {
    return shell(`<main class="page"><div class="permission-hero"><div class="permission-orb">${icon('photo_camera')}</div></div>
      <div class="card" style="text-align:center"><div class="eyebrow">Quyền thiết bị</div><h2 style="margin:9px 0">Cho phép truy cập Camera</h2><p class="lead">Camera chỉ được dùng để tạo khung hình nhận diện. Bạn luôn có thể chọn ảnh từ thư viện.</p>
      <button class="btn btn-primary btn-block" style="margin-top:20px" data-action="request-camera">${icon('photo_camera')} Cho phép camera</button>
      <button class="btn btn-ghost btn-block" style="margin-top:9px" data-action="pick-file">${icon('upload_file')} Tải ảnh lên</button></div>
      <input id="permission-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
    </main>`, { title: 'Cấp quyền Camera', back: true });
  }

  function scannerPage() {
    return shell(`<main class="page"><div class="scanner-viewport">
      <video id="scanner-video" class="scanner-video ${state.cameraFacingMode === 'user' ? 'front-camera' : ''}" autoplay muted playsinline ${state.stream ? '' : 'hidden'}></video>
      ${state.currentImageUrl && !state.stream ? `<img class="scanner-preview" src="${esc(state.currentImageUrl)}" alt="Ảnh đã chọn">` : ''}
      <div class="scanner-grid"></div><div class="scan-frame"></div><div class="scanner-hint">CĂN VẬT THỂ VÀO KHUNG</div>
      ${!state.stream && !state.currentImageUrl ? `<div class="state-page" style="min-height:100%"><div class="state-icon" style="color:var(--primary);background:var(--primary-soft)">${icon('center_focus_strong')}</div><p>Chọn camera hoặc tải ảnh để bắt đầu</p></div>` : ''}
    </div>
    <div class="capture-bar"><button class="mini-shot" data-action="pick-file" aria-label="Tải ảnh">${icon('image')}</button><button class="capture" data-action="capture" aria-label="Chụp ảnh"></button><button class="mini-shot" data-action="flip-camera" aria-label="Đổi camera" ${state.cameraSwitching ? 'disabled' : ''}>${icon(state.cameraSwitching ? 'progress_activity' : 'cameraswitch')}</button></div>
    <input id="scanner-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
    ${state.cameraError ? `<div class="card" style="margin-top:12px;border-color:var(--danger)"><div class="row">${icon('videocam_off')}<div><strong>Camera chưa sẵn sàng</strong><p class="tiny muted">${esc(state.cameraError)} Bạn vẫn có thể tải ảnh từ máy.</p></div></div></div>` : ''}
    <div class="row between" style="margin-top:14px"><span class="tiny mono muted"><i class="status-dot ${state.models.status === 'ready' ? 'ready' : ''}"></i> ${state.stream ? (state.cameraFacingMode === 'user' ? 'CAMERA TRƯỚC' : 'CAMERA SAU') : (state.models.status === 'ready' ? 'AI READY' : 'LOADING MODELS')}</span><button class="btn btn-ghost" data-action="start-camera">${icon('videocam')} Camera</button></div>
    </main>`, { title: 'Scanner AI' });
  }

  function processingPage() {
    const active = state.modelPreferences.active;
    const modelName = active === 'yolo' ? 'YOLOv8n ONNX' : active === 'coco' ? 'COCO-SSD Lite' : active === 'mobilenet' ? 'MobileNet V2' : 'MobileNet / COCO-SSD';
    return shell(`<main class="page processing-page"><div><div class="processing-orb">${icon('neurology')}</div><div class="eyebrow">Neural processing</div><h2>Đang phân tích hình ảnh...</h2><p class="lead">Mô hình Vision AI đang trích xuất đặc trưng và nhận diện vật thể.</p><div class="progress"><span style="--progress:${state.analysisProgress}%"></span></div><p class="mono tiny muted">${state.analysisProgress}% · ${modelName}</p></div></main>`, { title: 'Đang xử lý AI' });
    /* istanbul ignore next -- legacy markup kept below for a minimal UI migration */
    return shell(`<main class="page processing-page"><div><div class="processing-orb">${icon('neurology')}</div><div class="eyebrow">Neural processing</div><h2>Đang phân tích hình ảnh...</h2><p class="lead">Mô hình Vision AI đang trích xuất đặc trưng và nhận diện vật thể.</p><div class="progress"><span style="--progress:${state.analysisProgress}%"></span></div><p class="mono tiny muted">${state.analysisProgress}% · MobileNet / COCO-SSD</p></div></main>`, { title: 'Đang xử lý AI' });
  }

  function advancedAnalysisCard(result) {
    const cloudEnhanced = result.cloud_enhanced || String(result.model_version || '').includes('+ Gemini');
    if (cloudEnhanced) {
      const storedCategories = (result.predictions || [])
        .filter(item => item.source === 'gemini-category')
        .map(item => item.className);
      const categories = (result.cloud_categories || storedCategories).map(item => `<span class="tag active">${esc(item)}</span>`).join('');
      const visibleText = result.visible_text?.length
        ? `<p class="tiny"><strong>Chữ đọc được:</strong> ${esc(result.visible_text.join(' · '))}</p>`
        : '';
      const actions = result.suggested_actions?.length
        ? `<p class="tiny"><strong>Gợi ý:</strong> ${esc(result.suggested_actions.join(' · '))}</p>`
        : '';
      return `<div class="card" style="margin-top:14px;border-color:var(--cyan)"><div class="row between"><div><div class="eyebrow">Gemini Cloud · Tùy chọn</div><h3 style="margin:5px 0">Đã phân tích nâng cao</h3></div>${icon('cloud_done')}</div><div class="tag-list">${categories}<span class="tag">${esc(result.cloud_model || 'Gemini')}</span></div>${visibleText}${actions}<p class="tiny muted">Nhãn và mô tả đã được bổ sung bởi AI cloud. Độ tin cậy hiển thị vẫn là điểm của model local.</p></div>`;
    }
    return `<div class="card" style="margin-top:14px"><div class="row between"><div><div class="eyebrow">Gemini Cloud · Tùy chọn</div><h3 style="margin:5px 0">Nhận diện chưa chính xác?</h3></div>${icon('auto_awesome')}</div><p class="tiny muted">Chỉ gửi một bản ảnh đã nén khi bạn bấm nút. API key được giữ trên máy chủ; nếu lỗi hoặc hết quota, kết quả local không bị thay đổi.</p><button class="btn btn-primary btn-block" data-action="advanced-analysis" ${state.advancedAnalyzing ? 'disabled' : ''}>${icon(state.advancedAnalyzing ? 'progress_activity' : 'auto_awesome')} ${state.advancedAnalyzing ? 'Đang hỏi Gemini...' : 'Phân tích AI nâng cao'}</button></div>`;
  }

  function resultPage() {
    const result = state.currentResult;
    if (!result) return noResultPage();
    const tags = (result.predictions || []).slice(0, 3).map(item => `<span class="tag active">${esc((item.className || item.class || '').split(',')[0])}</span>`).join('');
    return shell(`<main class="page">${imageBlock(result)}${advancedAnalysisCard(result)}
      <div class="card"><div class="row"><div class="confidence-ring" style="--score:${Math.round(result.confidence * 100)}%" data-score="${pct(result.confidence)}"></div><div><div class="eyebrow">Nhận diện chính</div><h2 style="margin:5px 0 4px">${esc(result.primary_label)}</h2><div class="tag-list">${tags || '<span class="tag">AI Vision</span>'}</div></div></div><p class="lead" style="margin-top:14px">${esc(result.description)}</p></div>
      <div class="section-title"><span>Thông tin quét</span></div><div class="metadata"><div><small>Thời gian xử lý</small><strong>${result.processing_time_ms || 0} ms</strong></div><div><small>Mô hình AI</small><strong>${esc(result.model_version)}</strong></div><div><small>Kích thước</small><strong>${result.width || '—'} × ${result.height || '—'}</strong></div><div><small>Trạng thái</small><strong>${result.confirmed ? 'Đã xác nhận' : 'Chưa xác nhận'}</strong></div></div>
      <div class="button-grid" style="margin-top:14px"><button class="btn btn-primary" data-action="save-scan">${icon('bookmark_add')} ${result.id ? 'Đã lưu' : 'Lưu lịch sử'}</button><button class="btn btn-secondary" data-go="edit">${icon('edit')} Sửa nhãn</button><button class="btn btn-ghost" data-go="share">${icon('ios_share')} Chia sẻ</button><button class="btn btn-ghost" data-action="new-scan">${icon('refresh')} Quét lại</button></div><button class="btn btn-ghost btn-block" style="margin-top:9px" data-action="save-collection">${icon('collections_bookmark')} Lưu vào bộ sưu tập</button>
    </main>`, { title: 'Chi tiết kết quả', back: true });
  }

  function editPage() {
    const result = state.currentResult;
    if (!result) return noResultPage('Không có kết quả để chỉnh sửa');
    return shell(`<main class="page">${imageBlock(result, true)}<form id="edit-result" class="stack">
      <div class="field"><label for="edit-label">Tên đối tượng</label><input class="input" id="edit-label" name="label" value="${esc(result.primary_label)}" required maxlength="255"></div>
      <div class="field"><label>Phân loại</label><div class="tag-list"><button type="button" class="tag active" data-label="Công nghệ">Công nghệ</button><button type="button" class="tag" data-label="Điện tử">Điện tử</button><button type="button" class="tag" data-label="Đồ chơi">Đồ chơi</button><button type="button" class="tag" data-label="Khác">+ Thêm</button></div></div>
      <div class="field"><label for="edit-description">Mô tả</label><textarea class="textarea" id="edit-description" name="description">${esc(result.description)}</textarea></div>
      <div class="card"><div class="row between"><span class="small">Độ tin cậy AI</span><strong class="mono" style="color:var(--cyan)">${pct(result.confidence)}</strong></div><div class="progress"><span style="--progress:${Math.round(result.confidence * 100)}%"></span></div></div>
      <button class="btn btn-primary btn-block" type="submit">${icon('check_circle')} Xác nhận kết quả</button><button class="btn btn-ghost btn-block" type="button" data-action="report-result">${icon('flag')} Báo nhận diện sai</button>
    </form></main>`, { title: 'Chỉnh sửa kết quả', back: true });
  }

  function historyPage() {
    const items = state.scans.length ? state.scans.map(scan => `<article class="history-card" data-open-scan="${scan.id}"><div class="history-thumb"><img src="${esc(mediaUrl(scan.image_url))}" alt="${esc(scan.primary_label)}"></div><div><h3>${esc(scan.primary_label)}</h3><p>${formatDate(scan.created_at)} · ${scan.width}×${scan.height}</p></div><span class="score">${pct(scan.confidence)}</span></article>`).join('') : `<div class="state-page"><div class="state-icon" style="color:var(--primary);background:var(--primary-soft)">${icon('history')}</div><h2>Chưa có lịch sử quét</h2><p>Kết quả đã lưu sẽ xuất hiện tại đây.</p><button class="btn btn-primary" data-go="scanner">Quét ảnh đầu tiên</button></div>`;
    return shell(`<main class="page"><div class="searchbar">${icon('search')}<input id="history-search" class="input" placeholder="Tìm kiếm lịch sử..."></div><div class="filter-row"><button class="filter active">Tất cả</button><button class="filter">Yêu thích</button><button class="filter">Đã xác nhận</button><button class="filter" data-go="collections">Bộ sưu tập</button></div><div id="history-items" class="stack">${items}</div></main>`, { title: 'Lịch sử quét' });
  }

  function collectionsPage() {
    const cards = state.collections.map(item => `<article class="collection-card" data-open-collection="${item.id}"><div class="collection-cover">${item.cover_image_url ? `<img src="${esc(mediaUrl(item.cover_image_url))}" alt="">` : ''}</div><div class="copy"><h3>${esc(item.name)}</h3><p>${item.item_count} mục</p></div></article>`).join('');
    return shell(`<main class="page"><div class="searchbar">${icon('search')}<input class="input" placeholder="Tìm kiếm bộ sưu tập..."></div><div class="filter-row"><button class="filter active">Tất cả</button><button class="filter">Văn bản</button><button class="filter">Hình ảnh</button><button class="filter">Mã vạch</button></div><div class="collection-grid">${cards}<button class="new-collection" data-action="create-collection">${icon('add_circle')}<span class="small">Tạo mới</span></button></div></main>`, { title: 'Bộ sưu tập', back: true });
  }

  function collectionPage() {
    const collection = state.selectedCollection || { name: 'Bộ sưu tập', description: '' };
    const items = state.collectionItems.map(scan => `<article class="history-card" data-open-scan="${scan.id}"><div class="history-thumb"><img src="${esc(mediaUrl(scan.image_url))}" alt=""></div><div><h3>${esc(scan.primary_label)}</h3><p>${formatDate(scan.created_at)}</p></div><span class="score">${pct(scan.confidence)}</span></article>`).join('') || `<div class="state-page"><div class="state-icon" style="color:var(--primary);background:var(--primary-soft)">${icon('folder_open')}</div><h2>Bộ sưu tập đang trống</h2><p>Lưu kết quả từ trang chi tiết để xem tại đây.</p></div>`;
    return shell(`<main class="page"><div class="card"><div class="row between"><div><div class="eyebrow">Bộ sưu tập</div><h2 style="margin:6px 0">${esc(collection.name)}</h2><p class="lead">${esc(collection.description || 'Các kết quả Vision AI đã lưu')}</p></div>${icon('folder_special')}</div></div><div class="section-title"><span>${state.collectionItems.length} mục</span><button class="icon-btn" data-action="delete-collection">${icon('delete')}</button></div><div class="stack">${items}</div></main>`, { title: collection.name, back: true });
  }

  function accountPage() {
    const accountUser = state.user || { display_name: 'Người dùng', email: '' };
    const accountInitial = (accountUser.display_name || accountUser.email || 'V').trim().charAt(0).toUpperCase();
    return shell(`<main class="page"><div class="profile-card"><div class="profile-avatar">${esc(accountInitial)}</div><div><div class="eyebrow">Tài khoản Vision AI</div><h2>${esc(accountUser.display_name)}</h2><p>${esc(accountUser.email)}</p><span class="tag ${accountUser.email_verified_at ? 'active' : ''}">${accountUser.email_verified_at ? 'Email đã xác minh' : 'Email chưa xác minh'}</span></div></div>
      <div class="section-title"><span>Bảo mật tài khoản</span></div><div class="stack">
        ${accountUser.email_verified_at ? '' : `<button class="setting-row" data-action="request-email-verification"><span class="setting-icon">${icon('mark_email_unread')}</span><span><strong>Xác minh email</strong><small>Gửi liên kết có thời hạn đến ${esc(accountUser.email)}</small></span>${icon('chevron_right')}</button>`}
        <button class="setting-row" data-go="security"><span class="setting-icon">${icon('shield_lock')}</span><span><strong>Bảo mật & API</strong><small>2FA, phiên đăng nhập và khóa truy cập</small></span>${icon('chevron_right')}</button>
      </div>
      <form id="change-password-form" class="card stack" style="margin-top:16px"><h3>Đổi mật khẩu</h3><div class="field"><label>Mật khẩu hiện tại</label><input class="input" name="current_password" type="password" autocomplete="current-password" required></div><div class="field"><label>Mật khẩu mới</label><input class="input" name="new_password" type="password" autocomplete="new-password" minlength="10" required></div><button class="btn btn-primary btn-block" type="submit">Đổi mật khẩu</button></form>
      <form id="delete-account-form" class="card stack" style="margin-top:16px;border-color:var(--danger)"><h3>Xóa tài khoản</h3><p class="tiny muted">Xóa vĩnh viễn lịch sử, bộ sưu tập, API key và ảnh Cloudinary. Nhập mật khẩu và chữ DELETE.</p><div class="field"><label>Mật khẩu</label><input class="input" name="password" type="password" required></div><div class="field"><label>Xác nhận</label><input class="input mono" name="confirmation" pattern="DELETE" placeholder="DELETE" required></div><button class="btn btn-danger btn-block" type="submit">${icon('delete_forever')} Xóa vĩnh viễn</button></form>
      <button class="btn btn-danger btn-block" style="margin-top:22px" data-action="logout">${icon('logout')} Đăng xuất</button></main>`, { title: 'Tài khoản', back: true });
    /* legacy account markup */
    const user = state.user || { display_name: 'Người dùng', email: '' };
    const initial = (user.display_name || user.email || 'V').trim().charAt(0).toUpperCase();
    return shell(`<main class="page"><div class="profile-card"><div class="profile-avatar">${esc(initial)}</div><div><div class="eyebrow">Tài khoản Vision AI</div><h2>${esc(user.display_name)}</h2><p>${esc(user.email)}</p></div></div>
      <div class="section-title"><span>Thông tin tài khoản</span></div><div class="stack">
        <div class="setting-row"><span class="setting-icon">${icon('alternate_email')}</span><span><strong>Email đăng nhập</strong><small>${esc(user.email)}</small></span>${icon('verified_user')}</div>
        <button class="setting-row" data-go="security"><span class="setting-icon">${icon('shield_lock')}</span><span><strong>Bảo mật & API</strong><small>Phiên đăng nhập và khóa truy cập</small></span>${icon('chevron_right')}</button>
      </div><button class="btn btn-danger btn-block" style="margin-top:22px" data-action="logout">${icon('logout')} Đăng xuất</button></main>`, { title: 'Tài khoản', back: true });
  }

  function securityPage() {
    const keys = state.apiKeys.map(item => `<div class="security-item"><span class="setting-icon">${icon('key')}</span><span><strong>${esc(item.name)}</strong><small class="mono">${esc(item.prefix)}••••••••</small></span><button class="icon-btn" data-revoke-key="${item.id}" aria-label="Thu hồi API key">${icon('delete')}</button></div>`).join('') || `<p class="empty-copy">Chưa có API key nào. Chỉ tạo key khi cần tích hợp ứng dụng khác.</p>`;
    const sessions = state.sessions.map(item => `<div class="security-item"><span class="setting-icon">${icon(item.user_agent?.toLowerCase().includes('mobile') ? 'smartphone' : 'computer')}</span><span><strong>${item.current ? 'Thiết bị hiện tại' : 'Thiết bị đã đăng nhập'}</strong><small>${esc(item.ip_address || 'IP ẩn')} · ${formatDate(item.last_seen_at)}</small></span>${item.current ? '<span class="tag active">Hiện tại</span>' : `<button class="icon-btn" data-revoke-session="${item.id}" aria-label="Đăng xuất thiết bị">${icon('logout')}</button>`}</div>`).join('') || `<p class="empty-copy">Không có phiên đăng nhập hoạt động.</p>`;
    const eventLabels = { account_registered: 'Tạo tài khoản', login_success: 'Đăng nhập thành công', login_password_verified: 'Mật khẩu hợp lệ, chờ 2FA', login_failure: 'Đăng nhập thất bại', two_factor_failure: 'Sai mã 2FA', two_factor_enabled: 'Đã bật 2FA', two_factor_disabled: 'Đã tắt 2FA', recovery_code_used: 'Đã dùng mã khôi phục', recovery_codes_regenerated: 'Đã tạo lại mã khôi phục', rate_limit_blocked: 'Đã chặn do quá nhiều yêu cầu' };
    const events = state.securityEvents.slice(0, 12).map(item => `<div class="security-item"><span class="setting-icon">${icon(item.outcome === 'success' ? 'check_circle' : item.outcome === 'blocked' ? 'block' : 'warning')}</span><span><strong>${esc(eventLabels[item.event_type] || item.event_type)}</strong><small>${esc(item.ip_address || 'IP ẩn')} · ${formatDate(item.created_at)}</small></span><span class="tag ${item.outcome === 'success' ? 'active' : ''}">${esc(item.outcome)}</span></div>`).join('') || `<p class="empty-copy">Chưa có hoạt động bảo mật.</p>`;
    return shell(`<main class="page security-page"><div class="eyebrow">Security control center</div><h1 class="hero-title">Bảo mật & API</h1><p class="lead">Quản lý quyền truy cập và thiết bị đã đăng nhập.</p>
      <div class="security-card accent"><div class="row between"><div><h3>${icon('key')} Quản lý API Key</h3><p>Key chỉ hiện đầy đủ đúng một lần.</p></div><button class="btn btn-primary" data-action="create-api-key">${icon('add')} Tạo key</button></div>${state.newApiKey ? `<div class="new-key"><small>API KEY MỚI — hãy lưu ngay</small><code>${esc(state.newApiKey)}</code><button class="btn btn-ghost btn-block" data-action="copy-api-key">${icon('content_copy')} Sao chép</button></div>` : ''}<div class="stack">${keys}</div></div>
      <div class="security-card"><h3>${icon('verified_user')} Cài đặt bảo mật</h3><div class="security-status"><span>${icon('cookie')} Session HttpOnly</span><span class="tag active">Đang bật</span></div><div class="security-status"><span>${icon('https')} Mã hóa khi dùng HTTPS</span><span class="tag active">Đang bật</span></div><div class="security-status"><span>${icon('password')} Xác thực hai lớp (2FA)</span><button class="btn ${state.user?.two_factor_enabled ? 'btn-danger' : 'btn-primary'}" data-action="${state.user?.two_factor_enabled ? 'disable-2fa' : 'setup-2fa'}">${state.user?.two_factor_enabled ? 'Tắt 2FA' : 'Thiết lập'}</button></div>${state.user?.two_factor_enabled ? `<button class="btn btn-ghost btn-block" data-action="regenerate-recovery-codes">${icon('key')} Tạo lại mã khôi phục</button>` : ''}</div>
      <div class="security-card"><h3>${icon('devices')} Thiết bị đã đăng nhập</h3><div class="stack">${sessions}</div></div>
      <div class="security-card"><h3>${icon('policy')} Nhật ký bảo mật</h3><div class="stack">${events}</div></div>
      ${['owner','admin'].includes(state.user?.role) ? `<button class="btn btn-ghost btn-block" data-go="team">${icon('groups')} Quản lý nhóm & phân quyền</button>` : ''}
    </main>`, { title: 'Bảo mật & API', back: true });
  }

  function installPage() {
    return shell(`<main class="page install-page"><div class="install-hero"><img src="/assets/icons/icon-192.png" alt="Vision AI"><div class="eyebrow">Progressive Web App</div><h1>Cài đặt Vision AI</h1><p>Khởi động nhanh từ màn hình chính và mở được giao diện khi mất mạng.</p></div>
      <div class="card stack"><div class="benefit-row">${icon('offline_bolt')}<span><strong>Giao diện ngoại tuyến</strong><small>Service worker lưu app shell, không lưu API riêng tư.</small></span></div><div class="benefit-row">${icon('speed')}<span><strong>Mở nhanh hơn</strong><small>CSS, JavaScript và icon được cache an toàn.</small></span></div><div class="benefit-row">${icon('add_to_home_screen')}<span><strong>Như ứng dụng thật</strong><small>Chạy toàn màn hình từ màn hình chính.</small></span></div></div>
      <button class="btn btn-primary btn-block" style="margin-top:16px" data-action="install-pwa" ${state.pwa.installed || !state.pwa.deferredPrompt ? 'disabled' : ''}>${icon(state.pwa.installed ? 'check_circle' : 'download')} ${state.pwa.installed ? 'Đã cài đặt' : state.pwa.deferredPrompt ? 'Cài đặt ứng dụng' : 'Mở menu trình duyệt để cài'}</button>
      <button class="btn btn-ghost btn-block" style="margin-top:9px" data-go="settings">Để sau</button></main>`, { title: 'Cài đặt PWA', back: true });
  }

  function syncPage() {
    const usageMb = (state.storageEstimate.usage / 1024 / 1024).toFixed(1);
    const quotaMb = (state.storageEstimate.quota / 1024 / 1024).toFixed(0);
    const online = navigator.onLine && state.backendOnline !== false;
    const statusCard = (label, value, symbol, tone = '') => `<div class="system-card ${tone}"><div class="eyebrow">${label}</div><div class="row between"><strong>${value}</strong>${icon(symbol)}</div></div>`;
    return shell(`<main class="page"><div class="eyebrow">Network status</div><h1 class="hero-title">${online ? 'Online' : 'Ngoại tuyến'}</h1><p class="lead">${online ? 'Thiết bị đang kết nối với hệ thống production.' : 'Bạn vẫn mở được giao diện; thao tác API sẽ tiếp tục khi có mạng.'}</p>
      <div class="system-grid">${statusCard('PostgreSQL', state.system.database === 'postgresql' ? 'Connected' : state.system.database, 'database')}${statusCard('Cloudinary', state.system.storage === 'cloudinary' ? 'Connected' : state.system.storage, 'cloud', state.system.storage === 'cloudinary' ? '' : 'warning')}</div>
      <div class="section-title"><span>Bộ nhớ giao diện</span></div><div class="card"><div class="row between"><div><strong>${usageMb} MB đã dùng</strong><p class="tiny muted">Hạn mức trình duyệt: ${quotaMb} MB</p></div>${icon('hard_drive')}</div><div class="progress"><span style="--progress:${state.storageEstimate.quota ? Math.min(100, state.storageEstimate.usage / state.storageEstimate.quota * 100) : 0}%"></span></div></div>
      <div class="stack" style="margin-top:14px"><button class="btn btn-primary btn-block" data-action="sync-now">${icon('sync')} Kiểm tra đồng bộ</button><button class="btn btn-danger btn-block" data-action="clear-pwa-cache">${icon('delete_sweep')} Xóa cache giao diện</button></div>
      <p class="tiny muted" style="margin-top:14px">Ảnh, phiên đăng nhập và phản hồi API không được service worker lưu cache.</p></main>`, { title: 'Ngoại tuyến & Đồng bộ', back: true });
  }

  function modelCenterPage() {
    const p = state.modelPreferences;
    const assessment = yoloDeviceAssessment();
    const yoloStatus = state.models.yoloStatus === 'ready'
      ? `Sẵn sàng · ${state.models.yoloProvider.toUpperCase()}`
      : state.models.yoloStatus === 'loading' ? 'Đang tải...'
      : state.models.yoloStatus === 'fallback' ? 'Fallback COCO-SSD'
      : state.models.yoloStatus === 'error' ? 'Lỗi tải model'
      : 'Chưa tải';
    const deviceCopy = assessment.weak
      ? 'Thiết bị này sẽ tự động dùng COCO-SSD để tránh treo ứng dụng.'
      : `Thiết bị sẽ chạy YOLO bằng ${assessment.webgpu ? 'WebGPU (ưu tiên)' : 'WebAssembly'}. Model chỉ tải khi bạn chọn.`;
    const renderModelCard = (id, name, copy, metrics) => `<button class="model-card ${p.active === id ? 'active' : ''}" data-model="${id}"><div class="row between"><div><h3>${name}</h3><p>${copy}</p></div><span class="tag ${p.active === id ? 'active' : ''}">${p.active === id ? 'Đang dùng' : 'Chọn'}</span></div><div class="model-metrics">${metrics.map(([label,value]) => `<span><small>${label}</small><strong>${value}</strong></span>`).join('')}</div></button>`;
    return shell(`<main class="page"><div class="eyebrow">Neural runtime</div><h1 class="hero-title">Model Center</h1><p class="lead">Chọn cân bằng giữa độ chính xác, tốc độ và pin của thiết bị.</p>
      <div class="card" style="margin:16px 0"><div class="row between"><span><strong>Tiết kiệm pin</strong><small class="muted" style="display:block">Giảm độ phân giải khung phân tích</small></span><label class="switch"><input id="power-save" type="checkbox" ${p.powerSave ? 'checked' : ''}><span></span></label></div><div class="field" style="margin-top:16px"><label for="confidence-slider">Ngưỡng tin cậy: <strong id="confidence-value">${Math.round(p.threshold * 100)}%</strong></label><input id="confidence-slider" type="range" min="20" max="95" value="${Math.round(p.threshold * 100)}"></div></div>
      <div class="stack">
        ${renderModelCard('hybrid','MobileNet + COCO-SSD','Phân loại và phát hiện vật thể trên trình duyệt.',[['Trạng thái',state.models.status],['Runtime','WebGL'],['Chế độ','Hybrid']])}
        ${renderModelCard('mobilenet','MobileNet V2','Nhanh, nhẹ; phù hợp máy cấu hình thấp.',[['Kích thước','~3.5 MB'],['Runtime','WebGL'],['Loại','Classifier']])}
        ${renderModelCard('coco','COCO-SSD Lite','Phát hiện nhiều vật thể và bounding box.',[['Kích thước','~5 MB'],['Runtime','WebGL'],['Loại','Detector']])}
        ${renderModelCard('yolo','YOLOv8 Nano ONNX','Phát hiện 80 loại vật thể với NMS chạy hoàn toàn trên thiết bị.',[['Kích thước','12.3 MB'],['Runtime',state.models.yoloProvider === 'none' ? 'ONNX' : state.models.yoloProvider.toUpperCase()],['Trạng thái',yoloStatus]])}
      </div>
      <div class="card" style="margin-top:14px"><div class="row between"><div><strong>Đánh giá trên ảnh thật</strong><p class="tiny muted">Chạy cùng một ảnh qua YOLO và COCO-SSD, sau đó lưu độ chính xác, thời gian và RAM.</p></div><button class="btn btn-primary" data-action="pick-benchmark">${icon('science')} Chọn ảnh</button></div><input id="benchmark-file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
        <div class="model-metrics" style="margin-top:12px">${state.modelStats.map(item => `<span><small>${esc(item.model_name)}</small><strong>${item.accuracy == null ? 'Chưa gán nhãn' : pct(item.accuracy)} · ${Math.round(item.average_latency_ms)} ms</strong></span>`).join('') || '<span><small>Chưa có dữ liệu</small><strong>Hãy chọn ảnh test đầu tiên</strong></span>'}</div></div>
      <div class="card" style="margin-top:14px"><p class="tiny muted">${deviceCopy}</p>${state.models.yoloError ? `<p class="tiny" style="color:var(--danger)">${esc(state.models.yoloError)}</p>` : ''}</div></main>`, { title: 'Trung tâm Mô hình AI', back: true });
    /* istanbul ignore next -- legacy markup kept below for a minimal UI migration */
    const modelCard = (id, name, copy, metrics, available = true) => `<button class="model-card ${p.active === id ? 'active' : ''}" data-model="${id}" ${available ? '' : 'disabled'}><div class="row between"><div><h3>${name}</h3><p>${copy}</p></div><span class="tag ${p.active === id ? 'active' : ''}">${p.active === id ? 'Đang dùng' : available ? 'Chọn' : 'Chưa cài'}</span></div><div class="model-metrics">${metrics.map(([label,value]) => `<span><small>${label}</small><strong>${value}</strong></span>`).join('')}</div></button>`;
    return shell(`<main class="page"><div class="eyebrow">Neural runtime</div><h1 class="hero-title">Model Center</h1><p class="lead">Chọn cân bằng giữa độ chính xác, tốc độ và pin của thiết bị.</p>
      <div class="card" style="margin:16px 0"><div class="row between"><span><strong>Tiết kiệm pin</strong><small class="muted" style="display:block">Giảm độ phân giải khung phân tích</small></span><label class="switch"><input id="power-save" type="checkbox" ${p.powerSave ? 'checked' : ''}><span></span></label></div><div class="field" style="margin-top:16px"><label for="confidence-slider">Ngưỡng tin cậy: <strong id="confidence-value">${Math.round(p.threshold * 100)}%</strong></label><input id="confidence-slider" type="range" min="20" max="95" value="${Math.round(p.threshold * 100)}"></div></div>
      <div class="stack">${modelCard('hybrid','MobileNet + COCO-SSD','Phân loại và phát hiện vật thể trên trình duyệt.',[['Trạng thái',state.models.status],['Runtime','WebGL'],['Chế độ','Hybrid']])}${modelCard('mobilenet','MobileNet V2','Nhanh, nhẹ; phù hợp máy cấu hình thấp.',[['Kích thước','~3.5 MB'],['Runtime','WebGL'],['Loại','Classifier']])}${modelCard('coco','COCO-SSD Lite','Phát hiện nhiều vật thể và bounding box.',[['Kích thước','~5 MB'],['Runtime','WebGL'],['Loại','Detector']])}${modelCard('yolo','YOLO ONNX','Cần model ONNX đã huấn luyện và kiểm thử nhãn.',[['Runtime','ONNX'],['Triển khai','Tiếp theo'],['Trạng thái','Chưa cài']],false)}</div>
      <div class="card" style="margin-top:14px"><p class="tiny muted">YOLO chưa được giả lập. Hệ thống chỉ cho bật sau khi có file ONNX, danh sách nhãn và benchmark trên điện thoại thật.</p></div></main>`, { title: 'Trung tâm Mô hình AI', back: true });
  }

  function appUpdatePage() {
    return shell(`<main class="page update-visual"><div class="state-page"><img src="/assets/icons/icon-192.png" alt=""><div class="eyebrow">Vision AI · ${esc(APP_VERSION_LABEL)}</div><h2>${state.pwa.updateReady ? 'Phiên bản mới đã sẵn sàng' : 'Vision AI đang mới nhất'}</h2><p>${state.pwa.updateReady ? 'Giao diện mới đã tải xong. Cập nhật sẽ khởi động lại ứng dụng.' : 'Ứng dụng tự kiểm tra và kích hoạt bản mới mỗi khi bạn mở.'}</p><button class="btn btn-primary" data-action="apply-update" ${state.pwa.updateReady ? '' : 'disabled'}>${icon('system_update')} Cập nhật ngay</button></div></main>`, { title: 'Cập nhật ứng dụng', back: true });
  }

  function teamPage() {
    const members = state.teamMembers.map(member => `<div class="team-member"><div class="profile-avatar">${esc((member.display_name || member.email).charAt(0).toUpperCase())}</div><span><strong>${esc(member.display_name)}</strong><small>${esc(member.email)} · ${member.is_active ? 'Hoạt động' : 'Đã khóa'}</small></span><select class="input role-select" data-member-role="${member.id}" ${member.id === state.user?.id && member.role === 'owner' ? 'disabled' : ''}>${['owner','admin','member','viewer'].map(role => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role.toUpperCase()}</option>`).join('')}</select></div>`).join('') || '<div class="state-page"><p>Đang tải thành viên...</p></div>';
    return shell(`<main class="page"><div class="eyebrow">Access level · Secure</div><h1 class="hero-title">Team Roster</h1><p class="lead">Owner và Admin quản lý quyền truy cập dữ liệu trong workspace.</p><div class="stack" style="margin-top:18px">${members}</div><div class="card" style="margin-top:16px"><strong>Quy tắc quyền</strong><p class="tiny muted">Viewer chỉ xem; Member quét và quản lý dữ liệu của mình; Admin quản lý thành viên; Owner kiểm soát toàn bộ workspace.</p></div></main>`, { title: 'Nhóm & Thành viên', back: true });
  }

  function forbiddenPage() {
    return shell(`<main class="page"><div class="state-page"><div class="state-icon">${icon('lock')}</div><div class="tag">ERR_403_FORBIDDEN</div><h2 style="margin-top:14px">Truy cập bị từ chối</h2><p>Tài khoản hoặc API key hiện tại không có quyền thực hiện hành động này.</p><button class="btn btn-primary" data-action="back">${icon('arrow_back')} Quay lại</button></div></main>`, { title: 'Không có quyền truy cập', back: true });
  }

  function settingsPage() {
    const light = document.documentElement.dataset.theme === 'light';
    return shell(`<main class="page"><div class="eyebrow">Cấu hình ứng dụng</div><h2 style="margin:8px 0 18px">Settings</h2><div class="stack">
      <button class="setting-row" data-go="account"><span class="setting-icon">${icon('account_circle')}</span><span><strong>Tài khoản</strong><small>${esc(state.user?.email || 'Thông tin đăng nhập')}</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-go="security"><span class="setting-icon">${icon('shield_lock')}</span><span><strong>Bảo mật & API</strong><small>API key, phiên đăng nhập, HTTPS</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-go="privacy"><span class="setting-icon">${icon('shield_lock')}</span><span><strong>Quyền riêng tư & Dữ liệu</strong><small>Lịch sử, phân tích, xử lý cục bộ</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-action="toggle-theme"><span class="setting-icon">${icon(light ? 'light_mode' : 'dark_mode')}</span><span><strong>Giao diện</strong><small>${light ? 'Light mode' : 'Dark mode'} đang hoạt động</small></span><label class="switch"><input type="checkbox" ${light ? 'checked' : ''}><span></span></label></button>
      <button class="setting-row" data-go="models"><span class="setting-icon">${icon('model_training')}</span><span><strong>Mô hình AI</strong><small>${state.models.status === 'ready' ? 'MobileNet & COCO-SSD sẵn sàng' : 'Đang tải mô hình'}</small></span><span class="status-dot ${state.models.status === 'ready' ? 'ready' : ''}"></span></button>
      <button class="setting-row" data-go="sync"><span class="setting-icon">${icon('sync')}</span><span><strong>Ngoại tuyến & Đồng bộ</strong><small>${state.system.database} · ${state.system.storage}</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-go="install"><span class="setting-icon">${icon('install_mobile')}</span><span><strong>Cài ứng dụng</strong><small>${state.pwa.installed ? 'Đã cài trên thiết bị' : 'Thêm Vision AI vào màn hình chính'}</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-go="about"><span class="setting-icon">${icon('info')}</span><span><strong>Thông tin ứng dụng</strong><small>Vision AI v${esc(APP_VERSION_LABEL)}</small></span>${icon('chevron_right')}</button>
      <button class="setting-row" data-go="offline"><span class="setting-icon">${icon('wifi')}</span><span><strong>Kiểm tra kết nối</strong><small>Backend FastAPI</small></span>${icon('chevron_right')}</button>
    </div><button class="btn btn-danger btn-block" style="margin-top:22px" data-go="delete-confirm">${icon('delete_forever')} Xóa toàn bộ lịch sử</button></main>`, { title: 'Cài đặt' });
  }

  function privacyPage() {
    const s = state.settings;
    const toggle = (key, label, copy, symbol) => `<div class="setting-row"><span class="setting-icon">${icon(symbol)}</span><span><strong>${label}</strong><small>${copy}</small></span><label class="switch"><input data-setting="${key}" type="checkbox" ${s[key] ? 'checked' : ''}><span></span></label></div>`;
    return shell(`<main class="page"><div class="card"><div class="row">${icon('image_lock')}<div><strong class="small">Xử lý hình ảnh</strong><p class="lead">Vision AI ưu tiên xử lý ngay trên thiết bị. Chỉ kết quả bạn bấm lưu mới được gửi tới backend.</p></div></div></div><div class="section-title"><span>Tùy chọn dữ liệu</span></div><div class="stack">
      ${toggle('local_processing_preferred','Ưu tiên xử lý cục bộ','Giữ dữ liệu trên thiết bị khi có thể','memory')}
      ${toggle('save_history','Lưu lịch sử quét','Cho phép đồng bộ kết quả đã lưu','history')}
      ${toggle('share_analytics','Chia sẻ dữ liệu phân tích','Chỉ số sử dụng ẩn danh','analytics')}
    </div><button class="btn btn-danger btn-block" style="margin-top:18px" data-go="delete-confirm">${icon('delete_sweep')} Xóa toàn bộ lịch sử</button></main>`, { title: 'Quyền riêng tư & Dữ liệu', back: true });
  }

  function aboutPage() {
    return shell(`<main class="page"><div class="permission-hero"><div class="permission-orb">${icon('qr_code_scanner')}</div></div><div style="text-align:center"><h2>Vision AI Scanner</h2><p class="mono tiny muted">PHIÊN BẢN ${esc(APP_VERSION_LABEL)}</p><span class="tag active">AI: MobileNet + COCO-SSD + Gemini</span></div><div class="stack" style="margin-top:24px"><button class="setting-row"><span class="setting-icon">${icon('shield')}</span><span><strong>Tóm tắt quyền riêng tư</strong><small>Xử lý cục bộ theo mặc định</small></span>${icon('chevron_right')}</button><button class="setting-row"><span class="setting-icon">${icon('gavel')}</span><span><strong>Giấy phép</strong><small>Thư viện mã nguồn mở</small></span>${icon('chevron_right')}</button><button class="setting-row"><span class="setting-icon">${icon('description')}</span><span><strong>Điều khoản dịch vụ</strong><small>Cập nhật tháng 08/2026</small></span>${icon('chevron_right')}</button></div><button class="btn btn-primary btn-block" style="margin-top:22px" data-action="feedback">${icon('rate_review')} Gửi phản hồi</button></main>`, { title: 'Thông tin ứng dụng', back: true });
  }

  function statePage(type) {
    const variants = {
      offline: ['wifi_off', 'Không có kết nối Backend', 'Không thể kết nối FastAPI. Hãy khởi động backend hoặc kiểm tra địa chỉ API.', 'Thử lại', 'retry-backend'],
      unsupported: ['broken_image', 'Không hỗ trợ hình ảnh', 'Chỉ chấp nhận JPG, PNG hoặc WebP dưới 15 MB và tối đa 20 megapixel.', 'Chọn tệp khác', 'pick-file'],
      empty: ['inbox', 'Chưa có dữ liệu', 'Hãy quét và lưu kết quả đầu tiên để bắt đầu xây dựng thư viện Vision AI.', 'Bắt đầu quét', 'new-scan'],
    };
    const [symbol,title,copy,button,action] = variants[type];
    return shell(`<main class="page"><div class="state-page"><div class="state-icon">${icon(symbol)}</div><h2>${title}</h2><p>${copy}</p><button class="btn btn-primary" data-action="${action}">${icon('refresh')} ${button}</button><span class="tag" style="margin-top:16px">Trạng thái: ${state.backendOnline === false ? 'OFFLINE' : 'LOCAL'}</span><input id="state-file" type="file" accept="image/jpeg,image/png,image/webp" hidden></div></main>`, { title: type === 'offline' ? 'Lỗi kết nối' : 'Trạng thái hệ thống', back: true });
  }

  function sharePage() {
    const result = state.currentResult;
    if (!result) return noResultPage('Không có kết quả để chia sẻ');
    return shell(`<main class="page">${imageBlock(result)}<div class="card"><h2 style="margin:0">${esc(result.primary_label)}</h2><p class="lead">${esc(result.description)}</p></div></main><div class="sheet-backdrop"><div class="sheet"><div class="sheet-handle"></div><div class="row between"><div><h2>Chia sẻ & Xuất</h2><p>Chọn định dạng bạn muốn sử dụng.</p></div><button class="icon-btn" data-action="back">${icon('close')}</button></div>
      <button class="action-row" data-action="native-share">${icon('share')}<span><strong>Chia sẻ kết quả</strong><small>Văn bản tóm tắt nhận diện</small></span>${icon('chevron_right')}</button>
      <button class="action-row" data-export="json">${icon('data_object')}<span><strong>Xuất tệp JSON</strong><small>Dữ liệu thô cho nhà phát triển</small></span>${icon('download')}</button>
      <button class="action-row" data-export="csv">${icon('table_view')}<span><strong>Xuất tệp CSV</strong><small>Danh sách đối tượng nhận diện</small></span>${icon('download')}</button>
      <button class="action-row" data-action="copy-summary">${icon('content_copy')}<span><strong>Sao chép tóm tắt</strong><small>Văn bản mô tả nhanh</small></span>${icon('chevron_right')}</button>
    </div></div>`, { title: 'Chi tiết kết quả', back: true });
  }

  function deletePage() {
    const isCollection = Boolean(state.selectedCollection && state.route === 'delete-confirm' && state.params.get('type') === 'collection');
    return shell(`<main class="page"><div class="state-page"><div class="state-icon">${icon('delete_forever')}</div><h2>Xác nhận xóa</h2><p>Hành động này không thể hoàn tác. ${isCollection ? 'Ảnh gốc vẫn còn trong lịch sử.' : 'Toàn bộ lịch sử và file ảnh trên backend sẽ bị xóa.'}</p></div></main><div class="sheet-backdrop"><div class="sheet"><div class="sheet-handle"></div><h2>${isCollection ? 'Xóa bộ sưu tập?' : 'Xóa toàn bộ lịch sử?'}</h2><p>Vui lòng xác nhận để tiếp tục.</p><div class="card mono tiny">TARGET: ${isCollection ? esc(state.selectedCollection?.id || 'COLLECTION') : 'ALL-SCAN-HISTORY'}</div><div class="button-grid" style="margin-top:14px"><button class="btn btn-ghost" data-action="back">Hủy</button><button class="btn btn-danger" data-action="confirm-delete">${icon('delete')} Xóa</button></div></div></div>`, { title: 'Xác nhận xóa', back: true });
  }

  function render() {
    const pages = {
      onboarding: onboardingPage,
      login: loginPage,
      register: registerPage,
      'forgot-password': forgotPasswordPage,
      'reset-password': resetPasswordPage,
      'verify-email': verifyEmailPage,
      'two-factor': twoFactorPage,
      'two-factor-setup': twoFactorSetupPage,
      'recovery-codes': recoveryCodesPage,
      permissions: permissionsPage,
      scanner: scannerPage,
      processing: processingPage,
      result: resultPage,
      edit: editPage,
      history: historyPage,
      collections: collectionsPage,
      collection: collectionPage,
      settings: settingsPage,
      account: accountPage,
      security: securityPage,
      install: installPage,
      sync: syncPage,
      models: modelCenterPage,
      'app-update': appUpdatePage,
      team: teamPage,
      forbidden: forbiddenPage,
      privacy: privacyPage,
      about: aboutPage,
      offline: () => statePage('offline'),
      unsupported: () => statePage('unsupported'),
      empty: () => statePage('empty'),
      share: sharePage,
      'delete-confirm': deletePage,
    };
    app.innerHTML = pages[state.route]();
    bindPage();
  }

  async function checkBackend() {
    try {
      state.system = await api('/health');
      state.backendOnline = true;
      return true;
    } catch (_) {
      state.backendOnline = false;
      return false;
    }
  }

  async function loadModels() {
    let classifierReady = false;
    try {
      state.models.status = 'loading';
      if (window.tf) {
        window.tf.enableProdMode();
        await window.tf.setBackend('webgl').catch(() => window.tf.setBackend('cpu'));
        await window.tf.ready();
      }

      // MobileNet alpha 0.5 is substantially smaller and makes first scan ready
      // sooner on phones. Object detection continues loading in the background.
      const classifier = await window.mobilenet?.load({ version: 2, alpha: 0.5 });
      if (!classifier) throw new Error('Không tải được MobileNet');
      classifierReady = true;
      Object.assign(state.models, { classifier, detector: null, status: 'ready' });
      render();

      state.models.detectorPromise = window.cocoSsd?.load({ base: 'lite_mobilenet_v2' });
      state.models.detectorPromise?.then(detector => {
        state.models.detector = detector;
        state.models.detectorPromise = null;
        render();
      }).catch(error => {
        state.models.detectorPromise = null;
        console.warn('COCO-SSD background loading failed:', error);
      });
    } catch (error) {
      console.warn('Model loading failed:', error);
      if (!classifierReady) {
        try {
          const detector = await window.cocoSsd?.load({ base: 'lite_mobilenet_v2' });
          if (!detector) throw error;
          Object.assign(state.models, { classifier: null, detector, status: 'ready' });
        } catch (_) {
          state.models.status = 'error';
        }
        render();
      }
    }
  }

  async function listVideoDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
    } catch (_) {
      return [];
    }
  }

  function deviceForFacing(devices, facingMode, currentDeviceId) {
    const frontPattern = /front|user|facetime|selfie|trước/i;
    const backPattern = /back|rear|environment|world|sau/i;
    const pattern = facingMode === 'user' ? frontPattern : backPattern;
    return devices.find(device => device.deviceId !== currentDeviceId && pattern.test(device.label))
      || devices.find(device => device.deviceId !== currentDeviceId)
      || null;
  }

  function cameraConstraints(facingMode, deviceId) {
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { exact: facingMode };
    return { video, audio: false };
  }

  function cameraErrorMessage(error) {
    const messages = {
      NotAllowedError: 'Quyền camera đang bị từ chối. Hãy bật quyền trong cài đặt trình duyệt hoặc điện thoại.',
      SecurityError: 'Camera chỉ hoạt động trên kết nối HTTPS an toàn.',
      NotFoundError: 'Thiết bị không tìm thấy camera phù hợp.',
      DevicesNotFoundError: 'Thiết bị không có camera hoặc camera đã bị ngắt kết nối.',
      NotReadableError: 'Camera đang bận, bị hệ điều hành khóa hoặc có lỗi phần cứng.',
      TrackStartError: 'Camera đang được ứng dụng khác sử dụng.',
      OverconstrainedError: 'Camera không hỗ trợ cấu hình hình ảnh được yêu cầu.',
      AbortError: 'Hệ điều hành đã dừng quá trình mở camera.',
    };
    return messages[error?.name] || 'Không thể khởi động camera. Hãy thử tải ảnh từ máy.';
  }

  async function requestCamera({ flip = false } = {}) {
    if (state.cameraSwitching) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      state.cameraError = 'Trình duyệt hoặc thiết bị này không hỗ trợ truy cập camera.';
      render();
      toast(state.cameraError, 'error');
      return;
    }

    const previousFacingMode = state.cameraFacingMode;
    const previousDeviceId = state.cameraDeviceId;
    const desiredFacingMode = flip
      ? (previousFacingMode === 'environment' ? 'user' : 'environment')
      : previousFacingMode;

    state.cameraSwitching = true;
    state.cameraError = '';
    try {
      const knownDevices = await listVideoDevices();
      const selectedDevice = flip && knownDevices.length > 1
        ? deviceForFacing(knownDevices, desiredFacingMode, previousDeviceId)
        : null;

      stopCamera();
      // A short release delay prevents NotReadableError on iOS and some Android devices.
      if (flip) await new Promise(resolve => setTimeout(resolve, 180));

      const candidates = [
        cameraConstraints(desiredFacingMode, selectedDevice?.deviceId),
        cameraConstraints(desiredFacingMode, null),
        { video: { facingMode: { ideal: desiredFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      ];

      let stream = null;
      let lastError = null;
      for (const constraints of candidates) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
          if (!['OverconstrainedError', 'NotFoundError', 'NotReadableError', 'AbortError'].includes(error.name)) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      if (!stream) throw lastError || new Error('Không tìm thấy camera phù hợp.');

      state.stream = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack?.getSettings?.() || {};
      videoTrack?.addEventListener('ended', () => {
        if (state.stream !== stream) return;
        state.stream = null;
        state.cameraError = 'Camera đã ngắt kết nối hoặc bị hệ điều hành dừng.';
        render();
        toast(state.cameraError, 'error');
      }, { once: true });
      state.cameraDeviceId = settings.deviceId || selectedDevice?.deviceId || null;
      state.cameraFacingMode = ['user', 'environment'].includes(settings.facingMode)
        ? settings.facingMode
        : desiredFacingMode;
      state.cameraDevices = await listVideoDevices();
      state.cameraError = '';
      localStorage.setItem('vision-camera-facing', state.cameraFacingMode);
      localStorage.setItem('vision-onboarded', '1');
      state.cameraSwitching = false;

      // Re-render is required when flipping while already on the scanner route.
      if (state.route === 'scanner') render();
      else go('scanner');
    } catch (error) {
      state.cameraFacingMode = previousFacingMode;
      state.cameraDeviceId = previousDeviceId;
      state.cameraSwitching = false;
      render();
      const reason = cameraErrorMessage(error);
      state.cameraError = reason;
      toast(reason, 'error');
    }
  }

  function attachCamera() {
    const video = document.getElementById('scanner-video');
    if (video && state.stream) {
      video.hidden = false;
      video.srcObject = state.stream;
      video.onloadedmetadata = () => video.play().catch(() => {});
      video.play().catch(() => {});
    }
  }

  async function validateAndAnalyze(file) {
    if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > MAX_FILE_BYTES) {
      go('unsupported');
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) {
        URL.revokeObjectURL(url);
        go('unsupported');
        return;
      }
      if (state.currentImageUrl?.startsWith('blob:')) URL.revokeObjectURL(state.currentImageUrl);
      state.currentFile = file;
      state.currentImageUrl = url;
      stopCamera();
      await analyzeImage(image);
    };
    image.onerror = () => { URL.revokeObjectURL(url); go('unsupported'); };
    image.src = url;
  }

  async function captureFrame() {
    const video = document.getElementById('scanner-video');
    if (!video || video.readyState < 2) {
      document.getElementById('scanner-file')?.click();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => validateAndAnalyze(new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', .9);
  }

  function yoloDeviceAssessment() {
    return window.VisionYolo?.deviceAssessment?.() || {
      weak: true, memory: 0, cores: 0, saveData: false, webgpu: false,
    };
  }

  async function ensureCocoDetector() {
    if (state.models.detector) return state.models.detector;
    state.models.detectorPromise ||= window.cocoSsd?.load({ base: 'lite_mobilenet_v2' });
    let detector;
    try { detector = await state.models.detectorPromise; }
    finally { state.models.detectorPromise = null; }
    if (!detector) throw new Error('COCO-SSD is unavailable.');
    state.models.detector = detector;
    return detector;
  }

  async function ensureYoloLoaded({ force = false } = {}) {
    if (!window.VisionYolo) throw new Error('YOLO runtime is unavailable.');
    if (state.models.yoloStatus === 'ready') return true;
    state.models.yoloStatus = 'loading';
    state.models.yoloError = '';
    state.models.yoloFallback = false;
    if (state.route === 'models') render();
    try {
      const loaded = await window.VisionYolo.load({ force });
      state.models.yoloStatus = 'ready';
      state.models.yoloProvider = loaded.provider || window.VisionYolo.provider || 'wasm';
      if (state.route === 'models') render();
      return true;
    } catch (error) {
      state.models.yoloStatus = error?.code === 'WEAK_DEVICE' ? 'fallback' : 'error';
      state.models.yoloError = error?.message || 'YOLO could not be loaded.';
      state.models.yoloFallback = true;
      state.modelPreferences.active = 'coco';
      localStorage.setItem('vision-active-model', 'coco');
      await ensureCocoDetector();
      if (state.route === 'models') render();
      return false;
    }
  }

  async function analyzeImageLegacy(image) {
    state.analysisProgress = 12;
    go('processing');
    const canvas = document.createElement('canvas');
    const maxDimension = state.modelPreferences.powerSave ? 640 : 960;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const started = performance.now();
    try {
      state.analysisProgress = 38; render();
      if (state.models.status !== 'ready') await waitForModels(60000);
      state.analysisProgress = 66; render();
      const useClassifier = ['hybrid', 'mobilenet'].includes(state.modelPreferences.active);
      const useDetector = ['hybrid', 'coco'].includes(state.modelPreferences.active);
      const tasks = [
        useClassifier && state.models.classifier ? state.models.classifier.classify(canvas) : Promise.resolve([]),
        useDetector && state.models.detector ? state.models.detector.detect(canvas) : Promise.resolve([]),
      ];
      const [classification, detection] = await Promise.allSettled(tasks);
      const predictions = classification.status === 'fulfilled' ? classification.value : [];
      const detections = detection.status === 'fulfilled' ? detection.value : [];
      const top = detections.sort((a,b) => b.score - a.score)[0];
      const topPrediction = predictions[0];
      const label = top?.class || topPrediction?.className?.split(',')[0] || 'Không xác định';
      const rawConfidence = top?.score || topPrediction?.probability || 0;
      const confidence = rawConfidence >= state.modelPreferences.threshold ? rawConfidence : 0;
      state.analysisProgress = 100; render();
      state.currentResult = {
        primary_label: label,
        confidence,
        description: confidence ? `Vision AI nhận diện “${label}” với độ tin cậy ${pct(confidence)}. Hãy xác nhận hoặc chỉnh sửa nếu cần.` : 'Không thể xác định rõ nội dung ảnh. Hãy thử ảnh có ánh sáng tốt hơn.',
        predictions,
        detections,
        model_version: 'MobileNet + COCO-SSD',
        processing_time_ms: Math.round(performance.now() - started),
        width: image.naturalWidth,
        height: image.naturalHeight,
        confirmed: false,
        favorite: false,
      };
      setTimeout(() => go('result'), 350);
    } catch (error) {
      console.error(error);
      toast('Mô hình AI chưa sẵn sàng. Hãy thử lại.', 'error');
      go('offline');
    }
  }

  async function analyzeImage(image) {
    state.analysisProgress = 12;
    go('processing');
    const canvas = document.createElement('canvas');
    const maxDimension = state.modelPreferences.powerSave ? 640 : 960;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const started = performance.now();
    let predictions = [];
    let detections = [];
    let modelVersion = '';

    try {
      state.analysisProgress = 32;
      render();
      let activeModel = state.modelPreferences.active;

      if (activeModel === 'yolo') {
        if (state.modelPreferences.powerSave) {
          state.models.yoloStatus = 'fallback';
          state.models.yoloFallback = true;
          state.models.yoloError = 'Chế độ tiết kiệm pin đang bật.';
          state.modelPreferences.active = 'coco';
          localStorage.setItem('vision-active-model', 'coco');
          activeModel = 'coco';
        }
      }

      if (activeModel === 'yolo') {
        const yoloReady = await ensureYoloLoaded();
        if (yoloReady) {
          state.analysisProgress = 64;
          render();
          try {
            detections = await window.VisionYolo.detect(canvas, { threshold: state.modelPreferences.threshold });
            predictions = detections.slice(0, 5).map(item => ({ className: item.class, probability: item.score }));
            modelVersion = `YOLOv8n ONNX · ${(state.models.yoloProvider || 'wasm').toUpperCase()}`;
          } catch (error) {
            console.warn('YOLO inference failed; falling back to COCO-SSD:', error);
            state.models.yoloStatus = 'fallback';
            state.models.yoloError = error?.message || 'YOLO inference failed.';
            state.models.yoloFallback = true;
            activeModel = 'coco';
            state.modelPreferences.active = 'coco';
            localStorage.setItem('vision-active-model', 'coco');
            toast('YOLO không chạy ổn định trên máy này. Đã chuyển sang COCO-SSD.', 'error');
          }
        } else {
          activeModel = 'coco';
          toast('Thiết bị cấu hình thấp: tự động dùng COCO-SSD.', 'error');
        }
      }

      if (activeModel !== 'yolo') {
        if (state.models.status !== 'ready') await waitForModels(60000);
        state.analysisProgress = 64;
        render();
        const useClassifier = ['hybrid', 'mobilenet'].includes(activeModel);
        const useDetector = ['hybrid', 'coco'].includes(activeModel);
        const detector = useDetector ? await ensureCocoDetector() : null;
        const [classification, detection] = await Promise.allSettled([
          useClassifier && state.models.classifier ? state.models.classifier.classify(canvas) : Promise.resolve([]),
          detector ? detector.detect(canvas) : Promise.resolve([]),
        ]);
        predictions = classification.status === 'fulfilled' ? classification.value : [];
        detections = detection.status === 'fulfilled' ? detection.value : [];
        modelVersion = activeModel === 'coco' && state.models.yoloFallback
          ? 'COCO-SSD Lite (fallback)'
          : activeModel === 'coco' ? 'COCO-SSD Lite'
          : activeModel === 'mobilenet' ? 'MobileNet V2'
          : 'MobileNet + COCO-SSD';
      }

      const sortedDetections = [...detections].sort((a, b) => b.score - a.score);
      const top = sortedDetections[0];
      const topPrediction = predictions[0];
      const label = top?.class || topPrediction?.className?.split(',')[0] || 'Không xác định';
      const rawConfidence = top?.score || topPrediction?.probability || 0;
      const confidence = rawConfidence >= state.modelPreferences.threshold ? rawConfidence : 0;
      state.analysisProgress = 100;
      render();
      state.currentResult = {
        primary_label: label,
        confidence,
        description: confidence
          ? `Vision AI nhận diện “${label}” với độ tin cậy ${pct(confidence)}. Hãy xác nhận hoặc chỉnh sửa nếu cần.`
          : 'Không thể xác định rõ nội dung ảnh. Hãy thử ảnh có ánh sáng tốt hơn.',
        predictions,
        detections: sortedDetections,
        model_version: modelVersion,
        processing_time_ms: Math.round(performance.now() - started),
        width: image.naturalWidth,
        height: image.naturalHeight,
        confirmed: false,
        favorite: false,
      };
      setTimeout(() => go('result'), 350);
    } catch (error) {
      console.error(error);
      toast('Mô hình AI chưa sẵn sàng. Hãy thử lại.', 'error');
      go('offline');
    }
  }

  async function compressedCloudImage() {
    let source = state.currentFile;
    if (!source && state.currentResult?.image_url) {
      const response = await fetch(mediaUrl(state.currentResult.image_url), { credentials: 'include' });
      if (!response.ok) throw new Error('Không tải được ảnh đã lưu để phân tích.');
      source = await response.blob();
    }
    if (!source) throw new Error('Không có ảnh để phân tích nâng cao.');

    const objectUrl = URL.createObjectURL(source);
    try {
      const image = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error('Không đọc được ảnh để nén.'));
        node.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('Không nén được ảnh.')),
        'image/jpeg',
        .84,
      ));
      return new File([blob], `gemini-${Date.now()}.jpg`, { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function advancedAnalyze() {
    if (!state.currentResult || state.advancedAnalyzing) return;
    state.advancedAnalyzing = true;
    render();
    try {
      const file = await compressedCloudImage();
      const form = new FormData();
      form.append('file', file);
      const enhanced = await api('/analysis/advanced', { method: 'POST', body: form });
      const width = Number(state.currentResult.width || 1);
      const height = Number(state.currentResult.height || 1);
      const cloudDetections = (enhanced.objects || []).map(object => {
        const [ymin, xmin, ymax, xmax] = object.box_2d;
        return {
          class: object.label,
          score: null,
          bbox: [
            Math.round(xmin * width / 1000),
            Math.round(ymin * height / 1000),
            Math.round((xmax - xmin) * width / 1000),
            Math.round((ymax - ymin) * height / 1000),
          ],
          box_2d: object.box_2d,
          source: 'gemini',
        };
      });
      const localModel = String(state.currentResult.model_version || 'Local AI').split(' + Gemini')[0];
      const next = {
        ...state.currentResult,
        primary_label: enhanced.primary_label,
        description: enhanced.description,
        predictions: [
          { className: enhanced.primary_label, probability: state.currentResult.confidence, source: 'gemini' },
          ...(enhanced.categories || []).map(className => ({ className, probability: null, source: 'gemini-category' })),
          ...(state.currentResult.predictions || []),
        ].slice(0, 12),
        detections: [...cloudDetections, ...(state.currentResult.detections || [])].slice(0, 30),
        model_version: `${localModel} + Gemini ${enhanced.model}`.slice(0, 100),
        processing_time_ms: Number(state.currentResult.processing_time_ms || 0) + Number(enhanced.processing_time_ms || 0),
        cloud_enhanced: true,
        cloud_model: enhanced.model,
        cloud_categories: enhanced.categories || [],
        visible_text: enhanced.visible_text || [],
        suggested_actions: enhanced.suggested_actions || [],
      };
      if (next.id) {
        const saved = await api(`/scans/${next.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            primary_label: next.primary_label,
            description: next.description,
            predictions: next.predictions,
            detections: next.detections,
            model_version: next.model_version,
            processing_time_ms: next.processing_time_ms,
          }),
        });
        state.currentResult = {
          ...next,
          ...saved,
          cloud_enhanced: true,
          cloud_model: enhanced.model,
          cloud_categories: enhanced.categories || [],
          visible_text: enhanced.visible_text || [],
          suggested_actions: enhanced.suggested_actions || [],
        };
      } else {
        state.currentResult = next;
      }
      toast('Gemini đã bổ sung nhãn và mô tả thông minh hơn.');
    } catch (error) {
      toast(`${error.message || 'Gemini chưa phản hồi.'} Đã giữ nguyên kết quả local.`, 'error');
    } finally {
      state.advancedAnalyzing = false;
      render();
    }
  }

  function waitForModels(timeout) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (state.models.status === 'ready') { clearInterval(timer); resolve(); }
        else if (state.models.status === 'error' || Date.now() - started > timeout) { clearInterval(timer); reject(new Error('Model timeout')); }
      }, 150);
    });
  }

  async function saveCurrentScan() {
    if (!state.currentResult || !state.currentFile) {
      toast('Hãy quét một ảnh thật trước khi lưu.', 'error');
      return;
    }
    if (state.currentResult.id) { toast('Kết quả đã có trong lịch sử.'); return; }
    try {
      const form = new FormData();
      form.append('file', state.currentFile);
      form.append('metadata', JSON.stringify({
        primary_label: state.currentResult.primary_label,
        confidence: state.currentResult.confidence,
        description: state.currentResult.description,
        predictions: state.currentResult.predictions,
        detections: state.currentResult.detections,
        model_version: state.currentResult.model_version,
        processing_time_ms: state.currentResult.processing_time_ms,
        confirmed: state.currentResult.confirmed || false,
        favorite: state.currentResult.favorite || false,
      }));
      state.currentResult = await api('/scans', { method: 'POST', body: form });
      state.backendOnline = true;
      toast('Đã lưu kết quả vào lịch sử.');
      render();
    } catch (error) {
      state.backendOnline = false;
      toast(error.message || 'Không thể lưu vào backend.', 'error');
    }
  }

  async function loadHistory(search = '') {
    try {
      const result = await api(`/scans?page_size=50${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      state.scans = result.items;
      state.backendOnline = true;
    } catch (_) {
      state.scans = [];
      state.backendOnline = false;
    }
    if (state.route === 'history') render();
  }

  async function openScan(id) {
    try {
      state.currentResult = await api(`/scans/${id}`);
      state.currentFile = null;
      state.currentImageUrl = mediaUrl(state.currentResult.image_url);
      go('result');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function loadCollections() {
    try { state.collections = await api('/collections'); state.backendOnline = true; }
    catch (_) { state.collections = []; state.backendOnline = false; }
    if (state.route === 'collections') render();
  }

  async function saveToCollection() {
    if (!state.currentResult?.id) {
      await saveCurrentScan();
      if (!state.currentResult?.id) return;
    }
    try {
      let collections = await api('/collections');
      if (!collections.length) {
        const created = await api('/collections', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Yêu thích', description: 'Các kết quả Vision AI đã lưu' })
        });
        collections = [created];
      }
      const preferred = collections.find(item => item.name === 'Yêu thích') || collections[0];
      await api(`/collections/${preferred.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id: state.currentResult.id })
      });
      toast(`Đã lưu vào “${preferred.name}”.`);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function createCollection() {
    const name = prompt('Tên bộ sưu tập mới:');
    if (!name?.trim()) return;
    try {
      await api('/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      toast('Đã tạo bộ sưu tập.');
      loadCollections();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function openCollection(id) {
    try {
      const [collection, page] = await Promise.all([api(`/collections/${id}`), api(`/collections/${id}/items?page_size=50`)]);
      state.selectedCollection = collection;
      state.collectionItems = page.items;
      go('collection', { id });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function loadPrivacy() {
    try { state.settings = { ...state.settings, ...(await api('/settings/privacy')) }; }
    catch (_) { /* keep device preferences */ }
    if (state.route === 'privacy') render();
  }

  async function updatePrivacy(key, value) {
    state.settings[key] = value;
    try {
      await api('/settings/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
      toast('Đã cập nhật cài đặt.');
    } catch (_) { toast('Đã lưu trên thiết bị; backend đang ngoại tuyến.', 'error'); }
  }

  async function updateResult(form) {
    if (!state.currentResult) {
      toast('Không có kết quả để chỉnh sửa.', 'error');
      go('scanner');
      return;
    }
    const label = form.label.value.trim();
    const description = form.description.value.trim();
    if (!label) return;
    state.currentResult = { ...state.currentResult, primary_label: label, description, confirmed: true };
    try {
      if (state.currentResult.id) {
        state.currentResult = await api(`/scans/${state.currentResult.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ primary_label: label, description, confirmed: true }) });
        await api('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan_id: state.currentResult.id, feedback_type: 'confirm', corrected_label: label }) });
      }
      toast('Đã xác nhận kết quả AI.');
      go('result');
    } catch (error) { toast(error.message, 'error'); }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    state.settings.theme = next;
    localStorage.setItem('vision-theme', next);
    updatePrivacy('theme', next);
    render();
  }

  async function exportResult(format) {
    const result = state.currentResult;
    if (!result) {
      toast('Không có kết quả để xuất.', 'error');
      return;
    }
    if (result.id) {
      window.open(`${API_BASE}/scans/${result.id}/export?format=${format}`, '_blank', 'noopener');
      toast(`Đang xuất ${format.toUpperCase()}...`);
      return;
    }
    const payload = format === 'json'
      ? JSON.stringify(result, null, 2)
      : `label,confidence,model\n"${String(result.primary_label).replaceAll('"','""')}",${result.confidence},"${result.model_version}"`;
    const blob = new Blob([format === 'csv' ? '\ufeff' + payload : payload], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `vision-result.${format}`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`Đã xuất ${format.toUpperCase()}.`);
  }

  async function confirmDelete() {
    try {
      if (state.params.get('type') === 'collection' && state.selectedCollection) {
        await api(`/collections/${state.selectedCollection.id}`, { method: 'DELETE' });
        state.selectedCollection = null; toast('Đã xóa bộ sưu tập.'); go('collections');
      } else {
        await api('/scans', { method: 'DELETE' });
        state.scans = []; state.currentResult = null; toast('Đã xóa toàn bộ lịch sử.'); go('history');
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  async function loadMe() {
    try {
      state.user = await api('/auth/me');
    } catch (_) {
      state.user = null;
    } finally {
      state.authChecked = true;
    }
  }

  async function submitLogin(form) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const result = await api('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value, remember: form.remember.checked })
      });
      if (result.requires_2fa) {
        state.twoFactorChallenge = result.challenge_token;
        go('two-factor');
        return;
      }
      state.user = result.user;
      localStorage.setItem('vision-onboarded', '1');
      toast('Đăng nhập thành công.');
      go('permissions');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }

  async function submitTwoFactorLogin(form) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const result = await api('/auth/2fa/verify-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge_token: state.twoFactorChallenge, code: form.code.value.trim() })
      });
      state.user = result.user;
      state.twoFactorChallenge = '';
      localStorage.setItem('vision-onboarded', '1');
      toast('Xác minh thành công.');
      go('scanner');
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  }

  async function startTwoFactorSetup() {
    try {
      state.twoFactorSetup = await api('/auth/2fa/setup', { method: 'POST' });
      go('two-factor-setup');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function enableTwoFactor(form) {
    try {
      const result = await api('/auth/2fa/enable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_token: state.twoFactorSetup.setup_token, code: form.code.value.trim() })
      });
      state.user = result.user;
      state.recoveryCodes = result.recovery_codes;
      state.twoFactorSetup = null;
      toast('Đã bật xác thực hai lớp.');
      go('recovery-codes');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function disableTwoFactor() {
    const password = prompt('Nhập mật khẩu hiện tại để tắt 2FA:');
    if (!password) return;
    const code = prompt('Nhập mã 6 số từ Authenticator:');
    if (!/^\d{6}$/.test(code || '')) return toast('Mã xác thực phải có 6 số.', 'error');
    try {
      state.user = await api('/auth/2fa/disable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code })
      });
      toast('Đã tắt xác thực hai lớp.');
      render();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function regenerateRecoveryCodes() {
    const password = prompt('Nhập mật khẩu hiện tại:');
    if (!password) return;
    const code = prompt('Nhập mã 6 số từ Authenticator:');
    if (!/^\d{6}$/.test(code || '')) return toast('Mã Authenticator phải có 6 số.', 'error');
    try {
      const result = await api('/auth/2fa/recovery-codes/regenerate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code })
      });
      state.recoveryCodes = result.recovery_codes;
      go('recovery-codes');
    } catch (error) { toast(error.message, 'error'); }
  }

  function recoveryCodesText() {
    return `VISION AI - MÃ KHÔI PHỤC 2FA\n${state.user?.email || ''}\n\n${state.recoveryCodes.join('\n')}\n\nMỗi mã chỉ sử dụng được một lần.`;
  }

  function downloadRecoveryCodes() {
    const blob = new Blob([recoveryCodesText()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'vision-ai-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function submitRegister(form) {
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const result = await api('/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: form.display_name.value.trim(), email: form.email.value.trim(), password: form.password.value })
      });
      state.user = result.user;
      localStorage.setItem('vision-onboarded', '1');
      toast('Tài khoản đã được tạo.');
      go('permissions');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  }

  async function submitForgot(form) {
    try {
      const result = await api('/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value.trim() })
      });
      toast(result.message);
      if (result.debug_token) go('reset-password', { token: result.debug_token });
      form.reset();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function submitResetPassword(form) {
    if (form.new_password.value !== form.confirmation.value) {
      toast('Hai mật khẩu không khớp.', 'error');
      return;
    }
    try {
      const result = await api('/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: form.token.value, new_password: form.new_password.value }),
      });
      toast(result.message);
      go('login');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function submitVerifyEmail(form) {
    try {
      const user = await api('/auth/email-verification/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: form.token.value }),
      });
      state.user = user;
      toast('Email đã được xác minh.');
      try { state.user = await api('/auth/me'); go('account'); }
      catch (_) { state.user = null; go('login'); }
    } catch (error) { toast(error.message, 'error'); }
  }

  async function requestEmailVerification() {
    try {
      const result = await api('/auth/email-verification/request', { method: 'POST' });
      toast(result.message);
      if (result.debug_token) go('verify-email', { token: result.debug_token });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function submitChangePassword(form) {
    try {
      const result = await api('/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: form.current_password.value, new_password: form.new_password.value }),
      });
      form.reset();
      toast(result.message);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function submitDeleteAccount(form) {
    if (!window.confirm('Xóa tài khoản và toàn bộ ảnh vĩnh viễn?')) return;
    try {
      const result = await api('/auth/account', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.password.value, confirmation: form.confirmation.value }),
      });
      state.user = null;
      localStorage.removeItem('vision-onboarded');
      toast(result.message);
      go('login');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* clear local state anyway */ }
    stopCamera();
    state.user = null;
    state.sessions = [];
    state.apiKeys = [];
    state.securityEvents = [];
    state.currentResult = null;
    toast('Đã đăng xuất.');
    go('login');
  }

  async function loadSecurity() {
    try {
      [state.sessions, state.apiKeys, state.securityEvents] = await Promise.all([api('/auth/sessions'), api('/auth/api-keys'), api('/auth/security-events')]);
      if (state.route === 'security') render();
    } catch (error) {
      if (error.status === 401) { state.user = null; go('login'); }
      else toast(error.message, 'error');
    }
  }

  async function createApiKey() {
    const name = prompt('Tên API key (ví dụ: Ứng dụng mobile):');
    if (!name?.trim()) return;
    try {
      const item = await api('/auth/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() })
      });
      state.newApiKey = item.key;
      await loadSecurity();
      toast('Đã tạo API key. Hãy sao chép và lưu ngay.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function revokeApiKey(id) {
    if (!confirm('Thu hồi API key này? Ứng dụng đang dùng key sẽ mất quyền ngay.')) return;
    try { await api(`/auth/api-keys/${id}`, { method: 'DELETE' }); state.newApiKey = ''; await loadSecurity(); toast('Đã thu hồi API key.'); }
    catch (error) { toast(error.message, 'error'); }
  }

  async function revokeSession(id) {
    try { await api(`/auth/sessions/${id}`, { method: 'DELETE' }); await loadSecurity(); toast('Đã đăng xuất thiết bị đó.'); }
    catch (error) { toast(error.message, 'error'); }
  }

  async function registerPwa() {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      state.pwa.registration = registration;
      state.pwa.updateReady = Boolean(registration.waiting);
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            state.pwa.updateReady = true;
            toast('Có phiên bản Vision AI mới.', 'success');
            worker.postMessage({ type: 'SKIP_WAITING' });
            if (state.route === 'app-update') render();
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window.__visionReloading) return;
        window.__visionReloading = true;
        location.reload();
      });
      await registration.update();
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  }

  async function installPwa() {
    const promptEvent = state.pwa.deferredPrompt;
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    state.pwa.deferredPrompt = null;
    if (choice.outcome === 'accepted') toast('Đang cài Vision AI...');
    render();
  }

  function applyPwaUpdate() {
    const worker = state.pwa.registration?.waiting;
    if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
  }

  async function loadStorageEstimate() {
    try { state.storageEstimate = await navigator.storage?.estimate() || state.storageEstimate; }
    catch (_) { /* StorageManager is optional. */ }
    if (state.route === 'sync') render();
  }

  async function clearPwaCache() {
    if ('caches' in window) await Promise.all((await caches.keys()).map(key => caches.delete(key)));
    state.pwa.registration?.active?.postMessage({ type: 'CLEAR_UI_CACHE' });
    await loadStorageEstimate();
    toast('Đã xóa cache giao diện. Dữ liệu tài khoản không bị xóa.');
  }

  async function selectModel(model) {
    if (!['hybrid', 'mobilenet', 'coco', 'yolo'].includes(model)) return;
    if (model === 'yolo' && (yoloDeviceAssessment().weak || state.modelPreferences.powerSave)) {
      state.models.yoloStatus = 'fallback';
      state.models.yoloFallback = true;
      state.models.yoloError = 'Thiết bị cấu hình thấp hoặc đang bật chế độ tiết kiệm dữ liệu.';
      state.modelPreferences.active = 'coco';
      localStorage.setItem('vision-active-model', 'coco');
      await ensureCocoDetector().catch(() => null);
      toast('Máy này phù hợp với COCO-SSD hơn; YOLO sẽ không được tải.', 'error');
      render();
      return;
    }
    state.modelPreferences.active = model;
    localStorage.setItem('vision-active-model', model);
    if (model === 'yolo') {
      toast('Đang tải YOLOv8 Nano lần đầu...');
      const ready = await ensureYoloLoaded();
      if (!ready) toast('Đã tự động chuyển sang COCO-SSD.', 'error');
      else toast(`YOLO sẵn sàng qua ${state.models.yoloProvider.toUpperCase()}.`);
      render();
      return;
    }
    state.models.yoloFallback = false;
    toast('Đã đổi mô hình nhận diện.');
    render();
  }

  async function loadModelStats(force = false) {
    if (state.modelStatsLoaded && !force) return;
    state.modelStatsLoaded = true;
    try {
      state.modelStats = await api('/model-evaluations/summary');
      if (state.route === 'models') render();
    } catch (_) { state.modelStatsLoaded = false; }
  }

  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Ảnh không hợp lệ.')); };
      image.src = url;
    });
  }

  async function benchmarkModels(file) {
    if (!file) return;
    if (yoloDeviceAssessment().weak || state.modelPreferences.powerSave) {
      toast('Tắt tiết kiệm pin hoặc dùng thiết bị mạnh hơn để benchmark YOLO.', 'error');
      return;
    }
    toast('Đang chạy benchmark YOLO và COCO-SSD...');
    try {
      const image = await loadImageFile(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const expectedLabel = (window.prompt('Nhãn đúng của ảnh là gì? Ví dụ: person, cat, car') || '').trim();
      const device = {
        userAgent: navigator.userAgent.slice(0, 300),
        cores: navigator.hardwareConcurrency || null,
        memory: navigator.deviceMemory || null,
      };
      const detector = await ensureCocoDetector();
      const cocoStarted = performance.now();
      const coco = await detector.detect(canvas);
      const cocoLatency = Math.round(performance.now() - cocoStarted);
      const yoloReady = await ensureYoloLoaded({ force: true });
      if (!yoloReady) throw new Error('YOLO không khởi tạo được trên thiết bị này.');
      const yoloStarted = performance.now();
      const yolo = await window.VisionYolo.detect(canvas, { threshold: state.modelPreferences.threshold, force: true });
      const yoloLatency = Math.round(performance.now() - yoloStarted);
      const memoryMb = performance.memory?.usedJSHeapSize ? performance.memory.usedJSHeapSize / 1024 / 1024 : null;
      const payloads = [
        { model_name: 'COCO-SSD Lite', predicted_label: coco.sort((a,b) => b.score-a.score)[0]?.class || '', confidence: coco[0]?.score || 0, latency_ms: cocoLatency },
        { model_name: 'YOLOv8n ONNX', predicted_label: yolo.sort((a,b) => b.score-a.score)[0]?.class || '', confidence: yolo[0]?.score || 0, latency_ms: yoloLatency },
      ];
      await Promise.all(payloads.map(item => api('/model-evaluations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item, expected_label: expectedLabel, memory_mb: memoryMb, device }),
      })));
      await loadModelStats(true);
      toast(`Đã lưu benchmark: COCO ${cocoLatency} ms · YOLO ${yoloLatency} ms.`);
    } catch (error) { toast(error.message || 'Benchmark thất bại.', 'error'); }
  }

  async function loadTeam() {
    try {
      state.teamMembers = await api('/auth/team');
      if (state.route === 'team') render();
    } catch (error) {
      if (error.status === 403) go('forbidden');
      else toast(error.message, 'error');
    }
  }

  async function updateMemberRole(userId, role) {
    try {
      await api(`/auth/team/${userId}/role`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role })
      });
      toast('Đã cập nhật quyền thành viên.');
      await loadTeam();
    } catch (error) { toast(error.message, 'error'); await loadTeam(); }
  }

  function bindPage() {
    app.querySelectorAll('[data-go]').forEach(node => node.addEventListener('click', () => go(node.dataset.go)));
    app.querySelectorAll('[data-open-scan]').forEach(node => node.addEventListener('click', () => openScan(node.dataset.openScan)));
    app.querySelectorAll('[data-open-collection]').forEach(node => node.addEventListener('click', () => openCollection(node.dataset.openCollection)));
    app.querySelectorAll('[data-export]').forEach(node => node.addEventListener('click', () => exportResult(node.dataset.export)));
    app.querySelectorAll('[data-revoke-key]').forEach(node => node.addEventListener('click', () => revokeApiKey(node.dataset.revokeKey)));
    app.querySelectorAll('[data-revoke-session]').forEach(node => node.addEventListener('click', () => revokeSession(node.dataset.revokeSession)));
    app.querySelectorAll('[data-model]').forEach(node => node.addEventListener('click', () => selectModel(node.dataset.model)));
    app.querySelectorAll('[data-member-role]').forEach(node => node.addEventListener('change', () => updateMemberRole(node.dataset.memberRole, node.value)));
    app.querySelectorAll('[data-setting]').forEach(node => node.addEventListener('change', () => updatePrivacy(node.dataset.setting, node.checked)));
    app.querySelectorAll('[data-label]').forEach(node => node.addEventListener('click', () => {
      app.querySelectorAll('[data-label]').forEach(item => item.classList.remove('active')); node.classList.add('active');
    }));
    app.querySelectorAll('[data-action]').forEach(node => node.addEventListener('click', async event => {
      const action = node.dataset.action;
      if (action === 'drawer') { state.drawerOpen = true; render(); }
      if (action === 'close-drawer') { state.drawerOpen = false; render(); }
      if (action === 'back') history.length > 1 ? history.back() : go('scanner');
      if (action === 'more') { state.drawerOpen = true; render(); }
      if (action === 'request-camera' || action === 'start-camera') requestCamera();
      if (action === 'pick-file') document.querySelector('#scanner-file, #permission-file, #state-file')?.click();
      if (action === 'capture') captureFrame();
      if (action === 'flip-camera') { toast('Đang đổi camera...'); await requestCamera({ flip: true }); }
      if (action === 'save-scan') saveCurrentScan();
      if (action === 'advanced-analysis') advancedAnalyze();
      if (action === 'save-collection') saveToCollection();
      if (action === 'new-scan') { state.currentResult = null; state.currentFile = null; go('scanner'); }
      if (action === 'create-collection') createCollection();
      if (action === 'toggle-theme') toggleTheme();
      if (action === 'retry-backend') { const ok = await checkBackend(); toast(ok ? 'Backend đã kết nối.' : 'Backend vẫn chưa phản hồi.', ok ? 'success' : 'error'); if (ok) go('scanner'); }
      if (action === 'confirm-delete') confirmDelete();
      if (action === 'delete-collection') go('delete-confirm', { type: 'collection' });
      if (action === 'report-result') toast('Đã ghi nhận báo cáo nhận diện sai.');
      if (action === 'feedback') toast('Cảm ơn bạn! Kênh phản hồi đang được chuẩn bị.');
      if (action === 'logout') logout();
      if (action === 'request-email-verification') requestEmailVerification();
      if (action === 'create-api-key') createApiKey();
      if (action === 'setup-2fa') startTwoFactorSetup();
      if (action === 'disable-2fa') disableTwoFactor();
      if (action === 'regenerate-recovery-codes') regenerateRecoveryCodes();
      if (action === 'copy-recovery-codes') { navigator.clipboard?.writeText(recoveryCodesText()); toast('Đã sao chép mã khôi phục.'); }
      if (action === 'download-recovery-codes') downloadRecoveryCodes();
      if (action === 'finish-recovery-codes') { state.recoveryCodes = []; go('security'); }
      if (action === 'copy-api-key') { navigator.clipboard?.writeText(state.newApiKey); toast('Đã sao chép API key.'); }
      if (action === 'install-pwa') installPwa();
      if (action === 'apply-update') applyPwaUpdate();
      if (action === 'clear-pwa-cache') clearPwaCache();
      if (action === 'pick-benchmark') document.getElementById('benchmark-file')?.click();
      if (action === 'sync-now') { const ok = await checkBackend(); await loadStorageEstimate(); toast(ok ? 'PostgreSQL và kho ảnh đang phản hồi.' : 'Backend chưa kết nối.', ok ? 'success' : 'error'); render(); }
      if (action === 'copy-summary') {
        if (!state.currentResult) toast('Không có kết quả để sao chép.', 'error');
        else { navigator.clipboard?.writeText(state.currentResult.description); toast('Đã sao chép tóm tắt.'); }
      }
      if (action === 'native-share') {
        const result = state.currentResult;
        if (!result) toast('Không có kết quả để chia sẻ.', 'error');
        else if (navigator.share) navigator.share({ title: 'Kết quả Vision AI', text: `${result.primary_label} · ${pct(result.confidence)}\n${result.description}` }).catch(() => {});
        else { navigator.clipboard?.writeText(result.description); toast('Đã sao chép nội dung chia sẻ.'); }
      }
      event.stopPropagation();
    }));
    document.querySelectorAll('input[type=file]:not(#benchmark-file)').forEach(input => input.addEventListener('change', () => validateAndAnalyze(input.files?.[0])));
    document.getElementById('benchmark-file')?.addEventListener('change', event => benchmarkModels(event.target.files?.[0]));
    document.getElementById('edit-result')?.addEventListener('submit', event => { event.preventDefault(); updateResult(event.currentTarget); });
    document.getElementById('login-form')?.addEventListener('submit', event => { event.preventDefault(); submitLogin(event.currentTarget); });
    document.getElementById('register-form')?.addEventListener('submit', event => { event.preventDefault(); submitRegister(event.currentTarget); });
    document.getElementById('forgot-form')?.addEventListener('submit', event => { event.preventDefault(); submitForgot(event.currentTarget); });
    document.getElementById('reset-password-form')?.addEventListener('submit', event => { event.preventDefault(); submitResetPassword(event.currentTarget); });
    document.getElementById('verify-email-form')?.addEventListener('submit', event => { event.preventDefault(); submitVerifyEmail(event.currentTarget); });
    document.getElementById('change-password-form')?.addEventListener('submit', event => { event.preventDefault(); submitChangePassword(event.currentTarget); });
    document.getElementById('delete-account-form')?.addEventListener('submit', event => { event.preventDefault(); submitDeleteAccount(event.currentTarget); });
    document.getElementById('two-factor-login-form')?.addEventListener('submit', event => { event.preventDefault(); submitTwoFactorLogin(event.currentTarget); });
    document.getElementById('two-factor-enable-form')?.addEventListener('submit', event => { event.preventDefault(); enableTwoFactor(event.currentTarget); });
    document.getElementById('power-save')?.addEventListener('change', event => {
      state.modelPreferences.powerSave = event.target.checked;
      localStorage.setItem('vision-power-save', event.target.checked ? '1' : '0');
    });
    document.getElementById('confidence-slider')?.addEventListener('input', event => {
      state.modelPreferences.threshold = Number(event.target.value) / 100;
      localStorage.setItem('vision-confidence-threshold', String(state.modelPreferences.threshold));
      const output = document.getElementById('confidence-value');
      if (output) output.textContent = `${event.target.value}%`;
    });
    document.getElementById('history-search')?.addEventListener('input', event => {
      clearTimeout(window.__historyTimer);
      window.__historyTimer = setTimeout(() => loadHistory(event.target.value), 300);
    });
    if (state.route === 'scanner') attachCamera();
  }

  async function routeChanged() {
    const previous = state.route;
    parseRoute();
    if (state.authChecked && !state.user && !PUBLIC_ROUTES.has(state.route)) {
      go('login');
      return;
    }
    if (state.user && ['login', 'register'].includes(state.route)) {
      go('scanner');
      return;
    }
    state.drawerOpen = false;
    if (previous === 'scanner' && state.route !== 'scanner' && state.route !== 'processing') stopCamera();
    render();
    if (state.route === 'history') loadHistory();
    if (state.route === 'collections') loadCollections();
    if (state.route === 'collection' && state.params.get('id') && state.selectedCollection?.id !== state.params.get('id')) openCollection(state.params.get('id'));
    if (state.route === 'privacy') loadPrivacy();
    if (state.route === 'security') loadSecurity();
    if (state.route === 'models') loadModelStats();
    if (state.route === 'sync') { checkBackend().then(() => loadStorageEstimate()); }
    if (state.route === 'team') loadTeam();
    if (state.route === 'offline') checkBackend().then(() => render());
  }

  window.addEventListener('hashchange', routeChanged);
  window.addEventListener('beforeunload', stopCamera);
  async function bootstrap() {
    parseRoute();
    await loadMe();
    if (!state.user && !PUBLIC_ROUTES.has(state.route)) {
      state.route = 'login';
      history.replaceState(null, '', '#/login');
    } else if (state.user && ['login', 'register'].includes(state.route)) {
      state.route = 'scanner';
      history.replaceState(null, '', '#/scanner');
    }
    render();
    checkBackend();
    loadModels();
    registerPwa();
    if (state.route === 'security') loadSecurity();
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.pwa.deferredPrompt = event;
    if (state.route === 'install') render();
  });
  window.addEventListener('appinstalled', () => {
    state.pwa.installed = true;
    state.pwa.deferredPrompt = null;
    toast('Vision AI đã được cài trên thiết bị.');
    if (state.route === 'install') render();
  });
  window.addEventListener('online', () => {
    state.backendOnline = true;
    toast('Đã có kết nối mạng trở lại.');
    checkBackend().then(() => { if (state.route === 'sync') render(); });
  });
  window.addEventListener('offline', () => {
    state.backendOnline = false;
    toast('Đã mất mạng. AI trên thiết bị vẫn dùng được; đồng bộ và Gemini tạm dừng.', 'error');
    if (state.route === 'sync') render();
  });
  bootstrap();
})();
