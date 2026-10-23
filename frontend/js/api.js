/**
 * VishvaERP — Hardened Frontend API Client (v2.1 Enterprise Security)
 * Features:
 * - Automatic JWT refresh rotation & replay
 * - Multi-tab session synchronization
 * - DOM XSS-safe toast & modal handling
 * - Open-redirect protection
 * - Pre-flight token expiration validation
 */

const BACKEND_ORIGIN = window.location.hostname.endsWith('vercel.app')
  ? 'https://vishvaerp.onrender.com'
  : '';
const API_URL = BACKEND_ORIGIN ? `${BACKEND_ORIGIN}/api` : '/api';

/* ─── HTML ESCAPING UTILITY (DOM XSS DEFENSE) ─── */
function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}
window.escapeHTML = window.escapeHTML || escapeHTML;

/* ─── SAFE REDIRECT HELPER (OPEN REDIRECT DEFENSE) ─── */
function getSafeRedirectUrl(target, fallback = '/pages/login.html') {
  if (!target || typeof target !== 'string') return fallback;
  const trimmed = target.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {}
  return fallback;
}
window.getSafeRedirectUrl = window.getSafeRedirectUrl || getSafeRedirectUrl;

let refreshPromise = null;

const api = {
  getToken() {
    return localStorage.getItem('erp_token') || localStorage.getItem('token');
  },

  getRefreshToken() {
    return localStorage.getItem('erp_refresh_token') || localStorage.getItem('refreshToken');
  },

  setToken(token, user, refreshToken) {
    if (!token) return;
    localStorage.setItem('erp_token', token);
    localStorage.setItem('token', token);
    if (user) {
      localStorage.setItem('erp_user', JSON.stringify(user));
      localStorage.setItem('user', JSON.stringify(user));
    }
    if (refreshToken) {
      localStorage.setItem('erp_refresh_token', refreshToken);
      localStorage.setItem('refreshToken', refreshToken);
    }
  },

  clearToken() {
    ['erp_token', 'erp_user', 'erp_refresh_token', 'token', 'user', 'refreshToken'].forEach((key) => {
      localStorage.removeItem(key);
    });
  },

  getUser() {
    const user = localStorage.getItem('erp_user') || localStorage.getItem('user');
    if (!user) return null;
    try {
      return JSON.parse(user);
    } catch {
      this.clearToken();
      return null;
    }
  },

  isTokenExpired(token) {
    if (!token || typeof token !== 'string') return true;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return false;
      // Buffer by 30 seconds before actual expiration
      return (payload.exp * 1000) <= (Date.now() + 30000);
    } catch {
      return false;
    }
  },

  async refreshToken() {
    if (refreshPromise) return refreshPromise;

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const data = await res.json();
        if (res.ok && data.token) {
          this.setToken(data.token, data.user || this.getUser(), data.refreshToken || refreshToken);
          return data.token;
        }
      } catch (err) {
        console.warn('[Auth] Token refresh error:', err.message);
      } finally {
        refreshPromise = null;
      }
      return null;
    })();

    return refreshPromise;
  },

  async logout() {
    const token = this.getToken();
    try {
      if (token) {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
      }
    } catch {}
    this.clearToken();
    window.location.href = '/pages/login.html';
  },

  async request(endpoint, options = {}, isRetry = false) {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = { ...options.headers };
    if (!isFormData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    let token = this.getToken();

    // Proactive refresh if token is within expiry buffer
    if (token && this.isTokenExpired(token) && !endpoint.includes('/auth/')) {
      const refreshed = await this.refreshToken();
      if (refreshed) token = refreshed;
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      let data;
      try {
        data = await response.json();
      } catch {
        data = { message: 'Invalid response from server' };
      }

      if (!response.ok) {
        // Automatic token rotation and retry on 401
        if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register') && !endpoint.includes('/auth/refresh-token')) {
          const newToken = await this.refreshToken();
          if (newToken) {
            return this.request(endpoint, options, true);
          }
          this.clearToken();
          window.location.href = getSafeRedirectUrl(`/pages/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }

        if (response.status === 403 && data.code === 'SUBSCRIPTION_REQUIRED') {
          window.location.href = '/pages/college-admin/subscription.html';
        }
        throw new Error(data.message || data.errors?.[0]?.msg || `HTTP Error ${response.status}`);
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  get(endpoint, options = {}) { return this.request(endpoint, { ...options, method: 'GET' }); },
  post(endpoint, body, options = {}) { return this.request(endpoint, { ...options, method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }); },
  put(endpoint, body, options = {}) { return this.request(endpoint, { ...options, method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }); },
  delete(endpoint, options = {}) { return this.request(endpoint, { ...options, method: 'DELETE' }); }
};

/* ─── MULTI-TAB SESSION SYNCHRONIZATION ─── */
window.addEventListener('storage', (event) => {
  if ((event.key === 'erp_token' || event.key === 'token') && !event.newValue) {
    if (!window.location.pathname.includes('/pages/login.html') && !window.location.pathname.includes('/pages/register.html')) {
      window.location.href = '/pages/login.html';
    }
  }
});

/* ─── XSS-SAFE TOAST HELPER ─── */
function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    info: 'fa-info-circle',
    warning: 'fa-exclamation-triangle',
    loading: 'fa-spinner fa-spin'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const content = document.createElement('div');
  content.className = 'toast-content';

  const icon = document.createElement('i');
  icon.className = `fas ${icons[type] || icons.info}`;
  content.appendChild(icon);

  const span = document.createElement('span');
  span.textContent = String(message ?? ''); // Safe DOM textContent prevents script execution
  content.appendChild(span);

  toast.appendChild(content);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Close toast');
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.onclick = () => toast.remove();
  toast.appendChild(closeBtn);

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, duration);
}
window.showToast = window.showToast || showToast;
window.api = api;
