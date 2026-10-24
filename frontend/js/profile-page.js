/**
 * Vishva ERP — Advanced Profile page runtime.
 * Shared by /pages/<role>/profile.html for every role (student, faculty,
 * parent, college-admin, super-admin). Self-initializing; needs only
 * shared.js loaded first.
 *
 * Features
 *  - Header: avatar upload/remove (via /api/upload/avatar + /api/auth/profile),
 *    identity chips (email verified, 2FA, phone), profile-completion meter.
 *  - Personal Info: editable self-service fields (name, phone, gender, dob,
 *    blood group, address) saved through PUT /api/auth/profile, plus a
 *    read-only Official Record card (role-aware) served by GET /api/auth/me.
 *  - Security: change password with live strength meter + requirement
 *    checklist, 2FA status, recognized devices (trustedDevices/deviceTokens),
 *    account status facts.
 *  - Notifications: recent notifications with unread badge, per-item and
 *    mark-all-read actions.
 *  - Appearance: Light / Dark / System theme picker (same storage + classes
 *    as shared.js initTheme).
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return window.escapeHTML ? window.escapeHTML(s == null ? '' : String(s)) : String(s == null ? '' : s);
  };

  var ROLE_LABELS = {
    superadmin: 'Platform Super Admin',
    collegeAdmin: 'College Administrator',
    faculty: 'Faculty Member',
    student: 'Student',
    parent: 'Parent / Guardian'
  };
  var BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  var NOTIF_ICONS = {
    info: ['fas fa-circle-info', '#3B82F6'],
    success: ['fas fa-circle-check', '#10B981'],
    warning: ['fas fa-triangle-exclamation', '#F59E0B'],
    error: ['fas fa-circle-xmark', '#EF4444'],
    exam: ['fas fa-file-pen', '#8B5CF6'],
    fee: ['fas fa-receipt', '#F43F5E'],
    attendance: ['fas fa-calendar-check', '#0EA5E9'],
    assignment: ['fas fa-tasks', '#6366F1']
  };

  var me = null;
  var notifState = { items: [], unread: 0 };

  ready(init);

  async function init() {
    try {
      var local = window.api.getUser();
      if (local) renderIdentityShell(local);
    } catch (e) { /* requireAuth in shared.js handles redirects */ }

    bindTabs();
    bindAvatar();
    bindPersonalForm();
    bindPassword();
    bindNotifications();
    bindAppearance();
    applyStoredThemeUI();

    try {
      var res = await window.api.request('/auth/me', { silent: true });
      me = (res && res.user) || {};
      renderAll();
      loadNotifications();
    } catch (e) {
      /* 401 handled by api.request redirect; render local-only shell */
    }
  }

  /* ─────────────────────────── rendering ─────────────────────────── */

  function renderAll() {
    renderHeader();
    renderPersonalForm();
    renderRecord();
    renderSecurity();
    syncChrome();
  }

  function sidebarRoleLine() {
    if (me.role === 'student') {
      return [me.department, me.semester ? 'Sem ' + me.semester : ''].filter(Boolean).join(' • ') || 'Student';
    }
    if (me.role === 'faculty') {
      return [me.designation, me.department].filter(Boolean).join(' • ') || 'Faculty Member';
    }
    if (me.role === 'parent') return 'Parent / Guardian';
    if (me.role === 'collegeAdmin') return 'College Administrator';
    if (me.role === 'superadmin') return 'Platform Super Admin';
    return roleLabel(me.role);
  }

  function syncChrome() {
    // Keep the static sidebar/topbar chrome in sync with the loaded record.
    var sn = document.getElementById('sidebar-user-name');
    if (sn && me.name) sn.textContent = me.name;
    var sr = document.getElementById('sidebar-user-role');
    if (sr) sr.textContent = sidebarRoleLine();
    var sa = document.getElementById('sidebar-avatar');
    if (sa && !sa.querySelector('img') && me.name) sa.textContent = initials(me.name).charAt(0);
    var ta = document.getElementById('topbar-avatar');
    if (ta && !ta.querySelector('img') && me.name) ta.textContent = initials(me.name).charAt(0);
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase();
  }

  function fmtDate(value, withTime) {
    if (!value) return '—';
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleDateString(undefined, withTime
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return d.toDateString(); }
  }

  function relativeTime(value) {
    if (!value) return '';
    var diff = Date.now() - new Date(value).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return fmtDate(value);
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || 'User';
  }

  function completionInfo() {
    var checks = [
      ['avatar', 'photo', !!me.avatar],
      ['phone', 'phone number', !!me.phone],
      ['dateOfBirth', 'date of birth', !!me.dateOfBirth],
      ['gender', 'gender', !!me.gender],
      ['address', 'address', !!me.address],
      ['bloodGroup', 'blood group', !!me.bloodGroup]
    ];
    var filled = checks.filter(function (c) { return c[2]; }).length;
    var missing = checks.filter(function (c) { return !c[2]; });
    return { percent: Math.round((filled / checks.length) * 100), next: missing.length ? missing[0][1] : null };
  }

  function renderIdentityShell(u) {
    // Instant paint from cached session while /auth/me loads.
    var nameEl = $('pfName');
    if (nameEl) nameEl.textContent = u.name || '…';
    var emailEl = $('pfEmail');
    if (emailEl) emailEl.textContent = u.email || '';
    var roleEl = $('pfRoleChip');
    if (roleEl) {
      roleEl.textContent = roleLabel(u.role);
      roleEl.style.display = '';
    }
    var ini = $('pfInitials');
    if (ini) ini.textContent = initials(u.name);
  }

  function renderHeader() {
    var avatarWrap = $('pfAvatarWrap');
    var img = $('pfAvatar');
    var ini = $('pfInitials');
    if (me.avatar) {
      img.src = me.avatar;
      img.alt = me.name || 'Profile photo';
      img.style.display = '';
      ini.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      ini.style.display = '';
      ini.textContent = initials(me.name);
    }
    if (avatarWrap) avatarWrap.classList.toggle('has-photo', !!me.avatar);

    var removeBtn = $('btnRemovePhoto');
    if (removeBtn) removeBtn.style.display = me.avatar ? '' : 'none';

    $('pfName').textContent = me.name || '—';
    $('pfEmail').textContent = me.email || '—';
    var roleChip = $('pfRoleChip');
    roleChip.textContent = roleLabel(me.role);
    roleChip.style.display = '';

    var college = me.collegeId || {};
    var collegeEl = $('pfCollege');
    collegeEl.textContent = college.name
      ? college.name + (college.code ? ' • ' + college.code : '')
      : (me.role === 'superadmin' ? 'VishvaERP Platform Operations' : 'No institution linked');

    var chips = [];
    chips.push(me.isEmailVerified
      ? '<span class="pf-chip pf-chip-ok"><i class="fas fa-circle-check"></i> Email verified</span>'
      : '<span class="pf-chip pf-chip-warn"><i class="fas fa-circle-exclamation"></i> Email unverified</span>');
    chips.push(me.twoFactorEnabled
      ? '<span class="pf-chip pf-chip-ok"><i class="fas fa-shield-halved"></i> 2FA on</span>'
      : '<span class="pf-chip"><i class="fas fa-shield"></i> 2FA off</span>');
    if (me.phone) chips.push('<span class="pf-chip"><i class="fas fa-phone"></i> ' + esc(me.phone) + '</span>');
    chips.push('<span class="pf-chip"><i class="fas fa-circle" style="font-size:7px;' +
      (me.isActive === false ? 'color:#EF4444' : 'color:#10B981') + '"></i> ' +
      (me.isActive === false ? 'Account suspended' : 'Account active') + '</span>');
    $('pfChips').innerHTML = chips.join('');

    var meta = [];
    if (me.lastLogin) meta.push('<div class="pf-meta-item"><i class="fas fa-clock-rotate-left"></i> Last sign-in ' + esc(relativeTime(me.lastLogin)) + '</div>');
    if (me.createdAt) meta.push('<div class="pf-meta-item"><i class="fas fa-calendar-day"></i> Member since ' + esc(fmtDate(me.createdAt)) + '</div>');
    meta.push('<div class="pf-meta-item"><i class="fas fa-id-badge"></i> User ID ' + esc(String(me._id || '').slice(-8).toUpperCase()) + '</div>');
    $('pfMeta').innerHTML = meta.join('');

    var c = completionInfo();
    $('pfMeterFill').style.width = c.percent + '%';
    $('pfMeterFill').style.background = c.percent === 100
      ? 'linear-gradient(90deg,#10B981,#34D399)'
      : 'linear-gradient(90deg,var(--primary),#818CF8)';
    $('pfMeterText').innerHTML = '<strong>' + c.percent + '% complete</strong>' +
      (c.next ? ' — add your ' + esc(c.next) + ' to finish' : ' — your profile is fully filled out');
  }

  function renderPersonalForm() {
    $('fName').value = me.name || '';
    $('fPhone').value = me.phone || '';
    $('fGender').value = me.gender || '';
    $('fDob').value = me.dateOfBirth ? String(me.dateOfBirth).slice(0, 10) : '';
    $('fBlood').value = me.bloodGroup || '';
    $('fAddress').value = me.address || '';
    setDirty(false);
  }

  function recordRow(label, value, hint) {
    return '<div class="pf-rec-row"><div class="pf-rec-label">' + esc(label) + '</div>' +
      '<div class="pf-rec-value">' + (value ? esc(value) : '<span class="pf-rec-empty">—</span>') +
      (hint ? ' <span class="pf-rec-hint">' + esc(hint) + '</span>' : '') + '</div></div>';
  }

  function renderRecord() {
    var rows = [];
    rows.push(recordRow('Email (login)', me.email));
    rows.push(recordRow('Role', roleLabel(me.role)));
    if (me.role !== 'superadmin') rows.push(recordRow('Institution', me.collegeId ? me.collegeId.name : null, me.collegeId ? me.collegeId.code : null));

    if (me.role === 'student') {
      rows.push(recordRow('Enrollment No', me.enrollmentNo));
      rows.push(recordRow('Roll No', me.rollNo));
      rows.push(recordRow('Semester', me.semester ? 'Semester ' + me.semester : null, me.section ? 'Section ' + me.section : null));
      rows.push(recordRow('Department / Program', me.department));
      rows.push(recordRow('Admission Date', me.admissionDate ? fmtDate(me.admissionDate) : null));
      rows.push(recordRow('Parent / Guardian', me.parentId ? me.parentId.name : null, me.parentId ? me.parentId.phone : null));
    } else if (me.role === 'faculty') {
      rows.push(recordRow('Designation', me.designation));
      rows.push(recordRow('Department', me.department));
      rows.push(recordRow('Subjects assigned', me.subjects && me.subjects.length ? String(me.subjects.length) : null));
    } else if (me.role === 'parent') {
      var children = me.children && me.children.length ? me.children : [];
      rows.push(recordRow('Linked children', children.length ? String(children.length) : null));
    } else if (me.role === 'collegeAdmin') {
      rows.push(recordRow('Administration scope', 'Single campus'));
    } else if (me.role === 'superadmin') {
      rows.push(recordRow('Administration scope', 'Full platform'));
    }

    var html = rows.join('');
    if (me.role === 'parent' && me.children && me.children.length) {
      html += '<div class="pf-children">' + me.children.map(function (ch) {
        var col = ch.collegeId ? ch.collegeId.name : '';
        return '<div class="pf-child-card"><div class="pf-child-avatar">' + esc(initials(ch.name)) + '</div>' +
          '<div><div class="pf-child-name">' + esc(ch.name || 'Child') + '</div>' +
          '<div class="pf-child-meta">' + esc([ch.rollNo, ch.semester ? 'Sem ' + ch.semester : '', ch.department, col].filter(Boolean).join(' • ') || 'Student') + '</div></div></div>';
      }).join('') + '</div>';
    }
    $('recGrid').innerHTML = html;
  }

  function renderSecurity() {
    var s2fa = $('twofaStatus');
    if (s2fa) {
      s2fa.innerHTML = me.twoFactorEnabled
        ? '<i class="fas fa-circle-check" style="color:#10B981"></i> <strong>Enabled.</strong> One-time codes are required at every sign-in.'
        : '<i class="fas fa-circle-info" style="color:#F59E0B"></i> <strong>Disabled.</strong> Two-factor authentication is governed by your platform\'s security policy.';
    }

    var devices = (me.trustedDevices || []).filter(function (d) { return d && d.fingerprint; });
    var devEl = $('devicesList');
    if (devEl) {
      devEl.innerHTML = devices.length
        ? devices.map(function (d) {
            return '<div class="pf-device"><i class="fas fa-laptop-code"></i>' +
              '<div class="pf-device-info"><div class="pf-device-name">' + esc(d.name || 'Recognized browser') + '</div>' +
              '<div class="pf-device-meta">Last used ' + esc(fmtDate(d.lastUsed || d.expiresAt, true)) +
              (d.expiresAt ? ' • trusted until ' + esc(fmtDate(d.expiresAt)) : '') + '</div></div></div>';
          }).join('')
        : '<div class="pf-empty-sm"><i class="fas fa-shield-halved"></i> No recognized devices registered yet. Devices appear here once your administrator trusts them.</div>';
    }

    var tokens = me.deviceTokens || [];
    var tokEl = $('deviceTokensText');
    if (tokEl) {
      tokEl.textContent = tokens.length
        ? tokens.length + ' push target' + (tokens.length > 1 ? 's' : '') +
          ' (' + tokens.map(function (t) { return t.platform || 'web'; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ')'
        : 'No push targets registered';
    }

    $('acctVerify').innerHTML = me.isEmailVerified
      ? '<i class="fas fa-circle-check" style="color:#10B981"></i> Verified'
      : '<i class="fas fa-circle-exclamation" style="color:#F59E0B"></i> Not verified';
    $('acctLastLogin').textContent = fmtDate(me.lastLogin, true);
    $('acctCreated').textContent = fmtDate(me.createdAt);
    $('acctRole').textContent = roleLabel(me.role);
  }

  /* ─────────────────────────── tabs ─────────────────────────── */

  function bindTabs() {
    var buttons = document.querySelectorAll('[data-tab]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-tab');
        buttons.forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('[data-panel]').forEach(function (p) {
          p.style.display = p.getAttribute('data-panel') === target ? '' : 'none';
        });
      });
    });
  }

  /* ─────────────────────────── avatar ─────────────────────────── */

  function bindAvatar() {
    var input = $('inputPhoto');
    var pick = $('btnPickPhoto');
    if (pick && input) {
      pick.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) uploadAvatar(file);
      });
    }
    var removeBtn = $('btnRemovePhoto');
    if (removeBtn) {
      removeBtn.addEventListener('click', async function () {
        if (!window.confirm('Remove your profile photo?')) return;
        try {
          window.setLoading && window.setLoading(removeBtn, true);
          var res = await window.api.request('/auth/profile', { method: 'PUT', body: { avatar: '' }, silent: true });
          if (res && res.user) me = Object.assign(me, res.user);
          persistLocalUser({ avatar: null });
          renderHeader();
          window.showToast && window.showToast('Profile photo removed', 'success');
        } catch (e) {
          window.showToast && window.showToast((e && e.message) || 'Could not remove photo', 'error');
        } finally {
          window.setLoading && window.setLoading(removeBtn, false);
        }
      });
    }
  }

  async function uploadAvatar(file) {
    if (!/^image\//.test(file.type)) {
      window.showToast && window.showToast('Please choose an image file (JPG, PNG or WebP)', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      window.showToast && window.showToast('Image must be under 5 MB', 'error');
      return;
    }
    var pick = $('btnPickPhoto');
    try {
      window.setLoading && window.setLoading(pick, true);
      var fd = new FormData();
      fd.append('file', file);
      var up = await window.api.request('/upload/avatar?subdir=avatars', { method: 'POST', body: fd, silent: true });
      var saved = await window.api.request('/auth/profile', { method: 'PUT', body: { avatar: up.url }, silent: true });
      if (saved && saved.user) me = Object.assign(me, saved.user);
      else me.avatar = up.url;
      persistLocalUser({ avatar: up.url });
      renderHeader();
      window.showToast && window.showToast('Profile photo updated', 'success');
    } catch (e) {
      window.showToast && window.showToast((e && e.message) || 'Photo upload failed', 'error');
    } finally {
      window.setLoading && window.setLoading(pick, false);
    }
  }

  /* ─────────────────── personal info form ─────────────────── */

  function setDirty(flag) {
    var pill = $('pfDirty');
    if (pill) pill.style.display = flag ? '' : 'none';
  }

  function bindPersonalForm() {
    var form = $('personalForm');
    if (!form) return;
    form.addEventListener('input', function () { setDirty(true); });
    form.addEventListener('change', function () { setDirty(true); });

    var discard = $('btnDiscard');
    if (discard) {
      discard.addEventListener('click', function () {
        renderPersonalForm();
        window.showToast && window.showToast('Changes discarded', 'info');
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var name = $('fName').value.trim();
      var phone = $('fPhone').value.trim();
      var dob = $('fDob').value;
      if (name.length < 2) {
        window.showToast && window.showToast('Name must be at least 2 characters', 'error');
        return;
      }
      if (phone && !/^[+\d][\d\s()-]{5,19}$/.test(phone)) {
        window.showToast && window.showToast('Enter a valid phone number', 'error');
        return;
      }
      if (dob && new Date(dob) > new Date()) {
        window.showToast && window.showToast('Date of birth cannot be in the future', 'error');
        return;
      }
      var body = {
        name: name,
        phone: phone,
        gender: $('fGender').value,
        dateOfBirth: dob,
        bloodGroup: $('fBlood').value,
        address: $('fAddress').value.trim()
      };
      var btn = $('btnSaveProfile');
      try {
        window.setLoading && window.setLoading(btn, true);
        var res = await window.api.request('/auth/profile', { method: 'PUT', body: body, silent: true });
        if (res && res.user) me = Object.assign(me, res.user);
        persistLocalUser({ name: body.name });
        renderHeader();
        renderRecord();
        setDirty(false);
        window.showToast && window.showToast('Profile saved', 'success');
      } catch (err) {
        window.showToast && window.showToast((err && err.message) || 'Could not save profile', 'error');
      } finally {
        window.setLoading && window.setLoading(btn, false);
      }
    });
  }

  function persistLocalUser(patch) {
    try {
      var u = window.api.getUser();
      if (u) {
        Object.assign(u, patch);
        localStorage.setItem('erp_user', JSON.stringify(u));
      }
    } catch (e) { /* non-fatal */ }
    // Reflect in sidebar/topbar chrome immediately.
    if (patch.name) {
      var sn = document.getElementById('sidebar-user-name');
      if (sn) sn.textContent = patch.name;
      var initialsEl = document.getElementById('sidebar-avatar');
      if (initialsEl && !initialsEl.querySelector('img')) initialsEl.textContent = initials(patch.name).charAt(0);
      var ta = document.getElementById('topbar-avatar');
      if (ta && !ta.querySelector('img')) ta.textContent = initials(patch.name).charAt(0);
    }
  }

  /* ─────────────────────── password change ─────────────────────── */

  function pwdScore(v) {
    var score = 0;
    if (v.length >= 8) score++;
    if (/[A-Z]/.test(v)) score++;
    if (/[a-z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    return score;
  }

  function bindPassword() {
    var fields = ['fCurPwd', 'fNewPwd', 'fConfirmPwd'];
    var meter = $('pwdMeterFill');
    var meterLabel = $('pwdMeterLabel');
    var checks = $('pwdChecks');

    function update() {
      var v = $('fNewPwd').value;
      var score = pwdScore(v);
      var pct = v ? Math.max(12, score * 20) : 0;
      var level = v ? (score <= 2 ? ['Weak', '#EF4444'] : score === 3 ? ['Fair', '#F59E0B'] : ['Strong', '#10B981']) : ['', '#E2E8F0'];
      if (meter) { meter.style.width = pct + '%'; meter.style.background = level[1]; }
      if (meterLabel) meterLabel.textContent = v ? 'Strength: ' + level[0] : '';
      if (checks) {
        var items = [
          [v.length >= 8, 'At least 8 characters (6 minimum)'],
          [/[A-Z]/.test(v), 'One uppercase letter'],
          [/[a-z]/.test(v), 'One lowercase letter'],
          [/\d/.test(v), 'One number'],
          [v.length > 0 && v === $('fCurPwd').value, 'Different from current password']
        ];
        checks.innerHTML = items.map(function (it) {
          return '<li class="' + (it[0] ? 'ok' : '') + '"><i class="fas ' + (it[0] ? 'fa-circle-check' : 'fa-circle') + '"></i> ' + esc(it[1]) + '</li>';
        }).join('');
      }
    }
    fields.forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', update);
    });

    document.querySelectorAll('[data-toggle-pwd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = $(btn.getAttribute('data-toggle-pwd'));
        if (!target) return;
        var showing = target.type === 'text';
        target.type = showing ? 'password' : 'text';
        var icon = btn.querySelector('i');
        if (icon) icon.className = showing ? 'fas fa-eye' : 'fas fa-eye-slash';
      });
    });

    var form = $('passwordForm');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var cur = $('fCurPwd').value;
        var next = $('fNewPwd').value;
        var confirm = $('fConfirmPwd').value;
        if (!cur || !next) {
          window.showToast && window.showToast('Fill in current and new password', 'error');
          return;
        }
        if (next.length < 6) {
          window.showToast && window.showToast('New password must be at least 6 characters', 'error');
          return;
        }
        if (next !== confirm) {
          window.showToast && window.showToast('New password and confirmation do not match', 'error');
          return;
        }
        if (next === cur) {
          window.showToast && window.showToast('New password must be different from the current one', 'error');
          return;
        }
        var btn = $('btnChangePwd');
        try {
          window.setLoading && window.setLoading(btn, true);
          await window.api.request('/auth/change-password', {
            method: 'PUT',
            body: { currentPassword: cur, newPassword: next },
            silent: true
          });
          form.reset();
          update();
          window.showToast && window.showToast('Password changed — use it the next time you sign in', 'success');
        } catch (err) {
          window.showToast && window.showToast((err && err.message) || 'Password change failed', 'error');
        } finally {
          window.setLoading && window.setLoading(btn, false);
        }
      });
    }
    update();
  }

  /* ─────────────────────── notifications ─────────────────────── */

  function renderNotifications() {
    $('notifUnread').textContent = notifState.unread ? notifState.unread + ' unread' : 'All caught up';
    var list = $('notifList');
    if (!list) return;
    if (!notifState.items.length) {
      list.innerHTML = '<div class="pf-empty"><i class="fas fa-bell-slash"></i>' +
        '<div>No notifications yet</div>' +
        '<small>Announcements, exam updates and fee reminders will appear here.</small></div>';
      return;
    }
    list.innerHTML = notifState.items.map(function (n) {
      var icon = NOTIF_ICONS[n.type] || NOTIF_ICONS.info;
      return '<div class="pf-notif' + (n.isRead ? '' : ' unread') + '" data-notif="' + esc(n._id) + '">' +
        '<div class="pf-notif-icon" style="background:' + icon[1] + '1A;color:' + icon[1] + '"><i class="' + icon[0] + '"></i></div>' +
        '<div class="pf-notif-body"><div class="pf-notif-title">' + esc(n.title || 'Notification') +
        (n.isRead ? '' : ' <span class="pf-dot"></span>') + '</div>' +
        (n.body ? '<div class="pf-notif-text">' + esc(n.body) + '</div>' : '') +
        '<div class="pf-notif-time">' + esc(relativeTime(n.createdAt)) + '</div></div>' +
        (n.isRead ? '' : '<button class="pf-notif-read" title="Mark as read"><i class="fas fa-check"></i></button>') +
        '</div>';
    }).join('');
  }

  async function loadNotifications() {
    try {
      var res = await window.api.request('/notifications?limit=25', { silent: true });
      notifState.items = (res && (res.data || res.notifications)) || [];
      notifState.unread = (res && res.unreadCount) || 0;
      renderNotifications();
    } catch (e) { /* leave empty state */ }
  }

  function bindNotifications() {
    var list = $('notifList');
    if (list) {
      list.addEventListener('click', async function (e) {
        var btn = e.target.closest('.pf-notif-read');
        var row = e.target.closest('[data-notif]');
        if (!row) return;
        var id = row.getAttribute('data-notif');
        var item = notifState.items.find(function (n) { return String(n._id) === id; });
        if (!item || item.isRead) return;
        try {
          await window.api.request('/notifications/' + encodeURIComponent(id) + '/read', { method: 'PUT', silent: true });
          item.isRead = true;
          notifState.unread = Math.max(0, notifState.unread - 1);
          renderNotifications();
        } catch (err) {
          if (btn) window.showToast && window.showToast('Could not update notification', 'error');
        }
      });
    }
    var markAll = $('btnMarkAllRead');
    if (markAll) {
      markAll.addEventListener('click', async function () {
        if (!notifState.unread) {
          window.showToast && window.showToast('No unread notifications', 'info');
          return;
        }
        try {
          window.setLoading && window.setLoading(markAll, true);
          await window.api.request('/notifications/read-all', { method: 'POST', silent: true });
          notifState.items.forEach(function (n) { n.isRead = true; });
          notifState.unread = 0;
          renderNotifications();
          window.showToast && window.showToast('All notifications marked as read', 'success');
        } catch (e) {
          window.showToast && window.showToast((e && e.message) || 'Could not update notifications', 'error');
        } finally {
          window.setLoading && window.setLoading(markAll, false);
        }
      });
    }
    var refresh = $('btnNotifRefresh');
    if (refresh) refresh.addEventListener('click', function () { loadNotifications(); });

    window.addEventListener('erp:notification-received', function () {
      loadNotifications();
    });
  }

  /* ─────────────────────── appearance ─────────────────────── */

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function currentThemeChoice() {
    var stored = localStorage.getItem('theme');
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  }

  function applyThemeChoice(choice) {
    var dark = choice === 'dark' || (choice !== 'light' && systemPrefersDark());
    document.body.classList.toggle('dark-mode', dark);
    document.documentElement.classList.toggle('dark', dark);
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  }

  function applyStoredThemeUI() {
    var choice = currentThemeChoice();
    document.querySelectorAll('[data-theme]').forEach(function (card) {
      card.classList.toggle('selected', card.getAttribute('data-theme') === choice);
    });
  }

  function bindAppearance() {
    document.querySelectorAll('[data-theme]').forEach(function (card) {
      card.addEventListener('click', function () {
        var choice = card.getAttribute('data-theme');
        applyThemeChoice(choice);
        applyStoredThemeUI();
        var label = choice === 'system' ? 'Follow device setting' : choice === 'dark' ? 'Dark mode' : 'Light mode';
        window.showToast && window.showToast(label + ' applied', 'success');
      });
    });
  }
})();
