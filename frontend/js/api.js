const BACKEND_ORIGIN = window.location.hostname.endsWith('vercel.app')
  ? 'https://vishvaerp.onrender.com'
  : '';
const API_URL = BACKEND_ORIGIN ? `${BACKEND_ORIGIN}/api` : '/api';

const api = {
  getToken() {
    return localStorage.getItem('erp_token') || localStorage.getItem('token');
  },

  setToken(token, user, refreshToken) {
    localStorage.setItem('erp_token', token);
    localStorage.setItem('erp_user', JSON.stringify(user));
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
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

  async request(endpoint, options = {}) {
    const isFormData = options.body instanceof FormData;
    const headers = { ...options.headers };
    if (!isFormData && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const token = this.getToken();
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
        if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/register')) {
          this.clearToken();
          window.location.href = '/pages/login.html';
        }
        if (response.status === 403 && data.code === 'SUBSCRIPTION_REQUIRED') {
          window.location.href = '/pages/college-admin/subscription.html';
        }
        throw new Error(data.message || data.errors?.[0]?.msg || 'Request failed');
      }

      return data;
    } catch (error) {
      throw error;
    }
  }
};

// UI Toast Helper
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
  
  toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3500);
}
