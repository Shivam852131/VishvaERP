/**
 * Tag landing/auth pages with Website CMS attributes (data-cms*).
 * Re-runnable: entries already applied are skipped; missing matches fail loudly.
 *
 * Usage: node scripts/tag-landing-cms.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// find/replace use \n; converted to the file's EOL at runtime.
const FILE_STEPS = {
  'frontend/index.html': [
    {
      label: 'seo.title',
      find: '<title>Vishva ERP | AI-Powered Campus ERP for Colleges and Universities</title>',
      replace: '<title data-cms-meta="seo.title">Vishva ERP | AI-Powered Campus ERP for Colleges and Universities</title>',
    },
    {
      label: 'seo.description',
      find: '<meta name="description" content="',
      replace: '<meta name="description" data-cms-meta="seo.description" content="',
    },
    {
      label: 'seo.keywords',
      find: '<meta name="keywords" content="',
      replace: '<meta name="keywords" data-cms-meta="seo.keywords" content="',
    },
    {
      label: 'announcement bar',
      find: '<body class="landing-page antialiased">',
      replace:
        '<body class="landing-page antialiased">\n    <div id="lp-announcement" hidden style="position:fixed;top:0;left:0;right:0;z-index:120;background:linear-gradient(90deg,#7C3AED,#0EA5E9);color:#fff;text-align:center;padding:9px 16px;font-size:13.5px;font-weight:600;letter-spacing:.01em"><span id="lp-announcement-text"></span><a id="lp-announcement-link" href="#" style="color:#fff;text-decoration:underline;margin-left:10px" hidden></a></div>',
    },
    {
      label: 'hero.badge',
      find:
        '<div class="lp-hero-badge" data-reveal>\n          <span class="lp-live-dot"></span>\n          Campus-grade operating system for modern institutions\n        </div>',
      replace:
        '<div class="lp-hero-badge" data-reveal>\n          <span class="lp-live-dot"></span>\n          <span data-cms="hero.badge">Campus-grade operating system for modern institutions</span>\n        </div>',
    },
    {
      label: 'hero.title',
      find: '<h1 data-reveal>Run your entire campus from <span class="lp-gradient-text">one intelligent platform.</span></h1>',
      replace:
        '<h1 data-reveal data-cms="hero.title" data-cms-accent="hero.titleAccent">Run your entire campus from <span class="lp-gradient-text">one intelligent platform.</span></h1>',
    },
    {
      label: 'hero.description',
      find: '<p class="lp-hero-desc" data-reveal>',
      replace: '<p class="lp-hero-desc" data-reveal data-cms="hero.description">',
    },
    {
      label: 'hero.tags list',
      find: '<div class="lp-hero-tags" data-reveal>',
      replace:
        '<div class="lp-hero-tags" data-reveal data-cms-list="hero.tags" data-cms-render="heroTags">',
    },
    {
      label: 'hero CTAs',
      find:
        '<div class="lp-hero-actions" data-reveal>\n          <a href="./pages/register.html" class="lp-btn-hero-primary">Register Institution <i class="fas fa-arrow-right"></i></a>\n          <a href="./pages/login.html" class="lp-btn-hero-secondary">Sign In <i class="fas fa-right-to-bracket"></i></a>\n        </div>',
      replace:
        '<div class="lp-hero-actions" data-reveal>\n          <a href="./pages/register.html" class="lp-btn-hero-primary" data-cms-href="hero.primaryCtaHref"><span data-cms="hero.primaryCtaLabel">Register Institution</span> <i class="fas fa-arrow-right"></i></a>\n          <a href="./pages/login.html" class="lp-btn-hero-secondary" data-cms-href="hero.secondaryCtaHref"><span data-cms="hero.secondaryCtaLabel">Sign In</span> <i class="fas fa-right-to-bracket"></i></a>\n        </div>',
    },
    {
      label: 'hero.proof list',
      find: '<div class="lp-hero-proof" data-reveal>',
      replace:
        '<div class="lp-hero-proof" data-reveal data-cms-list="hero.proof" data-cms-render="proof">',
    },
    // ── Section headers ──────────────────────────────
    {
      label: 'sections.features header',
      find:
        '<span class="lp-kicker">Core capabilities</span>\n          <h2>Built for the daily demands of running a real institution.</h2>\n          <p>Vishva ERP is designed around operational outcomes: fewer manual registers, faster decisions, better student visibility, and cleaner governance.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.features.kicker">Core capabilities</span>\n          <h2 data-cms="sections.features.title">Built for the daily demands of running a real institution.</h2>\n          <p data-cms="sections.features.description">Vishva ERP is designed around operational outcomes: fewer manual registers, faster decisions, better student visibility, and cleaner governance.</p>',
    },
    {
      label: 'sections.platform header',
      find:
        '<span class="lp-kicker">Executive operations</span>\n          <h2>One command center for every campus decision.</h2>\n          <p>Replace scattered spreadsheets with a live operating layer for academics, revenue, compliance, and student success.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.platform.kicker">Executive operations</span>\n          <h2 data-cms="sections.platform.title">One command center for every campus decision.</h2>\n          <p data-cms="sections.platform.description">Replace scattered spreadsheets with a live operating layer for academics, revenue, compliance, and student success.</p>',
    },
    {
      label: 'sections.modules header',
      find:
        '<span class="lp-kicker">ERP modules</span>\n          <h2>Everything a real institution runs every day.</h2>\n          <p>Core modules designed for repeated operational use, not brochure screens. Each area connects to the same data.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.modules.kicker">ERP modules</span>\n          <h2 data-cms="sections.modules.title">Everything a real institution runs every day.</h2>\n          <p data-cms="sections.modules.description">Core modules designed for repeated operational use, not brochure screens. Each area connects to the same data.</p>',
    },
    {
      label: 'sections.flow header',
      find:
        '<span class="lp-kicker">Connected operations</span>\n          <h2>Every department works from the same record.</h2>\n          <p>Admissions become student records, timetable slots become attendance sessions, results become parent visibility, and fees become finance dashboards.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.flow.kicker">Connected operations</span>\n          <h2 data-cms="sections.flow.title">Every department works from the same record.</h2>\n          <p data-cms="sections.flow.description">Admissions become student records, timetable slots become attendance sessions, results become parent visibility, and fees become finance dashboards.</p>',
    },
    {
      label: 'sections.roles header',
      find:
        '<span class="lp-kicker">Role portals</span>\n          <h2>Different users, one connected source of truth.</h2>\n          <p>Every stakeholder gets the workspace they need while administrators keep centralized governance.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.roles.kicker">Role portals</span>\n          <h2 data-cms="sections.roles.title">Different users, one connected source of truth.</h2>\n          <p data-cms="sections.roles.description">Every stakeholder gets the workspace they need while administrators keep centralized governance.</p>',
    },
    {
      label: 'sections.ai header',
      find:
        '<span class="lp-kicker">AI and analytics</span>\n            <h2>Turn campus data into early action.</h2>\n            <p>Vishva ERP combines live operational data with AI-assisted workflows so administrators see what needs attention before it becomes a problem.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.ai.kicker">AI and analytics</span>\n            <h2 data-cms="sections.ai.title">Turn campus data into early action.</h2>\n            <p data-cms="sections.ai.description">Vishva ERP combines live operational data with AI-assisted workflows so administrators see what needs attention before it becomes a problem.</p>',
    },
    {
      label: 'sections.install header',
      find:
        '<span class="lp-kicker lp-kicker-light">Multi-Platform Access</span>\n            <h2>Your campus platform, everywhere.</h2>\n            <p>Built mobile-first. Whether you are a student checking attendance or an administrator approving leaves, the experience is fast, native, and always in sync.</p>',
      replace:
        '<span class="lp-kicker lp-kicker-light" data-cms="sections.install.kicker">Multi-Platform Access</span>\n            <h2 data-cms="sections.install.title">Your campus platform, everywhere.</h2>\n            <p data-cms="sections.install.description">Built mobile-first. Whether you are a student checking attendance or an administrator approving leaves, the experience is fast, native, and always in sync.</p>',
    },
    {
      label: 'sections.implementation header',
      find:
        '<span class="lp-kicker">Implementation path</span>\n          <h2>Move from setup to daily operations quickly.</h2>\n          <p>Start with the core ERP and expand into intelligence, automation, and campus-wide communication.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.implementation.kicker">Implementation path</span>\n          <h2 data-cms="sections.implementation.title">Move from setup to daily operations quickly.</h2>\n          <p data-cms="sections.implementation.description">Start with the core ERP and expand into intelligence, automation, and campus-wide communication.</p>',
    },
    {
      label: 'sections.security header',
      find:
        '<span class="lp-kicker">Security and governance</span>\n            <h2>Designed for institutional control, privacy, and auditability.</h2>\n            <p>Vishva ERP keeps sensitive academic, financial, and attendance data inside role-aware workflows. Smart attendance is consent-based.</p>',
      replace:
        '<span class="lp-kicker" data-cms="sections.security.kicker">Security and governance</span>\n            <h2 data-cms="sections.security.title">Designed for institutional control, privacy, and auditability.</h2>\n            <p data-cms="sections.security.description">Vishva ERP keeps sensitive academic, financial, and attendance data inside role-aware workflows. Smart attendance is consent-based.</p>',
    },
    {
      label: 'pricing header',
      find:
        '<span class="lp-kicker">Deployment models</span>\n          <h2>Fit for single colleges and university networks.</h2>\n          <p>Use the same platform for a focused campus rollout or a larger multi-institution command layer.</p>',
      replace:
        '<span class="lp-kicker" data-cms="pricing.kicker">Deployment models</span>\n          <h2 data-cms="pricing.title">Fit for single colleges and university networks.</h2>\n          <p data-cms="pricing.description">Use the same platform for a focused campus rollout or a larger multi-institution command layer.</p>',
    },
    {
      label: 'cta header',
      find:
        '<span class="lp-kicker lp-kicker-light">Ready to modernize your campus?</span>\n        <h2>Bring admissions, academics, attendance, finance, HR, and analytics into one intelligent platform.</h2>',
      replace:
        '<span class="lp-kicker lp-kicker-light" data-cms="cta.kicker">Ready to modernize your campus?</span>\n        <h2 data-cms="cta.title">Bring admissions, academics, attendance, finance, HR, and analytics into one intelligent platform.</h2>',
    },
    {
      label: 'cta buttons + proof',
      find:
        '<div class="lp-cta-actions">\n          <a href="./pages/register.html" class="lp-btn-hero-primary">Register Institution <i class="fas fa-arrow-right"></i></a>\n          <a href="./pages/login.html" class="lp-btn-hero-secondary">Sign In <i class="fas fa-right-to-bracket"></i></a>\n        </div>\n        <div class="lp-cta-proof">',
      replace:
        '<div class="lp-cta-actions">\n          <a href="./pages/register.html" class="lp-btn-hero-primary"><span data-cms="cta.primaryCtaLabel">Register Institution</span> <i class="fas fa-arrow-right"></i></a>\n          <a href="./pages/login.html" class="lp-btn-hero-secondary"><span data-cms="cta.secondaryCtaLabel">Sign In</span> <i class="fas fa-right-to-bracket"></i></a>\n        </div>\n        <div class="lp-cta-proof" data-cms-list="cta.proof" data-cms-render="proof">',
    },
    // ── List containers ──────────────────────────────
    {
      label: 'features list',
      find: '<div class="lp-features-grid">',
      replace:
        '<div class="lp-features-grid" data-cms-list="sections.features.items" data-cms-render="featureCard">',
    },
    {
      label: 'platform ops list',
      find: '<div class="lp-platform-ops">',
      replace:
        '<div class="lp-platform-ops" data-cms-list="sections.platform.ops" data-cms-render="opsRow">',
    },
    {
      label: 'engine cards list',
      find: '<div class="lp-engine-grid">',
      replace:
        '<div class="lp-engine-grid" data-cms-list="sections.engine.cards" data-cms-render="engineCard">',
    },
    {
      label: 'modules list',
      find: '<div class="lp-modules-grid">',
      replace:
        '<div class="lp-modules-grid" data-cms-list="sections.modules.items" data-cms-render="moduleCard">',
    },
    {
      label: 'flow nodes list',
      find: '<div class="lp-flow">',
      replace:
        '<div class="lp-flow" data-cms-list="sections.flow.nodes" data-cms-render="flowNodes">',
    },
    {
      label: 'roles list',
      find: '<div class="lp-roles-grid">',
      replace:
        '<div class="lp-roles-grid" data-cms-list="sections.roles.items" data-cms-render="roleCard">',
    },
    {
      label: 'ai insights list',
      find: '<div class="lp-insights">',
      replace:
        '<div class="lp-insights" data-cms-list="sections.ai.insights" data-cms-render="insightRow">',
    },
    {
      label: 'install features list',
      find: '<div class="lp-install-features">',
      replace:
        '<div class="lp-install-features" data-cms-list="sections.install.items" data-cms-render="installFeature">',
    },
    {
      label: 'implementation steps list',
      find: '<div class="lp-steps">',
      replace:
        '<div class="lp-steps" data-cms-list="sections.implementation.steps" data-cms-render="stepCard">',
    },
    {
      label: 'security points list',
      find: '<div class="lp-security-list">',
      replace:
        '<div class="lp-security-list" data-cms-list="sections.security.points" data-cms-render="securityPoint">',
    },
    {
      label: 'pricing plans list',
      find: '<div class="lp-plans-grid">',
      replace:
        '<div class="lp-plans-grid" data-cms-list="pricing.plans" data-cms-render="planCard">',
    },
    {
      label: 'footer columns list',
      find: '<div class="lp-footer-grid">',
      replace:
        '<div class="lp-footer-grid" data-cms-list="footer.columns" data-cms-render="footerCol">',
    },
    // ── Branding ─────────────────────────────────────
    {
      label: 'brand text (all 3)',
      find: '<span class="lp-brand-text"',
      replace: '<span data-cms-brand="branding.siteName" class="lp-brand-text"',
      all: true,
      skipIf: 'data-cms-brand=',
    },
    // ── Footer ───────────────────────────────────────
    {
      label: 'footer.description',
      find:
        '<p>Enterprise academic management platform for colleges, universities, school groups, and training institutions.</p>',
      replace:
        '<p data-cms="footer.description">Enterprise academic management platform for colleges, universities, school groups, and training institutions.</p>',
    },
    {
      label: 'footer.twitter',
      find: '<a href="#" aria-label="Twitter">',
      replace: '<a href="#" data-cms-href="footer.twitter" aria-label="Twitter">',
    },
    {
      label: 'footer.linkedin',
      find: '<a href="#" aria-label="LinkedIn">',
      replace: '<a href="#" data-cms-href="footer.linkedin" aria-label="LinkedIn">',
    },
    {
      label: 'footer.github',
      find: '<a href="#" aria-label="GitHub">',
      replace: '<a href="#" data-cms-href="footer.github" aria-label="GitHub">',
    },
    {
      label: 'footer.copyright',
      find: '<span>&copy; 2026 Vishva ERP. All rights reserved.</span>',
      replace: '<span data-cms="footer.copyright">&copy; 2026 Vishva ERP. All rights reserved.</span>',
    },
    {
      label: 'footer.tagline',
      find: '<span>Enterprise academic management platform.</span>',
      replace: '<span data-cms="footer.tagline">Enterprise academic management platform.</span>',
    },
    {
      label: 'site-content.js include',
      find: '<script src="./js/shared.js?v=2"></script>',
      replace:
        '<script src="./js/shared.js?v=2"></script>\n  <script src="./js/site-content.js"></script>',
    },
  ],
  'frontend/pages/login.html': [
    {
      label: 'login brand name',
      find: '<div class="brand-name">Vishva <span>ERP</span></div>',
      replace: '<div class="brand-name" data-cms-brand="branding.siteName">Vishva <span>ERP</span></div>',
    },
    {
      label: 'login hero title + desc',
      find:
        '<h1>Enterprise Academic Platform</h1>\n      <p>The complete ERP built for educational institutions',
      replace:
        '<h1 data-cms="auth.heroTitle">Enterprise Academic Platform</h1>\n      <p data-cms="auth.heroDescription">The complete ERP built for educational institutions',
    },
    {
      label: 'login title',
      find: '<h2>Welcome back</h2>',
      replace: '<h2 data-cms="auth.loginTitle">Welcome back</h2>',
    },
    {
      label: 'login subtitle',
      find: '<p class="subtitle">Sign in to your VishvaERP account</p>',
      replace: '<p class="subtitle" data-cms="auth.loginSubtitle">Sign in to your VishvaERP account</p>',
    },
    {
      label: 'site-content.js include',
      find: '</body>',
      replace: '  <script src="../js/site-content.js"></script>\n</body>',
      last: true,
    },
  ],
  'frontend/pages/register.html': [
    {
      label: 'register title + subtitle',
      find:
        '<h1>Create Account</h1>\n    <p>Join VishvaERP and transform your institution</p>',
      replace:
        '<h1 data-cms="auth.registerTitle">Create Account</h1>\n    <p data-cms="auth.registerSubtitle">Join VishvaERP and transform your institution</p>',
    },
    {
      label: 'site-content.js include',
      find: '</body>',
      replace: '  <script src="../js/site-content.js"></script>\n</body>',
      last: true,
    },
  ],
};

let applied = 0;
let skipped = 0;
let failed = 0;

for (const [rel, steps] of Object.entries(FILE_STEPS)) {
  const file = path.join(ROOT, rel);
  let text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const fix = (s) => s.split('\n').join(eol);
  let fileChanged = false;

  for (const step of steps) {
    const find = fix(step.find);
    const replace = fix(step.replace);

    // Idempotency: skip when the replacement is already in place.
    const appliedAlready = text.includes(fix(step.skipIf || step.replace));
    if (appliedAlready && step.find !== '</body>') {
      skipped++;
      continue;
    }

    if (step.last) {
      // Insert before the FINAL occurrence (</body> appears once, but be safe).
      const idx = text.lastIndexOf(find);
      if (idx === -1 || text.includes(fix(step.replace).trim())) {
        if (text.includes(fix(step.replace).trim())) { skipped++; continue; }
        console.error(`FAIL [${rel}] ${step.label}: anchor not found`);
        failed++;
        continue;
      }
      text = text.slice(0, idx) + replace + text.slice(idx + find.length);
      fileChanged = true;
      applied++;
      console.log(`APPLIED [${rel}] ${step.label}`);
      continue;
    }

    if (step.all) {
      if (!text.includes(find)) {
        console.error(`FAIL [${rel}] ${step.label}: not found`);
        failed++;
        continue;
      }
      const count = text.split(find).length - 1;
      text = text.split(find).join(replace);
      fileChanged = true;
      applied++;
      console.log(`APPLIED [${rel}] ${step.label} (${count}x)`);
      continue;
    }

    if (!text.includes(find)) {
      if (text.includes(replace)) {
        skipped++;
        continue;
      }
      console.error(`FAIL [${rel}] ${step.label}: exact source text not found (markup drift?)`);
      failed++;
      continue;
    }
    if (text.split(find).length - 1 > 1) {
      console.error(`FAIL [${rel}] ${step.label}: ambiguous (multiple matches)`);
      failed++;
      continue;
    }
    text = text.replace(find, replace);
    fileChanged = true;
    applied++;
    console.log(`APPLIED [${rel}] ${step.label}`);
  }

  if (fileChanged) fs.writeFileSync(file, text);
}

console.log(`\n${applied} applied, ${skipped} already present, ${failed} failed`);
process.exit(failed ? 1 : 0);
