// ── Toast Notification System ──────────────────────

const TOAST_CONTAINER_ID = 'toast-container';

function ensureToastContainer() {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (container) return container;
  container = document.createElement('div');
  container.id = TOAST_CONTAINER_ID;
  container.className = 'toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('role', 'status');
  document.body.appendChild(container);
  return container;
}

function showToast({ type = 'info', title = '', message = '', duration = 4000 }) {
  const container = ensureToastContainer();
  const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

  const el = document.createElement('div');
  el.id = id;
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');

  const icons = { success: '✅', info: 'ℹ️', warning: '⚠️', error: '❌' };

  el.innerHTML = `
    <div class="toast-content">
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="toast-body">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
    </div>
    <button class="toast-close" aria-label="Đóng">✕</button>
  `;

  const closeBtn = el.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => dismissToast(id));

  container.appendChild(el);

  // Animate in
  requestAnimationFrame(() => {
    el.classList.add('toast-visible');
  });

  // Auto dismiss
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }

  return id;
}

function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('toast-visible');
  el.classList.add('toast-hiding');
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 300);
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Ensure container exists on load
ensureToastContainer();

window.showToast = showToast;
window.dismissToast = dismissToast;