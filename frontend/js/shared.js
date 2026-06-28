/**
 * VishvaERP — Shared JS Utilities (v2.0 Enterprise)
 * Handles: Advanced Navbar, Command Palette, Sidebar, Modals, Counters, Charts, Toast
 */



const API_URL = '/api';

/* ─── API ─── */
const api = {
  getToken() { return localStorage.getItem('erp_token'); },
  setToken(token, user) {
    localStorage.setItem('erp_token', token);
    localStorage.setItem('erp_user', JSON.stringify(user));
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  clearToken() {
    ['erp_token','erp_user','token','user'].forEach(k => localStorage.removeItem(k));
  },
  getUser() {
    const u = localStorage.getItem('erp_user') || localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },
  async request(endpoint, options = {}) {
    try {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      const token = this.getToken() || localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
      
      let data;
      try { data = await res.json(); } catch(e) { data = { message: 'Invalid response from server' }; }
      
      if (!res.ok) {
        if (res.status === 401 && !endpoint.includes('/auth/')) {
          this.clearToken();
          window.location.href = '/pages/login.html';
          return;
        }
        const errorMsg = data.message || data.errors?.[0]?.msg || `HTTP Error ${res.status}`;
        if (!options.silent) showToast(errorMsg, 'error');
        throw new Error(errorMsg);
      }
      return data;
    } catch (error) {
      if (!options.silent) {
        const errorMsg = error.name === 'TypeError' && error.message.includes('fetch') 
          ? 'Network Error: Cannot connect to server.' 
          : error.message;
        showToast(errorMsg, 'error');
      }
      throw error;
    }
  }
};

/* ─── ROUTE GUARD ─── */
function requireAuth(allowedRoles) {
  const user = api.getUser();
  if (!user) { window.location.href = '/pages/login.html'; return null; }
  if (Array.isArray(allowedRoles) && allowedRoles.length && !allowedRoles.includes(user.role)) {
    window.location.href = '/pages/login.html'; return null;
  }
  return user;
}

function getPageGuardRoles(path = window.location.pathname) {
  const normalizedPath = String(path || '').replace(/\/+/g, '/');
  if (normalizedPath.startsWith('/pages/super-admin/')) return ['superadmin'];
  if (normalizedPath.startsWith('/pages/college-admin/')) return ['collegeAdmin'];
  if (normalizedPath.startsWith('/pages/faculty/')) return ['faculty'];
  if (normalizedPath.startsWith('/pages/student/')) return ['student'];
  if (normalizedPath.startsWith('/pages/parent/')) return ['parent'];
  if (normalizedPath.endsWith('/pages/messages.html')) return [];
  return null;
}

function guardCurrentPage() {
  const roles = getPageGuardRoles();
  if (roles === null) return api.getUser();
  return requireAuth(roles);
}

/* ─── TOAST NOTIFICATIONS (Advanced) ─── */
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
  toast.className = `toast ${type} toast-animate`;
  toast.innerHTML = `
    <div class="toast-content">
      <i class="fas ${icons[type] || icons.info}"></i>
      <span>${message}</span>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="fas fa-times"></i>
    </button>
    <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => { 
    toast.style.animation = 'slideInRight 0.3s ease reverse'; 
    setTimeout(() => toast.remove(), 300); 
  }, duration);
  
  return toast;
}

/* ─── CONFIRM DIALOG (SweetAlert-style) ─── */
function showConfirm(options) {
  return new Promise((resolve) => {
    const { title = 'Confirm', message, confirmText = 'Confirm', cancelText = 'Cancel', type = 'danger', html = '' } = options;
    
    let container = document.getElementById('confirm-dialog-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'confirm-dialog-container';
      document.body.appendChild(container);
    }
    
    const colors = { 
      danger: { bg: '#FEE2E2', icon: '#DC2626', btn: 'btn-danger' },
      warning: { bg: '#FEF3C7', icon: '#D97706', btn: 'btn-warning' },
      success: { bg: '#D1FAE5', icon: '#059669', btn: 'btn-success' },
      info: { bg: '#DBEAFE', icon: '#2563EB', btn: 'btn-primary' }
    };
    const c = colors[type] || colors.info;
    
    container.innerHTML = `
      <div class="modal-backdrop open" style="z-index: 1000;">
        <div class="modal modal-sm" style="position: relative; animation: scaleIn 0.2s ease;">
          <div class="modal-body" style="text-align: center; padding: 32px 24px;">
            <div style="width: 60px; height: 60px; margin: 0 auto 20px; background: ${c.bg}; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <i class="fas ${type === 'danger' ? 'fa-exclamation-triangle' : type === 'warning' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}" style="font-size: 24px; color: ${c.icon};"></i>
            </div>
            <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--text-primary);">${title}</h3>
            <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">${message}</p>
            ${html}
            <div style="display: flex; gap: 12px; justify-content: center;">
              <button class="btn btn-secondary" id="confirm-cancel">${cancelText}</button>
              <button class="btn ${c.btn}" id="confirm-ok">${confirmText}</button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('confirm-cancel').onclick = () => {
      container.innerHTML = '';
      document.body.style.overflow = '';
      resolve(false);
    };
    document.getElementById('confirm-ok').onclick = () => {
      container.innerHTML = '';
      document.body.style.overflow = '';
      resolve(true);
    };
  });
}

/* ─── LOADING STATES ─── */
function setLoading(button, loading = true) {
  if (!button) return;
  if (loading) {
    button.classList.add('btn-loading');
    button.disabled = true;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
  }
}

function showPageLoader(message = 'Loading...') {
  let loader = document.getElementById('page-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'page-loader';
    loader.innerHTML = `
      <div style="position: fixed; inset: 0; background: rgba(255,255,255,0.95); display: flex; align-items: center; justify-content: center; z-index: 9999; backdrop-filter: blur(4px);">
        <div style="text-align: center;">
          <div style="width: 48px; height: 48px; border: 4px solid #E2E8F0; border-top-color: #4F46E5; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px;"></div>
          <p style="color: var(--text-secondary); font-size: 14px;">${message}</p>
        </div>
      </div>
    `;
    document.body.appendChild(loader);
  }
  loader.style.display = 'flex';
  return loader;
}

function hidePageLoader() {
  const loader = document.getElementById('page-loader');
  if (loader) {
    loader.style.display = 'none';
    setTimeout(() => loader.remove(), 300);
  }
}

/* ─── SIDEBAR ─── */
const SIDEBAR_COMPACT_KEY = 'erp_sidebar_compact';

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function wrapSidebarLabels(sidebar) {
  if (!sidebar) return;

  sidebar.querySelectorAll('.nav-link').forEach((link) => {
    if (link.querySelector('.nav-link-label')) return;
    const textNodes = Array.from(link.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (!textNodes.length) return;
    const label = document.createElement('span');
    label.className = 'nav-link-label';
    label.textContent = textNodes.map((node) => node.textContent.trim()).join(' ');
    textNodes.forEach((node) => node.remove());
    const badge = link.querySelector('.nav-link-badge');
    if (badge) link.insertBefore(label, badge);
    else link.appendChild(label);
  });

  const logoutButton = sidebar.querySelector('.sidebar-logout');
  if (logoutButton && !logoutButton.querySelector('.sidebar-logout-label')) {
    const textNodes = Array.from(logoutButton.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNodes.length) {
      const label = document.createElement('span');
      label.className = 'sidebar-logout-label';
      label.textContent = textNodes.map((node) => node.textContent.trim()).join(' ');
      textNodes.forEach((node) => node.remove());
      logoutButton.appendChild(label);
    }
  }
}

function getDefaultRouteForRole(role) {
  return {
    superadmin: '/pages/super-admin/dashboard.html',
    collegeAdmin: '/pages/college-admin/dashboard.html',
    faculty: '/pages/faculty/dashboard.html',
    student: '/pages/student/dashboard.html',
    parent: '/pages/parent/dashboard.html',
  }[role] || '/pages/login.html';
}

function normalizeLocalPath(href) {
  if (!href || href.startsWith('javascript:') || href.startsWith('#')) return '';
  try {
    return new URL(href, window.location.href).pathname.replace(/\/+/g, '/');
  } catch {
    return '';
  }
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const hamburger = document.getElementById('hamburger');
  const main = document.querySelector('.erp-main');
  if (!sidebar) return;

  wrapSidebarLabels(sidebar);

  const currentPath = window.location.pathname.replace(/\/+/g, '/');
  let compactButton = document.getElementById('sidebarCompactBtn');

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    document.body.style.overflow = '';
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
  };

  const openSidebar = () => {
    sidebar.classList.add('open');
    overlay?.classList.add('open');
    document.body.classList.add('sidebar-open');
    document.body.style.overflow = 'hidden';
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
  };

  const setCompact = (compact) => {
    const shouldCompact = !isMobileViewport() && compact;
    sidebar.classList.toggle('compact', shouldCompact);
    main?.classList.toggle('sidebar-compact', shouldCompact);
    localStorage.setItem(SIDEBAR_COMPACT_KEY, shouldCompact ? '1' : '0');
    if (compactButton) {
      compactButton.setAttribute('aria-pressed', shouldCompact ? 'true' : 'false');
      compactButton.innerHTML = `<i class="fas ${shouldCompact ? 'fa-angles-right' : 'fa-angles-left'}"></i>`;
      compactButton.title = shouldCompact ? 'Expand navigation' : 'Collapse navigation';
    }
  };

  const navigateTo = (href) => {
    if (!href) return;
    if (href.startsWith('javascript:history.back()')) {
      fadeOutPage(() => {
        if (window.history.length > 1) window.history.back();
        else window.location.href = getDefaultRouteForRole(api.getUser()?.role);
      });
      return;
    }
    if (href.startsWith('#')) return;
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin) {
      window.location.href = target.href;
      return;
    }
    if (target.pathname === window.location.pathname && target.search === window.location.search && target.hash === window.location.hash) {
      closeSidebar();
      return;
    }
    showPageLoader('Opening page...');
    fadeOutPage(() => { window.location.href = target.href; });
  };

  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    const targetPath = normalizeLocalPath(href);
    const isActive = targetPath && targetPath === currentPath;
    link.classList.toggle('active', Boolean(isActive));
    if (isActive) link.setAttribute('aria-current', 'page');
    if (sidebar.classList.contains('compact')) link.title = link.textContent.trim();
    link.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      closeSidebar();
      navigateTo(href);
    });
  });

  hamburger?.setAttribute('aria-expanded', 'false');
  hamburger?.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  overlay?.addEventListener('click', closeSidebar);

  if (!compactButton && main && !isMobileViewport()) {
    const topbarLeft = document.querySelector('.topbar-left');
    if (topbarLeft) {
      compactButton = document.createElement('button');
      compactButton.id = 'sidebarCompactBtn';
      compactButton.className = 'topbar-btn topbar-nav-toggle';
      compactButton.type = 'button';
      topbarLeft.insertBefore(compactButton, topbarLeft.querySelector('.topbar-breadcrumb') || null);
      compactButton.addEventListener('click', () => setCompact(!sidebar.classList.contains('compact')));
    }
  }

  setCompact(localStorage.getItem(SIDEBAR_COMPACT_KEY) === '1');

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
    if (!isMobileViewport() && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      setCompact(!sidebar.classList.contains('compact'));
    }
  });

  window.addEventListener('resize', debounce(() => {
    if (isMobileViewport()) {
      closeSidebar();
      sidebar.classList.remove('compact');
      main?.classList.remove('sidebar-compact');
    } else {
      setCompact(localStorage.getItem(SIDEBAR_COMPACT_KEY) === '1');
    }
  }, 120));
}

/* ─── TOPBAR USER ─── */
function initTopbar() {
  const user = api.getUser();
  if (!user) return;
  
  const el = document.getElementById('topbar-user-name');
  if (el) el.textContent = user.name || 'User';
  
  const av = document.getElementById('topbar-avatar');
  if (av) av.textContent = (user.name || 'U')[0].toUpperCase();
  
  const sid = document.getElementById('sidebar-user-name');
  if (sid) sid.textContent = user.name || 'User';
  
  const srl = document.getElementById('sidebar-user-role');
  if (srl) srl.textContent = ({ superadmin: 'Super Admin', collegeAdmin: 'College Admin', faculty: 'Faculty', student: 'Student', parent: 'Parent' })[user.role] || user.role;
}

/* ─── ANIMATED COUNTER ─── */
function animateCounter(el, target, suffix = '') {
  const duration = 1200;
  const start = performance.now();
  const startVal = 0;
  el.textContent = '0' + suffix;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = Math.round(startVal + (target - startVal) * eased);
    el.textContent = val.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function animateAllCounters() {
  document.querySelectorAll('[data-counter]').forEach(el => {
    const target = parseFloat(el.dataset.counter);
    const suffix = el.dataset.suffix || '';
    if (!isNaN(target)) animateCounter(el, target, suffix);
  });
}

/* ─── MODAL SYSTEM ─── */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { 
    m.classList.add('open'); 
    document.body.style.overflow = 'hidden';
    setTimeout(() => m.querySelector('input')?.focus(), 100);
  }
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}
function createModal(options) {
  const { id, title, body, footer, size = 'md', onClose } = options;
  const sizes = { sm: '400px', md: '560px', lg: '720px', xl: '900px' };
  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal" style="max-width: ${sizes[size]};">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <button class="modal-close" onclick="closeModal('${id}')"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal(id);
      if (onClose) onClose();
    }
  });
  return modal;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => {
      m.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
});

/* ─── SKELETON LOADERS ─── */
function showSkeleton(containerId, rows = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array(rows).fill(`
    <div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #F1F5F9">
      <div class="skeleton" style="width:36px;height:36px;border-radius:50%;flex-shrink:0"></div>
      <div style="flex:1">
        <div class="skeleton skeleton-text" style="width:40%"></div>
        <div class="skeleton skeleton-text" style="width:65%;margin-bottom:0"></div>
      </div>
      <div class="skeleton" style="width:70px;height:24px;border-radius:20px"></div>
    </div>
  `).join('');
}

function showTableSkeleton(tableId, columns = 4, rows = 5) {
  const el = document.getElementById(tableId);
  if (!el) return;
  el.innerHTML = Array(rows).fill(`
    <tr>
      ${Array(columns).fill('<td><div class="skeleton" style="height:16px;width:80%"></div></td>').join('')}
    </tr>
  `).join('');
}

/* ─── CHART DEFAULTS ─── */
function getChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 12 }, padding: 16, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#0F172A', titleColor: '#F1F5F9', bodyColor: '#CBD5E1',
        padding: 12, borderColor: '#1E293B', borderWidth: 1, cornerRadius: 8,
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.formattedValue}` }
      }
    }
  };
}

const CHART_COLORS = ['#4F46E5','#10B981','#F59E0B','#EF4444','#8B5CF6','#0EA5E9','#EC4899','#14B8A6'];
const CHART_COLORS_ALPHA = CHART_COLORS.map(c => c + '22');

/* ─── SCROLL ANIMATIONS (Intersection Observer) ─── */
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fade-in-up');
        entry.target.style.opacity = '1';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  
  document.querySelectorAll('.animate-on-scroll').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });
}

/* ─── PAGE TRANSITIONS ─── */
function fadeOutPage(callback) {
  document.body.style.transition = 'opacity 0.2s ease';
  document.body.style.opacity = '0';
  setTimeout(() => {
    callback();
    document.body.style.opacity = '1';
  }, 200);
}

/* ─── STORAGE HELPERS ─── */
const storage = {
  get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch { return defaultValue; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  remove(key) { localStorage.removeItem(key); },
  clear() { localStorage.clear(); }
};

/* ─── DEBOUNCE & THROTTLE ─── */
function debounce(fn, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}
function throttle(fn, limit = 300) {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) { fn(...args); inThrottle = true; setTimeout(() => inThrottle = false, limit); }
  };
}

/* ─── FORM VALIDATION ─── */
const validators = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  phone: (v) => /^\d{10}$/.test(v.replace(/\D/g, '')),
  required: (v) => v && v.trim().length > 0,
  minLength: (v, len) => v && v.length >= len,
};

function validateField(field, rules) {
  const value = field.value;
  const errors = [];
  rules.forEach(rule => {
    if (typeof rule === 'function') {
      if (!rule(value)) errors.push('Invalid input');
    } else if (rule === 'required' && !value.trim()) errors.push('This field is required');
    else if (rule === 'email' && !validators.email(value)) errors.push('Invalid email');
    else if (rule === 'phone' && !validators.phone(value)) errors.push('Invalid phone');
  });
  return errors;
}

/* ─── DATE & TIME HELPERS ─── */
const dateHelpers = {
  format: (date, format = 'short') => {
    const d = new Date(date);
    const formats = {
      short: { month: 'short', day: 'numeric' },
      medium: { month: 'short', day: 'numeric', year: 'numeric' },
      long: { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' },
      time: { hour: '2-digit', minute: '2-digit' }
    };
    return d.toLocaleDateString('en-US', formats[format] || formats.short);
  },
  timeAgo: (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    const intervals = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60 };
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / secondsInUnit);
      if (interval >= 1) return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
    }
    return 'Just now';
  },
  isToday: (date) => new Date(date).toDateString() === new Date().toDateString(),
};

/* ─── NOTIFICATION PANEL TOGGLE ─── */
function initNotifications() {
  const notifBtn = document.getElementById('notif-btn');
  const notifPanel = document.getElementById('notif-panel');
  if (notifBtn && notifPanel) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPanel.classList.toggle('open');
    });
    document.addEventListener('click', () => notifPanel.classList.remove('open'));
    notifPanel.addEventListener('click', (e) => e.stopPropagation());
  }
}

/* ─── THEME TOGGLE ─── */
function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = themeToggle?.querySelector('i');
  
  const isDark = localStorage.getItem('theme') === 'dark' || 
    (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  const applyTheme = (dark) => {
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark', dark);
    if (themeIcon) themeIcon.className = `fas ${dark ? 'fa-sun' : 'fa-moon'}`;
  };

  applyTheme(isDark);
  if (!themeToggle) return;
  
  themeToggle.addEventListener('click', () => {
    const nextDark = !document.body.classList.contains('dark-mode');
    applyTheme(nextDark);
    localStorage.setItem('theme', nextDark ? 'dark' : 'light');
    updateScrollProgress();
  });
}

/* ─── ADVANCED NAVBAR & SCROLL ─── */
function updateScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
  const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrolled = (winScroll / height) * 100;
  bar.style.width = scrolled + "%";
  
  const nav = document.getElementById('mainNav');
  if (nav) {
    if (winScroll > 20) {
      nav.classList.add('shadow-xl', 'py-1');
      nav.style.background = document.body.classList.contains('dark-mode') ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.85)';
    } else {
      nav.classList.remove('shadow-xl', 'py-1');
      nav.style.background = '';
    }
  }
}

function initAdvancedNavbar() {
  window.addEventListener('scroll', throttle(updateScrollProgress, 10));
  
  // Mobile Bottom Navigation Injection
  const user = api.getUser();
  if (isMobileViewport() && !document.querySelector('.mobile-bottom-nav') && user) {
    const bottomNav = document.createElement('nav');
    bottomNav.className = 'mobile-bottom-nav';
    const rolePath = user.role.replace('Admin', '-admin').toLowerCase();

    bottomNav.innerHTML = `
      <a href="/pages/${rolePath}/dashboard.html" class="bottom-nav-link ${window.location.pathname.includes('dashboard') ? 'active' : ''}">
        <i class="fas fa-home"></i>
        <span>Home</span>
      </a>
      <a href="/pages/messages.html" class="bottom-nav-link ${window.location.pathname.includes('messages') ? 'active' : ''}">
        <i class="fas fa-comment-dots"></i>
        <span>Chat</span>
      </a>
      <a href="/pages/ai-tools.html" class="bottom-nav-link ${window.location.pathname.includes('ai-tools') ? 'active' : ''}">
        <i class="fas fa-brain"></i>
        <span>AI Tutor</span>
      </a>
      <a href="/pages/${rolePath}/settings.html" class="bottom-nav-link ${window.location.pathname.includes('settings') ? 'active' : ''}">
        <i class="fas fa-user-circle"></i>
        <span>Profile</span>
      </a>
    `;
    document.body.appendChild(bottomNav);
  }

  // Mobile Drawer
  const btn = document.getElementById('mobileDrawerBtn');
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('drawerOverlay');
  const content = document.getElementById('drawerContent');
  const close = document.getElementById('closeDrawer');
  
  if (btn && drawer) {
    const openDrawer = () => {
      drawer.classList.remove('invisible');
      overlay.classList.add('opacity-100');
      content.classList.remove('translate-x-full');
      document.body.style.overflow = 'hidden';
    };
    const closeDrawerFunc = () => {
      overlay.classList.remove('opacity-100');
      content.classList.add('translate-x-full');
      setTimeout(() => drawer.classList.add('invisible'), 300);
      document.body.style.overflow = '';
    };
    
    btn.onclick = openDrawer;
    overlay.onclick = closeDrawerFunc;
    close.onclick = closeDrawerFunc;
  }
}

/* ─── COMMAND PALETTE (Ctrl+K) ─── */
function openCommandPalette() {
  const cp = document.getElementById('commandPalette');
  if (cp) {
    cp.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('cpInput')?.focus(), 100);
  }
}

function closeCommandPalette() {
  const cp = document.getElementById('commandPalette');
  if (cp) {
    cp.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function initCommandPalette() {
  const input = document.getElementById('cpInput');
  if (input) {
    input.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.cp-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    });
  }
  
  // Shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
  });
}

/* ─── PWA INSTALL + SERVICE WORKER ─── */
let deferredInstallPrompt = null;
let installClickHandlerBound = false;

function isStandaloneApp() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
}

function ensurePwaMetadata() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.webmanifest';
    document.head.appendChild(manifest);
  }

  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = '/icons/apple-touch-icon.png';
    document.head.appendChild(appleIcon);
  }

  if (!document.querySelector('link[rel="icon"]')) {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = '/icons/icon.svg';
    icon.type = 'image/svg+xml';
    document.head.appendChild(icon);
  }

  const metas = [
    ['theme-color', '#4F46E5'],
    ['mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-title', 'VishvaERP'],
    ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
  ];

  metas.forEach(([name, content]) => {
    if (document.querySelector(`meta[name="${name}"]`)) return;
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  });
}

function updateInstallButtons() {
  const installed = isStandaloneApp();
  document.querySelectorAll('[data-install-app]').forEach((button) => {
    if (installed) {
      button.innerHTML = '<i class="fas fa-circle-check"></i> App Installed';
      button.classList.add('is-installed');
      button.disabled = true;
    } else {
      button.classList.remove('is-installed');
      button.disabled = false;
    }
  });
}

function showInstallInstructions() {
  if (isIosDevice()) {
    showToast('On iPhone or iPad: tap Share, then Add to Home Screen.', 'info', 7000);
    return;
  }
  showToast('If the install prompt is not shown, use your browser menu and choose Install app or Add to Home screen.', 'info', 7000);
}

async function installVishvaApp() {
  if (isStandaloneApp()) {
    showToast('Vishva ERP is already installed on this device.', 'success');
    updateInstallButtons();
    return;
  }

  if (!deferredInstallPrompt) {
    showInstallInstructions();
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallButtons();
  if (choice?.outcome === 'accepted') {
    showToast('Vishva ERP app installation started.', 'success');
  } else {
    showInstallInstructions();
  }
}

function initPwaInstall() {
  ensurePwaMetadata();
  if (isIosDevice()) {
    document.documentElement.classList.add('platform-ios');
  } else if (/android/i.test(navigator.userAgent)) {
    document.documentElement.classList.add('platform-android');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtons();
    showToast('Vishva ERP installed successfully.', 'success');
  });

  if (!installClickHandlerBound) {
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-install-app]');
      if (!button) return;
      event.preventDefault();
      installVishvaApp();
    });
    installClickHandlerBound = true;
  }
  updateInstallButtons();
}

function initServiceWorker() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!('serviceWorker' in navigator) || (window.location.protocol !== 'https:' && !isLocalhost)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Vishva ERP app update is ready. Refresh to use the latest version.', 'info', 7000);
            }
          });
        });
        initWebPush(registration);
      })
      .catch(() => {
        // PWA support should never block normal website usage.
      });
  });
}

async function initWebPush(registration) {
  if (!registration?.pushManager || !api.getToken()) return;
  try {
    let publicKey = window.VISHVA_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      const config = await api.request('/config/public', { silent: true }).catch(() => null);
      publicKey = config?.vapidPublicKey;
    }
    if (!publicKey) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api.request('/notifications/register-device', {
      method: 'POST',
      body: JSON.stringify({
        token: JSON.stringify(subscription),
        platform: 'web',
      }),
      silent: true,
    });
  } catch (_) {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/* ─── GLOBAL ADVANCED PAGE EXPERIENCE ─── */
function initGlobalExperience(user) {
  if (!document.querySelector('.erp-layout')) return;
  document.body.classList.add('erp-advanced-mode');

  const roleLabel = user?.role
    ? user.role.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
    : 'Guest';

  const topbarRight = document.querySelector('.erp-topbar .topbar-right');
  if (topbarRight && !document.getElementById('topbarLiveClock')) {
    const clock = document.createElement('div');
    clock.id = 'topbarLiveClock';
    clock.className = 'topbar-live-clock';
    clock.innerHTML = '<span class="status-dot online"></span><strong>Live ERP</strong><em>--:--</em>';
    topbarRight.insertBefore(clock, topbarRight.firstChild);
    const renderClock = () => {
      const date = new Date();
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const day = date.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
      clock.querySelector('em').textContent = `${day} • ${time}`;
    };
    renderClock();
    setInterval(renderClock, 30000);
  }

  if (topbarRight && !document.getElementById('topbarInstallApp') && !isStandaloneApp()) {
    const installButton = document.createElement('button');
    installButton.id = 'topbarInstallApp';
    installButton.className = 'topbar-install-app';
    installButton.setAttribute('data-install-app', '');
    installButton.innerHTML = '<i class="fas fa-download"></i><span>Install App</span>';
    topbarRight.insertBefore(installButton, topbarRight.firstChild);
  }

  const content = document.querySelector('.erp-content');
  const header = content?.querySelector('.page-header');
  if (content && header && !content.querySelector('.page-command-strip')) {
    const strip = document.createElement('div');
    strip.className = 'page-command-strip';
    strip.innerHTML = `
      <div><i class="fas fa-shield-check"></i><span>Role Scope</span><strong>${roleLabel}</strong></div>
      <div><i class="fas fa-bolt"></i><span>Quick Search</span><strong>Ctrl + K</strong></div>
      <div><i class="fas fa-robot"></i><span>AI Support</span><strong>Ready</strong></div>
      <div><i class="fas fa-clock"></i><span>Last Sync</span><strong>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
    `;
    header.insertAdjacentElement('afterend', strip);
  }

  if (!document.getElementById('globalAiLauncher') && !window.location.pathname.endsWith('/pages/ai-tools.html')) {
    const launcher = document.createElement('a');
    launcher.id = 'globalAiLauncher';
    launcher.className = 'global-ai-launcher';
    launcher.href = '/pages/ai-tools.html?mode=tutor';
    launcher.innerHTML = '<i class="fas fa-brain"></i><span>AI Tutor</span>';
    document.body.appendChild(launcher);
  }

  updateInstallButtons();

  document.querySelectorAll('.erp-table').forEach((table) => {
    if (table.dataset.enhanced === 'true') return;
    table.dataset.enhanced = 'true';
    table.closest('.table-wrap')?.classList.add('mobile-card-table');
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (headers[index]) cell.setAttribute('data-label', headers[index]);
      });
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      const search = document.querySelector('.search-bar input, .topbar-search input');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
    if (event.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      showToast('Shortcuts: Ctrl+K command search, / focus search, AI Tutor button for help.', 'info', 5000);
    }
  });
}

/* ─── INITIALIZATION ─── */
document.addEventListener('DOMContentLoaded', () => {
  const user = guardCurrentPage();
  if (getPageGuardRoles() !== null && !user) return;

  initSidebar();
  initTopbar();
  initNotifications();
  initTheme();
  initAdvancedNavbar();
  initCommandPalette();
  initPwaInstall();
  initServiceWorker();
  initGlobalExperience(user);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { 
      if (entry.isIntersecting) { animateAllCounters(); observer.disconnect(); } 
    });
  }, { threshold: 0.1 });
  const statsGrid = document.querySelector('.stats-grid');
  if (statsGrid) observer.observe(statsGrid);

  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', () => { 
      api.clearToken(); 
      window.location.href = '/pages/login.html'; 
    });
  });
});

/* ─── EXPORT FOR GLOBAL USE ─── */
window.showToast = showToast;
window.showConfirm = showConfirm;
window.setLoading = setLoading;
window.showPageLoader = showPageLoader;
window.hidePageLoader = hidePageLoader;
window.openModal = openModal;
window.closeModal = closeModal;
window.createModal = createModal;
window.requireAuth = requireAuth;
window.api = api;
window.animateCounter = animateCounter;
window.animateAllCounters = animateAllCounters;
window.showSkeleton = showSkeleton;
window.showTableSkeleton = showTableSkeleton;
window.getChartDefaults = getChartDefaults;
window.CHART_COLORS = CHART_COLORS;
window.CHART_COLORS_ALPHA = CHART_COLORS_ALPHA;
window.storage = storage;
window.debounce = debounce;
window.throttle = throttle;
window.validators = validators;
window.validateField = validateField;
window.dateHelpers = dateHelpers;
window.fadeOutPage = fadeOutPage;
window.installVishvaApp = installVishvaApp;
