const API_URL = '/api';

const api = {
  getToken() {
    return localStorage.getItem('token');
  },

  setToken(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },

  clearToken() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/auth/login')) {
          this.clearToken();
          window.location.href = '/pages/login.html';
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
