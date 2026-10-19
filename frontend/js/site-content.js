/**
 * Vishva ERP — Website CMS content hydrator.
 * Fetches /api/public/website and applies Super Admin saved content over the
 * static markup. If the API is unreachable the static markup stays untouched
 * (it is the fallback), so the page always renders something sensible.
 *
 * Attributes consumed:
 *   data-cms="path"          -> textContent = config value (strings only)
 *   data-cms-accent="path"   -> hero title: wraps accent in .lp-gradient-text
 *   data-cms-href="path"     -> href = config value (skipped when empty)
 *   data-cms-meta="path"     -> <title> text / <meta> content
 *   data-cms-brand="path"    -> brand wordmark (keeps inner <strong>/<span>)
 *   data-cms-list="path"     -> array rendered into this container
 *   data-cms-render="name"   -> renderer used for the list above
 */
(function () {
  'use strict';

  var API = '/api/public/website';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var MODULE_STYLE = [
    'background:linear-gradient(135deg,#EEF2FF,#E0E7FF);color:#4F46E5',
    'background:linear-gradient(135deg,#F0F9FF,#E0F2FE);color:#0284C7',
    'background:linear-gradient(135deg,#ECFDF5,#D1FAE5);color:#059669',
    'background:linear-gradient(135deg,#FFFBEB,#FEF3C7);color:#D97706',
    'background:linear-gradient(135deg,#FFF1F2,#FFE4E6);color:#E11D48',
    'background:linear-gradient(135deg,#ECFEFF,#CFFAFE);color:#0891B2',
    'background:linear-gradient(135deg,#F5F3FF,#EDE9FE);color:#7C3AED',
    'background:linear-gradient(135deg,#FDF4FF,#FAE8FF);color:#C026D3'
  ];
  var OPS_COLOR = ['#0EA5E9', '#10B981', '#F59E0B'];

  // ── Item renderers (innerHTML for ONE child of the container) ──────────
  var RENDERERS = {
    heroTags: function (item) {
      return '<i class="' + esc(item.icon) + '"></i> ' + esc(item.label);
    },
    proof: function (item) {
      return '<i class="fas fa-check"></i> ' + esc(item);
    },
    featureCard: function (item, i) {
      if (i === 0) {
        return '<div class="lp-feature-num">' + pad2(i + 1) + '</div><h3>' + esc(item.title) +
          '</h3><p>' + esc(item.description) + '</p>';
      }
      return '<div class="lp-feature-icon"><i class="' + esc(item.icon || 'fas fa-star') +
        '"></i></div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description) + '</p>';
    },
    opsRow: function (item, i, orig) {
      var color = '';
      if (orig) {
        var iconEl = orig.querySelector('i');
        color = iconEl ? (iconEl.getAttribute('style') || '') : '';
      }
      if (!color) color = 'color:' + OPS_COLOR[i % OPS_COLOR.length];
      return '<i class="' + esc(item.icon) + '" style="' + color + '"></i><div><strong>' +
        esc(item.title) + '</strong><span>' + esc(item.description) + '</span></div>';
    },
    engineCard: function (item) {
      return '<div class="lp-engine-icon"><i class="' + esc(item.icon) + '"></i></div><strong>' +
        esc(item.title) + '</strong><p>' + esc(item.description) + '</p>';
    },
    moduleCard: function (item, i, orig) {
      var st = '';
      if (orig) {
        var iconBox = orig.querySelector('.lp-module-icon');
        st = iconBox ? (iconBox.getAttribute('style') || '') : '';
      }
      if (!st) st = MODULE_STYLE[i % MODULE_STYLE.length];
      return '<div class="lp-module-icon" style="' + st + '"><i class="' + esc(item.icon) +
        '"></i></div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description) + '</p>';
    },
    flowNodes: function (item) {
      return '<i class="' + esc(item.icon) + '"></i><strong>' + esc(item.title) +
        '</strong><span>' + esc(item.description) + '</span>';
    },
    roleCard: function (item) {
      return '<span><i class="' + esc(item.icon) + '"></i></span><h3>' + esc(item.title) +
        '</h3><p>' + esc(item.description) + '</p>';
    },
    insightRow: function (item) {
      return '<i class="' + esc(item.icon) + '"></i><span>' + esc(item.text) + '</span>';
    },
    installFeature: function (item) {
      return '<div class="lp-install-icon"><i class="' + esc(item.icon) + '"></i></div>' +
        '<div><strong>' + esc(item.title) + '</strong><span>' + esc(item.description) + '</span></div>';
    },
    stepCard: function (item) {
      return '<div class="lp-step-num">' + esc(item.num) + '</div><strong>' + esc(item.title) +
        '</strong><em>' + esc(item.description) + '</em>';
    },
    securityPoint: function (item) {
      return '<i class="' + esc(item.icon) + '"></i><span>' + esc(item.text) + '</span>';
    },
    planCard: function (item) {
      return (item.badge ? '<div class="lp-plan-badge">' + esc(item.badge) + '</div>' : '') +
        '<h3>' + esc(item.title) + '</h3><p>' + esc(item.description) + '</p><strong>' +
        esc(item.highlight) + '</strong><a href="' + esc(item.ctaHref || '#') +
        '" class="lp-plan-btn' + (item.featured ? ' lp-plan-btn-primary' : '') + '">' +
        esc(item.ctaLabel) + '</a>';
    }
  };

  var LIST_ATTRS = {
    roleCard: function (child, item) {
      child.setAttribute('href', item.href || '#');
    },
    planCard: function (child, item) {
      child.className = 'lp-plan' + (item.featured ? ' lp-plan-featured' : '');
    }
  };

  // Generic list: in-place edit when counts match, else rebuild from shells
  // captured from the original children (keeps classes/attrs of card 0/1).
  function applyList(container, items, name) {
    var children = Array.prototype.slice.call(container.children);
    if (!children.length) return;
    var shellA = children[0].cloneNode(false);
    var shellB = (children[1] || children[0]).cloneNode(false);
    var render = RENDERERS[name];
    var attrs = LIST_ATTRS[name];

    if (items.length === children.length) {
      items.forEach(function (item, i) {
        children[i].innerHTML = render(item, i, children[i]);
        if (attrs) attrs(children[i], item, i);
      });
    } else {
      var frag = document.createDocumentFragment();
      items.forEach(function (item, i) {
        var shell = (i === 0 ? shellA : shellB).cloneNode(false);
        shell.innerHTML = render(item, i, null);
        if (attrs) attrs(shell, item, i);
        frag.appendChild(shell);
      });
      container.innerHTML = '';
      container.appendChild(frag);
    }
  }

  // Flow: nodes interleaved with arrow divs — only nodes carry content.
  function applyFlow(container, items) {
    var kids = Array.prototype.slice.call(container.children);
    var nodes = kids.filter(function (k) { return k.classList.contains('lp-flow-node'); });
    var arrow = kids.filter(function (k) { return k.classList.contains('lp-flow-arrow'); })[0];
    if (!nodes.length) return;
    var shellA = nodes[0].cloneNode(false);
    var shellB = (nodes[1] || nodes[0]).cloneNode(false);

    if (items.length === nodes.length) {
      items.forEach(function (item, i) {
        nodes[i].innerHTML = RENDERERS.flowNodes(item, i);
      });
    } else {
      container.innerHTML = '';
      items.forEach(function (item, i) {
        var shell = (i === 0 ? shellA : shellB).cloneNode(false);
        shell.innerHTML = RENDERERS.flowNodes(item, i);
        container.appendChild(shell);
        if (i < items.length - 1 && arrow) container.appendChild(arrow.cloneNode(true));
      });
    }
  }

  // Footer grid: brand block first, then .lp-footer-col children only.
  function footerColInner(item) {
    var links = (item.links || []).map(function (l) {
      return '<a href="' + esc(l.href || '#') + '">' + esc(l.label) + '</a>';
    }).join('');
    return '<strong>' + esc(item.title) + '</strong>' + links;
  }

  function applyFooterCols(container, items) {
    var cols = Array.prototype.filter.call(container.children, function (c) {
      return c.classList && c.classList.contains('lp-footer-col');
    });
    if (!cols.length) return;
    var shellA = cols[0].cloneNode(false);
    var shellB = (cols[1] || cols[0]).cloneNode(false);

    if (items.length === cols.length) {
      items.forEach(function (item, i) { cols[i].innerHTML = footerColInner(item); });
    } else {
      cols.forEach(function (c) { c.parentNode.removeChild(c); });
      items.forEach(function (item, i) {
        var shell = (i === 0 ? shellA : shellB).cloneNode(false);
        shell.innerHTML = footerColInner(item);
        container.appendChild(shell);
      });
    }
  }

  // ── Section visibility ─────────────────────────────────────────────────
  var VISIBILITY = [
    ['hero.enabled', '.lp-hero'],
    ['sections.features.enabled', '#features'],
    ['sections.platform.enabled', '#platform'],
    ['sections.engine.enabled', '@sections.engine.cards'],
    ['sections.modules.enabled', '#modules'],
    ['sections.flow.enabled', '@sections.flow.nodes'],
    ['sections.roles.enabled', '#roles'],
    ['sections.ai.enabled', '#ai'],
    ['sections.install.enabled', '@sections.install.items'],
    ['sections.implementation.enabled', '@sections.implementation.steps'],
    ['sections.security.enabled', '#security'],
    ['pricing.enabled', '#pricing'],
    ['cta.enabled', '.lp-cta']
  ];

  function applyVisibility(cfg) {
    VISIBILITY.forEach(function (entry) {
      var val = getPath(cfg, entry[0]);
      if (val !== false) return;
      var el = null;
      if (entry[1].charAt(0) === '@') {
        var list = document.querySelector('[data-cms-list="' + entry[1].slice(1) + '"]');
        el = list ? list.closest('section') : null;
      } else {
        el = document.querySelector(entry[1]);
      }
      if (el) el.style.display = 'none';
    });
  }

  // ── Branding ───────────────────────────────────────────────────────────
  function applyBrand(el, siteName) {
    if (!siteName) return;
    var inner = el.querySelector('strong, span, b');
    var tag = inner ? inner.tagName.toLowerCase() : null;
    var idx = siteName.lastIndexOf(' ');
    if (tag && idx > 0) {
      el.innerHTML = esc(siteName.slice(0, idx)) + ' <' + tag + '>' +
        esc(siteName.slice(idx + 1)) + '</' + tag + '>';
    } else {
      el.textContent = siteName;
    }
  }

  function applyAccent(el, title, accent) {
    if (!title) return;
    if (accent && title.indexOf(accent) !== -1) {
      var i = title.indexOf(accent);
      el.innerHTML = esc(title.slice(0, i)) + '<span class="lp-gradient-text">' +
        esc(accent) + '</span>' + esc(title.slice(i + accent.length));
    } else {
      el.textContent = title;
    }
  }

  function applyAnnouncement(cfg) {
    var bar = document.getElementById('lp-announcement');
    if (!bar) return;
    var ann = cfg.announcement;
    if (!ann || ann.enabled !== true) return;
    var textEl = document.getElementById('lp-announcement-text');
    var linkEl = document.getElementById('lp-announcement-link');
    if (textEl && ann.text) textEl.textContent = ann.text;
    if (linkEl) {
      if (ann.link) {
        linkEl.hidden = false;
        linkEl.textContent = ann.linkLabel || 'Learn more';
        linkEl.setAttribute('href', ann.link);
      } else {
        linkEl.hidden = true;
      }
    }
    bar.hidden = false;
    var h = bar.offsetHeight;
    var nav = document.querySelector('.lp-nav');
    if (nav) nav.style.top = h + 'px';
    var pad = parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
    document.body.style.paddingTop = (pad + h) + 'px';
  }

  function apply(cfg) {
    // SEO meta / title
    document.querySelectorAll('[data-cms-meta]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cms-meta'));
      if (typeof v !== 'string' || !v) return;
      if (el.tagName === 'TITLE') el.textContent = v;
      else el.setAttribute('content', v);
    });

    // Lists first (they replace children of containers)
    document.querySelectorAll('[data-cms-list]').forEach(function (el) {
      var items = getPath(cfg, el.getAttribute('data-cms-list'));
      if (!Array.isArray(items) || !items.length) return;
      var name = el.getAttribute('data-cms-render');
      try {
        if (name === 'flowNodes') applyFlow(el, items);
        else if (name === 'footerCol') applyFooterCols(el, items);
        else if (RENDERERS[name]) applyList(el, items, name);
      } catch (e) {
        console.warn('[cms] list render failed:', name, e);
      }
    });

    // Plain text nodes
    document.querySelectorAll('[data-cms]').forEach(function (el) {
      if (el.hasAttribute('data-cms-accent')) return;
      var v = getPath(cfg, el.getAttribute('data-cms'));
      if (typeof v === 'string' && v) el.textContent = v;
    });

    // Accent title (hero h1)
    document.querySelectorAll('[data-cms-accent]').forEach(function (el) {
      var title = getPath(cfg, el.getAttribute('data-cms'));
      var accent = getPath(cfg, el.getAttribute('data-cms-accent'));
      applyAccent(el, typeof title === 'string' ? title : null, typeof accent === 'string' ? accent : null);
    });

    // Links
    document.querySelectorAll('[data-cms-href]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cms-href'));
      if (typeof v === 'string' && v) el.setAttribute('href', v);
    });

    // Brand wordmarks + logo
    var brandName = getPath(cfg, 'branding.siteName');
    if (typeof brandName === 'string' && brandName) {
      document.querySelectorAll('[data-cms-brand]').forEach(function (el) {
        applyBrand(el, brandName);
      });
    }
    var logoUrl = getPath(cfg, 'branding.logoUrl');
    if (typeof logoUrl === 'string' && logoUrl) {
      document.querySelectorAll('.lp-brand-icon img, .brand-icon img').forEach(function (img) {
        img.setAttribute('src', logoUrl);
      });
    }

    applyVisibility(cfg);
    applyAnnouncement(cfg);
  }

  fetch(API, { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
    .then(function (data) {
      if (!data || !data.success || !data.website) return;
      var cfg = data.website;
      // branding may be served at top level as a fallback
      if (!cfg.branding && data.branding) cfg.branding = data.branding;
      apply(cfg);
      document.dispatchEvent(new CustomEvent('vishva:cms-applied', { detail: cfg }));
    })
    .catch(function (err) {
      console.info('[cms] website content API unavailable — static content kept.', err);
    });
})();
