/**
 * Vishva ERP — per-college portal branding runtime.
 * Fetches /api/public/college-branding (authenticated) and applies the
 * college's theme over the portal pages:
 *   - primaryColor  -> root CSS vars (--primary, --primary-hover, --primary-light)
 *                      plus sidebar active-state accents (injected stylesheet).
 *   - accentColor   -> active-nav marker + sidebar logo gradient.
 *   - portalName    -> sidebar wordmark + browser tab titles.
 *   - logoUrl       -> sidebar logo image.
 *   - tagline       -> line under the user's name in the sidebar.
 * When the theme is empty/unreachable, page defaults stay untouched.
 */
(function () {
  'use strict';

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    if (!c) return 'transparent';
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }
  function adjust(hex, delta) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    function ch(v) {
      var n = Math.round(delta >= 0 ? v + (255 - v) * delta : v * (1 + delta));
      return Math.max(0, Math.min(255, n));
    }
    function two(n) { return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + two(ch(c.r)) + two(ch(c.g)) + two(ch(c.b));
  }

  function apply(branding) {
    var theme = (branding && branding.theme) || {};
    var primary = theme.primaryColor || '';
    var accent = theme.accentColor || '';
    var validPrimary = hexToRgb(primary);

    if (validPrimary) {
      var root = document.documentElement;
      root.style.setProperty('--primary', primary);
      root.style.setProperty('--primary-hover', adjust(primary, -0.16));
      root.style.setProperty('--primary-light', rgba(primary, 0.08));

      var css =
        '.erp-sidebar .nav-link.active{background:' + rgba(primary, 0.22) + ' !important;color:' + adjust(primary, 0.42) + ' !important;}' +
        '.erp-sidebar .nav-link.active::before{background:' + (accent || primary) + ' !important;}' +
        '.sidebar-logo-icon{background:linear-gradient(135deg,' + primary + ',' + (accent || adjust(primary, 0.25)) + ') !important;}';
      var el = document.createElement('style');
      el.id = 'portal-branding-style';
      el.textContent = css;
      document.head.appendChild(el);
    }

    if (theme.portalName) {
      document.querySelectorAll('.sidebar-logo-text').forEach(function (node) {
        node.textContent = theme.portalName;
      });
      document.title = document.title.replace(/VishvaERP|Vishva ERP/g, theme.portalName);
    }

    if (theme.logoUrl) {
      document.querySelectorAll('.sidebar-logo-icon img').forEach(function (img) {
        img.setAttribute('src', theme.logoUrl);
      });
    }

    if (theme.tagline) {
      document.querySelectorAll('.sidebar-user-role').forEach(function (node) {
        node.textContent = theme.tagline;
      });
    }
  }

  var token = localStorage.getItem('erp_token') || localStorage.getItem('token');
  if (!token) return;

  fetch('/api/public/college-branding', {
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store'
  })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) {
      var b = data && data.branding;
      if (!b || !b.theme || !Object.keys(b.theme).length) return;
      apply(b);
      document.dispatchEvent(new CustomEvent('vishva:portal-branding', { detail: b }));
    })
    .catch(function () { /* no theme for this account — defaults stay. */ });
})();
