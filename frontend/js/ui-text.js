/**
 * Vishva ERP — dashboard UI text overrides (Website CMS client).
 * Applies Super Admin saved replacements (settings.uiText) over the static
 * text of dashboard pages.
 *
 * Key contract: elements tagged with data-cms="<key>" are matched against
 * the uiText map from /api/public/website. The FIRST non-empty text node is
 * replaced, so icons (<i>) and badge spans inside menu items stay untouched;
 * leading/trailing whitespace of the original node is preserved so spacing
 * around icons does not collapse. Empty/missing overrides keep page defaults.
 */
(function () {
  'use strict';

  function applyOverrides(map) {
    if (!map) return 0;
    var applied = 0;
    document.querySelectorAll('[data-cms]').forEach(function (el) {
      var value = map[el.getAttribute('data-cms')];
      if (typeof value !== 'string' || !value) return;
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var node = null;
      var found = null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.trim()) { found = node; break; }
      }
      if (found) {
        var lead = (found.nodeValue.match(/^\s*/) || [''])[0];
        var trail = (found.nodeValue.match(/\s*$/) || [''])[0];
        found.nodeValue = lead + value + trail;
      } else {
        el.textContent = value;
      }
      applied++;
    });
    return applied;
  }

  fetch('/api/public/website', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) {
      if (!data || !data.success) return;
      var n = applyOverrides(data.uiText || {});
      if (n) document.dispatchEvent(new CustomEvent('vishva:ui-text-applied', { detail: { count: n } }));
    })
    .catch(function () {
      /* API unavailable — page defaults stay. */
    });
})();
