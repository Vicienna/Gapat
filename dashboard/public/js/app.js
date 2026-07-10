// ─── API Helper ──────────────────────────────────────────────────
window.API = {
  base: '/api/proxy',
  async get(path) {
    try {
      const r = await fetch(this.base + path);
      if (r.status === 502) {
        const detail = await r.json().catch(() => ({}));
        throw new Error(detail?.detail || 'Bot API unreachable (port 3001)');
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP Error ${r.status}`); }
      return r.json();
    } catch (e) {
      if (e instanceof TypeError && e.message === 'Failed to fetch') {
        throw new Error('Dashboard proxy error. Check connection.');
      }
      throw e;
    }
  },
  async post(path, body) {
    const r = await fetch(this.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  },
  async patch(path, body) {
    const r = await fetch(this.base + path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  },
  async del(path) {
    const r = await fetch(this.base + path, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
    return r.json();
  }
};

// ─── Health Check ────────────────────────────────────────────────
window.checkHealth = async function() {
  try {
    const d = await API.get('/health');
    return d?.status === 'ok';
  } catch (e) {
    return false;
  }
};

// ─── Notification System ────────────────────────────────────────
const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };

window.notify = function(message, type = 'success', duration = 4000) {
  let container = document.getElementById('notif-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notif-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = 'notif-toast';
  const bar = document.createElement('div');
  bar.className = 'notif-bar';
  bar.style.background = colors[type] || colors.info;
  const icon = document.createElement('div');
  icon.className = 'notif-icon';
  icon.style.color = colors[type] || colors.info;
  const i = document.createElement('i');
  i.className = 'fas ' + (icons[type] || icons.info);
  icon.appendChild(i);
  const body = document.createElement('div');
  body.className = 'notif-body';
  const msg = document.createElement('p');
  msg.className = 'notif-msg';
  msg.textContent = String(message ?? '');
  body.appendChild(msg);
  const close = document.createElement('button');
  close.className = 'notif-close';
  const closeI = document.createElement('i');
  closeI.className = 'fas fa-times';
  close.appendChild(closeI);
  el.appendChild(bar);
  el.appendChild(icon);
  el.appendChild(body);
  el.appendChild(close);
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('notif-in'));
  const timer = setTimeout(() => dismiss(el), duration);
  el._timer = timer;
  el.querySelector('.notif-close').onclick = () => { clearTimeout(timer); dismiss(el); };
};

function dismiss(el) {
  if (el._dismissing) return;
  el._dismissing = true;
  el.classList.remove('notif-in');
  el.classList.add('notif-out');
  setTimeout(() => el.remove(), 400);
}

// Legacy alias
window.showToast = window.notify;

// ─── Confirm Dialog (replaces browser confirm()) ───────────────
window.confirmDialog = function(opts) {
  return new Promise(resolve => {
    const title = opts.title || 'Confirm';
    const message = opts.message || 'Are you sure?';
    const confirmText = opts.confirmText || 'Confirm';
    const danger = opts.danger !== false;

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">${title}</div>
        <div class="confirm-msg">${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel" data-action="cancel">${'Cancel'}</button>
          <button class="confirm-btn ${danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}" data-action="confirm">${confirmText}</button>
        </div>
      </div>`;

    function close(result) { backdrop.remove(); resolve(result); }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });

    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    backdrop.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));

    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="cancel"]').focus();
  });
};

// ─── Health Footer Component ─────────────────────────────────────
// Usage: <div x-data="healthFooter()" x-init="init()">...</div>
function healthFooter() {
  return {
    health: null,
    async init() {
      this.health = await checkHealth();
    }
  };
}

// ─── Format Helpers ─────────────────────────────────────────────
function fmt(num) { return num?.toLocaleString() || '0'; }
function trunc(str, n = 40) { return str?.length > n ? str.slice(0, n) + '...' : str || ''; }
function timeAgo(d) {
  if (!d) return '-';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function pct(a, b) { if (!b) return 0; return Math.min(100, ((a / b) * 100).toFixed(1)); }

// ─── Progress Bar Color Helper ──────────────────────────────────
function barColor(p) {
  if (p > 90) return 'bg-red-500';
  if (p > 70) return 'bg-orange-500';
  if (p > 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// ─── Theme Init (run before Alpine) ──────────────────────────────
(function() {
  const dark = localStorage.getItem('darkMode');
  if (dark === 'false') document.documentElement.classList.add('light');
})();

// ─── Global Alpine Stores ───────────────────────────────────────
document.addEventListener('alpine:init', () => {
  Alpine.store('app', {
    sidebarOpen: window.innerWidth > 768,
    page: window.location.pathname,
    darkMode: localStorage.getItem('darkMode') !== 'false',
    logoUrl: '',
    brandName: 'Gapat Bot',
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen;
    },
    closeSidebar() {
      this.sidebarOpen = false;
    },
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      localStorage.setItem('darkMode', this.darkMode);
      document.documentElement.classList.toggle('light', !this.darkMode);
    },
    async loadConfig() {
      try {
        const cfg = await fetch('/api/public/config').then(r => r.json());
        if (cfg.logoUrl) this.logoUrl = cfg.logoUrl;
        if (cfg.brandName) this.brandName = cfg.brandName;
      } catch {}
    }
  });

  Alpine.store('app').loadConfig();

  Alpine.store('user', {
    userId: null,
    username: null,
    avatar: null,
    role: null,
    adminGuilds: [],
    async init() {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.authenticated) {
          this.userId = data.user.userId;
          this.username = data.user.username;
          this.avatar = data.user.avatar;
          this.role = data.user.role;
          this.adminGuilds = data.user.adminGuilds || [];
        }
      } catch(e) {}
    }
  });
});
