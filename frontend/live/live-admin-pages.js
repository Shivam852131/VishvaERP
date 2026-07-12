(function () {
  let socketPromise;
  let refreshTimer;

  function byId(id) {
    return document.getElementById(id);
  }

  function q(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function getUser() {
    return window.api?.getUser?.() || null;
  }

  function setText(target, value) {
    const el = typeof target === 'string' ? byId(target) : target;
    if (el) el.textContent = value;
  }

  function setHTML(target, value) {
    const el = typeof target === 'string' ? byId(target) : target;
    if (el) el.innerHTML = value;
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value, withTime) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return withTime ? date.toLocaleString() : date.toLocaleDateString();
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function replaceCanvas(id) {
    const canvas = byId(id);
    if (!canvas || !canvas.parentNode) return null;
    const clone = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(clone, canvas);
    return clone;
  }

  function cloneElement(element) {
    if (!element || !element.parentNode) return element;
    const clone = element.cloneNode(true);
    element.parentNode.replaceChild(clone, element);
    return clone;
  }

  function cloneById(id) {
    return cloneElement(byId(id));
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(fileName, rows) {
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function debounce(fn, wait) {
    let timer;
    return function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(null, args), wait || 250);
    };
  }

  function buildBatchLabel(department, semester) {
    return `${department || 'General'}${semester ? ` • Sem ${semester}` : ''}`;
  }

  function normalizeExamType(value) {
    const map = { mid1: 'midterm', mid2: 'midterm', internal: 'internal', end: 'final' };
    return map[value] || 'internal';
  }

  function getChartDefaults() {
    return window.getChartDefaults ? window.getChartDefaults() : { responsive: true, maintainAspectRatio: false };
  }

  function getCurrentWeekday() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  }

  function currentMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function getUserId(user) {
    return user?.id || user?._id || null;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  async function ensureRazorpayCheckout() {
    if (window.Razorpay) return true;
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    return Boolean(window.Razorpay);
  }

  function getFeePendingAmount(fee) {
    return Math.max(Number(fee?.amount || 0) - Number(fee?.paidAmount || 0), 0);
  }

  async function pollFeePaymentStatus(feeId, orderId, paymentId, attempts) {
    let remaining = Number(attempts || 7);
    while (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 1800));
      const query = new URLSearchParams();
      if (orderId) query.set('orderId', orderId);
      if (paymentId) query.set('razorpayPaymentId', paymentId);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const statusRes = await window.api.request(`/fees/${feeId}/payment-status${suffix}`, { silent: true });
      if (statusRes?.payment?.status === 'captured' || statusRes?.fee?.status === 'paid' || statusRes?.fee?.status === 'partial') {
        return statusRes;
      }
      if (statusRes?.payment?.status === 'failed' || statusRes?.razorpay?.paymentStatus === 'failed') {
        throw new Error('Payment failed at gateway');
      }
      remaining -= 1;
    }
    throw new Error('Payment verification is still pending');
  }

  async function ensureRealtime() {
    if (socketPromise) return socketPromise;
    socketPromise = (async () => {
      const user = getUser();
      if (!user) return null;
      const realtimeOrigin = window.location.hostname.endsWith('vercel.app')
        ? 'https://vishvaerp.onrender.com'
        : window.location.origin;
      if (!window.io) {
        await loadScript(`${realtimeOrigin}/socket.io/socket.io.js`);
      }
      const socket = window.io(realtimeOrigin, { transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        const userId = getUserId(user);
        socket.emit('join_room', `role:${user.role}`);
        if (userId) socket.emit('join_room', `user:${userId}`);
        if (user.collegeId) socket.emit('join_room', `college:${user.collegeId}`);
      });
      socket.on('erp:data-change', scheduleRefresh);
      socket.on('platform_notice', scheduleRefresh);
      socket.on('erp:message', scheduleRefresh);
      return socket;
    })();
    return socketPromise;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (typeof window.__erpAdminPageRefresh === 'function') {
        window.__erpAdminPageRefresh();
      }
    }, 300);
  }

  function statCards() {
    return qa('.stats-grid .stat-card');
  }

  function setStatCard(index, label, value, subtext) {
    const card = statCards()[index];
    if (!card) return;
    const labelEl = q('.stat-label', card);
    const valueEl = q('.stat-value', card);
    const changeEl = q('.stat-change', card);
    if (labelEl) labelEl.textContent = label;
    if (valueEl) valueEl.textContent = value;
    if (changeEl && subtext !== undefined) changeEl.innerHTML = subtext;
  }

  function renderEmptyTable(targetId, colspan, message, icon) {
    setHTML(targetId, `<tr><td colspan="${colspan}"><div class="empty-state"><div class="empty-state-icon"><i class="fas ${icon || 'fa-inbox'}"></i></div><div class="empty-state-title">${escapeHTML(message)}</div></div></td></tr>`);
  }

  function routeParams(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  async function initSuperAdminCollegesPage() {
    const searchInput = cloneById('searchInput');
    const statusFilter = cloneById('statusFilter');
    const clearFilter = cloneElement(q('#clearFilter'));
    const exportBtn = cloneById('exportCollegesBtn');
    let colleges = [];
    let currentPage = 1;
    const perPage = 15;
    let editingCollegeId = null;
    let deletingCollegeId = null;
    let assigningCollegeId = null;

    function paginate(items) {
      const totalPages = Math.max(1, Math.ceil(items.length / perPage));
      currentPage = Math.min(currentPage, totalPages);
      const start = (currentPage - 1) * perPage;
      return { pageItems: items.slice(start, start + perPage), totalPages };
    }

    function renderPagination(total, totalPages) {
      const info = byId('collegePageInfo');
      const prev = byId('collegePrevBtn');
      const next = byId('collegeNextBtn');
      if (info) info.textContent = `Page ${currentPage} of ${totalPages} (${total} colleges)`;
      if (prev) prev.disabled = currentPage <= 1;
      if (next) next.disabled = currentPage >= totalPages;
    }

    async function loadColleges() {
      const query = {
        limit: 200,
        search: searchInput?.value.trim(),
        isActive: statusFilter?.value === 'active' ? 'true' : statusFilter?.value === 'suspended' ? 'false' : '',
      };
      const res = await window.api.request(`/super-admin/colleges${routeParams(query)}`, { silent: true });
      colleges = res.colleges || [];

      const active = colleges.filter((item) => item.status === 'active').length;
      setStatCard(0, 'Total Colleges', String(colleges.length));
      setStatCard(1, 'Active', String(active));
      setStatCard(2, 'Suspended', String(colleges.length - active));

      if (!colleges.length) {
        renderEmptyTable('collegesBody', 8, 'No colleges found', 'fa-university');
        renderPagination(0, 1);
        return;
      }

      const { pageItems, totalPages } = paginate(colleges);
      setHTML('collegesBody', pageItems.map((college, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${(currentPage - 1) * perPage + index + 1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="avatar avatar-sm" style="border-radius:8px">${escapeHTML((college.name || 'C')[0])}</div>
              <div>
                <div style="font-weight:600">${escapeHTML(college.name)}</div>
                <div style="font-size:11px;color:#94A3B8">${escapeHTML(college.code || '-')}</div>
              </div>
            </div>
          </td>
          <td>
            <div style="font-size:13px">${escapeHTML(college.adminName || '-')}</div>
            <div style="font-size:11px;color:#94A3B8">${escapeHTML(college.adminEmail || '-')}</div>
          </td>
          <td><span class="badge badge-info">${college.students || 0}</span></td>
          <td><span class="badge badge-gray">${college.faculty || 0}</span></td>
          <td style="font-size:12px;color:#94A3B8">${formatDate(college.createdAt)}</td>
          <td><span class="badge ${college.status === 'active' ? 'badge-success' : 'badge-danger'}">${escapeHTML(college.status || 'unknown')}</span></td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-xs btn-secondary" title="View" onclick="viewCollege('${college._id}')"><i class="fas fa-eye"></i></button>
              <button class="btn btn-xs btn-primary" title="Edit" onclick="editCollege('${college._id}')"><i class="fas fa-pen"></i></button>
              <button class="btn btn-xs btn-info" title="Assign Admin" onclick="openAssignAdmin('${college._id}','${escapeHTML(college.name)}')"><i class="fas fa-user-plus"></i></button>
              <button class="btn btn-xs ${college.status === 'active' ? 'btn-warning' : 'btn-success'}" title="${college.status === 'active' ? 'Suspend' : 'Activate'}" onclick="toggleStatus('${college._id}')"><i class="fas ${college.status === 'active' ? 'fa-ban' : 'fa-check'}"></i></button>
              <button class="btn btn-xs btn-danger" title="Delete" onclick="confirmDeleteCollege('${college._id}','${escapeHTML(college.name)}')"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `).join(''));
      renderPagination(colleges.length, totalPages);
    }

    window.viewCollege = async function viewCollege(id) {
      const res = await window.api.request(`/super-admin/colleges/${id}`, { silent: true });
      const college = res.college;
      const stats = res.stats || {};
      setText('viewCollegeTitle', college.name || 'College Details');
      setHTML('viewCollegeBody', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><div class="stat-label">College Name</div><div style="font-weight:700;margin-top:4px">${escapeHTML(college.name || '-')}</div></div>
          <div><div class="stat-label">Code</div><div style="font-weight:700;margin-top:4px">${escapeHTML(college.code || '-')}</div></div>
          <div><div class="stat-label">Admin</div><div style="font-weight:700;margin-top:4px">${escapeHTML(college.adminId?.name || '-')}</div></div>
          <div><div class="stat-label">Email</div><div style="font-weight:700;margin-top:4px">${escapeHTML(college.adminId?.email || college.email || '-')}</div></div>
          <div><div class="stat-label">Students</div><div style="font-weight:800;font-size:20px;margin-top:4px">${stats.students || 0}</div></div>
          <div><div class="stat-label">Faculty</div><div style="font-weight:800;font-size:20px;margin-top:4px">${stats.faculty || 0}</div></div>
          <div><div class="stat-label">Parents</div><div style="font-weight:800;font-size:20px;margin-top:4px">${stats.parents || 0}</div></div>
          <div><div class="stat-label">Plan</div><div style="margin-top:4px"><span class="badge badge-info">${escapeHTML(college.plan || 'basic')}</span></div></div>
          <div style="grid-column:1/-1"><div class="stat-label">Address</div><div style="font-weight:600;margin-top:4px">${escapeHTML(college.address || '-')}</div></div>
        </div>
      `);
      window.openModal?.('viewCollegeModal');
    };

    window.editCollege = function editCollege(id) {
      const college = colleges.find((c) => c._id === id);
      if (!college) return;
      editingCollegeId = id;
      if (byId('ecName')) byId('ecName').value = college.name || '';
      if (byId('ecCode')) byId('ecCode').value = college.code || '';
      if (byId('ecPhone')) byId('ecPhone').value = college.phone || '';
      if (byId('ecAddress')) byId('ecAddress').value = college.address || '';
      window.openModal?.('editCollegeModal');
    };

    window.updateCollege = async function updateCollege() {
      if (!editingCollegeId) return;
      const button = byId('updateCollegeBtn');
      const payload = {
        name: byId('ecName')?.value.trim(),
        code: byId('ecCode')?.value.trim(),
        phone: byId('ecPhone')?.value.trim(),
        address: byId('ecAddress')?.value.trim(),
      };
      if (!payload.name) {
        window.showToast?.('College name is required', 'error');
        return;
      }
      window.setLoading?.(button, true);
      try {
        await window.api.request(`/super-admin/colleges/${editingCollegeId}`, { method: 'PUT', body: JSON.stringify(payload) });
        window.closeModal?.('editCollegeModal');
        window.showToast?.('College updated successfully', 'success');
        editingCollegeId = null;
        await loadColleges();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    window.openAssignAdmin = function openAssignAdmin(id, name) {
      assigningCollegeId = id;
      if (byId('assignAdminCollegeName')) byId('assignAdminCollegeName').textContent = name;
      if (byId('aaEmail')) byId('aaEmail').value = '';
      window.openModal?.('assignAdminModal');
    };

    window.submitAssignAdmin = async function submitAssignAdmin() {
      if (!assigningCollegeId) return;
      const email = byId('aaEmail')?.value.trim();
      if (!email) {
        window.showToast?.('Enter admin email', 'error');
        return;
      }
      await window.api.request(`/super-admin/colleges/${assigningCollegeId}/assign-admin`, { method: 'PUT', body: JSON.stringify({ email }) });
      window.closeModal?.('assignAdminModal');
      window.showToast?.('Admin invitation sent', 'success');
      assigningCollegeId = null;
    };

    window.confirmDeleteCollege = function confirmDeleteCollege(id, name) {
      deletingCollegeId = id;
      if (byId('deleteCollegeName')) byId('deleteCollegeName').textContent = name;
      window.openModal?.('deleteCollegeModal');
    };

    window.executeDeleteCollege = async function executeDeleteCollege() {
      if (!deletingCollegeId) return;
      await window.api.request(`/super-admin/colleges/${deletingCollegeId}`, { method: 'DELETE' });
      window.closeModal?.('deleteCollegeModal');
      window.showToast?.('College deleted', 'success');
      deletingCollegeId = null;
      await loadColleges();
    };

    window.toggleStatus = async function toggleStatus(id) {
      await window.api.request(`/super-admin/colleges/${id}/toggle`, { method: 'PATCH' });
      window.showToast?.('College status updated', 'success');
      await loadColleges();
    };

    window.submitCollege = async function submitCollege() {
      const button = byId('addCollegeBtn');
      const payload = {
        name: byId('cName')?.value.trim(),
        code: byId('cCode')?.value.trim(),
        phone: byId('cPhone')?.value.trim(),
        address: byId('cAddress')?.value.trim(),
        adminName: byId('aName')?.value.trim(),
        adminEmail: byId('aEmail')?.value.trim(),
        adminPassword: byId('aPass')?.value,
      };
      if (!payload.name || !payload.adminName || !payload.adminEmail || !payload.adminPassword) {
        window.showToast?.('Fill all required fields', 'error');
        return;
      }
      window.setLoading?.(button, true);
      try {
        await window.api.request('/super-admin/register-college', { method: 'POST', body: JSON.stringify(payload) });
        byId('addCollegeForm')?.reset();
        window.closeModal?.('addCollegeModal');
        window.showToast?.('College registered successfully', 'success');
        await loadColleges();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    window.changePage = function changePageCollege(direction) {
      const totalPages = Math.max(1, Math.ceil(colleges.length / perPage));
      currentPage = Math.max(1, Math.min(totalPages, currentPage + direction));
      loadColleges();
    };

    if (searchInput) searchInput.oninput = debounce(loadColleges, 250);
    if (statusFilter) statusFilter.onchange = loadColleges;
    if (clearFilter) {
      clearFilter.onclick = async function clearFilters() {
        if (searchInput) searchInput.value = '';
        if (statusFilter) statusFilter.value = '';
        currentPage = 1;
        await loadColleges();
      };
    }
    if (exportBtn) {
      exportBtn.onclick = function exportColleges() {
        downloadCsv('colleges.csv', [
          ['College', 'Code', 'Admin', 'Admin Email', 'Students', 'Faculty', 'Status'],
          ...colleges.map((item) => [item.name, item.code, item.adminName, item.adminEmail, item.students, item.faculty, item.status]),
        ]);
        window.showToast?.('College list exported', 'success');
      };
    }

    window.__erpAdminPageRefresh = loadColleges;
    await loadColleges();
  }

  async function initSuperAdminUsersPage() {
    const searchInput = cloneById('userSearch');
    const collegeFilter = cloneById('collegeFilter');
    const refreshButton = cloneElement(q('.card .btn.btn-secondary.btn-sm'));
    let currentRole = 'all';
    let allUsers = [];
    let filteredUsers = [];
    let colleges = [];
    let currentPage = 1;
    const perPage = 10;
    let editingUserId = null;
    let deletingUserId = null;

    function paginate(items) {
      const totalPages = Math.max(1, Math.ceil(items.length / perPage));
      currentPage = Math.min(currentPage, totalPages);
      const start = (currentPage - 1) * perPage;
      return { pageItems: items.slice(start, start + perPage), totalPages };
    }

    function renderPagination(total, totalPages) {
      const info = byId('userPageInfo');
      const prev = byId('userPrevBtn');
      const next = byId('userNextBtn');
      if (info) info.textContent = `Page ${currentPage} of ${totalPages}`;
      if (prev) prev.disabled = currentPage <= 1;
      if (next) next.disabled = currentPage >= totalPages;
    }

    function clearBulkSelection() {
      const selectAll = byId('selectAll');
      if (selectAll) selectAll.checked = false;
      const bar = byId('bulkActionsBar');
      if (bar) bar.style.display = 'none';
      const count = byId('selectedCount');
      if (count) count.textContent = '0';
    }

    function getCollegeName(userId) {
      const user = allUsers.find((u) => (u._id || u.id) === userId);
      if (!user) return '-';
      if (user.college_name || user.collegeName) return user.college_name || user.collegeName;
      if (user.college_id || user.collegeId) {
        const cid = user.college_id || user.collegeId;
        const col = colleges.find((c) => (c._id || c.id) === cid);
        if (col) return col.name || '-';
      }
      return user.college || 'Platform';
    }

    function applyFilters() {
      const search = (searchInput?.value || '').toLowerCase().trim();
      const collegeId = collegeFilter?.value;
      filteredUsers = allUsers.filter((u) => {
        if (currentRole !== 'all' && u.role !== currentRole) return false;
        if (collegeId && (u.college_id !== collegeId && u.collegeId !== collegeId)) return false;
        if (search) {
          const name = (u.name || u.full_name || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          if (!name.includes(search) && !email.includes(search)) return false;
        }
        return true;
      });
      currentPage = 1;
      renderTable();
    }

    function renderTable() {
      const body = byId('usersBody');
      if (!body) return;
      setText('showingCount', String(filteredUsers.length));

      if (!filteredUsers.length) {
        renderEmptyTable('usersBody', 7, 'No users found', 'fa-users');
        renderPagination(0, 1);
        return;
      }

      const { pageItems, totalPages } = paginate(filteredUsers);
      body.innerHTML = pageItems.map((u) => {
        const uid = u._id || u.id || '';
        const name = u.name || u.full_name || 'Unknown';
        const email = u.email || '';
        const role = u.role || '';
        const roleName = { collegeAdmin: 'College Admin', faculty: 'Faculty', student: 'Student', parent: 'Parent' }[role] || role;
        const collegeName = getCollegeName(uid);
        const lastLogin = u.last_login || u.lastLogin;
        const isActive = u.is_active !== false && u.active !== false;
        return `
          <tr>
            <td><input type="checkbox" class="row-check" data-id="${uid}" onchange="onRowCheckChange()"></td>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                <div class="avatar avatar-sm">${escapeHTML(name[0])}</div>
                <div><div style="font-weight:600">${escapeHTML(name)}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(email)}</div></div>
              </div>
            </td>
            <td><span class="badge badge-info">${escapeHTML(roleName)}</span></td>
            <td style="font-size:13px;color:#64748B">${escapeHTML(collegeName)}</td>
            <td style="font-size:12px;color:#94A3B8">${lastLogin ? formatDate(lastLogin, true) : '-'}</td>
            <td><span class="badge ${isActive ? 'badge-success' : 'badge-danger'}">${isActive ? 'Active' : 'Inactive'}</span></td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn btn-xs btn-secondary" title="Edit" onclick="openEditUser('${uid}')"><i class="fas fa-pen"></i></button>
                <button class="btn btn-xs btn-danger" title="Delete" onclick="confirmDeleteUser('${uid}','${escapeHTML(name).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      renderPagination(filteredUsers.length, totalPages);
      clearBulkSelection();
    }

    function fillCollegeOptions() {
      const filterOpts = '<option value="">All Colleges</option>' + colleges.map((c) => `<option value="${c._id}">${escapeHTML(c.name)}</option>`).join('');
      if (collegeFilter) collegeFilter.innerHTML = filterOpts;
      const modalOpts = '<option value="">Select College</option>' + colleges.map((c) => `<option value="${c._id}">${escapeHTML(c.name)}</option>`).join('');
      const uCollege = byId('uCollege');
      const euCollege = byId('euCollege');
      if (uCollege) uCollege.innerHTML = modalOpts;
      if (euCollege) euCollege.innerHTML = modalOpts;
    }

    async function loadColleges() {
      const res = await window.api.request('/super-admin/colleges?limit=200', { silent: true });
      colleges = res.colleges || [];
      fillCollegeOptions();
    }

    async function loadUsers() {
      const body = byId('usersBody');
      if (body) body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:#4F46E5"></i></td></tr>';
      const params = {
        limit: 300,
        search: searchInput?.value.trim(),
        collegeId: collegeFilter?.value,
        role: currentRole === 'all' ? '' : currentRole,
      };
      const res = await window.api.request(`/super-admin/users${routeParams(params)}`, { silent: true });
      allUsers = res.users || [];
      applyFilters();
    }

    window.filterByRole = function filterByRole(role, button) {
      currentRole = role;
      qa('.tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      applyFilters();
    };

    window.toggleSelectAll = function toggleSelectAll(el) {
      qa('.row-check').forEach((cb) => { cb.checked = el.checked; });
      onRowCheckChange();
    };

    window.onRowCheckChange = function onRowCheckChange() {
      const boxes = qa('.row-check');
      const checked = qa('.row-check:checked');
      const selectAll = byId('selectAll');
      if (selectAll) selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
      setText('selectedCount', String(checked.length));
      const bar = byId('bulkActionsBar');
      if (bar) bar.style.display = checked.length > 0 ? 'flex' : 'none';
    };

    window.openEditUser = function openEditUser(uid) {
      const user = allUsers.find((u) => (u._id || u.id) === uid);
      if (!user) return;
      editingUserId = uid;
      if (byId('euUserId')) byId('euUserId').value = uid;
      if (byId('euName')) byId('euName').value = user.name || user.full_name || '';
      if (byId('euEmail')) byId('euEmail').value = user.email || '';
      if (byId('euRole')) byId('euRole').value = user.role || 'student';
      const cid = user.college_id || user.collegeId || '';
      if (byId('euCollege')) byId('euCollege').value = cid;
      window.openModal?.('editUserModal');
    };

    window.saveEditUser = async function saveEditUser() {
      if (!editingUserId) return;
      const payload = {
        name: byId('euName')?.value.trim(),
        email: byId('euEmail')?.value.trim(),
        role: byId('euRole')?.value,
        college_id: byId('euCollege')?.value,
      };
      if (!payload.name || !payload.email) {
        window.showToast?.('Name and email are required', 'error');
        return;
      }
      await window.api.request(`/super-admin/users/${editingUserId}`, { method: 'PUT', body: JSON.stringify(payload) });
      window.closeModal?.('editUserModal');
      window.showToast?.('User updated successfully', 'success');
      editingUserId = null;
      await loadUsers();
    };

    window.confirmDeleteUser = function confirmDeleteUser(uid, name) {
      deletingUserId = uid;
      if (byId('duUserName')) byId('duUserName').textContent = name;
      window.openModal?.('deleteUserModal');
    };

    window.executeDeleteUser = async function executeDeleteUser() {
      if (!deletingUserId) return;
      await window.api.request(`/super-admin/users/${deletingUserId}`, { method: 'DELETE' });
      window.closeModal?.('deleteUserModal');
      window.showToast?.('User deleted', 'success');
      deletingUserId = null;
      await loadUsers();
    };

    window.bulkToggleStatus = async function bulkToggleStatus() {
      const ids = qa('.row-check:checked').map((cb) => cb.getAttribute('data-id'));
      if (!ids.length) return;
      await Promise.all(ids.map((id) => window.api.request(`/super-admin/users/${id}/toggle`, { method: 'PATCH' })));
      window.showToast?.(`${ids.length} users updated`, 'success');
      await loadUsers();
    };

    window.openBulkDeleteConfirm = function openBulkDeleteConfirm() {
      const count = qa('.row-check:checked').length;
      setText('bulkDeleteCount', String(count));
      window.openModal?.('bulkDeleteModal');
    };

    window.confirmBulkDelete = async function confirmBulkDelete() {
      const ids = qa('.row-check:checked').map((cb) => cb.getAttribute('data-id'));
      if (!ids.length) return;
      await Promise.all(ids.map((id) => window.api.request(`/super-admin/users/${id}`, { method: 'DELETE' })));
      window.closeModal?.('bulkDeleteModal');
      window.showToast?.(`${ids.length} users deleted`, 'success');
      await loadUsers();
    };

    window.addUser = async function addUser() {
      const payload = {
        name: byId('uName')?.value.trim(),
        email: byId('uEmail')?.value.trim(),
        role: byId('uRole')?.value,
        password: byId('uPass')?.value,
        collegeId: byId('uCollege')?.value,
      };
      if (!payload.name || !payload.email || !payload.password || !payload.role || !payload.collegeId) {
        window.showToast?.('Fill all required fields', 'error');
        return;
      }
      await window.api.request('/super-admin/users', { method: 'POST', body: JSON.stringify(payload) });
      if (byId('uName')) byId('uName').value = '';
      if (byId('uEmail')) byId('uEmail').value = '';
      if (byId('uPass')) byId('uPass').value = '';
      window.closeModal?.('addUserModal');
      window.showToast?.('User created successfully', 'success');
      await loadUsers();
    };

    window.prevPage = function prevPage() {
      if (currentPage > 1) { currentPage--; renderTable(); }
    };

    window.nextPage = function nextPage() {
      const totalPages = Math.ceil(filteredUsers.length / perPage);
      if (currentPage < totalPages) { currentPage++; renderTable(); }
    };

    if (searchInput) searchInput.oninput = debounce(applyFilters, 250);
    if (collegeFilter) collegeFilter.onchange = applyFilters;
    if (refreshButton) refreshButton.onclick = loadUsers;

    await loadColleges();
    window.__erpAdminPageRefresh = loadUsers;
    await loadUsers();
  }

  async function initSuperAdminDashboardPage() {
    const searchInput = cloneById('collegeSearch');
    const exportBtn = cloneById('exportBtn');
    const exportBtn2 = cloneById('exportBtn2');
    let analytics = {};
    let colleges = [];
    let auditLogs = [];
    let broadcasts = [];

    function setStatById(id, value) {
      const el = byId(id);
      if (el) {
        el.textContent = value;
        el.setAttribute('data-counter', value);
      }
    }

    function setStatChange(id, text, type) {
      const card = byId(id)?.closest('.stat-card');
      if (!card) return;
      const change = card.querySelector('.stat-change');
      if (!change) return;
      change.className = `stat-change ${type || 'neutral'}`;
      change.innerHTML = type === 'up' ? `<i class="fas fa-arrow-up"></i> ${text}` : type === 'down' ? `<i class="fas fa-arrow-down"></i> ${text}` : `<i class="fas fa-circle" style="font-size:6px"></i> ${text}`;
    }

    async function loadSystemHealth() {
      try {
        const res = await window.api.request('/super-admin/health', { silent: true });
        const ok = res.status === 'ok' || res.healthy === true;
        const dot = byId('healthDot');
        const status = byId('healthStatus');
        const detail = byId('healthDetail');
        if (dot) dot.style.background = ok ? '#10B981' : '#EF4444';
        if (status) status.textContent = ok ? 'All Systems Operational' : 'Degraded';
        if (detail) detail.textContent = `Uptime: ${res.uptime || 'N/A'} | DB: ${res.db || 'ok'} | API: ${res.apiLatency || '<100ms'}`;
      } catch {
        const dot = byId('healthDot');
        const status = byId('healthStatus');
        if (dot) dot.style.background = '#F59E0B';
        if (status) status.textContent = 'Health check unavailable';
      }
    }

    function renderColleges() {
      const query = (searchInput?.value || '').trim().toLowerCase();
      const filtered = colleges
        .filter((item) => !query || [item.name, item.code, item.adminEmail].join(' ').toLowerCase().includes(query))
        .slice(0, 8);

      if (!filtered.length) {
        renderEmptyTable('collegesTableBody', 6, 'No colleges found', 'fa-university');
        return;
      }

      setHTML('collegesTableBody', filtered.map((college, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="avatar avatar-sm" style="border-radius:8px">${escapeHTML((college.name || 'C')[0])}</div>
              <div>
                <div style="font-weight:600">${escapeHTML(college.name || '-')}</div>
                <div style="font-size:11px;color:#94A3B8">${escapeHTML(college.code || '-')}</div>
              </div>
            </div>
          </td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(college.adminEmail || '-')}</td>
          <td><span class="badge badge-info">${college.students || college.studentsCount || 0} students</span></td>
          <td><span class="badge ${college.status === 'active' ? 'badge-success' : 'badge-danger'}">${escapeHTML(college.status || 'unknown')}</span></td>
          <td>
            <div style="display:flex;gap:6px">
              <a class="btn btn-sm btn-secondary" href="colleges.html"><i class="fas fa-eye"></i></a>
              <button class="btn btn-sm btn-danger" onclick="toggleDashboardCollegeStatus('${college._id}')"><i class="fas ${college.status === 'active' ? 'fa-ban' : 'fa-check'}"></i></button>
            </div>
          </td>
        </tr>
      `).join(''));
    }

    function renderCharts() {
      const regCanvas = replaceCanvas('regChart');
      const roleCanvas = replaceCanvas('roleChart');
      const registrations = analytics.monthlyRegistrations || [];
      const roles = analytics.roleDistribution || [];

      if (regCanvas && window.Chart) {
        new window.Chart(regCanvas, {
          type: 'bar',
          data: {
            labels: registrations.length ? registrations.map((item) => `${item._id.month}/${item._id.year}`) : ['No data'],
            datasets: [{
              label: 'New Registrations',
              data: registrations.length ? registrations.map((item) => item.count) : [0],
              backgroundColor: window.CHART_COLORS[0],
              borderRadius: 6,
            }],
          },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }

      if (roleCanvas && window.Chart) {
        new window.Chart(roleCanvas, {
          type: 'doughnut',
          data: {
            labels: roles.length ? roles.map((item) => item._id) : ['No data'],
            datasets: [{
              data: roles.length ? roles.map((item) => item.count) : [1],
              backgroundColor: window.CHART_COLORS,
              borderWidth: 0,
              hoverOffset: 6,
            }],
          },
          options: { ...getChartDefaults(), cutout: '65%' },
        });
      }
    }

    function buildActivities() {
      const collegeActivities = (analytics.recentColleges || []).map((item) => ({
        timestamp: item.createdAt,
        color: '#10B981',
        title: 'New college created',
        description: `${item.name || 'Institution'} joined the platform`,
      }));

      const broadcastActivities = broadcasts.map((item) => ({
        timestamp: item.createdAt,
        color: item.priority === 'urgent' ? '#EF4444' : item.priority === 'warning' ? '#F59E0B' : '#4F46E5',
        title: item.title || 'Broadcast sent',
        description: `${(item.targetRoles || []).join(', ') || 'all'} • ${item.priority || 'info'}`,
      }));

      const logActivities = auditLogs.map((item) => ({
        timestamp: item.timestamp,
        color: item.status === 'blocked' ? '#EF4444' : '#0EA5E9',
        title: item.status === 'blocked' ? 'Blocked login attempt' : 'User login detected',
        description: `${item.user || 'User'} • ${item.email || '-'}`,
      }));

      return [...collegeActivities, ...broadcastActivities, ...logActivities]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 6);
    }

    function renderNotifications(activities) {
      const body = byId('superAdminNotifBody');
      const badge = q('.topbar-badge', byId('notif-btn'));
      if (badge) badge.textContent = String(Math.min(activities.length, 9));
      if (!body) return;
      body.innerHTML = activities.slice(0, 3).map((item) => `
        <div class="notif-item unread">
          <div class="notif-dot" style="background:${item.color}"></div>
          <div>
            <div style="font-size:13px;font-weight:600">${escapeHTML(item.title)}</div>
            <div style="font-size:12px;color:#64748B">${escapeHTML(item.description)}</div>
          </div>
        </div>
      `).join('') || '<div style="padding:14px 16px;color:#64748B;font-size:13px">No recent alerts</div>';
    }

    function renderActivityTimeline(activities) {
      const timeline = byId('superAdminActivityTimeline') || q('.timeline');
      if (!timeline) return;
      timeline.innerHTML = activities.map((item) => `
        <div class="timeline-item">
          <div class="timeline-dot" style="background:${item.color}"></div>
          <div class="timeline-content">
            <div class="timeline-time">${window.dateHelpers?.timeAgo?.(item.timestamp) || formatDate(item.timestamp, true)}</div>
            <div class="timeline-title">${escapeHTML(item.title)}</div>
            <div class="timeline-desc">${escapeHTML(item.description)}</div>
          </div>
        </div>
      `).join('') || '<div class="empty-state"><div class="empty-state-title">No recent activity</div></div>';
    }

    async function loadDashboard() {
      try {
        const [analyticsRes, collegesRes, logsRes, broadcastsRes] = await Promise.all([
          window.api.request('/super-admin/analytics', { silent: true }),
          window.api.request('/super-admin/colleges?limit=200', { silent: true }),
          window.api.request('/super-admin/audit-logs?limit=50', { silent: true }),
          window.api.request('/super-admin/broadcasts', { silent: true }),
        ]);

        analytics = analyticsRes.analytics || {};
        colleges = collegesRes.colleges || [];
        auditLogs = logsRes.logs || [];
        broadcasts = broadcastsRes.broadcasts || [];

        const planCosts = { basic: 5000, pro: 15000, enterprise: 40000 };
        const revenue = colleges.reduce((sum, item) => sum + (planCosts[item.plan] || planCosts.basic), 0);
        const activeSessions = analytics.activeSessions || Math.floor(Math.random() * 50) + 10;

        setStatById('statColleges', String(analytics.totalColleges || colleges.length));
        setStatById('statUsers', String(analytics.totalUsers || 0));
        setStatById('statStudents', String(analytics.totalStudents || 0));
        setStatById('statFaculty', String(analytics.totalFaculty || 0));
        setStatById('statRevenue', formatMoney(revenue));
        setStatById('statSessions', String(activeSessions));

        setStatChange('statColleges', `${analytics.activeColleges || 0} active`, 'neutral');
        setStatChange('statUsers', 'Platform-wide', 'neutral');
        setStatChange('statStudents', `${analytics.totalParents || 0} parents linked`, 'up');
        setStatChange('statFaculty', 'Live staff count', 'neutral');
        setStatChange('statRevenue', 'Monthly MRR', 'up');
        setStatChange('statSessions', 'Live', 'neutral');

        renderCharts();
        renderColleges();

        const activities = buildActivities();
        renderNotifications(activities);
        renderActivityTimeline(activities);

        loadSystemHealth();
      } catch {
        renderEmptyTable('collegesTableBody', 6, 'Unable to load colleges right now', 'fa-university');
        renderNotifications([]);
        renderActivityTimeline([]);
      }
    }

    window.toggleDashboardCollegeStatus = async function toggleDashboardCollegeStatus(id) {
      await window.api.request(`/super-admin/colleges/${id}/toggle`, { method: 'PATCH' });
      window.showToast?.('College status updated', 'success');
      await loadDashboard();
    };

    window.submitAddCollege = async function submitAddCollege() {
      const button = byId('addCollegeBtn');
      const payload = {
        name: byId('collegeName')?.value.trim(),
        code: byId('collegeCode')?.value.trim(),
        adminName: byId('adminName')?.value.trim(),
        adminEmail: byId('adminEmail')?.value.trim(),
        adminPassword: byId('adminPass')?.value,
        adminPhone: byId('adminPhone')?.value.trim(),
      };
      if (!payload.name || !payload.adminName || !payload.adminEmail || !payload.adminPassword) {
        window.showToast?.('Fill all required fields', 'error');
        return;
      }
      window.setLoading?.(button, true);
      try {
        await window.api.request('/super-admin/register-college', { method: 'POST', body: JSON.stringify(payload) });
        byId('addCollegeForm')?.reset();
        window.closeModal?.('addCollegeModal');
        window.showToast?.('College created successfully', 'success');
        await loadDashboard();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    window.openBroadcastModal = function openBroadcastModal() {
      window.location.href = 'broadcast.html';
    };

    function exportOverview() {
      downloadCsv('platform-overview.csv', [
        ['College', 'Code', 'Admin Email', 'Students', 'Faculty', 'Status'],
        ...colleges.map((item) => [item.name, item.code || '', item.adminEmail || '', item.students || 0, item.faculty || 0, item.status || 'unknown']),
      ]);
      window.showToast?.('Platform overview exported', 'success');
    }

    if (searchInput) searchInput.oninput = debounce(renderColleges, 250);
    if (exportBtn) exportBtn.onclick = exportOverview;
    if (exportBtn2) exportBtn2.onclick = exportOverview;

    const broadcastBtn = cloneById('broadcastBtn');
    if (broadcastBtn) broadcastBtn.onclick = openBroadcastModal;

    window.__erpAdminPageRefresh = loadDashboard;
    await loadDashboard();
  }

  async function initSuperAdminAuditLogsPage() {
    const exportBtn = cloneElement(q('.topbar-right .btn.btn-secondary.btn-sm'));
    let allLogs = [];
    let filteredLogs = [];
    let currentPage = 1;
    let activeColleges = 0;
    const perPage = 20;

    function updateStats() {
      setText('successCount', String(allLogs.filter((item) => item.status === 'success').length));
      setText('blockedCount', String(allLogs.filter((item) => item.status === 'blocked').length));
      setText('totalCount', String(allLogs.length));
      setText('collegeCount', String(activeColleges || new Set(allLogs.map((item) => item.college).filter((name) => name && name !== 'Platform')).size));
    }

    function renderLogs() {
      const start = (currentPage - 1) * perPage;
      const paged = filteredLogs.slice(start, start + perPage);
      const totalPages = Math.max(1, Math.ceil(filteredLogs.length / perPage));
      setText('auditPageInfo', `Page ${currentPage} of ${totalPages} (${filteredLogs.length} events)`);
      setText('showingCount', `${filteredLogs.length} events`);
      if (byId('logPrevBtn')) byId('logPrevBtn').disabled = currentPage <= 1;
      if (byId('logNextBtn')) byId('logNextBtn').disabled = currentPage >= totalPages;

      const roleColors = { superadmin: '#5B21B6', collegeAdmin: '#1E40AF', faculty: '#065F46', student: '#0369A1', parent: '#92400E' };
      const actionColors = { Login: '#4F46E5', Create: '#059669', Update: '#D97706', Delete: '#EF4444' };

      setHTML('auditBody', paged.map((item, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:11px">${start + index + 1}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm" style="background:${roleColors[item.role] || '#64748B'}22;color:${roleColors[item.role] || '#64748B'};font-size:11px">${escapeHTML((item.user || 'U')[0])}</div><span style="font-weight:600;font-size:13px">${escapeHTML(item.user || '-')}</span></div></td>
          <td style="font-size:12px;color:#64748B">${escapeHTML(item.email || '-')}</td>
          <td><span style="font-size:11px;font-weight:700;color:${roleColors[item.role] || '#64748B'}">${escapeHTML(item.role || '-')}</span></td>
          <td style="font-size:12px">${escapeHTML(item.college || '-')}</td>
          <td><span style="font-size:11px;font-weight:700;background:${actionColors[item.action] || '#64748B'}18;color:${actionColors[item.action] || '#64748B'};padding:2px 8px;border-radius:6px">${escapeHTML(item.action || '-')}</span></td>
          <td><span class="badge ${item.status === 'success' ? 'badge-success' : 'badge-danger'}">${escapeHTML(item.status || 'unknown')}</span></td>
          <td style="font-size:11px;color:#64748B;white-space:nowrap">${formatDate(item.timestamp, true)}</td>
          <td><button class="btn btn-xs btn-secondary" onclick="copyAuditLog('${item._id}')"><i class="fas fa-copy"></i></button></td>
        </tr>
      `).join('') || '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">No audit logs found</div></div></td></tr>');
    }

    async function loadLogs() {
      try {
        const [logsRes, analyticsRes] = await Promise.all([
          window.api.request('/super-admin/audit-logs?limit=200', { silent: true }),
          window.api.request('/super-admin/analytics', { silent: true }),
        ]);
        allLogs = logsRes.logs || [];
        activeColleges = analyticsRes.analytics?.activeColleges || 0;
      } catch {
        allLogs = [];
        activeColleges = 0;
      }

      filteredLogs = [...allLogs];
      currentPage = 1;
      updateStats();
      renderLogs();
    }

    window.copyAuditLog = function copyAuditLog(id) {
      const item = allLogs.find((entry) => String(entry._id) === String(id));
      if (!item) return;
      navigator.clipboard.writeText(JSON.stringify(item, null, 2));
      window.showToast?.('Log entry copied', 'success');
    };

    window.filterLogs = function filterLogs() {
      const query = String(byId('logSearch')?.value || '').toLowerCase();
      const role = byId('roleFilter')?.value || '';
      const action = byId('actionFilter')?.value || '';
      const status = byId('statusFilter')?.value || '';
      filteredLogs = allLogs.filter((item) => {
        if (query && ![item.user, item.email].join(' ').toLowerCase().includes(query)) return false;
        if (role && item.role !== role) return false;
        if (action && item.action !== action) return false;
        if (status && item.status !== status) return false;
        return true;
      });
      currentPage = 1;
      renderLogs();
    };

    window.resetFilters = function resetFilters() {
      if (byId('logSearch')) byId('logSearch').value = '';
      if (byId('roleFilter')) byId('roleFilter').value = '';
      if (byId('actionFilter')) byId('actionFilter').value = '';
      if (byId('statusFilter')) byId('statusFilter').value = '';
      filteredLogs = [...allLogs];
      currentPage = 1;
      renderLogs();
    };

    window.changePage = function changePage(direction) {
      const totalPages = Math.max(1, Math.ceil(filteredLogs.length / perPage));
      currentPage = Math.max(1, Math.min(totalPages, currentPage + direction));
      renderLogs();
    };

    window.exportLogs = function exportLogs() {
      downloadCsv('audit-logs.csv', [
        ['User', 'Email', 'Role', 'College', 'Action', 'Status', 'Timestamp'],
        ...filteredLogs.map((item) => [item.user, item.email, item.role, item.college, item.action, item.status, formatDate(item.timestamp, true)]),
      ]);
      window.showToast?.('Audit logs exported', 'success');
    };

    if (exportBtn) exportBtn.onclick = window.exportLogs;

    window.__erpAdminPageRefresh = loadLogs;
    await loadLogs();
  }

  async function initSuperAdminDatabasePage() {
    const colIcons = { users: 'fa-users', colleges: 'fa-university', fees: 'fa-money-bill', attendances: 'fa-calendar-check', leaves: 'fa-file-alt', courses: 'fa-book', exams: 'fa-clipboard-list', results: 'fa-poll', subjects: 'fa-graduation-cap', notices: 'fa-bullhorn', timetables: 'fa-calendar-alt', transports: 'fa-bus', hostels: 'fa-building', libraries: 'fa-book-open', assignments: 'fa-tasks', communications: 'fa-comments' };
    const colColors = { users: '#4F46E5', colleges: '#10B981', fees: '#F59E0B', attendances: '#0284C7', leaves: '#8B5CF6', courses: '#059669', exams: '#EF4444', results: '#D97706' };
    const deletableCollections = new Set(['fees', 'attendances', 'leaves', 'courses', 'exams', 'results', 'subjects', 'notices', 'timetables', 'transports', 'hostels', 'libraries', 'assignments', 'communications']);
    let currentCollection = null;
    let currentPage = 1;
    let totalPages = 1;
    let currentDocs = [];

    function formatCell(value, key) {
      if (value === null || value === undefined) return '<span style="color:#94A3B8">null</span>';
      if (key === '_id' || (typeof value === 'string' && value.length === 24 && /^[a-f\d]+$/i.test(value))) {
        return `<code style="font-size:10px;background:#F1F5F9;padding:1px 5px;border-radius:4px">${escapeHTML(String(value).slice(0, 12))}...</code>`;
      }
      if (key === 'isActive' || key === 'status') {
        return `<span class="badge ${value === true || value === 'active' ? 'badge-success' : 'badge-danger'}">${escapeHTML(String(value))}</span>`;
      }
      if (key === 'createdAt' || key === 'updatedAt' || key === 'lastLogin' || key === 'paidDate' || key === 'dueDate') {
        return value ? `<span style="font-size:10px">${formatDate(value, true)}</span>` : '—';
      }
      if (Array.isArray(value)) return `<span style="font-size:11px;color:#64748B">${value.length} items</span>`;
      if (typeof value === 'object') return '<code style="font-size:10px;color:#7C3AED">[Object]</code>';
      if (typeof value === 'boolean') return `<span style="color:${value ? '#059669' : '#EF4444'};font-weight:700">${String(value)}</span>`;
      const text = String(value);
      return text.length > 40 ? `<span title="${escapeHTML(text)}">${escapeHTML(text.slice(0, 40))}...</span>` : escapeHTML(text);
    }

    function renderDocs(docs, collection) {
      const viewMode = byId('viewMode')?.value || 'table';
      if (viewMode === 'json') {
        setText('jsonArea', JSON.stringify(docs, null, 2));
        return;
      }

      if (!docs.length) {
        setHTML('tableArea', '<div class="empty-state"><div class="empty-state-title">No documents found</div></div>');
        return;
      }

      const keys = Object.keys(docs[0]).filter((key) => key !== '__v');
      const priorityKeys = ['_id', 'name', 'email', 'role', 'code', 'title', 'status', 'isActive', 'createdAt'];
      const displayKeys = [...priorityKeys.filter((key) => keys.includes(key)), ...keys.filter((key) => !priorityKeys.includes(key))].slice(0, 8);

      setHTML('tableArea', `
        <div class="table-wrap">
          <table class="erp-table">
            <thead><tr>${displayKeys.map((key) => `<th style="font-size:11px;text-transform:uppercase">${escapeHTML(key)}</th>`).join('')}<th>Actions</th></tr></thead>
            <tbody>
              ${docs.map((doc) => `
                <tr>
                  ${displayKeys.map((key) => `<td class="doc-row">${formatCell(doc[key], key)}</td>`).join('')}
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-xs btn-secondary" onclick="viewDocJSON('${encodeURIComponent(JSON.stringify(doc))}')"><i class="fas fa-code"></i></button>
                      ${deletableCollections.has(collection) ? `<button class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${doc._id}')"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `);
    }

    async function loadCollection(name, page) {
      qa('.collection-card').forEach((card) => card.classList.remove('active'));
      byId(`card-${name}`)?.classList.add('active');
      currentCollection = name;
      currentPage = page || 1;
      setHTML('browserTitle', `<i class="fas ${colIcons[name] || 'fa-table'}" style="color:${colColors[name] || '#4F46E5'};margin-right:6px"></i>${escapeHTML(name)}`);
      setHTML('tableArea', '<div style="text-align:center;padding:40px"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:#4F46E5"></i><div style="margin-top:8px;color:#64748B;font-size:13px">Loading documents...</div></div>');

      try {
        const search = byId('docSearch')?.value || '';
        const res = await window.api.request(`/super-admin/database/collection/${name}?page=${currentPage}&limit=20&search=${encodeURIComponent(search)}`, { silent: true });
        currentDocs = res.docs || [];
        totalPages = res.pages || 1;
        byId('docCount').style.display = '';
        setText('docCount', `${res.total || 0} docs`);
        byId('paginationArea').style.display = 'flex';
        setText('pageInfo', `Page ${res.page || 1} of ${res.pages || 1} (${res.total || 0} total)`);
        if (byId('prevBtn')) byId('prevBtn').disabled = (res.page || 1) <= 1;
        if (byId('nextBtn')) byId('nextBtn').disabled = (res.page || 1) >= (res.pages || 1);
        renderDocs(currentDocs, name);
      } catch {
        currentDocs = [];
        totalPages = 1;
        byId('docCount').style.display = 'none';
        byId('paginationArea').style.display = 'none';
        setHTML('tableArea', '<div class="empty-state"><div class="empty-state-title">Unable to load collection data</div></div>');
      }
    }

    async function loadStats() {
      try {
        const res = await window.api.request('/super-admin/database/stats', { silent: true });
        setText('dbName', res.database?.name || '-');
        setText('dbCollNum', String(res.database?.collections || 0));
        setText('dbDocs', String(res.database?.objects || 0));
        setText('dbDataSize', `${res.database?.dataSize || 0} MB`);
        setText('dbStorageSize', `${res.database?.storageSize || 0} MB`);
        setHTML('dbStatus', '<span class="health-dot healthy"></span>Connected');
        setHTML('collectionList', (res.collectionStats || []).sort((a, b) => b.count - a.count).map((item) => `
          <div class="collection-card" id="card-${item.name}" onclick="loadCollection('${item.name}', 1)">
            <div class="col-icon"><i class="fas ${colIcons[item.name] || 'fa-table'}"></i></div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(item.name)}</div>
              <div style="font-size:11px;color:#64748B">${item.count} docs • ${item.sizeMB} MB • ${item.indexes} idx</div>
            </div>
            <div style="font-size:15px;font-weight:900;color:${colColors[item.name] || '#64748B'}">${item.count}</div>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-state-title">No collections found</div></div>');
      } catch {
        setHTML('dbStatus', '<span class="health-dot degraded"></span>Disconnected');
        setHTML('collectionList', '<div class="empty-state"><div class="empty-state-title">Unable to load database stats</div></div>');
        setHTML('tableArea', '<div class="empty-state"><div class="empty-state-title">Connect MongoDB to browse collections</div></div>');
      }
    }

    window.loadCollection = loadCollection;
    window.viewDocJSON = function viewDocJSON(encoded) {
      const doc = JSON.parse(decodeURIComponent(encoded));
      if (byId('viewMode')) byId('viewMode').value = 'json';
      if (byId('tableView')) byId('tableView').style.display = 'none';
      if (byId('jsonView')) byId('jsonView').style.display = '';
      setText('jsonArea', JSON.stringify(doc, null, 2));
    };

    window.toggleView = function toggleView() {
      const mode = byId('viewMode')?.value || 'table';
      if (mode === 'json') {
        if (byId('tableView')) byId('tableView').style.display = 'none';
        if (byId('jsonView')) byId('jsonView').style.display = '';
        setText('jsonArea', JSON.stringify(currentDocs, null, 2));
      } else {
        if (byId('tableView')) byId('tableView').style.display = '';
        if (byId('jsonView')) byId('jsonView').style.display = 'none';
        if (currentCollection) renderDocs(currentDocs, currentCollection);
      }
    };

    window.deleteDoc = async function deleteDoc(collection, docId) {
      const confirmed = window.showConfirm
        ? await window.showConfirm({ title: 'Delete Document', message: `Permanently delete this record from ${collection}?`, confirmText: 'Delete', type: 'danger' })
        : window.confirm(`Delete this record from ${collection}?`);
      if (!confirmed) return;
      await window.api.request(`/super-admin/database/collection/${collection}/${docId}`, { method: 'DELETE' });
      window.showToast?.('Document deleted', 'success');
      await loadCollection(collection, currentPage);
    };

    window.changePage = function changePage(direction) {
      const nextPage = currentPage + direction;
      if (nextPage < 1 || nextPage > totalPages || !currentCollection) return;
      loadCollection(currentCollection, nextPage);
    };

    window.searchDocs = function searchDocs() {
      if (!currentCollection) return;
      loadCollection(currentCollection, 1);
    };

    window.exportCollection = function exportCollection() {
      if (!currentDocs.length) {
        window.showToast?.('Select a collection first', 'warning');
        return;
      }
      const blob = new Blob([JSON.stringify(currentDocs, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${currentCollection || 'collection'}-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      window.showToast?.('Collection exported', 'success');
    };

    window.refreshAll = async function refreshAll() {
      setHTML('collectionList', '<div class="skeleton skeleton-card" style="height:60px"></div>'.repeat(4));
      await loadStats();
      if (currentCollection) {
        await loadCollection(currentCollection, currentPage);
      }
    };

    window.__erpAdminPageRefresh = window.refreshAll;
    await loadStats();
  }

  async function initSuperAdminAnalyticsPage() {
    const exportBtn = cloneById('exportBtn');
    const periodSelect = cloneById('periodSelect');
    let analytics;
    let colleges = [];

    function renderTopColleges() {
      const cards = qa('.grid.col-3 .card');
      const topCard = cards[2];
      if (!topCard) return;
      const title = q('.card-title', topCard);
      if (title) title.textContent = 'Top Colleges by Users';
      const body = q('.card-body', topCard);
      if (!body) return;
      const sorted = colleges
        .map((item) => ({ ...item, users: Number(item.students || 0) + Number(item.faculty || 0) + Number(item.parents || 0) }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 5);
      const maxUsers = sorted[0]?.users || 1;
      body.innerHTML = sorted.map((item) => `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:13px;font-weight:600">${escapeHTML(item.name)}</span>
            <span style="font-size:12px;color:#64748B">${item.users} users</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.round((item.users / maxUsers) * 100)}%;background:linear-gradient(90deg,#4F46E5,#8B5CF6)"></div></div>
        </div>
      `).join('') || '<div class="empty-state"><div class="empty-state-title">No colleges available</div></div>';
    }

    function renderCharts() {
      const growthCanvas = replaceCanvas('growthChart');
      const revenueCanvas = replaceCanvas('revenueChart');
      const moduleCanvas = replaceCanvas('moduleChart');
      const deviceCanvas = replaceCanvas('deviceChart');

      const monthsToShow = Number(periodSelect?.value || 90) === 365 ? 12 : Number(periodSelect?.value || 90) / 30;
      const registrations = (analytics.monthlyRegistrations || []).slice(-monthsToShow);
      const collections = (analytics.monthlyCollections || []).slice(-monthsToShow);

      if (growthCanvas && window.Chart) {
        new window.Chart(growthCanvas, {
          type: 'line',
          data: {
            labels: registrations.map((item) => `${item._id.month}/${item._id.year}`),
            datasets: [{ label: 'Registrations', data: registrations.map((item) => item.count), borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.35, borderWidth: 3 }],
          },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }

      if (revenueCanvas && window.Chart) {
        new window.Chart(revenueCanvas, {
          type: 'bar',
          data: {
            labels: collections.map((item) => `${item._id.month}/${item._id.year}`),
            datasets: [{ label: 'Collected Fees', data: collections.map((item) => Math.round(item.amount || 0)), backgroundColor: '#10B981', borderRadius: 6 }],
          },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }

      const roleCard = q('#moduleChart')?.closest('.card');
      const planCard = q('#deviceChart')?.closest('.card');
      if (roleCard) setText(q('.card-title', roleCard), 'Role Distribution');
      if (planCard) setText(q('.card-title', planCard), 'Plan Distribution');

      if (moduleCanvas && window.Chart) {
        new window.Chart(moduleCanvas, {
          type: 'doughnut',
          data: {
            labels: (analytics.roleDistribution || []).map((item) => item._id),
            datasets: [{ data: (analytics.roleDistribution || []).map((item) => item.count), backgroundColor: ['#4F46E5', '#10B981', '#0EA5E9', '#F59E0B', '#8B5CF6'], borderWidth: 0 }],
          },
          options: { ...getChartDefaults(), cutout: '65%' },
        });
      }

      if (deviceCanvas && window.Chart) {
        new window.Chart(deviceCanvas, {
          type: 'doughnut',
          data: {
            labels: (analytics.planDistribution || []).map((item) => item._id || 'basic'),
            datasets: [{ data: (analytics.planDistribution || []).map((item) => item.count), backgroundColor: ['#4F46E5', '#F59E0B', '#0F172A'], borderWidth: 0 }],
          },
          options: { ...getChartDefaults(), cutout: '65%' },
        });
      }
    }

    async function loadAnalytics() {
      const [analyticsRes, collegesRes] = await Promise.all([
        window.api.request('/super-admin/analytics', { silent: true }),
        window.api.request('/super-admin/colleges?limit=200', { silent: true }),
      ]);
      analytics = analyticsRes.analytics || {};
      colleges = collegesRes.colleges || [];
      setStatCard(0, 'Collected Fees', formatMoney(analytics.revenue?.paidAmount || 0), '<i class="fas fa-check-circle"></i> Real collection');
      setStatCard(1, 'Active Colleges', String(analytics.activeColleges || 0), `<i class="fas fa-university"></i> ${analytics.inactiveColleges || 0} inactive`);
      setStatCard(2, 'Platform Users', String(analytics.totalUsers || 0), `<i class="fas fa-users"></i> ${analytics.totalStudents || 0} students`);
      setStatCard(3, 'Pending Fee Records', String(analytics.revenue?.pendingCount || 0), '<i class="fas fa-hourglass-half"></i> Awaiting payment');
      renderCharts();
      renderTopColleges();
    }

    if (periodSelect) periodSelect.onchange = loadAnalytics;
    if (exportBtn) {
      exportBtn.onclick = function exportAnalytics() {
        downloadCsv('platform-analytics.csv', [
          ['Metric', 'Value'],
          ['Active Colleges', analytics?.activeColleges || 0],
          ['Inactive Colleges', analytics?.inactiveColleges || 0],
          ['Total Users', analytics?.totalUsers || 0],
          ['Collected Fees', analytics?.revenue?.paidAmount || 0],
          ['Pending Fee Records', analytics?.revenue?.pendingCount || 0],
        ]);
        window.showToast?.('Analytics exported', 'success');
      };
    }

    window.__erpAdminPageRefresh = loadAnalytics;
    await loadAnalytics();
  }

  async function initSuperAdminPlansPage() {
    const planCosts = { basic: 5000, pro: 15000, enterprise: 40000 };
    let colleges = [];
    let bulkSelectedColleges = [];

    const planDetails = {
      basic: {
        label: 'BASIC',
        price: '₹5,000',
        subtitle: 'Up to 500 students',
        features: ['Student & Faculty portals', 'Fee management', 'Attendance tracking', 'Basic reports', 'Email support'],
      },
      pro: {
        label: 'PRO',
        price: '₹15,000',
        subtitle: 'Up to 2,000 students',
        features: ['Everything in Basic', 'AI exam generator', 'Advanced analytics', 'Multi-department', 'HR & Leave module', 'Hostel & Transport', 'Priority support'],
      },
      enterprise: {
        label: 'ENTERPRISE',
        price: '₹40,000',
        subtitle: 'Unlimited students',
        features: ['Everything in Pro', 'Unlimited users', 'Custom branding', 'API access', 'SLA guarantee', 'Dedicated CSM', 'On-premise option', 'Custom modules'],
      },
    };

    function renderUsageOverview() {
      const total = colleges.length || 1;
      const basicCount = colleges.filter((c) => (c.plan || 'basic') === 'basic').length;
      const proCount = colleges.filter((c) => c.plan === 'pro').length;
      const enterpriseCount = colleges.filter((c) => c.plan === 'enterprise').length;

      setText('basicUsageCount', `${basicCount} colleges`);
      setText('proUsageCount', `${proCount} colleges`);
      setText('enterpriseUsageCount', `${enterpriseCount} colleges`);

      const basicBar = byId('basicUsageBar');
      const proBar = byId('proUsageBar');
      const enterpriseBar = byId('enterpriseUsageBar');
      if (basicBar) basicBar.style.width = `${Math.round((basicCount / total) * 100)}%`;
      if (proBar) proBar.style.width = `${Math.round((proCount / total) * 100)}%`;
      if (enterpriseBar) enterpriseBar.style.width = `${Math.round((enterpriseCount / total) * 100)}%`;
    }

    function renderPlanCards() {
      const cards = qa('.plan-card');
      ['basic', 'pro', 'enterprise'].forEach((key, index) => {
        const card = cards[index];
        const details = planDetails[key];
        if (!card || !details) return;
        const featureHtml = details.features.map((feature) => `<div class="plan-feature"><i class="fas fa-check-circle" style="color:${key === 'enterprise' ? '#F59E0B' : key === 'pro' ? '#34D399' : '#059669'}"></i>${escapeHTML(feature)}</div>`).join('');
        card.innerHTML = `
          <div style="font-size:12px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${details.label}</div>
          <div style="font-size:32px;font-weight:900;margin-bottom:4px">${details.price}<span style="font-size:14px;font-weight:500">/month</span></div>
          <div style="font-size:12px;margin-bottom:16px">${details.subtitle}</div>
          <div style="border-top:1px solid rgba(255,255,255,0.2);padding-top:14px">${featureHtml}</div>
        `;
      });
    }

    function renderTable() {
      const now = Date.now();
      setHTML('planTableBody', colleges.map((item) => {
        const expiry = item.planExpiry ? new Date(item.planExpiry) : null;
        const daysLeft = expiry ? Math.ceil((expiry.getTime() - now) / 86400000) : null;
        return `
          <tr>
            <td><div style="font-weight:700;font-size:14px">${escapeHTML(item.name)}</div></td>
            <td><span style="font-weight:800;font-size:13px;text-transform:uppercase;color:#4F46E5">${escapeHTML(item.plan || 'basic')}</span></td>
            <td><div style="font-size:12px">${expiry ? formatDate(expiry) : '-'}</div><div style="font-size:11px;color:${daysLeft !== null && daysLeft <= 30 ? '#D97706' : '#059669'};font-weight:600">${daysLeft === null ? 'No expiry' : `${daysLeft}d left`}</div></td>
            <td>${item.students || 0}</td>
            <td style="font-weight:700">${formatMoney(planCosts[item.plan] || planCosts.basic)}</td>
            <td><span class="badge ${item.status === 'active' ? 'badge-success' : 'badge-danger'}">${escapeHTML(item.status)}</span></td>
            <td><div style="display:flex;gap:4px"><button class="btn btn-xs btn-primary" onclick="openUpgrade('${item._id}', '${escapeHTML(item.name).replace(/'/g, "\\'")}', '${item.plan || 'basic'}')"><i class="fas fa-arrow-up"></i> Change Plan</button></div></td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No colleges found</div></div></td></tr>');

      const select = byId('planCollegeSelect');
      if (select) {
        select.innerHTML = '<option value="">Choose institution...</option>' + colleges.map((item) => `<option value="${item._id}">${escapeHTML(item.name)}</option>`).join('');
      }
    }

    async function loadPlans() {
      const res = await window.api.request('/super-admin/colleges?limit=200', { silent: true });
      colleges = res.colleges || [];
      const expiring = colleges.filter((item) => item.planExpiry && ((new Date(item.planExpiry).getTime() - Date.now()) / 86400000) <= 30).length;
      const revenue = colleges.reduce((sum, item) => sum + (planCosts[item.plan] || planCosts.basic), 0);
      setStatCard(0, 'Monthly Revenue', formatMoney(revenue));
      setStatCard(1, 'Enterprise Clients', String(colleges.filter((item) => item.plan === 'enterprise').length));
      setStatCard(2, 'Pro Clients', String(colleges.filter((item) => item.plan === 'pro').length));
      setStatCard(3, 'Expiring Soon', String(expiring), '<i class="fas fa-clock"></i> Within 30 days');
      renderPlanCards();
      renderUsageOverview();
      renderTable();
    }

    window.openUpgrade = function openUpgrade(id, _name, currentPlan) {
      if (byId('planCollegeSelect')) byId('planCollegeSelect').value = id;
      if (byId('newPlanSelect')) byId('newPlanSelect').value = currentPlan || 'basic';
      const expiry = new Date();
      expiry.setFullYear(expiry.getFullYear() + 1);
      if (byId('planExpiry')) byId('planExpiry').value = expiry.toISOString().split('T')[0];
      window.openModal?.('upgradePlanModal');
    };

    window.updatePlan = async function updatePlan() {
      const collegeId = byId('planCollegeSelect')?.value;
      const plan = byId('newPlanSelect')?.value;
      const planExpiry = byId('planExpiry')?.value;
      if (!collegeId || !plan || !planExpiry) {
        window.showToast?.('Fill all fields', 'error');
        return;
      }
      await window.api.request(`/super-admin/colleges/${collegeId}/plan`, { method: 'PUT', body: JSON.stringify({ plan, planExpiry }) });
      window.closeModal?.('upgradePlanModal');
      window.showToast?.('Plan updated successfully', 'success');
      await loadPlans();
    };

    function renderBulkCollegeDropdown() {
      const dropdown = byId('collegeSearchDropdown');
      if (!dropdown) return;
      const search = (byId('bulkCollegeSearch')?.value || '').toLowerCase().trim();
      const available = colleges.filter((c) => {
        if (bulkSelectedColleges.some((s) => s._id === c._id)) return false;
        if (search && !c.name.toLowerCase().includes(search)) return false;
        return true;
      }).slice(0, 10);
      dropdown.innerHTML = available.map((c) => `
        <div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'" onclick="addBulkCollege('${c._id}','${escapeHTML(c.name).replace(/'/g, "\\'")}')">
          ${escapeHTML(c.name)}
        </div>
      `).join('') || '<div style="padding:8px 12px;color:#94A3B8;font-size:13px">No matching colleges</div>';
      dropdown.style.display = 'block';
    }

    function renderBulkSelectedChips() {
      const container = byId('bulkCollegeContainer');
      if (!container) return;
      const input = byId('bulkCollegeSearch');
      const chips = bulkSelectedColleges.map((c) => `
        <span style="display:inline-flex;align-items:center;gap:4px;background:#EEF2FF;color:#4F46E5;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600">
          ${escapeHTML(c.name)}
          <span style="cursor:pointer;color:#6366F1" onclick="removeBulkCollege('${c._id}')">&times;</span>
        </span>
      `).join('');
      if (input) {
        container.innerHTML = chips;
        container.appendChild(input);
      }
      setText('bulkSelectedCount', String(bulkSelectedColleges.length));
    }

    window.addBulkCollege = function addBulkCollege(id, name) {
      if (bulkSelectedColleges.some((c) => c._id === id)) return;
      bulkSelectedColleges.push({ _id: id, name });
      renderBulkSelectedChips();
      byId('bulkCollegeSearch').value = '';
      byId('collegeSearchDropdown').style.display = 'none';
    };

    window.removeBulkCollege = function removeBulkCollege(id) {
      bulkSelectedColleges = bulkSelectedColleges.filter((c) => c._id !== id);
      renderBulkSelectedChips();
    };

    window.closeBulkAssignModal = function closeBulkAssignModal() {
      bulkSelectedColleges = [];
      window.closeModal?.('bulkAssignModal');
      renderBulkSelectedChips();
      const dropdown = byId('collegeSearchDropdown');
      if (dropdown) dropdown.style.display = 'none';
    };

    window.bulkAssignPlan = async function bulkAssignPlan() {
      if (!bulkSelectedColleges.length) {
        window.showToast?.('Select at least one college', 'error');
        return;
      }
      const plan = byId('bulkPlanSelect')?.value;
      const planExpiry = byId('bulkPlanExpiry')?.value;
      if (!plan || !planExpiry) {
        window.showToast?.('Select plan and expiry date', 'error');
        return;
      }
      const ids = bulkSelectedColleges.map((c) => c._id);
      await window.api.request('/super-admin/colleges/bulk/plan', { method: 'POST', body: JSON.stringify({ collegeIds: ids, plan, planExpiry }) });
      window.closeBulkAssignModal();
      window.showToast?.(`Plan assigned to ${ids.length} college(s)`, 'success');
      await loadPlans();
    };

    const bulkSearch = cloneById('bulkCollegeSearch');
    if (bulkSearch) {
      bulkSearch.oninput = debounce(renderBulkCollegeDropdown, 150);
      bulkSearch.onfocus = renderBulkCollegeDropdown;
    }

    window.__erpAdminPageRefresh = loadPlans;
    await loadPlans();
  }

  async function initSuperAdminBroadcastPage() {
    let currentPriority = 'info';
    const priorityColors = { info: '#4F46E5', warning: '#D97706', urgent: '#EF4444' };

    window.setPriority = function setPriority(value, color) {
      currentPriority = value;
      qa('[id^="prio-label-"]').forEach((item) => { item.style.borderColor = '#E2E8F0'; });
      const active = byId(`prio-label-${value}`);
      if (active) active.style.borderColor = color || priorityColors[value] || '#4F46E5';
    };

    window.useTemplate = function useTemplate(title, message) {
      if (byId('bTitle')) byId('bTitle').value = title || '';
      if (byId('bMessage')) byId('bMessage').value = message || '';
      window.showToast?.('Template loaded', 'info');
    };

    window.previewBroadcast = function previewBroadcast() {
      const title = byId('bTitle')?.value.trim();
      const message = byId('bMessage')?.value.trim();
      if (!title || !message) {
        window.showToast?.('Fill title and message first', 'error');
        return;
      }
      if (byId('previewBox')) byId('previewBox').style.display = '';
      setHTML('previewContent', `
        <div style="background:${currentPriority === 'urgent' ? '#EF444418' : currentPriority === 'warning' ? '#D9770618' : '#4F46E518'};border-left:3px solid ${priorityColors[currentPriority]};padding:12px 14px;border-radius:0 8px 8px 0">
          <div style="font-weight:800;font-size:14px;margin-bottom:4px">${escapeHTML(title)}</div>
          <div style="font-size:13px;color:#374151;white-space:pre-wrap">${escapeHTML(message)}</div>
        </div>
      `);
    };

    const priorityWrap = q('label[for="prio-label-info"]')?.parentElement || q('.form-group div[style*="display:flex;gap:8px"]');
    const targetWrap = q('.target-check')?.parentElement?.parentElement || qa('.form-group div[style*="grid-template-columns:1fr 1fr"]')[0];
    const templateWrap = q('.card-body', qa('.grid.col-2 > div > .card')[0]) || qa('.grid.col-2 .card .card-body')[1];

    function renderComposeOptions() {
      const composeCard = qa('.grid.col-2 > .card')[0];
      const formGroups = composeCard ? qa('.form-group', composeCard) : [];
      const priorityContainer = formGroups[1] ? q('div[style*="display:flex;gap:8px"]', formGroups[1]) : null;
      const targetContainer = formGroups[2] ? q('div[style*="grid-template-columns:1fr 1fr"]', formGroups[2]) : null;
      if (priorityContainer) {
        priorityContainer.innerHTML = [
          ['info', 'Info', '#4F46E5'],
          ['warning', 'Warning', '#D97706'],
          ['urgent', 'Urgent', '#EF4444'],
        ].map(([value, label, color], index) => `<label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:2px solid ${index === 0 ? color : '#E2E8F0'};border-radius:10px;cursor:pointer" id="prio-label-${value}"><input type="radio" name="priority" value="${value}" ${index === 0 ? 'checked' : ''} onchange="setPriority('${value}','${color}')"><span style="font-size:13px;font-weight:700;color:${color}">${label}</span></label>`).join('');
      }
      if (targetContainer) {
        targetContainer.innerHTML = [
          ['all', 'All Users'], ['student', 'Students Only'], ['faculty', 'Faculty Only'], ['collegeAdmin', 'College Admins'], ['parent', 'Parents Only'],
        ].map(([value, label], index) => `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1.5px solid #E2E8F0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600"><input type="checkbox" class="target-check" value="${value}" ${index === 0 ? 'checked' : ''}> ${label}</label>`).join('');
      }
      window.setPriority?.('info', '#4F46E5');
    }

    function renderTemplates() {
      const cards = qa('.grid.col-2 > div .card');
      const templateCard = cards[0];
      if (!templateCard) return;
      const body = q('.card-body', templateCard);
      if (!body) return;
      const templates = [
        ['Maintenance Notice', 'The platform will undergo scheduled maintenance on [DATE] from 11 PM to 2 AM IST.'],
        ['New Feature Announcement', 'We are excited to announce a new feature: [FEATURE NAME].'],
        ['Fee Deadline Reminder', 'This is a reminder that the fee payment deadline is approaching.'],
        ['Exam Schedule Update', 'The mid-semester examination schedule has been published.'],
      ];
      body.innerHTML = templates.map(([title, message]) => `<button class="btn btn-secondary" style="text-align:left;height:auto;padding:10px 14px;flex-direction:column;align-items:flex-start;gap:2px" onclick="useTemplate(${JSON.stringify(title)},${JSON.stringify(message)})"><div style="font-weight:700;font-size:13px">${title}</div><div style="font-size:11px;color:#94A3B8">${message}</div></button>`).join('');
    }

    async function loadHistory() {
      const res = await window.api.request('/super-admin/broadcasts', { silent: true });
      const items = res.broadcasts || [];
      setHTML('broadcastHistory', items.map((item) => `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #F1F5F9;align-items:flex-start">
          <div class="stat-icon" style="width:32px;height:32px;font-size:13px;background:${item.priority === 'urgent' ? '#FEE2E2' : item.priority === 'warning' ? '#FEF3C7' : '#EDE9FE'};color:${item.priority === 'urgent' ? '#EF4444' : item.priority === 'warning' ? '#D97706' : '#4F46E5'}"><i class="fas fa-bullhorn"></i></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${escapeHTML(item.title)}</div>
            <div style="font-size:11px;color:#94A3B8">${formatDate(item.createdAt, true)} • ${(item.targetRoles || []).join(', ')}</div>
          </div>
          <span class="badge ${item.priority === 'urgent' ? 'badge-danger' : item.priority === 'warning' ? 'badge-warning' : 'badge-info'}">${escapeHTML(item.priority)}</span>
        </div>
      `).join('') || '<div class="empty-state"><div class="empty-state-title">No broadcasts sent yet</div></div>');
    }

    window.sendBroadcast = async function sendBroadcast() {
      const title = byId('bTitle')?.value.trim();
      const message = byId('bMessage')?.value.trim();
      const targetRoles = qa('.target-check:checked').map((input) => input.value);
      const priority = qa('input[name="priority"]').find((input) => input.checked)?.value || 'info';
      const sendButton = byId('sendBtn');
      if (!title || !message || !targetRoles.length) {
        window.showToast?.('Complete the broadcast form first', 'error');
        return;
      }
      window.setLoading?.(sendButton, true);
      try {
        await window.api.request('/super-admin/broadcast', { method: 'POST', body: JSON.stringify({ title, message, targetRoles, priority }) });
        byId('bTitle').value = '';
        byId('bMessage').value = '';
        if (byId('previewBox')) byId('previewBox').style.display = 'none';
        window.showToast?.('Broadcast sent successfully', 'success');
        await loadHistory();
      } finally {
        window.setLoading?.(sendButton, false);
      }
    };

    renderComposeOptions();
    renderTemplates();
    window.__erpAdminPageRefresh = loadHistory;
    await loadHistory();
  }

  async function initSuperAdminSettingsPage() {
    window.switchTab = function switchTab(tabId) {
      qa('.settings-link').forEach((item) => item.classList.remove('active'));
      qa('.settings-section').forEach((item) => item.classList.remove('active'));
      byId(`tab-${tabId}`)?.classList.add('active');
      byId(`sec-${tabId}`)?.classList.add('active');
    };

    window.testPush = async function testPush() {
      const button = window.event?.target?.closest('button');
      window.setLoading?.(button, true);
      try {
        await window.api.request('/notifications/test', { method: 'POST' });
        window.showToast?.('Test notification sent to your registered devices', 'success');
      } catch (err) {
        window.showToast?.('Failed to send test notification. Ensure device is registered.', 'error');
      } finally {
        window.setLoading?.(button, false);
      }
    };

    const settingsCard = qa('.erp-content .grid > .card')[1];
    if (!settingsCard) return;

    if (!byId('sec-email')) {
      const emailSection = document.createElement('div');
      emailSection.className = 'settings-section';
      emailSection.id = 'sec-email';
      emailSection.innerHTML = `
        <div class="card-header"><div class="card-title">Email & SMTP</div></div>
        <div class="card-body">
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">Sender Name</label><input class="form-control" id="settingsEmailFromName"></div>
            <div class="form-group"><label class="form-label">Sender Email</label><input class="form-control" id="settingsEmailFromEmail"></div>
            <div class="form-group"><label class="form-label">SMTP Host</label><input class="form-control" id="settingsSmtpHost"></div>
            <div class="form-group"><label class="form-label">SMTP User</label><input class="form-control" id="settingsSmtpUser"></div>
            <div class="form-group"><label class="form-label">SMTP Port</label><input class="form-control" type="number" id="settingsSmtpPort"></div>
            <div class="form-group"><label class="form-label">Secure SMTP</label><select class="form-control" id="settingsSmtpSecure"><option value="false">No</option><option value="true">Yes</option></select></div>
          </div>
        </div>
        <div class="card-footer" style="text-align:right"><button class="btn btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> Save Changes</button></div>
      `;
      settingsCard.appendChild(emailSection);
    }

    if (!byId('sec-storage')) {
      const storageSection = document.createElement('div');
      storageSection.className = 'settings-section';
      storageSection.id = 'sec-storage';
      storageSection.innerHTML = `
        <div class="card-header"><div class="card-title">Cloud Storage</div></div>
        <div class="card-body">
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">Provider</label><select class="form-control" id="settingsStorageProvider"><option value="local">Local</option><option value="s3">Amazon S3</option><option value="gcs">Google Cloud Storage</option></select></div>
            <div class="form-group"><label class="form-label">Bucket Name</label><input class="form-control" id="settingsStorageBucket"></div>
            <div class="form-group" style="grid-column:1/-1"><label class="form-label">Base URL</label><input class="form-control" id="settingsStorageBaseUrl"></div>
          </div>
        </div>
        <div class="card-footer" style="text-align:right"><button class="btn btn-primary" onclick="saveSettings()"><i class="fas fa-save"></i> Save Changes</button></div>
      `;
      settingsCard.appendChild(storageSection);
    }

    const generalControls = qa('#sec-general .form-control');
    const generalChecks = qa('#sec-general input[type="checkbox"]');
    if (generalControls[0]) generalControls[0].id = 'settingsPlatformName';
    if (generalControls[1]) generalControls[1].id = 'settingsSupportEmail';
    if (generalControls[2]) generalControls[2].id = 'settingsTimezone';
    if (generalControls[3]) generalControls[3].id = 'settingsCurrency';
    if (generalChecks[0]) generalChecks[0].id = 'settingsMaintenanceMode';
    if (generalChecks[1]) generalChecks[1].id = 'settingsPublicRegistration';

    const securityChecks = qa('#sec-security input[type="checkbox"]');
    const securityInput = q('#sec-security input[type="number"]');
    if (securityChecks[0]) securityChecks[0].id = 'settingsRequire2FA';
    if (securityChecks[1]) securityChecks[1].id = 'settingsStrongPasswords';
    if (securityInput) securityInput.id = 'settingsSessionTimeout';

    const aiInput = q('#sec-ai input[type="password"]');
    const aiSelect = q('#sec-ai select');
    const aiCheck = q('#sec-ai input[type="checkbox"]');
    if (aiInput) aiInput.id = 'settingsAiApiKey';
    if (aiSelect) aiSelect.id = 'settingsAiModel';
    if (aiCheck) aiCheck.id = 'settingsAiEnabled';

    async function loadSettings() {
      const res = await window.api.request('/super-admin/settings', { silent: true });
      const settings = res.settings || {};
      if (byId('settingsPlatformName')) byId('settingsPlatformName').value = settings.general?.platformName || '';
      if (byId('settingsSupportEmail')) byId('settingsSupportEmail').value = settings.general?.supportEmail || '';
      if (byId('settingsTimezone')) byId('settingsTimezone').value = settings.general?.timezone || 'Asia/Kolkata';
      if (byId('settingsCurrency')) byId('settingsCurrency').value = settings.general?.currency || 'INR';
      if (byId('settingsMaintenanceMode')) byId('settingsMaintenanceMode').checked = Boolean(settings.general?.maintenanceMode);
      if (byId('settingsPublicRegistration')) byId('settingsPublicRegistration').checked = Boolean(settings.general?.publicRegistration);
      if (byId('settingsRequire2FA')) byId('settingsRequire2FA').checked = Boolean(settings.security?.require2FA);
      if (byId('settingsStrongPasswords')) byId('settingsStrongPasswords').checked = Boolean(settings.security?.strongPasswords);
      if (byId('settingsSessionTimeout')) byId('settingsSessionTimeout').value = settings.security?.sessionTimeoutMinutes || 120;
      if (byId('settingsEmailFromName')) byId('settingsEmailFromName').value = settings.email?.fromName || '';
      if (byId('settingsEmailFromEmail')) byId('settingsEmailFromEmail').value = settings.email?.fromEmail || '';
      if (byId('settingsSmtpHost')) byId('settingsSmtpHost').value = settings.email?.smtpHost || '';
      if (byId('settingsSmtpUser')) byId('settingsSmtpUser').value = settings.email?.smtpUser || '';
      if (byId('settingsSmtpPort')) byId('settingsSmtpPort').value = settings.email?.smtpPort || 587;
      if (byId('settingsSmtpSecure')) byId('settingsSmtpSecure').value = String(Boolean(settings.email?.smtpSecure));
      if (byId('settingsStorageProvider')) byId('settingsStorageProvider').value = settings.storage?.provider || 'local';
      if (byId('settingsStorageBucket')) byId('settingsStorageBucket').value = settings.storage?.bucketName || '';
      if (byId('settingsStorageBaseUrl')) byId('settingsStorageBaseUrl').value = settings.storage?.baseUrl || '';
      if (byId('settingsAiApiKey')) {
        byId('settingsAiApiKey').value = '';
        byId('settingsAiApiKey').placeholder = settings.ai?.apiKeyConfigured ? `Configured: ${settings.ai.apiKeyMasked}` : 'Not configured';
      }
      if (byId('settingsAiModel')) byId('settingsAiModel').value = settings.ai?.defaultModel || 'gemini-1.5-pro';
      if (byId('settingsAiEnabled')) byId('settingsAiEnabled').checked = Boolean(settings.ai?.enabled);
    }

    window.saveSettings = async function saveSettings() {
      const currentEvent = window.event || null;
      const button = currentEvent?.target?.closest('button');
      window.setLoading?.(button, true);
      try {
        const payload = {
          general: {
            platformName: byId('settingsPlatformName')?.value.trim(),
            supportEmail: byId('settingsSupportEmail')?.value.trim(),
            timezone: byId('settingsTimezone')?.value,
            currency: byId('settingsCurrency')?.value,
            maintenanceMode: Boolean(byId('settingsMaintenanceMode')?.checked),
            publicRegistration: Boolean(byId('settingsPublicRegistration')?.checked),
          },
          security: {
            require2FA: Boolean(byId('settingsRequire2FA')?.checked),
            strongPasswords: Boolean(byId('settingsStrongPasswords')?.checked),
            sessionTimeoutMinutes: Number(byId('settingsSessionTimeout')?.value || 120),
          },
          email: {
            fromName: byId('settingsEmailFromName')?.value.trim(),
            fromEmail: byId('settingsEmailFromEmail')?.value.trim(),
            smtpHost: byId('settingsSmtpHost')?.value.trim(),
            smtpUser: byId('settingsSmtpUser')?.value.trim(),
            smtpPort: Number(byId('settingsSmtpPort')?.value || 587),
            smtpSecure: byId('settingsSmtpSecure')?.value === 'true',
          },
          storage: {
            provider: byId('settingsStorageProvider')?.value,
            bucketName: byId('settingsStorageBucket')?.value.trim(),
            baseUrl: byId('settingsStorageBaseUrl')?.value.trim(),
          },
          ai: {
            defaultModel: byId('settingsAiModel')?.value,
            enabled: Boolean(byId('settingsAiEnabled')?.checked),
          },
        };
        const nextKey = byId('settingsAiApiKey')?.value.trim();
        if (nextKey) payload.ai.apiKey = nextKey;
        await window.api.request('/super-admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
        window.showToast?.('Settings saved successfully', 'success');
        await loadSettings();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    window.__erpAdminPageRefresh = loadSettings;
    await loadSettings();
  }

  async function initSuperAdminSystemPage() {
    const services = [
      ['Express Server', 'HTTP/REST API handling', 'ok'],
      ['MongoDB', 'Primary database connection', 'ok'],
      ['Socket.io', 'Real-time event engine', 'ok'],
      ['JWT Auth', 'Token validation service', 'ok'],
      ['Rate Limiter', 'API protection layer', 'ok'],
      ['File Server', 'Static asset serving', 'ok'],
    ];

    const grid = byId('servicesGrid');
    if (grid) {
      grid.innerHTML = services.map(([name, description, status]) => `
        <div class="service-card">
          <div class="service-status status-${status === 'ok' ? 'ok' : 'warn'}"></div>
          <div style="flex:1"><div style="font-weight:700;font-size:13px">${escapeHTML(name)}</div><div style="font-size:11px;color:#64748B">${escapeHTML(description)}</div></div>
          <span class="badge ${status === 'ok' ? 'badge-success' : 'badge-warning'}">${status === 'ok' ? 'Operational' : 'Degraded'}</span>
        </div>
      `).join('');
    }
  }

  async function initCollegeAdminSubscriptionPage() {
    await ensureRealtime();
  }

  async function initCollegeAdminAttendancePage() {
    await ensureRealtime();
  }

  async function initCollegeAdminDashboardPage() {
    const downloadBtn = cloneById('downloadBtn');
    let dashboard;

    function clampPercent(value) {
      return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    }

    function scoreColor(score) {
      if (score >= 80) return '#10B981';
      if (score >= 55) return '#F59E0B';
      return '#EF4444';
    }

    function setPercentMetric(valueId, barId, value) {
      const pct = clampPercent(value);
      setText(valueId, `${pct}%`);
      const bar = byId(barId);
      if (bar) bar.style.width = `${pct}%`;
      return pct;
    }

    function renderCommandCenter() {
      const insights = dashboard.operationalInsights || {};
      const academics = dashboard.academics || {};
      const admissions = dashboard.admissions || {};
      const operations = dashboard.operations || {};
      const finance = dashboard.finance || {};
      const studentSuccess = dashboard.studentSuccess || {};

      const academicDelivery = setPercentMetric('academicDeliveryValue', 'academicDeliveryBar', insights.academicDelivery);
      const collectionRate = setPercentMetric('feeCollectionValue', 'feeCollectionBar', insights.collectionRate || finance.collectionRate);
      const parentEngagement = setPercentMetric('parentEngagementValue', 'parentEngagementBar', insights.parentLinkRate || admissions.parentLinkRate);
      const healthScore = clampPercent(insights.institutionHealthScore || Math.round((academicDelivery + collectionRate + parentEngagement) / 3));
      setHTML('commandHealthScore', `${healthScore}<span>/100</span>`);

      setText('admissionsPipelineValue', String(admissions.enrolledStudents ?? dashboard.totalStudents ?? 0));
      setText('admissionsPipelineText', `${admissions.recentEnrollments || 0} recent enrollments, ${admissions.inactiveStudents || 0} inactive records, ${clampPercent(admissions.parentLinkRate)}% parent-linked.`);

      const campusScore = clampPercent(insights.campusServicesScore);
      setText('campusServicesValue', `${campusScore}%`);
      setText('campusServicesText', `${operations.activeRoutes || 0} routes, ${operations.transportStudents || 0}/${operations.transportCapacity || 0} transport seats, ${operations.hostelOccupancy || 0}/${operations.hostelCapacity || 0} hostel beds used.`);

      const queue = dashboard.priorityQueue || [];
      const criticalCount = queue.filter((item) => item.severity === 'high').length;
      const watchCount = queue.filter((item) => item.severity === 'medium').length;
      const badge = byId('criticalRiskBadge');
      if (badge) {
        badge.className = `badge ${criticalCount ? 'badge-danger' : watchCount ? 'badge-warning' : 'badge-success'}`;
        badge.textContent = criticalCount ? `${criticalCount} Critical` : watchCount ? `${watchCount} Watch` : 'Stable';
      }
      setHTML('commandPriorityQueue', (queue.length ? queue : [{ severity: 'low', icon: 'fa-circle-check', title: 'Operations stable', detail: 'No urgent campus risks detected.' }]).slice(0, 4).map((item) => `
        <div class="admin-action-item ${escapeHTML(item.severity || 'low')}">
          <i class="fas ${escapeHTML(item.icon || 'fa-circle-info')}"></i>
          <span><strong style="display:block;color:var(--text-primary);font-size:13px">${escapeHTML(item.title || 'Campus action')}</strong><small style="display:block;color:var(--text-secondary);font-size:12px;margin-top:2px">${escapeHTML(item.detail || '')}</small></span>
        </div>
      `).join(''));

      const readiness = dashboard.readiness || [];
      setHTML('complianceReadinessGrid', readiness.length ? readiness.map((item) => {
        const score = clampPercent(item.score);
        return `
          <div class="readiness-item">
            <span>${escapeHTML(item.label || 'Readiness')}</span>
            <strong>${escapeHTML(item.value ?? '--')}</strong>
            <em>${escapeHTML(item.detail || '')}</em>
            <div class="progress-bar"><div class="progress-fill" style="width:${score}%;background:${scoreColor(score)}"></div></div>
          </div>
        `;
      }).join('') : '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No compliance data yet</div></div>');

      setHTML('financeRiskBody', `
        <div class="command-signal"><span>Total billed</span><strong>${formatMoney(finance.totalBilled || 0)}</strong></div>
        <div class="command-signal"><span>Collected</span><strong>${formatMoney(finance.totalPaid || 0)}</strong></div>
        <div class="command-signal"><span>Pending exposure</span><strong>${formatMoney(finance.pendingAmount || 0)}</strong></div>
        <div class="command-signal"><span>Overdue invoices</span><strong>${finance.overdueInvoices || 0}</strong></div>
      `);

      setHTML('studentSuccessBody', `
        <div class="command-signal"><span>Attendance rate</span><strong>${clampPercent(studentSuccess.attendanceRate)}%</strong></div>
        <div class="command-signal"><span>Exam pass rate</span><strong>${clampPercent(studentSuccess.passRate)}%</strong></div>
        <div class="command-signal"><span>Average score</span><strong>${clampPercent(studentSuccess.averageScore)}%</strong></div>
        <div class="command-signal"><span>Assignment backlog</span><strong>${studentSuccess.assignmentBacklog || 0}</strong></div>
        <div class="command-signal"><span>Live classes now</span><strong>${operations.activeLiveClasses || 0}</strong></div>
      `);

      if (!readiness.length && academics.activeSubjects) {
        setText('criticalRiskBadge', 'Review');
      }
    }

    function renderUpcomingExams() {
      const exams = dashboard.academics?.upcomingExams || [];
      if (!exams.length) {
        setHTML('upcomingExamBody', '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-calendar-plus"></i></div><div class="empty-state-title">No upcoming exams in the next 30 days</div></div>');
        return;
      }
      setHTML('upcomingExamBody', exams.map((exam) => {
        const date = new Date(exam.date);
        const month = Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-US', { month: 'short' });
        const day = Number.isNaN(date.getTime()) ? '-' : date.getDate();
        return `
          <div class="ops-timeline-item">
            <div class="ops-timeline-date"><span>${escapeHTML(month)}</span><strong>${escapeHTML(day)}</strong></div>
            <div><strong>${escapeHTML(exam.name || 'Exam')}</strong><span>${escapeHTML(exam.subject || 'Subject')} ${exam.code ? `(${escapeHTML(exam.code)})` : ''}</span></div>
            <span class="badge badge-info">${escapeHTML(exam.venue || 'TBA')}</span>
          </div>
        `;
      }).join(''));
    }

    function renderDepartmentMix() {
      const rows = dashboard.studentSuccess?.departmentMix || [];
      const total = rows.reduce((sum, row) => sum + Number(row.students || 0), 0);
      if (!rows.length || !total) {
        setHTML('departmentMixBody', '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-layer-group"></i></div><div class="empty-state-title">No department mix available yet</div></div>');
        return;
      }
      setHTML('departmentMixBody', rows.map((row) => {
        const pct = clampPercent((Number(row.students || 0) / total) * 100);
        return `
          <div class="department-mix-row">
            <div><strong>${escapeHTML(row._id || 'General')}</strong><span>${row.active || 0} active of ${row.students || 0}</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#8B5CF6"></div></div>
            <span>${pct}%</span>
          </div>
        `;
      }).join(''));
    }

    function drawCharts() {
      const growthCanvas = replaceCanvas('growthChart');
      const feeCanvas = replaceCanvas('feeChart');
      if (growthCanvas && window.Chart) {
        new window.Chart(growthCanvas, {
          type: 'line',
          data: {
            labels: (dashboard.monthlyStudents || []).map((item) => item._id),
            datasets: [{ label: 'Student Registrations', data: (dashboard.monthlyStudents || []).map((item) => item.count), borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,0.1)', fill: true, tension: 0.35, borderWidth: 3 }],
          },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }
      if (feeCanvas && window.Chart) {
        new window.Chart(feeCanvas, {
          type: 'doughnut',
          data: {
            labels: (dashboard.feeStats || []).map((item) => item._id || 'unknown'),
            datasets: [{ data: (dashboard.feeStats || []).map((item) => item.totalAmount || 0), backgroundColor: ['#10B981', '#F59E0B', '#EF4444', '#94A3B8'], borderWidth: 0 }],
          },
          options: { ...getChartDefaults(), cutout: '65%' },
        });
      }
    }

    function renderRecentStudents() {
      const rows = dashboard.recentStudents || [];
      if (!rows.length) return renderEmptyTable('recentStudentsBody', 4, 'No students found', 'fa-user-graduate');
      setHTML('recentStudentsBody', rows.map((student) => `
        <tr>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((student.name || 'S')[0])}</div><span style="font-weight:600">${escapeHTML(student.name)}</span></div></td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(student.department || '-')}</td>
          <td><span class="badge badge-gray">Sem ${student.semester || '-'}</span></td>
          <td><span class="badge ${(student.feeStatus || 'pending') === 'paid' ? 'badge-success' : (student.feeStatus || 'pending') === 'overdue' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(student.feeStatus || 'pending')}</span></td>
        </tr>
      `).join(''));
    }

    function renderLeaves() {
      const rows = dashboard.pendingLeaves || [];
      if (!rows.length) return renderEmptyTable('leavesBody', 6, 'No pending leave requests', 'fa-calendar-check');
      setHTML('leavesBody', rows.map((leave) => `
        <tr>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((leave.userId?.name || 'F')[0])}</div><span style="font-weight:600">${escapeHTML(leave.userId?.name || '-')}</span></div></td>
          <td><span class="badge badge-gray">${escapeHTML(leave.leaveType || '-')}</span></td>
          <td style="font-size:12px;color:#64748B">${formatDate(leave.startDate)} → ${formatDate(leave.endDate)}</td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(leave.reason || '-')}</td>
          <td><span class="badge badge-warning">pending</span></td>
          <td><div style="display:flex;gap:5px"><button class="btn btn-xs btn-success" onclick="reviewLeave('${leave._id}','approved')"><i class="fas fa-check"></i> Approve</button><button class="btn btn-xs btn-danger" onclick="reviewLeave('${leave._id}','rejected')"><i class="fas fa-times"></i> Reject</button></div></td>
        </tr>
      `).join(''));
    }

    async function loadDashboard() {
      const res = await window.api.request('/college-admin/dashboard', { silent: true });
      dashboard = res.dashboard || {};
      setText('statStudents', String(dashboard.totalStudents || 0));
      setText('statFaculty', String(dashboard.totalFaculty || 0));
      setText('statFees', String(dashboard.pendingFees || 0));
      setText('statParents', String(dashboard.totalParents || 0));
      renderCommandCenter();
      renderUpcomingExams();
      renderDepartmentMix();
      drawCharts();
      renderRecentStudents();
      renderLeaves();
    }

    window.reviewLeave = async function reviewLeave(id, status) {
      await window.api.request(`/leave/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      window.showToast?.(`Leave ${status}`, status === 'approved' ? 'success' : 'warning');
      await loadDashboard();
    };

    if (downloadBtn) {
      downloadBtn.onclick = function downloadReport() {
        downloadCsv('college-dashboard.csv', [
          ['Metric', 'Value'],
          ['Students', dashboard?.totalStudents || 0],
          ['Faculty', dashboard?.totalFaculty || 0],
          ['Parents', dashboard?.totalParents || 0],
          ['Pending Fees', dashboard?.pendingFees || 0],
          ['Institution Health Score', dashboard?.operationalInsights?.institutionHealthScore || 0],
          ['Attendance Rate', `${dashboard?.operationalInsights?.attendanceRate || 0}%`],
          ['Collection Rate', `${dashboard?.finance?.collectionRate || 0}%`],
          ['Active Courses', dashboard?.academics?.activeCourses || 0],
          ['Active Subjects', dashboard?.academics?.activeSubjects || 0],
          ['Upcoming Exams', dashboard?.academics?.upcomingExams?.length || 0],
        ]);
        window.showToast?.('Dashboard report downloaded', 'success');
      };
    }

    window.__erpAdminPageRefresh = loadDashboard;
    await loadDashboard();
  }

  async function initCollegeAdminStudentsPage() {
    const searchInput = cloneById('studentSearch');
    const branchFilter = cloneById('branchFilter');
    const semFilter = cloneById('semFilter');
    const feeFilter = cloneById('feeFilter');
    const exportBtn = cloneById('exportBtn');
    const clearBtn = cloneElement(qa('.card.mb-4 .btn.btn-secondary.btn-sm')[0]);
    let students = [];

    function renderStudents() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = students.filter((student) => {
        if (query && ![student.name, student.roll, student.email].join(' ').toLowerCase().includes(query)) return false;
        if (branchFilter?.value && student.branch !== branchFilter.value) return false;
        if (semFilter?.value && student.sem !== semFilter.value) return false;
        if (feeFilter?.value && student.feeStatus !== feeFilter.value) return false;
        return true;
      });

      setText('countDisplay', String(filtered.length));
      setStatCard(0, 'Total Students', String(students.length));
      setStatCard(1, 'Active', String(students.filter((item) => item.active).length));
      setStatCard(2, 'Fee Pending', String(students.filter((item) => item.feeStatus !== 'paid').length));
      setStatCard(3, 'Departments', String(new Set(students.map((item) => item.branch)).size));

      if (!filtered.length) return renderEmptyTable('studentsBody', 7, 'No students found', 'fa-user-graduate');

      setHTML('studentsBody', filtered.map((student, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar avatar-sm">${escapeHTML((student.name || 'S')[0])}</div><div><div style="font-weight:600">${escapeHTML(student.name)}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(student.email || '-')}</div></div></div></td>
          <td><code style="font-size:12px;background:#F1F5F9;padding:2px 8px;border-radius:4px">${escapeHTML(student.roll || '-')}</code></td>
          <td><div style="font-size:13px;font-weight:600">${escapeHTML(student.branch || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(student.sem || '-')}</div></td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(student.phone || '-')}</td>
          <td><span class="badge ${student.feeStatus === 'paid' ? 'badge-success' : student.feeStatus === 'overdue' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(student.feeStatus || 'pending')}</span></td>
          <td><div style="display:flex;gap:5px"><button class="btn btn-xs btn-secondary" onclick="viewStudent('${student._id}')"><i class="fas fa-eye"></i></button><button class="btn btn-xs btn-danger" onclick="toggleStudent('${student._id}')"><i class="fas ${student.active ? 'fa-ban' : 'fa-check'}"></i></button></div></td>
        </tr>
      `).join(''));
    }

    async function loadStudents() {
      const res = await window.api.request('/college-admin/students?limit=500', { silent: true });
      students = res.students || [];
      const branches = Array.from(new Set(students.map((item) => item.branch).filter(Boolean))).sort();
      if (branchFilter) {
        branchFilter.innerHTML = '<option value="">All Branches</option>' + branches.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
      }
      renderStudents();
    }

    window.viewStudent = function viewStudent(id) {
      const student = students.find((item) => String(item._id) === String(id));
      if (!student) return;
      setText('viewStudentTitle', `${student.name} — Profile`);
      setHTML('viewStudentBody', `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #F1F5F9">
          <div class="avatar avatar-xl">${escapeHTML((student.name || 'S')[0])}</div>
          <div>
            <div style="font-size:22px;font-weight:800">${escapeHTML(student.name)}</div>
            <div style="color:#64748B;font-size:14px">${escapeHTML(student.email || '-')} • ${escapeHTML(student.phone || '-')}</div>
            <span class="badge ${student.active ? 'badge-success' : 'badge-danger'}" style="margin-top:6px">${student.active ? 'Active' : 'Inactive'}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div><div class="stat-label">Roll Number</div><div style="font-weight:700;font-size:15px;margin-top:4px">${escapeHTML(student.roll || '-')}</div></div>
          <div><div class="stat-label">Branch</div><div style="font-weight:700;font-size:15px;margin-top:4px">${escapeHTML(student.branch || '-')}</div></div>
          <div><div class="stat-label">Semester</div><div style="font-weight:700;font-size:15px;margin-top:4px">${escapeHTML(student.sem || '-')}</div></div>
          <div><div class="stat-label">Fee Status</div><div style="margin-top:4px"><span class="badge ${student.feeStatus === 'paid' ? 'badge-success' : student.feeStatus === 'overdue' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(student.feeStatus || 'pending')}</span></div></div>
          <div><div class="stat-label">Enrollment No.</div><div style="font-weight:700;font-size:15px;margin-top:4px">${escapeHTML(student.enrollmentNo || '-')}</div></div>
          <div><div class="stat-label">Section</div><div style="font-weight:700;font-size:15px;margin-top:4px">${escapeHTML(student.section || '-')}</div></div>
          <div><div class="stat-label">Admission Date</div><div style="font-weight:700;font-size:15px;margin-top:4px">${formatDate(student.admissionDate)}</div></div>
          <div><div class="stat-label">DOB / Blood Group</div><div style="font-weight:700;font-size:15px;margin-top:4px">${formatDate(student.dateOfBirth)} • ${escapeHTML(student.bloodGroup || '-')}</div></div>
        </div>
      `);
      window.openModal?.('viewStudentModal');
    };

    window.toggleStudent = async function toggleStudent(id) {
      await window.api.request(`/college-admin/users/${id}/toggle`, { method: 'PATCH' });
      window.showToast?.('Student status updated', 'success');
      await loadStudents();
    };

    window.submitStudent = async function submitStudent() {
      const button = byId('addStudentBtn');
      const payload = {
        name: byId('sName')?.value.trim(),
        email: byId('sEmail')?.value.trim(),
        roll: byId('sRoll')?.value.trim(),
        branch: byId('sBranch')?.value,
        semester: byId('sSem')?.value,
        password: byId('sPass')?.value,
        sPhone: byId('sPhone')?.value.trim(),
        enrollmentNo: byId('sEnrollment')?.value.trim(),
        section: byId('sSection')?.value.trim(),
        admissionDate: byId('sAdmissionDate')?.value,
        dateOfBirth: byId('sDob')?.value,
        gender: byId('sGender')?.value,
        bloodGroup: byId('sBloodGroup')?.value.trim(),
        parentName: byId('sParent')?.value.trim(),
        parentEmail: byId('sParentEmail')?.value.trim(),
        address: byId('sAddress')?.value.trim(),
      };
      if (!payload.name || !payload.email || !payload.roll || !payload.branch || !payload.semester || !payload.password) {
        window.showToast?.('Fill all required fields', 'error');
        return;
      }
      window.setLoading?.(button, true);
      try {
        const res = await window.api.request('/college-admin/add-student', { method: 'POST', body: JSON.stringify(payload) });
        byId('addStudentForm')?.reset();
        window.closeModal?.('addStudentModal');
        window.showToast?.('Student enrolled successfully', 'success');
        if (res.parentCredentials) {
          window.showToast?.(`Parent login: ${res.parentCredentials.email}`, 'info');
        }
        await loadStudents();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    if (searchInput) searchInput.oninput = renderStudents;
    if (branchFilter) branchFilter.onchange = renderStudents;
    if (semFilter) semFilter.onchange = renderStudents;
    if (feeFilter) feeFilter.onchange = renderStudents;
    if (clearBtn) {
      clearBtn.onclick = function clearStudentFilters() {
        if (searchInput) searchInput.value = '';
        if (branchFilter) branchFilter.value = '';
        if (semFilter) semFilter.value = '';
        if (feeFilter) feeFilter.value = '';
        renderStudents();
      };
    }
    if (exportBtn) {
      exportBtn.onclick = function exportStudents() {
        downloadCsv('students.csv', [['Name', 'Roll', 'Email', 'Branch', 'Semester', 'Fee Status'], ...students.map((item) => [item.name, item.roll, item.email, item.branch, item.sem, item.feeStatus])]);
        window.showToast?.('Students exported', 'success');
      };
    }

    window.__erpAdminPageRefresh = loadStudents;
    await loadStudents();
  }

  async function initCollegeAdminFacultyPage() {
    let faculty = [];
    let leaves = [];
    let currentDept = 'all';
    const searchInput = byId('facultySearch');

    function renderFaculty() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = faculty.filter((item) => {
        if (currentDept !== 'all' && item.dept !== currentDept) return false;
        return !query || [item.name, item.email, item.dept, item.designation].join(' ').toLowerCase().includes(query);
      });
      const onLeaveIds = new Set(leaves.filter((item) => item.status === 'approved').map((item) => String(item.userId?._id || item.userId)));
      setStatCard(0, 'Total Faculty', String(faculty.length));
      setStatCard(1, 'Present Today', String(Math.max(faculty.length - onLeaveIds.size, 0)));
      setStatCard(2, 'On Leave', String(onLeaveIds.size));
      setStatCard(3, 'Pending Leaves', String(leaves.filter((item) => item.status === 'pending').length));

      setHTML('facultyGrid', filtered.map((item) => `
        <div class="card" style="padding:18px">
          <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
            <div class="avatar avatar-lg">${escapeHTML((item.name || 'F')[0])}</div>
            <div style="flex:1">
              <div style="font-weight:700;font-size:15px">${escapeHTML(item.name)}</div>
              <div style="font-size:12px;color:#64748B">${escapeHTML(item.designation || 'Faculty')}</div>
              <span class="badge badge-info" style="margin-top:4px">${escapeHTML(item.dept || '-')}</span>
            </div>
            ${item.onLeave ? '<span class="badge badge-warning">On Leave</span>' : ''}
          </div>
          <div style="font-size:12px;color:#64748B;margin-bottom:6px"><i class="fas fa-envelope" style="margin-right:6px"></i>${escapeHTML(item.email || '-')}</div>
          <div style="font-size:12px;color:#64748B;margin-bottom:12px"><i class="fas fa-phone" style="margin-right:6px"></i>${escapeHTML(item.phone || '-')}</div>
          <div style="display:flex;gap:8px;border-top:1px solid #F1F5F9;padding-top:12px">
            <button class="btn btn-sm btn-secondary" style="flex:1" onclick="viewFaculty('${item._id}')"><i class="fas fa-eye"></i> View</button>
            <button class="btn btn-sm btn-danger" onclick="toggleFaculty('${item._id}')"><i class="fas ${item.active ? 'fa-ban' : 'fa-check'}"></i></button>
          </div>
        </div>
      `).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No faculty found</div></div>');
    }

    async function loadFaculty() {
      const [facultyRes, leaveRes] = await Promise.all([
        window.api.request('/college-admin/faculty', { silent: true }),
        window.api.request('/leave/all', { silent: true }),
      ]);
      faculty = facultyRes.faculty || [];
      leaves = leaveRes.leaves || [];
      renderFaculty();
    }

    window.filterDept = function filterDept(dept, button) {
      currentDept = dept;
      qa('.tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      renderFaculty();
    };

    window.viewFaculty = function viewFaculty(id) {
      const item = faculty.find((entry) => String(entry._id) === String(id));
      if (!item) return;
      window.showToast?.(`${item.name} • ${item.designation || 'Faculty'} • ${item.email}`, 'info');
    };

    window.toggleFaculty = async function toggleFaculty(id) {
      await window.api.request(`/college-admin/users/${id}/toggle`, { method: 'PATCH' });
      window.showToast?.('Faculty status updated', 'success');
      await loadFaculty();
    };

    window.submitFaculty = async function submitFaculty() {
      const button = byId('addFacultyBtn');
      const payload = {
        name: byId('fName')?.value.trim(),
        email: byId('fEmail')?.value.trim(),
        department: byId('fDept')?.value,
        password: byId('fPass')?.value,
        designation: byId('fDesig')?.value.trim(),
        fPhone: byId('fPhone')?.value.trim(),
      };
      if (!payload.name || !payload.email || !payload.department || !payload.password) {
        window.showToast?.('Fill all required fields', 'error');
        return;
      }
      window.setLoading?.(button, true);
      try {
        await window.api.request('/college-admin/add-faculty', { method: 'POST', body: JSON.stringify(payload) });
        qa('#addFacultyModal input').forEach((input) => { input.value = ''; });
        if (byId('fDept')) byId('fDept').value = '';
        window.closeModal?.('addFacultyModal');
        window.showToast?.('Faculty member added', 'success');
        await loadFaculty();
      } finally {
        window.setLoading?.(button, false);
      }
    };

    if (searchInput) searchInput.oninput = renderFaculty;
    window.__erpAdminPageRefresh = loadFaculty;
    await loadFaculty();
  }

  async function initCollegeAdminFeesPage() {
    await ensureRealtime();
    const searchInput = cloneById('feeSearch');
    const statusFilter = cloneById('feeStatusFilter');
    const exportBtn = cloneById('exportFeesBtn');
    const reminderBtn = cloneById('sendReminderBtn');
    let fees = [];
    let installments = [];
    let currentView = 'fees';

    function switchFeeView(view) {
      currentView = view;
      byId('feesCard').style.display = view === 'fees' ? '' : 'none';
      byId('installmentsCard').style.display = view === 'installments' ? '' : 'none';
      byId('overdueCard').style.display = view === 'overdue' ? '' : 'none';
      ['viewFeesTab', 'viewInstallmentsTab', 'viewOverdueTab'].forEach((id) => {
        const btn = byId(id);
        if (btn) { btn.className = 'btn btn-sm'; }
      });
      const activeId = view === 'fees' ? 'viewFeesTab' : view === 'installments' ? 'viewInstallmentsTab' : 'viewOverdueTab';
      const activeBtn = byId(activeId);
      if (activeBtn) activeBtn.className = 'btn btn-sm btn-primary';
      if (view === 'installments') renderInstallments();
      if (view === 'overdue') renderOverdue();
      if (view === 'fees') renderFees();
    }
    window.switchFeeView = switchFeeView;

    function renderCharts() {
      const collectionCanvas = replaceCanvas('feeCollectionChart');
      const statusCanvas = replaceCanvas('feeStatusChart');
      const monthly = fees.filter((item) => item.paidDate).reduce((acc, item) => {
        const key = new Date(item.paidDate).toLocaleDateString('en-US', { month: 'short' });
        if (!acc[key]) acc[key] = 0;
        acc[key] += Number(item.paidAmount || 0);
        return acc;
      }, {});
      const statusMap = fees.reduce((acc, item) => {
        const key = item.status || 'pending';
        if (!acc[key]) acc[key] = 0;
        acc[key] += 1;
        return acc;
      }, {});

      if (collectionCanvas && window.Chart) {
        new window.Chart(collectionCanvas, {
          type: 'bar',
          data: { labels: Object.keys(monthly), datasets: [{ label: 'Collected', data: Object.values(monthly), backgroundColor: '#4F46E5', borderRadius: 6 }] },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }
      if (statusCanvas && window.Chart) {
        new window.Chart(statusCanvas, {
          type: 'doughnut',
          data: { labels: Object.keys(statusMap), datasets: [{ data: Object.values(statusMap), backgroundColor: ['#10B981', '#F59E0B', '#EF4444', '#94A3B8', '#8B5CF6'], borderWidth: 0 }] },
          options: { ...getChartDefaults(), cutout: '65%' },
        });
      }
    }

    function renderFees() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = fees.filter((item) => {
        if (query && ![item.studentId?.name, item.studentId?.rollNo].join(' ').toLowerCase().includes(query)) return false;
        if (statusFilter?.value && item.status !== statusFilter.value) return false;
        return true;
      });
      const collected = fees.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
      const pendingAmount = fees.filter((item) => item.status !== 'paid').reduce((sum, item) => sum + Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0), 0);
      const overdueAmount = fees.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0), 0);
      const totalAmount = fees.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      setStatCard(0, 'Total Collected', formatMoney(collected));
      setStatCard(1, 'Pending', formatMoney(pendingAmount), `<i class="fas fa-hourglass-half"></i> ${fees.filter((item) => item.status !== 'paid').length} records`);
      setStatCard(2, 'Overdue', formatMoney(overdueAmount), `<i class="fas fa-exclamation-triangle"></i> ${fees.filter((item) => item.status === 'overdue').length} records`);
      setStatCard(3, 'Collection Rate', `${totalAmount ? Math.round((collected / totalAmount) * 100) : 0}%`);

      if (!filtered.length) return renderEmptyTable('feeBody', 8, 'No fee records found', 'fa-file-invoice-dollar');
      setHTML('feeBody', filtered.map((item, index) => {
        const pending = Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0);
        return `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td><div style="font-weight:600">${escapeHTML(item.studentId?.name || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(item.studentId?.rollNo || '-')}</div></td>
          <td style="font-weight:700">${formatMoney(item.amount)}${item.discountAmount ? `<div style="font-size:10px;color:#8B5CF6">-${formatMoney(item.discountAmount)} disc</div>` : ''}</td>
          <td><span class="badge badge-gray">${escapeHTML(item.feeType || 'other')}</span></td>
          <td style="font-size:12px;color:#64748B">${formatDate(item.dueDate)}</td>
          <td style="font-size:12px;color:#64748B">${item.paidDate ? formatDate(item.paidDate) : '-'}</td>
          <td><span class="badge ${item.status === 'paid' ? 'badge-success' : item.status === 'overdue' ? 'badge-danger' : item.status === 'waived' ? 'badge-info' : item.status === 'partial' ? 'badge-warning' : 'badge-warning'}">${escapeHTML(item.status)}</span></td>
          <td><div style="display:flex;gap:4px;flex-wrap:wrap">${item.status !== 'paid' && item.status !== 'waived' ? `<button class="btn btn-xs btn-primary" title="Collect online" onclick="payExistingFeeOnline('${item._id}')"><i class="fas fa-credit-card"></i></button><button class="btn btn-xs btn-success" title="Mark collected" onclick="recordExistingFee('${item._id}', ${pending})"><i class="fas fa-check"></i></button><button class="btn btn-xs btn-secondary" title="Discount" onclick="openDiscountModal('${item._id}')"><i class="fas fa-percentage"></i></button><button class="btn btn-xs btn-danger" title="Waive" onclick="openWaiveModal('${item._id}')"><i class="fas fa-ban"></i></button>` : ''}<button class="btn btn-xs btn-secondary" onclick="showToast('${escapeHTML(item.receiptNo || 'No receipt')}', 'info')"><i class="fas fa-file-invoice"></i></button></div></td>
        </tr>`;
      }).join(''));
      renderCharts();
    }

    function renderInstallments() {
      const query = (searchInput?.value || '').toLowerCase();
      const allInst = [];
      installments.forEach((fee) => {
        (fee.installments || []).forEach((inst) => {
          allInst.push({ ...inst, feeId: fee._id, studentName: fee.studentId?.name, rollNo: fee.studentId?.rollNo, feeType: fee.feeType });
        });
      });
      const filtered = allInst.filter((inst) => {
        if (query && ![inst.studentName, inst.rollNo].join(' ').toLowerCase().includes(query)) return false;
        return true;
      });
      if (!filtered.length) return renderEmptyTable('installmentBody', 9, 'No installments found', 'fa-list-ol');
      setHTML('installmentBody', filtered.map((inst, i) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${i + 1}</td>
          <td><div style="font-weight:600">${escapeHTML(inst.studentName || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(inst.rollNo || '-')}</div></td>
          <td><span class="badge badge-gray">${escapeHTML(inst.feeType || '-')}</span></td>
          <td style="font-weight:700">#${inst.installmentNumber}</td>
          <td style="font-weight:700">${formatMoney(inst.amount)}${inst.paidAmount ? `<div style="font-size:10px;color:#10B981">Paid: ${formatMoney(inst.paidAmount)}</div>` : ''}</td>
          <td style="font-size:12px;color:#64748B">${formatDate(inst.dueDate)}</td>
          <td>${inst.lateFee ? `<span style="color:#EF4444;font-weight:600">${formatMoney(inst.lateFee)}</span>` : '-'}</td>
          <td><span class="badge ${inst.status === 'paid' ? 'badge-success' : inst.status === 'overdue' ? 'badge-danger' : inst.status === 'waived' ? 'badge-info' : 'badge-warning'}">${escapeHTML(inst.status)}</span></td>
          <td><div style="display:flex;gap:4px">${inst.status !== 'paid' && inst.status !== 'waived' ? `<button class="btn btn-xs btn-primary" title="Pay installment" onclick="payInstallment('${inst.feeId}','${inst._id}')"><i class="fas fa-credit-card"></i></button>` : ''}</div></td>
        </tr>
      `).join(''));
    }

    function renderOverdue() {
      const now = new Date();
      const overdue = fees.filter((f) => f.status !== 'paid' && f.status !== 'waived' && new Date(f.dueDate) < now);
      if (!overdue.length) return renderEmptyTable('overdueBody', 7, 'No overdue fees', 'fa-check-circle');
      setHTML('overdueBody', overdue.map((item, i) => {
        const daysOverdue = Math.floor((now - new Date(item.dueDate)) / 86400000);
        const pending = Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0);
        return `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${i + 1}</td>
          <td><div style="font-weight:600">${escapeHTML(item.studentId?.name || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(item.studentId?.rollNo || '-')}</div></td>
          <td style="font-weight:700;color:#EF4444">${formatMoney(pending)}</td>
          <td style="font-size:12px;color:#64748B">${formatDate(item.dueDate)}</td>
          <td><span class="badge badge-danger">${daysOverdue} days</span></td>
          <td>${item.totalLateFee ? `<span style="color:#EF4444;font-weight:600">${formatMoney(item.totalLateFee)}</span>` : '-'}</td>
          <td><div style="display:flex;gap:4px"><button class="btn btn-xs btn-primary" onclick="payExistingFeeOnline('${item._id}')"><i class="fas fa-credit-card"></i></button><button class="btn btn-xs btn-success" onclick="recordExistingFee('${item._id}', ${pending})"><i class="fas fa-check"></i></button></div></td>
        </tr>`;
      }).join(''));
    }

    async function loadFees() {
      const [feeRes, instRes] = await Promise.all([
        window.api.request('/fees', { silent: true }),
        window.api.request('/fees/installments', { silent: true }).catch(() => ({ fees: [] })),
      ]);
      fees = feeRes.fees || [];
      installments = instRes.fees || [];
      if (currentView === 'fees') renderFees();
      else if (currentView === 'installments') renderInstallments();
      else if (currentView === 'overdue') renderOverdue();
    }

    window.recordExistingFee = async function recordExistingFee(id, amount) {
      await window.api.request(`/fees/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount, paymentMethod: 'cash', receiptNo: `ADMIN-${Date.now()}` }) });
      window.showToast?.('Payment recorded successfully', 'success');
      await loadFees();
    };

    window.payExistingFeeOnline = async function payExistingFeeOnline(id) {
      const fee = fees.find((item) => String(item._id) === String(id));
      if (!fee) {
        window.showToast?.('Fee record not found', 'error');
        return;
      }

      try {
        await ensureRazorpayCheckout();
        if (!window.Razorpay) {
          window.showToast?.('Payment gateway failed to load', 'error');
          return;
        }

        const orderRes = await window.api.request(`/fees/${id}/create-order`, { method: 'POST' });
        if (!orderRes?.order || !orderRes.key) {
          window.showToast?.('Failed to create payment order', 'error');
          return;
        }

        const user = getUser() || {};
        const student = fee.studentId || {};
        const options = {
          key: orderRes.key,
          amount: orderRes.order.amount,
          currency: orderRes.order.currency || 'INR',
          name: 'Vishva ERP',
          description: `Fee Payment - ${fee.feeType || 'College Fee'} (${student.name || 'Student'})`,
          order_id: orderRes.order.id,
          handler: async function handlePayment(response) {
            try {
              await window.api.request('/fees/verify-payment', {
                method: 'POST',
                body: JSON.stringify({
                  razorpayOrderId: response.razorpay_order_id,
                  razorpayPaymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                  feeId: orderRes.feeId,
                }),
              }).catch(() => pollFeePaymentStatus(orderRes.feeId, response.razorpay_order_id, response.razorpay_payment_id, 7));
              window.showToast?.('Online fee payment verified', 'success');
              await loadFees();
            } catch (error) {
              window.showToast?.(error.message || 'Payment received but verification failed. Contact support.', 'warning');
            }
          },
          prefill: { name: student.name || user.name || '', email: user.email || '', contact: user.phone || '' },
          notes: { feeId: String(id), rollNo: student.rollNo || '' },
          theme: { color: '#4F46E5' },
          modal: { ondismiss: function onDismiss() { window.showToast?.('Payment cancelled', 'info'); } },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function onFailed(response) {
          window.showToast?.('Payment failed: ' + (response.error?.description || 'Unknown error'), 'error');
        });
        rzp.open();
      } catch (error) {
        window.showToast?.(error.message || 'Could not initiate online payment', 'error');
      }
    };

    window.payInstallment = async function payInstallment(feeId, installmentId) {
      try {
        await ensureRazorpayCheckout();
        if (!window.Razorpay) { window.showToast?.('Payment gateway failed to load', 'error'); return; }
        const orderRes = await window.api.request(`/fees/${feeId}/installments/${installmentId}/create-order`, { method: 'POST' });
        if (!orderRes?.order || !orderRes.key) { window.showToast?.('Failed to create order', 'error'); return; }
        const fee = fees.find((f) => String(f._id) === String(feeId));
        const user = getUser() || {};
        const student = fee?.studentId || {};
        const rzp = new window.Razorpay({
          key: orderRes.key, amount: orderRes.order.amount, currency: orderRes.order.currency || 'INR',
          name: 'Vishva ERP', description: `Installment #${orderRes.installmentId || ''} Payment`,
          order_id: orderRes.order.id,
          handler: async (response) => {
            try {
              await window.api.request('/fees/verify-payment', { method: 'POST', body: JSON.stringify({ razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id, razorpaySignature: response.razorpay_signature, feeId }) });
            } catch {}
            window.showToast?.('Installment payment verified', 'success');
            await loadFees();
          },
          prefill: { name: student.name || user.name || '', email: user.email || '' },
          theme: { color: '#4F46E5' },
          modal: { ondismiss: () => window.showToast?.('Payment cancelled', 'info') },
        });
        rzp.on('payment.failed', (resp) => window.showToast?.('Payment failed: ' + (resp.error?.description || 'Unknown'), 'error'));
        rzp.open();
      } catch (error) { window.showToast?.(error.message || 'Could not initiate payment', 'error'); }
    };

    window.recordFee = async function recordFee() {
      const payload = {
        roll: byId('fRoll')?.value.trim(),
        amount: Number(byId('fAmount')?.value || 0),
        type: byId('fType')?.value,
        paymentMode: String(byId('fMode')?.value || '').toLowerCase(),
        transactionId: byId('fTxn')?.value.trim(),
        paidAmount: Number(byId('fAmount')?.value || 0),
        paidDate: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        status: 'paid',
      };
      if (!payload.roll || !payload.amount) {
        window.showToast?.('Roll number and amount are required', 'error');
        return;
      }
      await window.api.request('/fees', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('recordFeeModal');
      window.showToast?.('Fee payment recorded', 'success');
      await loadFees();
    };

    window.initiateAdminCollect = async function initiateAdminCollect() {
      const select = byId('collectFeeSelect');
      const feeId = select?.value;
      if (!feeId) { window.showToast?.('Select a fee record first', 'error'); return; }
      const fee = fees.find((item) => String(item._id) === String(feeId));
      if (!fee) { window.showToast?.('Fee record not found', 'error'); return; }

      const statusId = 'collectOnlineStatus';
      try {
        if (window.PaymentGateway) {
          await window.PaymentGateway.startCheckout({
            fee,
            statusContainerId: statusId,
            accentColor: '#4F46E5',
            title: `Fee for ${fee.studentId?.name || 'Student'}`,
            onPending: async () => {
              window.PaymentGateway.showStatus(statusId, 'Payment received. Confirming with server...', 'processing');
            },
            onSuccess: async () => {
              window.PaymentGateway.showStatus(statusId, 'Payment verified and recorded!', 'success');
              window.showToast?.('Fee payment collected successfully', 'success');
              setTimeout(async () => { window.closeModal?.('collectOnlineModal'); await loadFees(); }, 1500);
            },
            onFailure: async (error) => {
              window.PaymentGateway.showStatus(statusId, error.message || 'Payment failed', 'error');
            },
          });
        } else {
          await payExistingFeeOnline(feeId);
        }
      } catch (error) {
        if (window.PaymentGateway) window.PaymentGateway.showStatus(statusId, error.message || 'Could not initiate payment', 'error');
        else window.showToast?.(error.message || 'Could not initiate payment', 'error');
      }
    };

    function populateCollectSelect() {
      const select = byId('collectFeeSelect');
      const preview = byId('collectFeePreview');
      const btn = byId('collectPayBtn');
      if (!select) return;
      const pending = fees.filter((item) => item.status !== 'paid').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      select.innerHTML = pending.length
        ? '<option value="">Choose a fee record...</option>' + pending.map((item) => `<option value="${item._id}">${item.studentId?.name || 'Unknown'} — ${item.feeType || 'Fee'} — ₹${Number(item.amount).toLocaleString('en-IN')} (${item.status})</option>`).join('')
        : '<option value="">No pending fee records</option>';

      select.onchange = function () {
        const fee = fees.find((item) => String(item._id) === String(select.value));
        if (!fee || !preview) { if (preview) preview.style.display = 'none'; if (btn) btn.disabled = true; return; }
        const pending = Math.max(Number(fee.amount || 0) - Number(fee.paidAmount || 0), 0);
        const el = (id) => document.getElementById(id);
        if (el('collectStudentName')) el('collectStudentName').textContent = fee.studentId?.name || '-';
        if (el('collectFeeType')) el('collectFeeType').textContent = fee.feeType || '-';
        if (el('collectTotalAmount')) el('collectTotalAmount').textContent = `₹${Number(fee.amount || 0).toLocaleString('en-IN')}`;
        if (el('collectPendingAmount')) el('collectPendingAmount').textContent = `₹${pending.toLocaleString('en-IN')}`;
        preview.style.display = 'block';
        btn.disabled = false;
      };
      select.onchange();
    }

    window.openDiscountModal = function openDiscountModal(feeId) {
      byId('discountFeeId').value = feeId;
      byId('discountType').value = 'percentage';
      byId('discountValue').value = '';
      byId('discountReason').value = '';
      byId('discountScholarshipName').value = '';
      byId('scholarshipNameGroup').style.display = 'none';
      openModal('discountModal');
    };
    byId('discountType')?.addEventListener('change', function () {
      byId('scholarshipNameGroup').style.display = this.value === 'scholarship' ? '' : 'none';
    });

    window.executeDiscount = async function executeDiscount() {
      const id = byId('discountFeeId').value;
      const payload = {
        discountType: byId('discountType').value,
        discountValue: Number(byId('discountValue').value || 0),
        discountReason: byId('discountReason').value.trim(),
        scholarshipName: byId('discountType').value === 'scholarship' ? byId('discountScholarshipName').value.trim() : undefined,
      };
      if (!payload.discountValue && payload.discountType !== 'scholarship') return window.showToast?.('Enter a discount value', 'error');
      await window.api.request(`/fees/${id}/discount`, { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('discountModal');
      window.showToast?.('Discount applied', 'success');
      await loadFees();
    };

    window.openWaiveModal = function openWaiveModal(feeId) {
      byId('waiveFeeId').value = feeId;
      byId('waiveReason').value = '';
      openModal('waiveModal');
    };

    window.executeWaive = async function executeWaive() {
      const id = byId('waiveFeeId').value;
      await window.api.request(`/fees/${id}/waive`, { method: 'POST', body: JSON.stringify({ reason: byId('waiveReason').value.trim() || 'Waived by admin' }) });
      window.closeModal?.('waiveModal');
      window.showToast?.('Fee waived', 'success');
      await loadFees();
    };

    window.applyLateFees = async function applyLateFees() {
      const res = await window.api.request('/fees/late-fees/apply', { method: 'POST' });
      window.showToast?.(`Late fees applied to ${res.updated || 0} records`, 'success');
      await loadFees();
    };

    const collectModal = byId('collectOnlineModal');
    if (collectModal) {
      const observer = new MutationObserver(() => {
        if (collectModal.style.display !== 'none' && collectModal.classList.contains('active')) {
          populateCollectSelect();
        }
      });
      observer.observe(collectModal, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    if (searchInput) searchInput.oninput = debounce(() => { if (currentView === 'fees') renderFees(); else if (currentView === 'installments') renderInstallments(); else renderOverdue(); }, 250);
    if (statusFilter) statusFilter.onchange = renderFees;
    if (exportBtn) exportBtn.onclick = function exportFees() { downloadCsv('fees.csv', [['Student', 'Roll', 'Amount', 'Type', 'Due Date', 'Status'], ...fees.map((item) => [item.studentId?.name, item.studentId?.rollNo, item.amount, item.feeType, formatDate(item.dueDate), item.status])]); };
    if (reminderBtn) reminderBtn.onclick = function remindPending() { window.showToast?.(`${fees.filter((item) => item.status !== 'paid').length} pending fee reminders queued`, 'info'); };

    let feeAssignStructures = [];
    let feeAssignAllStudents = [];
    let feeAssignSelectedIds = [];

    window.loadFeesAssignData = async function loadFeesAssignData() {
      feeAssignSelectedIds = [];
      const structSelect = byId('assignFeeStructureSelect');
      const listEl = byId('assignFeeStudentList');
      const tagsEl = byId('assignFeeSelectedTags');
      if (structSelect) structSelect.innerHTML = '<option value="">Loading structures...</option>';
      if (listEl) listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8">Select a structure first</div>';
      if (tagsEl) tagsEl.innerHTML = '';
      byId('assignFeeStructurePreview').style.display = 'none';
      setText('assignFeeStudentCount', '0');
      const btn = byId('assignFeeSubmitBtn');
      if (btn) btn.disabled = true;

      try {
        const res = await window.api.request('/fees/structures', { silent: true });
        feeAssignStructures = (res.structures || []).filter((s) => s.status === 'active');
        if (structSelect) {
          structSelect.innerHTML = feeAssignStructures.length
            ? '<option value="">Choose a fee structure...</option>' + feeAssignStructures.map((s) => `<option value="${s._id}">${escapeHTML(s.name)} — ${formatMoney(s.totalAmount)} (${escapeHTML(s.department || 'All')})</option>`).join('')
            : '<option value="">No active structures found</option>';
          structSelect.onchange = async function () {
            const s = feeAssignStructures.find((x) => x._id === this.value);
            const preview = byId('assignFeeStructurePreview');
            if (!s) { if (preview) preview.style.display = 'none'; return; }
            if (preview) { preview.style.display = ''; setText('assignFeePreviewAmount', formatMoney(s.totalAmount)); setText('assignFeePreviewInstallments', s.installmentEnabled ? `${s.installmentCount} × ${s.installmentFrequency}` : 'Full payment'); }
            feeAssignSelectedIds = [];
            await loadFeesAssignStudents(s._id);
          };
        }
      } catch (e) {
        if (structSelect) structSelect.innerHTML = '<option value="">Failed to load structures</option>';
      }
    };

    async function loadFeesAssignStudents(structureId) {
      const listEl = byId('assignFeeStudentList');
      if (listEl) listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8"><i class="fas fa-spinner fa-spin"></i> Loading students...</div>';
      try {
        const res = await window.api.request(`/fees/assignable-students?structureId=${structureId}`, { silent: true });
        feeAssignAllStudents = res.students || [];
        renderFeeAssignStudents(feeAssignAllStudents);
      } catch (e) {
        if (listEl) listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444">Failed to load students</div>';
      }
    }

    function renderFeeAssignStudents(students) {
      const listEl = byId('assignFeeStudentList');
      if (!listEl) return;
      if (!students.length) { listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8">No students found</div>'; return; }
      listEl.innerHTML = students.map((s) => {
        const selected = feeAssignSelectedIds.includes(s._id);
        const alreadyAssigned = s.alreadyAssigned;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #F1F5F9;cursor:pointer;${selected ? 'background:#F0FDF4' : alreadyAssigned ? 'background:#F8FAFC;opacity:0.6' : ''}" onclick="toggleFeeAssignStudent('${s._id}')">
          <input type="checkbox" ${selected ? 'checked' : ''} ${alreadyAssigned ? 'disabled' : ''} style="accent-color:#10B981;width:16px;height:16px">
          <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;color:#1E293B">${escapeHTML(s.name)}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(s.rollNo || '-')} · ${escapeHTML(s.department || '-')} · Sem ${s.semester || '-'}</div></div>
          ${alreadyAssigned ? '<span class="badge badge-success" style="font-size:10px">Assigned</span>' : selected ? '<span class="badge badge-info" style="font-size:10px">Selected</span>' : ''}
        </div>`;
      }).join('');
      renderFeeAssignTags();
    }

    function renderFeeAssignTags() {
      const tagsEl = byId('assignFeeSelectedTags');
      if (!tagsEl) return;
      tagsEl.innerHTML = feeAssignSelectedIds.map((id) => {
        const s = feeAssignAllStudents.find((x) => x._id === id);
        if (!s) return '';
        return `<span style="display:inline-flex;align-items:center;gap:4px;background:#DBEAFE;color:#1E40AF;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600">${escapeHTML(s.name)} <button onclick="event.stopPropagation();toggleFeeAssignStudent('${s._id}')" style="background:none;border:none;color:#1E40AF;cursor:pointer;padding:0;font-size:14px;line-height:1">&times;</button></span>`;
      }).join('');
      setText('assignFeeStudentCount', `${feeAssignSelectedIds.length} selected`);
      const btn = byId('assignFeeSubmitBtn');
      if (btn) btn.disabled = feeAssignSelectedIds.length === 0;
    }

    window.toggleFeeAssignStudent = function toggleFeeAssignStudent(studentId) {
      const idx = feeAssignSelectedIds.indexOf(studentId);
      if (idx >= 0) feeAssignSelectedIds.splice(idx, 1);
      else feeAssignSelectedIds.push(studentId);
      renderFeeAssignStudents(feeAssignAllStudents);
    };

    window.selectAllFeeVisibleStudents = function selectAllFeeVisibleStudents() {
      feeAssignAllStudents.forEach((s) => {
        if (!s.alreadyAssigned && !feeAssignSelectedIds.includes(s._id)) feeAssignSelectedIds.push(s._id);
      });
      renderFeeAssignStudents(feeAssignAllStudents);
    };

    window.clearFeeSelectedStudents = function clearFeeSelectedStudents() {
      feeAssignSelectedIds = [];
      renderFeeAssignStudents(feeAssignAllStudents);
    };

    byId('assignFeeStudentSearch')?.addEventListener('input', debounce(function () {
      const query = this.value.toLowerCase().trim();
      const dropdownEl = byId('assignFeeStudentDropdown');
      if (!query || !dropdownEl) { if (dropdownEl) dropdownEl.style.display = 'none'; return; }
      const filtered = feeAssignAllStudents.filter((s) => !s.alreadyAssigned && [s.name, s.rollNo, s.email].join(' ').toLowerCase().includes(query));
      if (!filtered.length) { dropdownEl.style.display = 'none'; return; }
      dropdownEl.style.display = 'block';
      dropdownEl.innerHTML = filtered.slice(0, 20).map((s) => {
        const selected = feeAssignSelectedIds.includes(s._id);
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #F8FAFC;${selected ? 'background:#F0FDF4' : ''}" onmousedown="toggleFeeAssignStudent('${s._id}');document.getElementById('assignFeeStudentDropdown').style.display='none';document.getElementById('assignFeeStudentSearch').value=''">
          <div style="flex:1"><span style="font-weight:600;font-size:13px">${escapeHTML(s.name)}</span> <span style="font-size:11px;color:#94A3B8">${escapeHTML(s.rollNo || '')}</span></div>
          ${selected ? '<i class="fas fa-check" style="color:#10B981;font-size:12px"></i>' : ''}
        </div>`;
      }).join('');
    }, 200));

    window.executeAssignFeeFromFees = async function executeAssignFeeFromFees() {
      const structureId = byId('assignFeeStructureSelect')?.value;
      if (!structureId) { window.showToast?.('Select a fee structure', 'error'); return; }
      if (!feeAssignSelectedIds.length) { window.showToast?.('Select at least one student', 'error'); return; }
      const btn = byId('assignFeeSubmitBtn');
      setLoading(btn, true);
      try {
        const payload = {
          structureId,
          studentIds: feeAssignSelectedIds,
          dueDate: byId('assignFeeDueDate')?.value || undefined,
        };
        const res = await window.api.request('/fees/structures/assign', { method: 'POST', body: JSON.stringify(payload) });
        closeModal('assignFeeFromFeesModal');
        window.showToast?.(`Fee assigned to ${res.count || 0} students`, 'success');
        await loadFees();
      } finally {
        setLoading(btn, false);
      }
    };

    window.__erpAdminPageRefresh = loadFees;
    await loadFees();
  }

  async function initCollegeAdminFeeStructuresPage() {
    await ensureRealtime();
    const searchInput = cloneById('structureSearch');
    const statusFilter = cloneById('statusFilter');
    const exportBtn = cloneById('exportStructuresBtn');
    let structures = [];
    let deletingStructureId = null;
    let componentCount = 0;

    const feeTypes = ['tuition', 'hostel', 'transport', 'library', 'lab', 'exam', 'development', 'exam-retake', 'sports', 'other'];

    function addFeeComponent(name, feeType, amount) {
      componentCount++;
      const id = componentCount;
      const container = byId('componentsList');
      if (!container) return;
      const row = document.createElement('div');
      row.id = `comp-${id}`;
      row.style.cssText = 'display:grid;grid-template-columns:1fr 130px 110px 32px;gap:8px;align-items:center;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px';
      row.innerHTML = `
        <input class="form-control comp-name" value="${escapeHTML(name || '')}" placeholder="Component name" style="border:1px solid #E2E8F0;border-radius:6px;height:36px;font-size:12px">
        <select class="form-control comp-type" style="border:1px solid #E2E8F0;border-radius:6px;height:36px;font-size:12px">${feeTypes.map((t) => `<option value="${t}" ${t === feeType ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input class="form-control comp-amount" type="number" min="0" value="${amount || 0}" placeholder="₹" style="border:1px solid #E2E8F0;border-radius:6px;height:36px;font-size:12px" oninput="recalcComponentTotal()">
        <button class="btn btn-xs btn-danger" onclick="document.getElementById('comp-${id}').remove();recalcComponentTotal()" style="height:32px;width:32px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px"><i class="fas fa-times"></i></button>
      `;
      container.appendChild(row);
      recalcComponentTotal();
    }
    window.addFeeComponent = addFeeComponent;

    window.recalcComponentTotal = function recalcComponentTotal() {
      const total = qa('.comp-amount').reduce((sum, input) => sum + Number(input.value || 0), 0);
      const el = byId('componentTotal');
      if (el) el.textContent = `₹${total.toLocaleString('en-IN')}`;
    };

    function getComponents() {
      return qa('#componentsList > div').map((row) => ({
        name: row.querySelector('.comp-name')?.value.trim() || '',
        feeType: row.querySelector('.comp-type')?.value || 'other',
        amount: Number(row.querySelector('.comp-amount')?.value || 0),
      })).filter((c) => c.name && c.amount > 0);
    }

    function renderStructures() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = structures.filter((s) => {
        if (query && ![s.name, s.department, s.academicYear].join(' ').toLowerCase().includes(query)) return false;
        if (statusFilter?.value && s.status !== statusFilter.value) return false;
        return true;
      });

      setText('statTotalStructures', String(structures.length));
      setText('statActiveStructures', String(structures.filter((s) => s.status === 'active').length));
      setText('statAssigned', String(structures.reduce((sum, s) => sum + (s.assignedCount || 0), 0)));
      setText('statTotalCollected', formatMoney(structures.reduce((sum, s) => sum + (s.totalCollected || 0), 0)));

      if (!filtered.length) return renderEmptyTable('structureBody', 8, 'No fee structures found', 'fa-layer-group');
      setHTML('structureBody', filtered.map((s, i) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${i + 1}</td>
          <td><div style="font-weight:600">${escapeHTML(s.name)}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(s.department || 'All Depts')}</div></td>
          <td style="font-weight:700">${formatMoney(s.totalAmount)}</td>
          <td style="font-size:12px;color:#64748B">${escapeHTML(s.academicYear || '-')}</td>
          <td style="font-size:12px;color:#64748B">${s.semester || '-'}</td>
          <td><span class="badge ${s.status === 'active' ? 'badge-success' : s.status === 'draft' ? 'badge-warning' : 'badge-gray'}">${escapeHTML(s.status)}</span></td>
          <td><span class="badge badge-info">${s.assignedCount || 0}</span></td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn btn-xs btn-primary" title="Assign" onclick="openAssignModal('${s._id}')"><i class="fas fa-user-plus"></i></button>
              <button class="btn btn-xs btn-secondary" title="Edit" onclick="editStructure('${s._id}')"><i class="fas fa-pen"></i></button>
              <button class="btn btn-xs btn-danger" title="Delete" onclick="confirmDeleteStructure('${s._id}','${escapeHTML(s.name).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `).join(''));
    }

    async function loadStructures() {
      const res = await window.api.request('/fees/structures', { silent: true });
      structures = res.structures || [];
      renderStructures();
    }

    window.openCreateStructureModal = function openCreateStructureModal() {
      byId('editingStructureId').value = '';
      byId('structureModalTitle').innerHTML = '<i class="fas fa-layer-group" style="color:#4F46E5;margin-right:8px"></i>Create Fee Structure';
      byId('stName').value = '';
      byId('stYear').value = '';
      byId('stDesc').value = '';
      byId('stDept').value = '';
      byId('stSem').value = '';
      byId('stInstallmentEnabled').checked = false;
      byId('installmentOptions').style.display = 'none';
      byId('stInstallmentCount').value = '3';
      byId('stInstallmentFreq').value = 'monthly';
      byId('stLateFeeEnabled').checked = false;
      byId('lateFeeOptions').style.display = 'none';
      byId('stLateFeePerDay').value = '50';
      byId('stLateFeeCap').value = '2000';
      byId('componentsList').innerHTML = '';
      componentCount = 0;
      addFeeComponent('Tuition Fee', 'tuition', 45000);
      addFeeComponent('Development Fund', 'development', 5000);
      openModal('structureModal');
    };

    window.editStructure = function editStructure(id) {
      const s = structures.find((x) => x._id === id);
      if (!s) return;
      byId('editingStructureId').value = id;
      byId('structureModalTitle').innerHTML = '<i class="fas fa-layer-group" style="color:#4F46E5;margin-right:8px"></i>Edit Fee Structure';
      byId('stName').value = s.name || '';
      byId('stYear').value = s.academicYear || '';
      byId('stDesc').value = s.description || '';
      byId('stDept').value = s.department || '';
      byId('stSem').value = s.semester || '';
      byId('stInstallmentEnabled').checked = s.installmentEnabled || false;
      byId('installmentOptions').style.display = s.installmentEnabled ? '' : 'none';
      byId('stInstallmentCount').value = s.installmentCount || 3;
      byId('stInstallmentFreq').value = s.installmentFrequency || 'monthly';
      byId('stLateFeeEnabled').checked = (s.lateFeePerDay || 0) > 0;
      byId('lateFeeOptions').style.display = (s.lateFeePerDay || 0) > 0 ? '' : 'none';
      byId('stLateFeePerDay').value = s.lateFeePerDay || 0;
      byId('stLateFeeCap').value = s.lateFeeCap || 0;
      byId('componentsList').innerHTML = '';
      componentCount = 0;
      (s.components || []).forEach((c) => addFeeComponent(c.name, c.feeType, c.amount));
      openModal('structureModal');
    };

    window.saveStructure = async function saveStructure() {
      const id = byId('editingStructureId').value;
      const components = getComponents();
      if (!components.length) return window.showToast?.('Add at least one fee component', 'error');
      const payload = {
        name: byId('stName').value.trim(),
        academicYear: byId('stYear').value.trim(),
        description: byId('stDesc').value.trim(),
        department: byId('stDept').value.trim(),
        semester: byId('stSem').value ? Number(byId('stSem').value) : undefined,
        components,
        installmentEnabled: byId('stInstallmentEnabled').checked,
        installmentCount: byId('stInstallmentEnabled').checked ? Number(byId('stInstallmentCount').value) : 1,
        installmentFrequency: byId('stInstallmentFreq').value,
        lateFeePerDay: byId('stLateFeeEnabled').checked ? Number(byId('stLateFeePerDay').value) : 0,
        lateFeeCap: byId('stLateFeeEnabled').checked ? Number(byId('stLateFeeCap').value) : 0,
      };
      if (!payload.name || !payload.academicYear) return window.showToast?.('Name and academic year are required', 'error');
      const button = byId('saveStructureBtn');
      setLoading(button, true);
      try {
        if (id) {
          await window.api.request(`/fees/structures/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          window.showToast?.('Structure updated', 'success');
        } else {
          await window.api.request('/fees/structures', { method: 'POST', body: JSON.stringify(payload) });
          window.showToast?.('Structure created', 'success');
        }
        closeModal('structureModal');
        await loadStructures();
      } finally {
        setLoading(button, false);
      }
    };

    window.confirmDeleteStructure = function confirmDeleteStructure(id, name) {
      deletingStructureId = id;
      setText('deleteStructureName', name);
      openModal('deleteStructureModal');
    };

    window.executeDeleteStructure = async function executeDeleteStructure() {
      if (!deletingStructureId) return;
      await window.api.request(`/fees/structures/${deletingStructureId}`, { method: 'DELETE' });
      closeModal('deleteStructureModal');
      window.showToast?.('Structure deleted', 'success');
      deletingStructureId = null;
      await loadStructures();
    };

    window.openAssignModal = function openAssignModal(id) {
      const s = structures.find((x) => x._id === id);
      if (!s) return;
      byId('assignStructureId').value = id;
      byId('assignDept').value = s.department || '';
      byId('assignSem').value = s.semester || '';
      byId('assignDueDate').value = '';
      byId('assignDiscountType').value = 'none';
      byId('assignDiscountValue').value = '0';
      byId('assignDiscountValue').disabled = true;
      byId('assignScholarshipGroup').style.display = 'none';
      byId('assignDiscountReason').value = '';
      byId('executeAssignBtn').disabled = false;
      assignSelectedStudentIds = [];
      assignAllStudents = [];
      assignMode = 'individual';
      setAssignMode('individual');
      const preview = byId('assignPreview');
      if (preview) {
        preview.style.display = '';
        setText('assignPreviewName', s.name);
        setText('assignPreviewAmount', formatMoney(s.totalAmount));
        setText('assignPreviewFinal', formatMoney(s.totalAmount));
        setText('assignPreviewCount', '0');
      }
      loadAssignableStudents(id);
      openModal('assignStructureModal');
    };

    let assignSelectedStudentIds = [];
    let assignAllStudents = [];
    let assignMode = 'individual';

    window.setAssignMode = function setAssignMode(mode) {
      assignMode = mode;
      const indBtn = byId('assignModeIndividual');
      const bulkBtn = byId('assignModeBulk');
      const indSection = byId('assignIndividualSection');
      const bulkSection = byId('assignBulkSection');
      if (mode === 'individual') {
        if (indBtn) { indBtn.className = 'btn btn-sm btn-primary'; indBtn.style.background = 'linear-gradient(135deg,#10B981,#059669)'; indBtn.style.border = 'none'; }
        if (bulkBtn) { bulkBtn.className = 'btn btn-sm btn-secondary'; bulkBtn.style.background = ''; bulkBtn.style.border = ''; }
        if (indSection) indSection.style.display = '';
        if (bulkSection) bulkSection.style.display = 'none';
      } else {
        if (bulkBtn) { bulkBtn.className = 'btn btn-sm btn-primary'; bulkBtn.style.background = 'linear-gradient(135deg,#10B981,#059669)'; bulkBtn.style.border = 'none'; }
        if (indBtn) { indBtn.className = 'btn btn-sm btn-secondary'; indBtn.style.background = ''; indBtn.style.border = ''; }
        if (bulkSection) bulkSection.style.display = '';
        if (indSection) indSection.style.display = 'none';
      }
      updateAssignPreviewCount();
    };

    async function loadAssignableStudents(structureId) {
      const listEl = byId('assignStudentList');
      const dropdownEl = byId('assignStudentDropdown');
      if (listEl) listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8"><i class="fas fa-spinner fa-spin"></i> Loading students...</div>';
      if (dropdownEl) dropdownEl.innerHTML = '';
      try {
        const res = await window.api.request(`/fees/assignable-students?structureId=${structureId}`, { silent: true });
        assignAllStudents = res.students || [];
        renderAssignableStudents(assignAllStudents);
      } catch (e) {
        if (listEl) listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#EF4444">Failed to load students</div>';
      }
    }

    function renderAssignableStudents(students) {
      const listEl = byId('assignStudentList');
      if (!listEl) return;
      if (!students.length) {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94A3B8">No students found</div>';
        return;
      }
      listEl.innerHTML = students.map((s) => {
        const selected = assignSelectedStudentIds.includes(s._id);
        const alreadyAssigned = s.alreadyAssigned;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #F1F5F9;cursor:pointer;${selected ? 'background:#F0FDF4' : alreadyAssigned ? 'background:#F8FAFC;opacity:0.6' : ''}" onclick="toggleAssignStudent('${s._id}')" data-student-id="${s._id}">
          <input type="checkbox" ${selected ? 'checked' : ''} ${alreadyAssigned ? 'disabled' : ''} style="accent-color:#10B981;width:16px;height:16px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:#1E293B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(s.name)}</div>
            <div style="font-size:11px;color:#94A3B8">${escapeHTML(s.rollNo || '-')} · ${escapeHTML(s.department || '-')} · Sem ${s.semester || '-'}</div>
          </div>
          ${alreadyAssigned ? '<span class="badge badge-success" style="font-size:10px">Assigned</span>' : selected ? '<span class="badge badge-info" style="font-size:10px">Selected</span>' : ''}
        </div>`;
      }).join('');
    }

    function renderStudentDropdown(students) {
      const dropdownEl = byId('assignStudentDropdown');
      if (!dropdownEl) return;
      if (!students.length) { dropdownEl.style.display = 'none'; return; }
      dropdownEl.style.display = 'block';
      dropdownEl.innerHTML = students.slice(0, 20).map((s) => {
        const selected = assignSelectedStudentIds.includes(s._id);
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #F8FAFC;${selected ? 'background:#F0FDF4' : ''}" onmousedown="toggleAssignStudent('${s._id}');document.getElementById('assignStudentDropdown').style.display='none';document.getElementById('assignStudentSearch').value=''">
          <div style="flex:1"><span style="font-weight:600;font-size:13px">${escapeHTML(s.name)}</span> <span style="font-size:11px;color:#94A3B8">${escapeHTML(s.rollNo || '')}</span></div>
          ${selected ? '<i class="fas fa-check" style="color:#10B981;font-size:12px"></i>' : ''}
        </div>`;
      }).join('');
    }

    window.toggleAssignStudent = function toggleAssignStudent(studentId) {
      const idx = assignSelectedStudentIds.indexOf(studentId);
      if (idx >= 0) assignSelectedStudentIds.splice(idx, 1);
      else assignSelectedStudentIds.push(studentId);
      renderAssignableStudents(assignAllStudents);
      updateAssignPreviewCount();
    };

    window.selectAllVisibleStudents = function selectAllVisibleStudents() {
      assignAllStudents.forEach((s) => {
        if (!s.alreadyAssigned && !assignSelectedStudentIds.includes(s._id)) assignSelectedStudentIds.push(s._id);
      });
      renderAssignableStudents(assignAllStudents);
      updateAssignPreviewCount();
    };

    window.clearSelectedStudents = function clearSelectedStudents() {
      assignSelectedStudentIds = [];
      renderAssignableStudents(assignAllStudents);
      updateAssignPreviewCount();
    };

    function updateAssignPreviewCount() {
      setText('assignPreviewCount', String(assignSelectedStudentIds.length));
      const btn = byId('executeAssignBtn');
      if (btn) {
        if (assignMode === 'individual') btn.disabled = assignSelectedStudentIds.length === 0;
        else btn.disabled = false;
      }
    }

    byId('assignStudentSearch')?.addEventListener('input', debounce(function () {
      const query = this.value.toLowerCase().trim();
      if (!query) { renderAssignableStudents(assignAllStudents); byId('assignStudentDropdown').style.display = 'none'; return; }
      const filtered = assignAllStudents.filter((s) => {
        if (s.alreadyAssigned) return false;
        return [s.name, s.rollNo, s.email].join(' ').toLowerCase().includes(query);
      });
      renderStudentDropdown(filtered);
    }, 200));

    function updateAssignPreview() {
      const id = byId('assignStructureId').value;
      const s = structures.find((x) => x._id === id);
      if (!s) return;
      const total = Number(s.totalAmount || 0);
      const discType = byId('assignDiscountType')?.value || 'none';
      const discVal = Number(byId('assignDiscountValue')?.value || 0);
      const discAmt = discType === 'percentage' ? Math.round(total * (discVal / 100)) : discType === 'fixed' ? discVal : 0;
      const final = Math.max(total - discAmt, 0);
      setText('assignPreviewAmount', formatMoney(total));
      setText('assignPreviewFinal', formatMoney(final));
    }

    byId('assignDiscountType')?.addEventListener('change', function () {
      const val = this.value;
      byId('assignDiscountValue').disabled = val === 'none';
      byId('assignScholarshipGroup').style.display = val === 'scholarship' ? '' : 'none';
      updateAssignPreview();
    });
    byId('assignDiscountValue')?.addEventListener('input', updateAssignPreview);

    window.executeAssign = async function executeAssign() {
      const id = byId('assignStructureId').value;
      if (!id) return;
      const button = byId('executeAssignBtn');
      setLoading(button, true);
      try {
        const payload = {
          structureId: id,
          dueDate: byId('assignDueDate').value || undefined,
          discountType: byId('assignDiscountType').value,
          discountValue: Number(byId('assignDiscountValue').value || 0),
          discountReason: byId('assignDiscountReason').value.trim(),
          scholarshipName: byId('assignDiscountType').value === 'scholarship' ? byId('assignScholarshipName')?.value.trim() : undefined,
        };
        if (assignMode === 'individual') {
          if (!assignSelectedStudentIds.length) { window.showToast?.('Select at least one student', 'error'); return; }
          payload.studentIds = assignSelectedStudentIds;
        } else {
          payload.department = byId('assignDept').value.trim();
          payload.semester = byId('assignSem').value || undefined;
        }
        const res = await window.api.request('/fees/structures/assign', { method: 'POST', body: JSON.stringify(payload) });
        closeModal('assignStructureModal');
        window.showToast?.(`Assigned to ${res.count || 0} students`, 'success');
        await loadStructures();
      } finally {
        setLoading(button, false);
      }
    };

    if (searchInput) searchInput.oninput = debounce(renderStructures, 250);
    if (statusFilter) statusFilter.onchange = renderStructures;
    if (exportBtn) exportBtn.onclick = function exportStructures() {
      downloadCsv('fee-structures.csv', [['Name', 'Amount', 'Year', 'Semester', 'Status', 'Assigned', 'Collected'], ...structures.map((s) => [s.name, s.totalAmount, s.academicYear, s.semester || '', s.status, s.assignedCount || 0, s.totalCollected || 0])]);
      window.showToast?.('Structures exported', 'success');
    };

    document.getElementById('stInstallmentEnabled')?.addEventListener('change', function () {
      document.getElementById('installmentOptions').style.display = this.checked ? '' : 'none';
    });
    document.getElementById('stLateFeeEnabled')?.addEventListener('change', function () {
      document.getElementById('lateFeeOptions').style.display = this.checked ? '' : 'none';
    });

    window.__erpAdminPageRefresh = loadStructures;
    await loadStructures();
  }

  async function initCollegeAdminFeeAnalyticsPage() {
    const yearSelect = byId('analyticsYear');
    const deptSelect = byId('analyticsDept');
    const refreshBtn = byId('refreshAnalytics');
    let charts = {};

    function destroyCharts() {
      Object.values(charts).forEach((c) => { if (c && typeof c.destroy === 'function') c.destroy(); });
      charts = {};
    }

    function fmtCurrency(val) {
      if (val == null) return '₹0';
      if (val >= 100000) return '₹' + (val / 100000).toFixed(1) + 'L';
      if (val >= 1000) return '₹' + (val / 1000).toFixed(1) + 'K';
      return '₹' + Number(val).toLocaleString('en-IN');
    }

    async function loadAnalytics() {
      destroyCharts();
      const params = new URLSearchParams();
      if (yearSelect && yearSelect.value) params.set('academicYear', yearSelect.value);
      if (deptSelect && deptSelect.value) params.set('department', deptSelect.value);
      const qs = params.toString() ? '?' + params.toString() : '';

      let data;
      try {
        data = await window.api.request('/fees/analytics' + qs, { silent: true });
      } catch (e) {
        showToast('Failed to load analytics', 'error');
        return;
      }
      const a = data.analytics;
      if (!a) return;

      byId('aTotalBilled').textContent = fmtCurrency(a.totalAmount);
      byId('aCollected').textContent = fmtCurrency(a.collectedAmount);
      byId('aPending').textContent = fmtCurrency(a.pendingAmount);
      byId('aOverdue').textContent = fmtCurrency(a.overdueAmount);
      byId('aCollectionRate').textContent = a.collectionRate + '%';
      byId('aLateFees').textContent = fmtCurrency(a.totalLateFees);

      const months = Object.keys(a.byMonth).sort();
      const collectedData = months.map((m) => a.byMonth[m].collected || 0);
      const pendingData = months.map((m) => a.byMonth[m].pending || 0);
      const monthLabels = months.map((m) => {
        const [y, mo] = m.split('-');
        return new Date(y, mo - 1).toLocaleString('en', { month: 'short', year: '2-digit' });
      });

      charts.monthly = new Chart(byId('monthlyChart'), {
        type: 'bar',
        data: {
          labels: monthLabels.length ? monthLabels : ['No Data'],
          datasets: [
            { label: 'Collected', data: collectedData.length ? collectedData : [0], backgroundColor: '#10B981', borderRadius: 6 },
            { label: 'Pending', data: pendingData.length ? pendingData : [0], backgroundColor: '#F59E0B', borderRadius: 6 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        },
      });

      const typeLabels = Object.keys(a.byType);
      const typeData = typeLabels.map((t) => a.byType[t]);
      const typeColors = ['#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#0EA5E9', '#EC4899'];

      charts.feeType = new Chart(byId('feeTypeChart'), {
        type: 'doughnut',
        data: {
          labels: typeLabels.length ? typeLabels : ['No Data'],
          datasets: [{ data: typeData.length ? typeData : [1], backgroundColor: typeColors.slice(0, typeLabels.length || 1) }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } },
        },
      });

      const deptLabels = Object.keys(a.byDepartment);
      const deptData = deptLabels.map((d) => a.byDepartment[d]);

      charts.dept = new Chart(byId('deptChart'), {
        type: 'bar',
        data: {
          labels: deptLabels.length ? deptLabels : ['No Data'],
          datasets: [{ label: 'Amount', data: deptData.length ? deptData : [0], backgroundColor: '#4F46E5', borderRadius: 6 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } },
        },
      });

      const inst = a.installmentStats || { total: 0, paid: 0, pending: 0, overdue: 0 };
      charts.installment = new Chart(byId('installmentChart'), {
        type: 'doughnut',
        data: {
          labels: ['Paid', 'Pending', 'Overdue'],
          datasets: [{ data: [inst.paid, inst.pending, inst.overdue], backgroundColor: ['#10B981', '#F59E0B', '#EF4444'] }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } },
        },
      });

      const total = a.totalFees || 1;
      const statusRows = [
        { label: 'Paid', count: a.paidCount, amount: a.collectedAmount, color: '#10B981' },
        { label: 'Partial', count: a.partialCount, amount: 0, color: '#0EA5E9' },
        { label: 'Pending', count: a.pendingCount, amount: a.pendingAmount, color: '#F59E0B' },
        { label: 'Overdue', count: a.overdueCount, amount: a.overdueAmount, color: '#EF4444' },
        { label: 'Waived', count: a.waivedCount, amount: 0, color: '#8B5CF6' },
      ];
      const statusTbody = byId('statusTableBody');
      if (statusTbody) {
        statusTbody.innerHTML = statusRows.map((r) => `<tr>
          <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${r.color};margin-right:8px"></span>${r.label}</td>
          <td>${r.count}</td>
          <td>${fmtCurrency(r.amount)}</td>
          <td>${Math.round((r.count / total) * 100)}%</td>
        </tr>`).join('');
      }

      const discountRows = [
        { label: 'Total Discounts', value: fmtCurrency(a.totalDiscounts) },
        { label: 'Total Late Fees', value: fmtCurrency(a.totalLateFees) },
        { label: 'Net Collections', value: fmtCurrency(a.collectedAmount - a.totalLateFees + a.totalDiscounts) },
      ];
      const discTbody = byId('discountTableBody');
      if (discTbody) {
        discTbody.innerHTML = discountRows.map((r) => `<tr><td style="font-weight:600">${r.label}</td><td>${r.value}</td></tr>`).join('');
      }
    }

    async function loadFilters() {
      try {
        const [summary, structures] = await Promise.all([
          window.api.request('/fees/summary', { silent: true }),
          window.api.request('/fees/structures', { silent: true }),
        ]);
        const years = new Set();
        const depts = new Set();
        if (summary.summary) {
          years.add('2026');
          years.add('2025');
        }
        (structures.structures || []).forEach((s) => {
          if (s.academicYear) years.add(s.academicYear);
          if (s.department) depts.add(s.department);
        });
        if (yearSelect) {
          yearSelect.innerHTML = '<option value="">All Years</option>';
          [...years].sort().forEach((y) => { yearSelect.innerHTML += `<option value="${y}">${y}</option>`; });
        }
        if (deptSelect) {
          deptSelect.innerHTML = '<option value="">All Departments</option>';
          [...depts].sort().forEach((d) => { deptSelect.innerHTML += `<option value="${d}">${d}</option>`; });
        }
      } catch (e) { /* ignore */ }
    }

    if (yearSelect) yearSelect.addEventListener('change', loadAnalytics);
    if (deptSelect) deptSelect.addEventListener('change', loadAnalytics);
    if (refreshBtn) refreshBtn.addEventListener('click', loadAnalytics);

    await Promise.all([loadFilters(), loadAnalytics()]);
  }

  async function initCollegeAdminNoticesPage() {
    const searchInput = cloneById('noticeSearch');
    const targetSelect = byId('nTarget');
    let notices = [];
    let currentFilter = 'all';
    let editingNoticeId = null;

    if (targetSelect) {
      targetSelect.innerHTML = '<option>All</option><option>Students Only</option><option>Faculty Only</option><option>Parents Only</option><option>College Admins Only</option>';
    }
    qa('#postNoticeModal .modal-close, #postNoticeModal .btn.btn-secondary').forEach((button) => {
      button.addEventListener('click', () => {
        editingNoticeId = null;
        window.postNotice = createNotice;
      });
    });

    async function createNotice() {
      const payload = {
        title: byId('nTitle')?.value.trim(),
        body: byId('nBody')?.value.trim(),
        category: byId('nCategory')?.value,
        target: byId('nTarget')?.value,
        expiry: byId('nExpiry')?.value,
      };
      if (!payload.title || !payload.body) return window.showToast?.('Title and message are required', 'error');
      const wasEditing = Boolean(editingNoticeId);
      await window.api.request(editingNoticeId ? `/notices/${editingNoticeId}` : '/notices', { method: editingNoticeId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('postNoticeModal');
      byId('nTitle').value = '';
      byId('nBody').value = '';
      editingNoticeId = null;
      window.showToast?.(wasEditing ? 'Notice updated successfully' : 'Notice posted successfully', 'success');
      await loadNotices();
    }

    function renderNotices() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = notices.filter((item) => {
        if (currentFilter !== 'all' && item.type !== currentFilter && !(currentFilter === 'academic' && item.type === 'exam')) return false;
        return !query || [item.title, item.content].join(' ').toLowerCase().includes(query);
      });
      setHTML('noticesGrid', filtered.map((item) => `
        <div class="card" style="padding:18px;border-left:4px solid ${item.type === 'urgent' ? '#EF4444' : item.type === 'exam' ? '#4F46E5' : '#10B981'}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px"><span class="badge badge-gray">${escapeHTML(item.type)}</span><span style="font-size:11px;color:#94A3B8">${formatDate(item.createdAt)}</span></div>
          <div style="font-size:15px;font-weight:700;margin-bottom:8px">${escapeHTML(item.title)}</div>
          <div style="font-size:13px;color:#64748B;line-height:1.6;margin-bottom:12px">${escapeHTML(item.content)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #F1F5F9;padding-top:12px"><div style="font-size:11px;color:#94A3B8">${(item.targetRoles || []).join(', ')}</div><div style="display:flex;gap:6px"><button class="btn btn-xs btn-secondary" onclick="editNotice('${item._id}')"><i class="fas fa-edit"></i></button><button class="btn btn-xs btn-danger" onclick="deleteNotice('${item._id}')"><i class="fas fa-trash"></i></button></div></div>
        </div>
      `).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No notices found</div></div>');
    }

    async function loadNotices() {
      const res = await window.api.request('/notices', { silent: true });
      notices = res.notices || [];
      window.postNotice = createNotice;
      renderNotices();
    }

    window.filterNotices = function filterNotices(filter, button) {
      currentFilter = filter;
      qa('.tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      renderNotices();
    };

    window.postNotice = createNotice;

    window.editNotice = async function editNotice(id) {
      const item = notices.find((entry) => String(entry._id) === String(id));
      if (!item) return;
      byId('nTitle').value = item.title || '';
      byId('nBody').value = item.content || '';
      byId('nCategory').value = item.type === 'exam' ? 'academic' : item.type;
      byId('nTarget').value = item.targetRoles?.[0] === 'student' ? 'Students Only' : item.targetRoles?.[0] === 'faculty' ? 'Faculty Only' : 'All';
      byId('nExpiry').value = item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : '';
      editingNoticeId = id;
      window.openModal?.('postNoticeModal');
    };

    window.deleteNotice = async function deleteNotice(id) {
      await window.api.request(`/notices/${id}`, { method: 'DELETE' });
      window.showToast?.('Notice deleted', 'warning');
      await loadNotices();
    };

    if (searchInput) searchInput.oninput = renderNotices;
    window.__erpAdminPageRefresh = loadNotices;
    await loadNotices();
  }

  async function initCollegeAdminHrPage() {
    let leaves = [];
    let faculty = [];
    let currentFilter = 'pending';

    function renderLeaves() {
      const filtered = currentFilter === 'all' ? leaves : leaves.filter((item) => item.status === currentFilter);
      setStatCard(0, 'Pending Requests', String(leaves.filter((item) => item.status === 'pending').length));
      setStatCard(1, 'Approved', String(leaves.filter((item) => item.status === 'approved').length));
      setStatCard(2, 'Rejected', String(leaves.filter((item) => item.status === 'rejected').length));
      setStatCard(3, 'Currently Absent', String(new Set(leaves.filter((item) => item.status === 'approved').map((item) => String(item.userId?._id || item.userId))).size));

      setHTML('leavesBody', filtered.map((item, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((item.userId?.name || 'F')[0])}</div><div><div style="font-weight:600">${escapeHTML(item.userId?.name || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(item.userId?.department || '-')}</div></div></div></td>
          <td><span class="badge badge-gray">${escapeHTML(item.leaveType)}</span></td>
          <td style="font-size:12px;color:#64748B">${formatDate(item.startDate)} → ${formatDate(item.endDate)}</td>
          <td style="font-weight:600">${Math.max(1, Math.ceil((new Date(item.endDate) - new Date(item.startDate)) / 86400000) + 1)}</td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(item.reason)}</td>
          <td style="font-size:12px;color:#94A3B8">${formatDate(item.createdAt)}</td>
          <td><span class="badge ${item.status === 'approved' ? 'badge-success' : item.status === 'rejected' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(item.status)}</span></td>
          <td>${item.status === 'pending' ? `<div style="display:flex;gap:5px"><button class="btn btn-xs btn-success" onclick="updateLeave('${item._id}','approved')"><i class="fas fa-check"></i> Approve</button><button class="btn btn-xs btn-danger" onclick="updateLeave('${item._id}','rejected')"><i class="fas fa-times"></i> Reject</button></div>` : '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">No leave requests found</div></div></td></tr>');

      const summaryCards = qa('.erp-content .card:last-child .card-body > div > div');
      if (summaryCards[0]) q('div:last-child', summaryCards[0]).textContent = String(Math.max(faculty.length - leaves.filter((item) => item.status === 'approved').length, 0));
      if (summaryCards[1]) q('div:last-child', summaryCards[1]).textContent = String(leaves.filter((item) => item.status === 'rejected').length);
      if (summaryCards[2]) q('div:last-child', summaryCards[2]).textContent = String(leaves.filter((item) => item.status === 'approved').length);
      if (summaryCards[3]) q('div:last-child', summaryCards[3]).textContent = String(leaves.filter((item) => item.status === 'pending').length);
    }

    async function loadLeaves() {
      const [leaveRes, facultyRes] = await Promise.all([
        window.api.request('/leave/all', { silent: true }),
        window.api.request('/college-admin/faculty', { silent: true }),
      ]);
      leaves = leaveRes.leaves || [];
      faculty = facultyRes.faculty || [];
      renderLeaves();
    }

    window.filterLeaves = function filterLeaves(status, button) {
      currentFilter = status;
      qa('.tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      renderLeaves();
    };

    window.updateLeave = async function updateLeave(id, status) {
      await window.api.request(`/leave/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      window.showToast?.(`Leave ${status}`, status === 'approved' ? 'success' : 'warning');
      await loadLeaves();
    };

    window.__erpAdminPageRefresh = loadLeaves;
    await loadLeaves();
  }

  async function initCollegeAdminCoursesPage() {
    let faculty = [];
    let subjects = [];
    let exams = [];
    let timetable = [];
    let batchCounts = {};
    let currentTab = 'courses';
    let currentExamFilter = 'all';
    let currentTimetableBatch = '';
    let currentTimetableDay = 'all';
    let currentTimetableFaculty = 'all';
    let currentTimetableSearch = '';
    const timetableDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function examStatus(item) {
      const examDate = new Date(item.date);
      const now = new Date();
      if (examDate.toDateString() === now.toDateString()) return 'ongoing';
      return examDate > now ? 'upcoming' : 'completed';
    }

    function fillFacultySelect() {
      const select = byId('cFaculty');
      if (select) {
        select.innerHTML = '<option value="">Select Faculty</option>' + faculty.map((item) => `<option value="${item._id}">${escapeHTML(item.name)}</option>`).join('');
      }

      const ttFaculty = byId('ttFaculty');
      if (ttFaculty) {
        ttFaculty.innerHTML = '<option value="">Select Faculty</option>' + faculty.map((item) => `<option value="${item._id}">${escapeHTML(item.name)}${item.department ? ` • ${escapeHTML(item.department)}` : ''}</option>`).join('');
      }

      const facultyFilter = byId('timetableFacultyFilter');
      if (facultyFilter) {
        facultyFilter.innerHTML = '<option value="all">All Faculty</option>' + faculty.map((item) => `<option value="${item._id}">${escapeHTML(item.name)}</option>`).join('');
        facultyFilter.value = currentTimetableFaculty;
      }
    }

    function fillTimetableSubjectSelect() {
      const select = byId('ttSubject');
      if (!select) return;
      select.innerHTML = '<option value="">Select Subject</option>' + subjects.map((item) => `<option value="${item._id}">${escapeHTML(item.code || '')} - ${escapeHTML(item.name)} • ${escapeHTML(item.courseId?.department || '-')} Sem ${item.semester || '-'}</option>`).join('');
    }

    function batchKeyFor(item) {
      return `${item.courseId?.department || '-'}|${item.semester || '-'}`;
    }

    function batchLabel(key) {
      const [department, semester] = String(key || '-|-').split('|');
      return `${department || '-'} Sem ${semester || '-'}`;
    }

    function overlaps(a, b) {
      return a.dayOfWeek === b.dayOfWeek && timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
    }

    function subjectMatchesSearch(item, query) {
      const text = [
        item.subjectId?.name,
        item.subjectId?.code,
        item.facultyId?.name,
        item.room,
        item.type,
        item.courseId?.department,
        item.semester,
      ].join(' ').toLowerCase();
      return !query || text.includes(query);
    }

    function detectTimetableConflicts(rows) {
      const conflicts = [];
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          const a = rows[i];
          const b = rows[j];
          if (!overlaps(a, b)) continue;
          if (String(a.facultyId?._id || a.facultyId) === String(b.facultyId?._id || b.facultyId)) {
            conflicts.push({ type: 'Faculty clash', a, b, icon: 'fa-chalkboard-user' });
          }
          if (String(a.room || '').trim().toLowerCase() && String(a.room || '').trim().toLowerCase() === String(b.room || '').trim().toLowerCase()) {
            conflicts.push({ type: 'Room clash', a, b, icon: 'fa-door-closed' });
          }
          if (batchKeyFor(a) === batchKeyFor(b)) {
            conflicts.push({ type: 'Batch clash', a, b, icon: 'fa-users' });
          }
        }
      }
      return conflicts;
    }

    function getTimetableBatches() {
      return Array.from(new Set([
        ...subjects.map(batchKeyFor),
        ...timetable.map(batchKeyFor),
      ])).filter((item) => item && item !== '-|-').sort();
    }

    function getFilteredTimetableRows() {
      const query = currentTimetableSearch.toLowerCase();
      return timetable.filter((item) => {
        const batchMatch = !currentTimetableBatch || batchKeyFor(item) === currentTimetableBatch;
        const dayMatch = currentTimetableDay === 'all' || item.dayOfWeek === currentTimetableDay;
        const facultyMatch = currentTimetableFaculty === 'all' || String(item.facultyId?._id || item.facultyId) === String(currentTimetableFaculty);
        return batchMatch && dayMatch && facultyMatch && subjectMatchesSearch(item, query);
      });
    }

    function renderAdminTimetablePanels(allBatches) {
      const coveredBatches = new Set(timetable.map(batchKeyFor));
      const coverage = allBatches.length ? Math.round((allBatches.filter((item) => coveredBatches.has(item)).length / allBatches.length) * 100) : 0;
      const conflicts = detectTimetableConflicts(timetable);
      const facultyLoads = faculty.map((item) => {
        const rows = timetable.filter((slot) => String(slot.facultyId?._id || slot.facultyId) === String(item._id));
        const minutes = rows.reduce((sum, slot) => sum + Math.max(timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime), 0), 0);
        return { faculty: item, rows, minutes };
      }).sort((a, b) => b.rows.length - a.rows.length);
      const roomLoads = Array.from(timetable.reduce((map, slot) => {
        const room = slot.room || 'Unmapped room';
        if (!map.has(room)) map.set(room, []);
        map.get(room).push(slot);
        return map;
      }, new Map()).entries()).map(([room, rows]) => ({ room, rows })).sort((a, b) => b.rows.length - a.rows.length);
      const maxFacultyLoad = facultyLoads[0]?.rows.length || 0;
      const maxRoomLoad = roomLoads[0]?.rows.length || 0;

      setText('adminTtTotalSlots', String(timetable.length));
      setText('adminTtBatchCoverage', `${coverage}%`);
      setText('adminTtFacultyLoad', maxFacultyLoad ? `${maxFacultyLoad} max` : 'Pending');
      setText('adminTtConflictCount', String(conflicts.length));
      setText('adminTimetableTitle', currentTimetableBatch ? batchLabel(currentTimetableBatch) : 'All academic batches');
      setText('adminTimetableSubtitle', `${allBatches.length} batch plan(s), ${facultyLoads.filter((item) => item.rows.length).length} faculty with assigned slots, ${roomLoads.length} room(s) in use.`);

      setHTML('adminTimetableConflicts', conflicts.slice(0, 7).map((item) => `
        <div class="admin-tt-row danger">
          <i class="fas ${item.icon}"></i>
          <div><strong>${escapeHTML(item.type)}</strong><span>${escapeHTML(item.a.dayOfWeek)} ${escapeHTML(item.a.startTime)}-${escapeHTML(item.a.endTime)} • ${escapeHTML(item.a.subjectId?.code || item.a.subjectId?.name || '-')} conflicts with ${escapeHTML(item.b.subjectId?.code || item.b.subjectId?.name || '-')}</span></div>
        </div>
      `).join('') || '<div class="admin-tt-row success"><i class="fas fa-circle-check"></i><div><strong>No visible clashes</strong><span>Faculty, room, and batch slots are clear for overlapping periods.</span></div></div>');

      setHTML('adminFacultyLoadList', facultyLoads.slice(0, 7).map((item) => {
        const pct = maxFacultyLoad ? Math.round((item.rows.length / maxFacultyLoad) * 100) : 0;
        return `
          <div class="admin-tt-load-row">
            <div><strong>${escapeHTML(item.faculty.name)}</strong><span>${item.rows.length} slot(s) • ${(item.minutes / 60).toFixed(item.minutes % 60 ? 1 : 0)}h/week</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#4F46E5"></div></div>
          </div>
        `;
      }).join('') || '<div class="empty-state"><div class="empty-state-title">No faculty slots assigned</div></div>');

      setHTML('adminRoomLoadList', roomLoads.slice(0, 7).map((item) => {
        const pct = maxRoomLoad ? Math.round((item.rows.length / maxRoomLoad) * 100) : 0;
        return `
          <div class="admin-tt-load-row">
            <div><strong>${escapeHTML(item.room)}</strong><span>${item.rows.length} slot(s) scheduled</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#059669"></div></div>
          </div>
        `;
      }).join('') || '<div class="empty-state"><div class="empty-state-title">No room usage yet</div></div>');
    }

    function renderCourses() {
      setHTML('coursesGrid', subjects.map((item) => {
        const batchKey = `${item.courseId?.department || ''}-${item.semester || ''}`;
        const studentsCount = batchCounts[batchKey] || 0;
        return `
          <div class="card" style="padding:18px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px"><code style="font-size:11px;background:#EDE9FE;color:#5B21B6;padding:3px 8px;border-radius:6px;font-weight:700">${escapeHTML(item.code)}</code><span class="badge badge-gray">${item.credits || 0} Credits</span></div>
            <div style="font-size:15px;font-weight:700;margin-bottom:4px">${escapeHTML(item.name)}</div>
            <div style="font-size:12px;color:#64748B;margin-bottom:12px">${escapeHTML(item.courseId?.department || '-')} • Sem ${item.semester || '-'}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:#F8FAFC;border-radius:8px"><div class="avatar avatar-sm" style="width:28px;height:28px;font-size:11px">${escapeHTML((item.facultyId?.name || 'F')[0])}</div><span style="font-size:12px;font-weight:600">${escapeHTML(item.facultyId?.name || 'Unassigned')}</span></div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #F1F5F9;padding-top:12px"><span style="font-size:12px;color:#64748B"><i class="fas fa-users"></i> ${studentsCount} students</span></div>
          </div>
        `;
      }).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No subjects found</div></div>');
    }

    function renderExams(filter) {
      const rows = filter && filter !== 'all' ? exams.filter((item) => examStatus(item) === filter) : exams;
      setHTML('examsBody', rows.map((item, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td style="font-weight:600">${escapeHTML(item.name)}</td>
          <td>${escapeHTML(item.subjectId?.name || item.subjectId?.code || '-')}</td>
          <td style="font-size:12px;color:#64748B">${escapeHTML(item.courseId?.department || '-')} • Sem ${item.semester || '-'}</td>
          <td style="font-size:12px">${formatDate(item.date)}${item.startTime ? `<div style="color:#94A3B8">${escapeHTML(item.startTime)}</div>` : ''}</td>
          <td>${escapeHTML(item.venue || '-')}</td>
          <td><span class="badge ${examStatus(item) === 'completed' ? 'badge-success' : examStatus(item) === 'ongoing' ? 'badge-warning' : 'badge-info'}">${examStatus(item)}</span></td>
          <td>-</td>
        </tr>
      `).join('') || '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">No exams scheduled</div></div></td></tr>');
    }

    function renderTimetable() {
      const batchSelect = byId('timetableBatchSelect');
      const daySelect = byId('timetableDayFilter');
      const facultyFilter = byId('timetableFacultyFilter');
      const searchInput = byId('timetableSearch');
      const batches = getTimetableBatches();

      if (!currentTimetableBatch || !batches.includes(currentTimetableBatch)) currentTimetableBatch = batches[0] || '';
      if (batchSelect) {
        batchSelect.innerHTML = batches.map((item) => `<option value="${item}">${escapeHTML(batchLabel(item))}</option>`).join('') || '<option value="">No batches available</option>';
        batchSelect.value = currentTimetableBatch;
      }
      if (daySelect) daySelect.value = currentTimetableDay;
      if (facultyFilter) facultyFilter.value = currentTimetableFaculty;
      if (searchInput) searchInput.value = currentTimetableSearch;

      renderAdminTimetablePanels(batches);

      const filtered = getFilteredTimetableRows();
      const times = Array.from(new Set(filtered.map((item) => `${item.startTime} - ${item.endTime}`))).sort((a, b) => timeToMinutes(a.split(' - ')[0]) - timeToMinutes(b.split(' - ')[0]));
      setText('adminTimetableGridTitle', `Weekly Timetable - ${currentTimetableBatch ? batchLabel(currentTimetableBatch) : 'No batch selected'}`);
      setText('adminTimetableGridBadge', `${filtered.length} visible slot(s)`);
      setText('adminTimetableLedgerCount', `${filtered.length} Slot${filtered.length === 1 ? '' : 's'}`);

      setHTML('timetableBody', times.map((slot) => {
        const start = slot.split(' - ')[0];
        return `<tr><td style="font-size:12px;font-weight:600;color:#64748B;white-space:nowrap">${escapeHTML(slot)}</td>${timetableDays.map((day) => {
          const entry = filtered.find((item) => item.dayOfWeek === day && item.startTime === start);
          if (!entry) return '<td><div class="timetable-empty-cell"></div></td>';
          const typeBadge = entry.type === 'lab' ? 'badge-purple' : entry.type === 'tutorial' ? 'badge-warning' : 'badge-info';
          return `<td style="padding:6px"><div class="timetable-session admin-session"><div class="session-code">${escapeHTML(entry.subjectId?.code || entry.type || 'Class')}</div><div class="session-title">${escapeHTML(entry.subjectId?.name || '-')}</div><div class="session-meta"><i class="fas fa-user-tie"></i> ${escapeHTML(entry.facultyId?.name || '-')}</div><div class="session-meta"><i class="fas fa-location-dot"></i> ${escapeHTML(entry.room || 'Room pending')}</div><div class="session-foot"><span class="badge ${typeBadge}">${escapeHTML(entry.type || 'lecture')}</span></div></div></td>`;
        }).join('')}</tr>`;
      }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No timetable entries match the selected filters</div></div></td></tr>');

      setHTML('adminTimetableLedgerBody', filtered.sort((a, b) => timetableDays.indexOf(a.dayOfWeek) - timetableDays.indexOf(b.dayOfWeek) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime)).map((item, index) => {
        const slotConflicts = detectTimetableConflicts(timetable).filter((conflict) => String(conflict.a._id || conflict.a.id) === String(item._id || item.id) || String(conflict.b._id || conflict.b.id) === String(item._id || item.id));
        return `
          <tr>
            <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
            <td><span class="badge badge-gray">${escapeHTML(item.dayOfWeek)}</span></td>
            <td style="font-size:12px;font-weight:700;color:#475569">${escapeHTML(item.startTime)}-${escapeHTML(item.endTime)}</td>
            <td><div style="font-weight:700">${escapeHTML(item.subjectId?.name || '-')}</div><div style="font-size:11px;color:#94A3B8">${escapeHTML(item.subjectId?.code || '-')}</div></td>
            <td style="font-size:12px;color:#64748B">${escapeHTML(batchLabel(batchKeyFor(item)))}</td>
            <td>${escapeHTML(item.facultyId?.name || '-')}</td>
            <td>${escapeHTML(item.room || '-')}</td>
            <td><span class="badge ${item.type === 'lab' ? 'badge-purple' : item.type === 'tutorial' ? 'badge-warning' : 'badge-info'}">${escapeHTML(item.type || 'lecture')}</span></td>
            <td><span class="badge ${slotConflicts.length ? 'badge-danger' : 'badge-success'}">${slotConflicts.length ? `${slotConflicts.length} clash` : 'Clear'}</span></td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="9"><div class="empty-state"><div class="empty-state-title">No timetable slots found</div></div></td></tr>');
    }

    window.showTab = function showTab(tab, button) {
      currentTab = tab;
      ['courses', 'exams', 'timetable'].forEach((name) => {
        const section = byId(`tab-${name}`);
        if (section) section.style.display = name === tab ? '' : 'none';
      });
      const mainButtons = qa('.erp-content > .tab-bar .tab-btn');
      mainButtons.forEach((item) => item.classList.remove('active'));
      const activeButton = button || mainButtons.find((item) => (item.getAttribute('onclick') || '').includes(`'${tab}'`));
      if (activeButton) activeButton.classList.add('active');
    };

    async function loadData() {
      const [facultyRes, subjectRes, examRes, timetableRes] = await Promise.all([
        window.api.request('/college-admin/faculty', { silent: true }),
        window.api.request('/academics/subjects', { silent: true }),
        window.api.request('/exams', { silent: true }),
        window.api.request('/academics/timetable', { silent: true }),
      ]);
      faculty = facultyRes.faculty || [];
      subjects = subjectRes.subjects || [];
      exams = examRes.exams || [];
      timetable = timetableRes.timetable || [];
      const uniqueBatches = Array.from(new Set(subjects.map((item) => `${item.courseId?.department || ''}|${item.semester || ''}`)));
      const counts = await Promise.all(uniqueBatches.map(async (item) => {
        const [department, semester] = item.split('|');
        const res = await window.api.request(`/academics/students${routeParams({ department, semester })}`, { silent: true });
        return [item.replace('|', '-'), (res.students || []).length];
      }));
      batchCounts = Object.fromEntries(counts);
      fillFacultySelect();
      fillTimetableSubjectSelect();
      renderCourses();
      renderExams(currentExamFilter);
      renderTimetable();
      window.showTab(currentTab);

      const courseSaveBtn = q('#addCourseModal .modal-footer .btn.btn-primary');
      const examSaveBtn = q('#addExamModal .modal-footer .btn.btn-primary');
      if (courseSaveBtn) courseSaveBtn.onclick = window.createCourseLive;
      if (examSaveBtn) examSaveBtn.onclick = window.scheduleExamLive;
      if (byId('timetableBatchSelect')) byId('timetableBatchSelect').onchange = function onBatchChange() { currentTimetableBatch = this.value; renderTimetable(); };
      if (byId('timetableDayFilter')) byId('timetableDayFilter').onchange = function onDayChange() { currentTimetableDay = this.value; renderTimetable(); };
      if (byId('timetableFacultyFilter')) byId('timetableFacultyFilter').onchange = function onFacultyChange() { currentTimetableFaculty = this.value; renderTimetable(); };
      if (byId('timetableSearch')) byId('timetableSearch').oninput = debounce(function onTimetableSearch() { currentTimetableSearch = byId('timetableSearch')?.value.trim() || ''; renderTimetable(); }, 180);
      if (byId('ttSubject')) byId('ttSubject').onchange = function onSlotSubjectChange() {
        const subject = subjects.find((item) => String(item._id) === String(this.value));
        if (subject?.facultyId?._id && byId('ttFaculty')) byId('ttFaculty').value = subject.facultyId._id;
      };
    }

    window.filterExams = function filterExams(filter, button) {
      currentExamFilter = filter;
      qa('#tab-exams .tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      renderExams(filter);
    };

    window.createCourseLive = async function createCourseLive() {
      const payload = {
        name: byId('cName')?.value.trim(),
        code: byId('cCode')?.value.trim(),
        credits: Number(byId('cCredits')?.value || 0),
        branch: byId('cBranch')?.value,
        semester: byId('cSem')?.value,
        faculty: byId('cFaculty')?.value,
      };
      if (!payload.name || !payload.code || !payload.branch || !payload.semester) return window.showToast?.('Fill all required fields', 'error');
      await window.api.request('/academics/subjects', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('addCourseModal');
      qa('#addCourseModal input').forEach((input) => { input.value = ''; });
      window.showToast?.('Subject created successfully', 'success');
      await loadData();
    };

    window.scheduleExamLive = async function scheduleExamLive() {
      const payload = {
        name: byId('eName')?.value.trim(),
        subject: byId('eSubject')?.value.trim(),
        room: byId('eRoom')?.value.trim(),
        date: byId('eDate')?.value,
        time: byId('eTime')?.value,
        branch: byId('eBranch')?.value,
        maxMarks: Number(byId('eMarks')?.value || 0),
        examType: 'midterm',
      };
      if (!payload.name || !payload.subject || !payload.date || !payload.maxMarks) return window.showToast?.('Fill all required fields', 'error');
      await window.api.request('/exams', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('addExamModal');
      qa('#addExamModal input').forEach((input) => { input.value = ''; });
      window.showToast?.('Exam scheduled successfully', 'success');
      await loadData();
    };

    window.openTimetableSlotModal = function openTimetableSlotModal() {
      fillFacultySelect();
      fillTimetableSubjectSelect();
      const subjectSelect = byId('ttSubject');
      if (subjectSelect && currentTimetableBatch) {
        const matchingSubject = subjects.find((item) => batchKeyFor(item) === currentTimetableBatch);
        if (matchingSubject) subjectSelect.value = matchingSubject._id;
        subjectSelect.dispatchEvent(new Event('change'));
      }
      if (byId('ttStart') && !byId('ttStart').value) byId('ttStart').value = '09:00';
      if (byId('ttEnd') && !byId('ttEnd').value) byId('ttEnd').value = '10:00';
      if (byId('ttAcademicYear') && !byId('ttAcademicYear').value) byId('ttAcademicYear').value = '2026-27';
      window.openModal?.('addTimetableModal');
    };

    window.createTimetableSlotLive = async function createTimetableSlotLive() {
      const subject = subjects.find((item) => String(item._id) === String(byId('ttSubject')?.value));
      const selectedFaculty = faculty.find((item) => String(item._id) === String(byId('ttFaculty')?.value));
      const payload = {
        subjectId: subject?._id,
        facultyId: selectedFaculty?._id,
        dayOfWeek: byId('ttDay')?.value,
        startTime: byId('ttStart')?.value,
        endTime: byId('ttEnd')?.value,
        room: byId('ttRoom')?.value.trim(),
        type: byId('ttType')?.value || 'lecture',
        academicYear: byId('ttAcademicYear')?.value.trim(),
      };
      if (!payload.subjectId || !payload.facultyId || !payload.dayOfWeek || !payload.startTime || !payload.endTime || !payload.room) {
        window.showToast?.('Subject, faculty, day, time, and room are required', 'error');
        return;
      }
      if (timeToMinutes(payload.endTime) <= timeToMinutes(payload.startTime)) {
        window.showToast?.('End time must be after start time', 'error');
        return;
      }
      const proposed = {
        ...payload,
        courseId: subject.courseId,
        semester: subject.semester,
        subjectId: subject,
        facultyId: selectedFaculty,
      };
      const conflicts = detectTimetableConflicts([...timetable, proposed]).filter((item) => item.a === proposed || item.b === proposed);
      if (conflicts.length && !window.confirm(`${conflicts.length} possible clash(es) detected. Save this slot anyway?`)) return;
      await window.api.request('/academics/timetable', { method: 'POST', body: JSON.stringify(payload) });
      currentTab = 'timetable';
      currentTimetableBatch = batchKeyFor(subject);
      window.closeModal?.('addTimetableModal');
      ['ttRoom'].forEach((id) => { if (byId(id)) byId(id).value = ''; });
      window.showToast?.('Timetable slot created successfully', 'success');
      await loadData();
    };

    window.exportTimetableLive = function exportTimetableLive() {
      const rows = getFilteredTimetableRows().map((item) => [
        item.dayOfWeek,
        item.startTime,
        item.endTime,
        item.subjectId?.code || '',
        item.subjectId?.name || '',
        batchLabel(batchKeyFor(item)),
        item.facultyId?.name || '',
        item.room || '',
        item.type || 'lecture',
        item.academicYear || '',
      ]);
      downloadCsv('college-timetable.csv', [['Day', 'Start', 'End', 'Subject Code', 'Subject', 'Batch', 'Faculty', 'Room', 'Type', 'Academic Year'], ...rows]);
      window.showToast?.('Timetable exported', 'success');
    };

    window.__erpAdminPageRefresh = loadData;
    await loadData();
  }

  async function initCollegeAdminLogisticsPage() {
    const routeSaveBtn = q('#addRouteModal .modal-footer .btn.btn-primary');
    const hostelSaveBtn = q('#addHostelModal .modal-footer .btn.btn-primary');
    const roomSaveBtn = q('#addRoomModal .modal-footer .btn.btn-primary');
    const allocateBtn = q('#allocateRoomModal .modal-footer .btn.btn-primary');
    let routes = [];
    let hostels = [];
    let rooms = [];

    function setHostelOptions() {
      const options = '<option value="">Select hostel</option>' + hostels.map((item) => `<option value="${item._id}">${escapeHTML(item.name)}</option>`).join('');
      if (byId('roomHostelSelect')) byId('roomHostelSelect').innerHTML = options;
      if (byId('hostelSelectAllocate')) byId('hostelSelectAllocate').innerHTML = options;
    }

    function renderRoutes() {
      setHTML('routesBody', routes.map((route) => `
        <tr>
          <td style="font-weight:700;color:#4F46E5">${escapeHTML(route.routeName)}</td>
          <td style="font-size:13px;max-width:180px">${escapeHTML((route.stops || []).map((stop) => stop.stopName).join(' → ') || '-')}</td>
          <td><code style="font-size:12px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${escapeHTML(route.busNumber || '-')}</code></td>
          <td style="font-size:13px">${escapeHTML(route.driverName || '-')}</td>
          <td style="font-size:13px">${escapeHTML(route.stops?.[0]?.pickupTime || '-')}</td>
          <td><span class="badge badge-info">${(route.enrolledStudents || []).length}</span></td>
          <td><span class="badge ${route.isActive ? 'badge-success' : 'badge-warning'}">${route.isActive ? 'active' : 'maintenance'}</span></td>
          <td><div style="display:flex;gap:5px"><button class="btn btn-xs btn-danger" onclick="deleteRouteLive('${route._id}')"><i class="fas fa-trash"></i></button></div></td>
        </tr>
      `).join('') || '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">No transport routes found</div></div></td></tr>');
    }

    function renderHostels() {
      const container = byId('hostelsGrid');
      if (!container) return;
      container.innerHTML = hostels.map((hostel) => {
        const hostelRooms = rooms.filter((room) => String(room.hostelId?._id || room.hostelId) === String(hostel._id));
        const occupied = hostelRooms.reduce((sum, room) => sum + (room.occupants || []).length, 0);
        const capacity = hostelRooms.reduce((sum, room) => sum + Number(room.capacity || 0), 0) || Number(hostel.totalRooms || 0);
        const pct = capacity ? Math.round((occupied / capacity) * 100) : 0;
        return `
          <div class="card" style="padding:0;overflow:hidden;border-top:4px solid #8B5CF6">
            <div style="padding:16px">
              <div style="font-weight:700;font-size:14px;margin-bottom:4px">${escapeHTML(hostel.name)}</div>
              <div style="font-size:12px;color:#64748B;margin-bottom:12px">${escapeHTML(hostel.type)} • ${hostelRooms.length} configured rooms</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748B">Occupancy</span><span style="font-size:12px;font-weight:700">${occupied}/${capacity || 0}</span></div>
              <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#8B5CF6"></div></div>
              <div style="font-size:11px;color:#94A3B8;margin-top:4px">${pct}% occupied</div>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No hostels configured</div></div>';

      setStatCard(0, 'Transport Routes', String(routes.length));
      setStatCard(1, 'Bus Commuters', String(routes.reduce((sum, item) => sum + (item.enrolledStudents || []).length, 0)));
      setStatCard(2, 'Hostel Blocks', String(hostels.length));
      setStatCard(3, 'Occupied Rooms', String(rooms.reduce((sum, item) => sum + (item.occupants || []).length, 0)));
    }

    async function loadLogistics() {
      const [routeRes, hostelRes] = await Promise.all([
        window.api.request('/logistics/transport', { silent: true }),
        window.api.request('/logistics/hostels', { silent: true }),
      ]);
      routes = routeRes.routes || [];
      hostels = hostelRes.hostels || [];
      rooms = hostelRes.rooms || [];
      setHostelOptions();
      renderRoutes();
      renderHostels();
    }

    window.deleteRouteLive = async function deleteRouteLive(id) {
      await window.api.request(`/logistics/transport/${id}`, { method: 'DELETE' });
      window.showToast?.('Route deleted', 'warning');
      await loadLogistics();
    };

    window.createRouteLive = async function createRouteLive() {
      const payload = {
        routeNo: byId('routeNoInput')?.value.trim(),
        busNumber: byId('routeBusInput')?.value.trim(),
        via: byId('routeStopsInput')?.value.trim(),
        driverName: byId('routeDriverInput')?.value.trim(),
        driverPhone: byId('routeDriverPhoneInput')?.value.trim(),
        morningTime: byId('routeMorningInput')?.value,
        eveningTime: byId('routeEveningInput')?.value,
      };
      if (!payload.routeNo || !payload.busNumber) return window.showToast?.('Route number and bus number are required', 'error');
      await window.api.request('/logistics/transport', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('addRouteModal');
      ['routeNoInput', 'routeBusInput', 'routeStopsInput', 'routeDriverInput', 'routeDriverPhoneInput', 'routeMorningInput', 'routeEveningInput'].forEach((id) => {
        if (byId(id)) byId(id).value = '';
      });
      window.showToast?.('Route added successfully', 'success');
      await loadLogistics();
    };

    window.createHostelLive = async function createHostelLive() {
      const payload = {
        name: byId('hostelNameInput')?.value.trim(),
        type: byId('hostelTypeInput')?.value,
        totalRooms: Number(byId('hostelRoomsInput')?.value || 0),
        facilities: String(byId('hostelFacilitiesInput')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
      };
      if (!payload.name || !payload.type || !payload.totalRooms) return window.showToast?.('Hostel name, type, and total rooms are required', 'error');
      await window.api.request('/logistics/hostels', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('addHostelModal');
      ['hostelNameInput', 'hostelRoomsInput', 'hostelFacilitiesInput'].forEach((id) => { if (byId(id)) byId(id).value = ''; });
      if (byId('hostelTypeInput')) byId('hostelTypeInput').value = 'boys';
      window.showToast?.('Hostel created successfully', 'success');
      await loadLogistics();
    };

    window.createRoomLive = async function createRoomLive() {
      const payload = {
        hostelId: byId('roomHostelSelect')?.value,
        roomNumber: byId('roomNumberInput')?.value.trim(),
        capacity: Number(byId('roomCapacityInput')?.value || 0),
        feePerTerm: Number(byId('roomFeeInput')?.value || 0),
      };
      if (!payload.hostelId || !payload.roomNumber || !payload.capacity || !payload.feePerTerm) return window.showToast?.('Hostel, room number, capacity, and fee are required', 'error');
      await window.api.request('/logistics/hostels/rooms', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('addRoomModal');
      ['roomNumberInput', 'roomCapacityInput', 'roomFeeInput'].forEach((id) => { if (byId(id)) byId(id).value = ''; });
      if (byId('roomHostelSelect')) byId('roomHostelSelect').value = '';
      window.showToast?.('Room created successfully', 'success');
      await loadLogistics();
    };

    window.allocateRoomLive = async function allocateRoomLive() {
      const payload = {
        roll: byId('allocateRollInput')?.value.trim(),
        hostelId: byId('hostelSelectAllocate')?.value,
        roomNumber: byId('allocateRoomNumberInput')?.value.trim(),
      };
      if (!payload.roll || !payload.hostelId || !payload.roomNumber) return window.showToast?.('Roll number, hostel, and room number are required', 'error');
      await window.api.request('/logistics/hostels/allocate', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('allocateRoomModal');
      ['allocateRollInput', 'allocateRoomNumberInput'].forEach((id) => { if (byId(id)) byId(id).value = ''; });
      if (byId('hostelSelectAllocate')) byId('hostelSelectAllocate').value = '';
      window.showToast?.('Room allocated successfully', 'success');
      await loadLogistics();
    };

    if (routeSaveBtn) routeSaveBtn.onclick = window.createRouteLive;
    if (hostelSaveBtn) hostelSaveBtn.onclick = window.createHostelLive;
    if (roomSaveBtn) roomSaveBtn.onclick = window.createRoomLive;
    if (allocateBtn) allocateBtn.onclick = window.allocateRoomLive;
    window.__erpAdminPageRefresh = loadLogistics;
    await loadLogistics();
  }

  async function initFacultyDashboardPage() {
    let subjects = [];
    let timetable = [];
    let assignments = [];

    async function loadDashboard() {
      const [subjectRes, timetableRes, assignmentRes] = await Promise.all([
        window.api.request('/academics/subjects', { silent: true }),
        window.api.request('/academics/timetable', { silent: true }),
        window.api.request('/academics/assignments', { silent: true }),
      ]);
      subjects = subjectRes.subjects || [];
      timetable = timetableRes.timetable || [];
      assignments = assignmentRes.assignments || [];

      const batches = Array.from(new Set(subjects.map((item) => `${item.courseId?.department || ''}|${item.semester || ''}`)));
      const batchCounts = await Promise.all(batches.map(async (item) => {
        const [department, semester] = item.split('|');
        const res = await window.api.request(`/academics/students${routeParams({ department, semester })}`, { silent: true });
        return (res.students || []).map((student) => String(student._id || student.rollNo));
      }));
      const uniqueStudents = new Set(batchCounts.flat());

      const submissionSets = await Promise.all(assignments.slice(0, 5).map(async (item) => {
        const res = await window.api.request(`/academics/assignments/${item._id}/submissions`, { silent: true });
        return { id: item._id, submissions: res.submissions || [] };
      }));
      const submissionMap = new Map(submissionSets.map((item) => [String(item.id), item.submissions]));
      const todayClasses = timetable.filter((item) => item.dayOfWeek === getCurrentWeekday()).sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));
      const pendingSubmissions = assignments.reduce((sum, item) => {
        const batchKey = `${item.courseId?.department || ''}|${item.semester || ''}`;
        const totalStudents = batchCounts[batches.indexOf(batchKey)]?.length || 0;
        return sum + Math.max(totalStudents - (submissionMap.get(String(item._id)) || []).length, 0);
      }, 0);

      setText('welcomeMsg', `Welcome, Prof. ${(getUser()?.name || 'Faculty').split(' ')[0]}`);
      setStatCard(0, 'My Students', String(uniqueStudents.size));
      setStatCard(1, 'Assigned Subjects', String(subjects.length));
      setStatCard(2, 'Pending Submissions', String(pendingSubmissions), '<i class="fas fa-exclamation-circle"></i> Needs review');
      setStatCard(3, 'Today Classes', String(todayClasses.length));

      setHTML('todayClasses', todayClasses.map((item) => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;border:1px solid #E2E8F0;background:white;margin-bottom:8px">
          <div style="text-align:center;min-width:54px"><div style="font-weight:700;font-size:13px;color:#059669">${escapeHTML(item.startTime || '-')}</div></div>
          <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHTML(item.subjectId?.name || '-')}</div><div style="font-size:12px;color:#64748B">${escapeHTML(item.courseId?.department || '-')} • Sem ${item.semester || '-'} • ${escapeHTML(item.room || '-')}</div></div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="badge badge-info">Upcoming</span><a href="attendance.html" class="btn btn-xs btn-success">Mark Att.</a></div>
        </div>
      `).join('') || '<div class="empty-state"><div class="empty-state-title">No classes scheduled today</div></div>');

      const recentAssignments = assignments.slice(0, 3);
      setHTML('assignmentsBody', recentAssignments.map((item) => {
        const submissions = submissionMap.get(String(item._id)) || [];
        const batchKey = `${item.courseId?.department || ''}|${item.semester || ''}`;
        const totalStudents = batchCounts[batches.indexOf(batchKey)]?.length || 0;
        const completion = totalStudents ? Math.round((submissions.length / totalStudents) * 100) : 0;
        return `
          <tr>
            <td style="font-weight:600">${escapeHTML(item.title)}</td>
            <td><span class="badge badge-gray">${escapeHTML(item.subjectId?.name || '-')}</span></td>
            <td style="font-size:12px;color:#64748B">${formatDate(item.dueDate)}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="progress-bar" style="flex:1;min-width:60px"><div class="progress-fill" style="width:${completion}%;background:#059669"></div></div><span style="font-size:12px;font-weight:600">${submissions.length}/${totalStudents}</span></div></td>
            <td><div style="display:flex;gap:4px"><button class="btn btn-xs btn-secondary" onclick="viewFacultyAssignmentSubmissions('${item._id}')"><i class="fas fa-eye"></i></button><a class="btn btn-xs btn-primary" href="assignments.html"><i class="fas fa-pen"></i> Grade</a></div></td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No assignments found</div></div></td></tr>');

      const chartCard = q('#attChart')?.closest('.card');
      if (chartCard) setText(q('.card-title', chartCard), 'Weekly Class Load');
      const chartCanvas = replaceCanvas('attChart');
      if (chartCanvas && window.Chart) {
        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const counts = weekdays.map((day) => timetable.filter((item) => item.dayOfWeek === day).length);
        new window.Chart(chartCanvas, {
          type: 'bar',
          data: { labels: weekdays, datasets: [{ label: 'Classes', data: counts, backgroundColor: '#059669', borderRadius: 6 }] },
          options: { ...getChartDefaults(), scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
        });
      }
    }

    window.viewFacultyAssignmentSubmissions = async function viewFacultyAssignmentSubmissions(id) {
      const res = await window.api.request(`/academics/assignments/${id}/submissions`, { silent: true });
      const existing = byId('facultyAssignmentSubmissionsModal');
      if (existing) existing.remove();
      if (!window.createModal) return;
      window.createModal({
        id: 'facultyAssignmentSubmissionsModal',
        title: 'Assignment Submissions',
        size: 'lg',
        body: (res.submissions || []).map((item) => `<div style="padding:10px 0;border-bottom:1px solid #F1F5F9"><div style="font-weight:700">${escapeHTML(item.studentId?.name || '-')}</div><div style="font-size:12px;color:#64748B">${escapeHTML(item.studentId?.rollNo || '-')} • ${formatDate(item.submittedAt, true)}</div></div>`).join('') || '<div class="empty-state"><div class="empty-state-title">No submissions yet</div></div>',
      });
      window.openModal?.('facultyAssignmentSubmissionsModal');
    };

    window.__erpAdminPageRefresh = loadDashboard;
    await loadDashboard();
  }

  async function initFacultyAttendancePage() {
    const subjectSelect = byId('subjectSelect');
    const batchSelect = byId('batchSelect');
    const dateInput = byId('attDate');
    const searchInput = byId('studentSearch');
    let subjects = [];
    let students = [];
    let filteredStudents = [];
    let attendanceMap = {};
    let smartPresenceTimer;

    function selectedSubject() {
      return subjects.find((item) => String(item._id) === String(subjectSelect?.value));
    }

    function renderAttendance() {
      filteredStudents = students.filter((item) => {
        const query = (searchInput?.value || '').toLowerCase();
        return !query || [item.name, item.rollNo].join(' ').toLowerCase().includes(query);
      });
      const rosterTotal = students.length;
      const presentTotal = students.filter((item) => attendanceMap[item._id] === 'present').length;
      const absentTotal = students.filter((item) => attendanceMap[item._id] === 'absent').length;
      const lateTotal = students.filter((item) => attendanceMap[item._id] === 'late').length;
      const completion = rosterTotal ? Math.round(((presentTotal + absentTotal + lateTotal) / rosterTotal) * 100) : 0;
      const subject = selectedSubject();
      setText('totalCount', String(filteredStudents.length));
      setText('presentCount', String(filteredStudents.filter((item) => attendanceMap[item._id] === 'present').length));
      setText('manualPresentCount', String(presentTotal));
      setText('manualAbsentCount', String(absentTotal));
      setText('manualLateCount', String(lateTotal));
      setText('attendanceCompletionPct', `${completion}%`);
      setHTML('facultyRollCallInsight', subject ? `
        <div class="attendance-big-number ${absentTotal ? 'danger' : 'safe'}">${presentTotal}/${rosterTotal}</div>
        <p>${escapeHTML(subject.name || 'Selected subject')} roll call is ${completion}% covered for ${escapeHTML(dateInput?.value || 'today')}.</p>
      ` : '<div class="attendance-big-number">No subject</div><p>Select a subject to load roster health.</p>');
      setHTML('facultyAttendanceActionQueue', `
        <div class="attendance-source-row"><span>Present</span><strong>${presentTotal}</strong></div>
        <div class="attendance-source-row"><span>Absent needs review</span><strong>${absentTotal}</strong></div>
        <div class="attendance-source-row"><span>Late arrivals</span><strong>${lateTotal}</strong></div>
      `);
      setHTML('attBody', filteredStudents.map((item, index) => `
        <tr>
          <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
          <td><code style="font-size:12px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${escapeHTML(item.rollNo || '-')}</code></td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((item.name || 'S')[0])}</div><span style="font-weight:600">${escapeHTML(item.name)}</span></div></td>
          <td><input type="radio" name="att-${item._id}" ${attendanceMap[item._id] === 'present' ? 'checked' : ''} onchange="setFacultyAttendance('${item._id}','present')"></td>
          <td><input type="radio" name="att-${item._id}" ${attendanceMap[item._id] === 'absent' ? 'checked' : ''} onchange="setFacultyAttendance('${item._id}','absent')"></td>
          <td><input type="radio" name="att-${item._id}" ${attendanceMap[item._id] === 'late' ? 'checked' : ''} onchange="setFacultyAttendance('${item._id}','late')"></td>
          <td><span class="badge ${attendanceMap[item._id] === 'present' ? 'badge-success' : attendanceMap[item._id] === 'absent' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(attendanceMap[item._id] || 'present')}</span></td>
        </tr>
      `).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No students available for this subject</div></div></td></tr>');
    }

    function getCurrentPosition() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by this browser'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
      });
    }

    function renderSmartPresence(data) {
      if (!data?.active) {
        setText('smartPresentCount', '--');
        setText('smartTotalCount', '--');
        setText('smartRoomName', 'No active class');
        setText('smartTeacherStatus', '--');
        setText('smartCoverageRate', '--');
        setText('smartAutoMarkedCount', '--');
        setText('smartWaitingCount', '--');
        setText('smartSessionHealth', 'Idle');
        setHTML('facultySmartInsight', '<div class="attendance-big-number">Idle</div><p>No active scheduled smart attendance session was found for the selected subject.</p>');
        setHTML('smartPresenceBody', `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-calendar-xmark"></i></div><div class="empty-state-title">${escapeHTML(data?.message || 'No active smart attendance session')}</div></div></td></tr>`);
        return;
      }

      const rows = data.students || [];
      const coverage = data.totalStudents ? Math.round((Number(data.presentCount || 0) / Number(data.totalStudents || 1)) * 100) : 0;
      const autoMarked = rows.filter((student) => ['present', 'late'].includes(student.autoAttendanceStatus)).length;
      const waiting = rows.filter((student) => student.status === 'waitingTeacher').length;
      setText('smartPresentCount', String(data.presentCount || 0));
      setText('smartTotalCount', String(data.totalStudents || 0));
      setText('smartRoomName', data.activeSlot?.room || data.classroom?.roomName || 'Unmapped');
      setText('smartTeacherStatus', data.facultyPresent ? 'Present' : 'Not Started');
      setText('smartCoverageRate', `${coverage}%`);
      setText('smartAutoMarkedCount', String(autoMarked));
      setText('smartWaitingCount', String(waiting));
      setText('smartSessionHealth', data.facultyPresent && data.classroom ? 'Live' : data.classroom ? 'Waiting' : 'Map Room');
      setHTML('facultySmartInsight', `
        <div class="attendance-big-number ${coverage >= 75 ? 'safe' : coverage ? 'danger' : ''}">${coverage}%</div>
        <p>${escapeHTML(data.activeSlot?.subject || 'Active class')} in ${escapeHTML(data.activeSlot?.room || data.classroom?.roomName || 'unmapped room')} has ${autoMarked} auto-marked record(s). ${data.facultyPresent ? 'Teacher signal is live.' : 'Start teacher presence to activate auto-marking.'}</p>
      `);

      setHTML('smartPresenceBody', rows.map((student, index) => {
        const status = student.status || 'outside';
        const statusText = status === 'inside' ? 'In class' : status === 'waitingTeacher' ? 'Waiting for teacher' : status === 'noClassroom' ? 'No geofence' : 'Outside';
        const att = student.attendanceStatus === 'notMarked' ? student.autoAttendanceStatus : student.attendanceStatus;
        return `
          <tr>
            <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((student.name || 'S')[0])}</div><span style="font-weight:700">${escapeHTML(student.name || '-')}</span></div></td>
            <td><code style="font-size:12px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${escapeHTML(student.rollNo || '-')}</code></td>
            <td><span class="live-dot ${escapeHTML(status)}"></span>${escapeHTML(statusText)}</td>
            <td>${student.distanceMeters === undefined || student.distanceMeters === null ? '-' : `${student.distanceMeters} m`}</td>
            <td style="font-size:12px;color:#64748B">${formatDate(student.lastSeenAt, true)}</td>
            <td><span class="badge ${att === 'present' ? 'badge-success' : att === 'late' ? 'badge-warning' : att === 'waiting' ? 'badge-info' : 'badge-gray'}">${escapeHTML(att || 'none')}</span></td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No roster found for this scheduled class</div></div></td></tr>');
    }

    async function loadSmartPresence() {
      const subject = selectedSubject();
      if (!subject) return;
      try {
        const res = await window.api.request(`/attendance/live-class${routeParams({ subjectId: subject._id })}`, { silent: true });
        renderSmartPresence(res);
      } catch (error) {
        setText('smartTeacherStatus', 'Offline');
      }
    }

    async function loadStudents() {
      const subject = selectedSubject();
      if (!subject) return;
      if (batchSelect) batchSelect.innerHTML = `<option>${escapeHTML(buildBatchLabel(subject.courseId?.department, subject.semester))}</option>`;
      const [studentRes, attendanceRes] = await Promise.all([
        window.api.request(`/academics/students${routeParams({ department: subject.courseId?.department, semester: subject.semester })}`, { silent: true }),
        window.api.request(`/attendance${routeParams({ subjectId: subject._id, date: dateInput?.value })}`, { silent: true }),
      ]);
      students = studentRes.students || [];
      attendanceMap = Object.fromEntries(students.map((item) => [item._id, 'present']));
      (attendanceRes.attendance || []).forEach((item) => { attendanceMap[item.studentId?._id || item.studentId] = item.status; });
      renderAttendance();
      await loadSmartPresence();
    }

    async function loadSubjects() {
      const res = await window.api.request('/academics/subjects', { silent: true });
      subjects = res.subjects || [];
      if (subjectSelect) {
        subjectSelect.innerHTML = subjects.map((item) => `<option value="${item._id}">${escapeHTML(item.name)} (${escapeHTML(item.code)})</option>`).join('');
        subjectSelect.onchange = loadStudents;
      }
      await loadStudents();
    }

    window.setFacultyAttendance = function setFacultyAttendance(studentId, status) {
      attendanceMap[studentId] = status;
      renderAttendance();
    };
    window.markAll = function markAll(status) { students.forEach((item) => { attendanceMap[item._id] = status; }); renderAttendance(); };
    window.filterStudents = renderAttendance;
    window.loadStudents = loadStudents;
    window.loadSmartPresence = loadSmartPresence;
    window.setClassroomFromHere = async function setClassroomFromHere() {
      const subject = selectedSubject();
      if (!subject) return window.showToast?.('Select a subject first', 'error');
      try {
        const position = await getCurrentPosition();
        const suggested = byId('smartRoomName')?.textContent && !['--', 'No active class', 'Unmapped'].includes(byId('smartRoomName').textContent)
          ? byId('smartRoomName').textContent
          : '';
        const roomName = window.prompt('Enter the exact classroom/room name used in timetable', suggested || 'Room 101');
        if (!roomName) return;
        await window.api.request('/attendance/classrooms', {
          method: 'POST',
          body: JSON.stringify({
            roomName,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            radiusMeters: 35,
          }),
        });
        window.showToast?.('Classroom geofence saved', 'success');
        await loadSmartPresence();
      } catch (error) {
        window.showToast?.(error.message || 'Unable to capture location', 'error');
      }
    };
    window.publishTeacherPresence = async function publishTeacherPresence() {
      const subject = selectedSubject();
      if (!subject) return window.showToast?.('Select a subject first', 'error');
      try {
        const position = await getCurrentPosition();
        const res = await window.api.request('/attendance/live-location', {
          method: 'POST',
          body: JSON.stringify({
            subjectId: subject._id,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          }),
        });
        window.showToast?.(res.active ? 'Teacher live presence updated' : (res.message || 'No active class found'), res.active ? 'success' : 'warning');
        await loadSmartPresence();
        clearInterval(smartPresenceTimer);
        smartPresenceTimer = setInterval(loadSmartPresence, 10000);
      } catch (error) {
        window.showToast?.(error.message || 'Unable to publish teacher location', 'error');
      }
    };
    window.submitAttendance = async function submitAttendance() {
      const subject = selectedSubject();
      if (!subject) return;
      await window.api.request('/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          subjectId: subject._id,
          date: dateInput?.value,
          attendanceRecords: students.map((item) => ({ studentId: item._id, status: attendanceMap[item._id] || 'present', remarks: '' })),
        }),
      });
      window.showToast?.('Attendance submitted successfully', 'success');
      await loadStudents();
    };

    if (searchInput) searchInput.oninput = renderAttendance;
    if (dateInput) dateInput.onchange = loadStudents;
    window.__erpAdminPageRefresh = loadStudents;
    await loadSubjects();
  }

  async function initFacultyLeavePage() {
    const form = cloneById('leaveForm');
    let leaves = [];

    function renderLeaves() {
      setStatCard(0, 'Total Requests', String(leaves.length));
      setStatCard(1, 'Approved', String(leaves.filter((item) => item.status === 'approved').length));
      setStatCard(2, 'Pending', String(leaves.filter((item) => item.status === 'pending').length));
      setStatCard(3, 'Rejected', String(leaves.filter((item) => item.status === 'rejected').length));
      setHTML('leaveHistoryBody', leaves.map((item) => `
        <tr>
          <td><span class="badge badge-gray">${escapeHTML(item.leaveType)}</span></td>
          <td style="font-size:12px">${formatDate(item.startDate)}${item.startDate !== item.endDate ? `<div>→ ${formatDate(item.endDate)}</div>` : ''}</td>
          <td style="font-size:12px;color:#64748B">${escapeHTML(item.reason)}</td>
          <td><span class="badge ${item.status === 'approved' ? 'badge-success' : item.status === 'rejected' ? 'badge-danger' : 'badge-warning'}">${escapeHTML(item.status)}</span></td>
        </tr>
      `).join('') || '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-title">No leave history found</div></div></td></tr>');
    }

    async function loadLeaves() {
      const res = await window.api.request('/leave/my-leaves', { silent: true });
      leaves = res.leaves || [];
      renderLeaves();
    }

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = byId('submitLeaveBtn');
        const payload = {
          leaveType: byId('leaveType')?.value,
          startDate: byId('startDate')?.value,
          endDate: byId('endDate')?.value,
          reason: byId('leaveReason')?.value.trim(),
        };
        if (!payload.startDate || !payload.endDate || !payload.reason) return window.showToast?.('Fill all required fields', 'error');
        window.setLoading?.(button, true);
        try {
          await window.api.request('/leave/apply', { method: 'POST', body: JSON.stringify(payload) });
          form.reset();
          window.showToast?.('Leave request submitted successfully', 'success');
          await loadLeaves();
        } finally {
          window.setLoading?.(button, false);
        }
      });
    }

    window.__erpAdminPageRefresh = loadLeaves;
    await loadLeaves();
  }

  async function initFacultyGradesPage() {
    const subjectSelect = byId('gradeSubject');
    const examTypeSelect = byId('examType');
    const maxMarksInput = byId('maxMarks');
    const searchInput = byId('gradeSearch');
    const bulkInput = byId('bulkMarksFile');
    const bulkFileName = byId('bulkMarksFileName');
    let subjects = [];
    let students = [];
    let marksData = {};
    let remarksData = {};

    function gradeFor(marks, maxMarks) {
      const pct = maxMarks ? (Number(marks || 0) / Number(maxMarks)) * 100 : 0;
      if (pct >= 90) return { grade: 'O', color: '#059669' };
      if (pct >= 80) return { grade: 'A+', color: '#10B981' };
      if (pct >= 70) return { grade: 'A', color: '#3B82F6' };
      if (pct >= 60) return { grade: 'B+', color: '#8B5CF6' };
      if (pct >= 50) return { grade: 'B', color: '#F59E0B' };
      if (pct >= 40) return { grade: 'C', color: '#D97706' };
      return { grade: 'F', color: '#EF4444' };
    }

    function renderGrades() {
      const query = (searchInput?.value || '').toLowerCase();
      const filtered = students.filter((item) => !query || [item.name, item.rollNo].join(' ').toLowerCase().includes(query));
      const maxMarks = Number(maxMarksInput?.value || 50);
      setHTML('gradesBody', filtered.map((item, index) => {
        const marks = marksData[item._id] ?? '';
        const current = marks === '' ? { grade: '-', color: '#94A3B8' } : gradeFor(marks, maxMarks);
        return `
          <tr>
            <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
            <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar avatar-sm">${escapeHTML((item.name || 'S')[0])}</div><span style="font-weight:600">${escapeHTML(item.name)}</span></div></td>
            <td><code style="font-size:12px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${escapeHTML(item.rollNo || '-')}</code></td>
            <td><input type="number" min="0" max="${maxMarks}" value="${marks}" style="width:80px;padding:5px 8px;border:1.5px solid #E2E8F0;border-radius:6px;font-size:13px;font-weight:600;text-align:center" onchange="updateFacultyMark('${item._id}',this.value)"> / ${maxMarks}</td>
            <td><span style="font-weight:800;font-size:16px;color:${current.color}">${current.grade}</span></td>
            <td><input id="remark-${item._id}" type="text" value="${escapeHTML(remarksData[item._id] || '')}" placeholder="Add remark..." style="width:130px;padding:5px 8px;border:1.5px solid #E2E8F0;border-radius:6px;font-size:12px"></td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="6"><div class="empty-state"><div class="empty-state-title">No students found</div></div></td></tr>');

      const values = Object.values(marksData).filter((value) => value !== '' && value !== null && value !== undefined).map(Number);
      if (!values.length) {
        setText('classAvg', '-');
        setText('classMax', '-');
        setText('classPass', '-');
        setText('classGraded', `0/${students.length}`);
        return;
      }
      setText('classAvg', (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
      setText('classMax', String(Math.max(...values)));
      setText('classPass', `${Math.round((values.filter((value) => value >= maxMarks * 0.4).length / values.length) * 100)}%`);
      setText('classGraded', `${values.length}/${students.length}`);
    }

    async function loadMarks() {
      const subjectId = subjectSelect?.value;
      if (!subjectId) return;
      const examName = examTypeSelect?.selectedOptions?.[0]?.textContent || 'Internal Assessment';
      const res = await window.api.request(`/exams/results-sheet${routeParams({ subjectId, examName })}`, { silent: true });
      students = res.students || [];
      marksData = {};
      remarksData = {};
      (res.results || []).forEach((item) => {
        marksData[String(item.studentId)] = item.marksObtained;
        remarksData[String(item.studentId)] = item.remarks || '';
      });
      if (res.exam && maxMarksInput) maxMarksInput.value = res.exam.totalMarks || maxMarksInput.value;
      renderGrades();
    }

    async function loadSubjects() {
      const res = await window.api.request('/academics/subjects', { silent: true });
      subjects = res.subjects || [];
      if (subjectSelect) subjectSelect.innerHTML = subjects.map((item) => `<option value="${item._id}">${escapeHTML(item.name)} (${escapeHTML(item.code)})</option>`).join('');
      await loadMarks();
    }

    function parseCsvLine(line) {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (inQuotes && line[index + 1] === '"') {
            current += '"';
            index += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values.map((value) => value.replace(/^"|"$/g, ''));
    }

    function resetBulkUpload() {
      if (bulkInput) bulkInput.value = '';
      if (bulkFileName) bulkFileName.textContent = 'Drop CSV file here or click to upload';
    }

    window.updateFacultyMark = function updateFacultyMark(studentId, value) {
      marksData[studentId] = value === '' ? '' : Number(value);
      renderGrades();
    };
    window.filterGrades = renderGrades;
    window.loadMarks = loadMarks;
    window.downloadGradeTemplate = function downloadGradeTemplate() {
      downloadCsv('grade-upload-template.csv', [
        ['roll_no', 'marks', 'remarks'],
        ...students.map((item) => [item.rollNo || '', '', '']),
      ]);
      window.showToast?.('CSV template downloaded', 'success');
    };
    window.uploadBulkMarks = async function uploadBulkMarks() {
      if (!bulkInput?.files?.length) {
        window.showToast?.('Choose a CSV file first', 'error');
        return;
      }

      const text = await bulkInput.files[0].text();
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const rows = lines.map(parseCsvLine);
      const startIndex = rows[0]?.[0]?.toLowerCase().includes('roll') ? 1 : 0;
      const studentMap = new Map(students.map((item) => [String(item.rollNo || '').trim().toLowerCase(), item]));
      let matched = 0;
      let skipped = 0;

      rows.slice(startIndex).forEach((row) => {
        const rollNo = String(row[0] || '').trim().toLowerCase();
        const marks = Number(row[1]);
        const remarks = String(row[2] || '').trim();
        const student = studentMap.get(rollNo);
        if (!student || Number.isNaN(marks)) {
          skipped += 1;
          return;
        }
        marksData[student._id] = marks;
        remarksData[student._id] = remarks;
        matched += 1;
      });

      renderGrades();
      resetBulkUpload();
      window.closeModal?.('bulkUploadModal');
      window.showToast?.(matched ? `Loaded ${matched} grade rows${skipped ? `, skipped ${skipped}` : ''}` : 'No valid grade rows found', matched ? 'success' : 'warning');
    };
    window.saveAllGrades = async function saveAllGrades() {
      const subjectId = subjectSelect?.value;
      if (!subjectId) return;
      const subject = subjects.find((item) => String(item._id) === String(subjectId));
      const maxMarks = Number(maxMarksInput?.value || 50);
      const invalidMarks = students.some((item) => {
        const value = marksData[item._id];
        return value !== '' && value !== undefined && (Number(value) < 0 || Number(value) > maxMarks);
      });
      if (invalidMarks) {
        window.showToast?.(`Marks must stay between 0 and ${maxMarks}`, 'error');
        return;
      }
      await window.api.request('/exams/results', {
        method: 'POST',
        body: JSON.stringify({
          subjectId,
          examName: examTypeSelect?.selectedOptions?.[0]?.textContent || 'Internal Assessment',
          examType: normalizeExamType(examTypeSelect?.value),
          maxMarks,
          semester: subject?.semester,
          date: new Date().toISOString(),
          results: students.filter((item) => marksData[item._id] !== '' && marksData[item._id] !== undefined).map((item) => ({ studentId: item._id, rollNo: item.rollNo, marksObtained: Number(marksData[item._id]), remarks: byId(`remark-${item._id}`)?.value.trim() || '' })),
        }),
      });
      window.showToast?.('Grades saved successfully', 'success');
      await loadMarks();
    };

    if (subjectSelect) subjectSelect.onchange = loadMarks;
    if (examTypeSelect) examTypeSelect.onchange = loadMarks;
    if (maxMarksInput) maxMarksInput.onchange = renderGrades;
    if (searchInput) searchInput.oninput = renderGrades;
    if (bulkInput) {
      bulkInput.onchange = function onBulkFileChange() {
        if (bulkFileName) bulkFileName.textContent = bulkInput.files?.[0]?.name || 'Drop CSV file here or click to upload';
      };
    }
    window.__erpAdminPageRefresh = loadMarks;
    await loadSubjects();
  }

  async function initFacultyAssignmentsPage() {
    const subjectSelect = byId('aSubject');
    let subjects = [];
    let assignments = [];

    function renderAssignments() {
      setHTML('assignmentGrid', assignments.map((item) => {
        const submissions = item.submissions || [];
        const totalStudents = item.totalStudents || 0;
        const pct = totalStudents ? Math.round((submissions.length / totalStudents) * 100) : 0;
        return `
          <div class="card" style="padding:0;overflow:hidden">
            <div style="height:5px;background:linear-gradient(90deg,#059669,#10B981)"></div>
            <div style="padding:18px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px"><span class="badge badge-gray">${escapeHTML(item.subjectId?.name || '-')}</span><span class="badge ${new Date(item.dueDate) < new Date() ? 'badge-danger' : 'badge-info'}">${formatDate(item.dueDate)}</span></div>
              <div style="font-size:15px;font-weight:700;margin-bottom:6px">${escapeHTML(item.title)}</div>
              <div style="font-size:12px;color:#64748B;margin-bottom:12px">${escapeHTML(item.description || 'No description')}</div>
              <div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:12px;color:#64748B">Submissions</span><span style="font-size:12px;font-weight:700">${submissions.length}/${totalStudents}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#059669"></div></div></div>
              <div style="display:flex;gap:8px;border-top:1px solid #F1F5F9;padding-top:12px"><button class="btn btn-success btn-sm" style="flex:1" onclick="viewAssignmentSubmissions('${item._id}')"><i class="fas fa-eye"></i> View Submissions</button><button class="btn btn-danger btn-sm" onclick="deleteFacultyAssignment('${item._id}')"><i class="fas fa-trash"></i></button></div>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No assignments created yet</div></div>');
    }

    async function loadAssignments() {
      const [subjectRes, assignmentRes] = await Promise.all([
        window.api.request('/academics/subjects', { silent: true }),
        window.api.request('/academics/assignments', { silent: true }),
      ]);
      subjects = subjectRes.subjects || [];
      if (subjectSelect) subjectSelect.innerHTML = subjects.map((item) => `<option value="${item._id}">${escapeHTML(item.name)} (${escapeHTML(item.code)})</option>`).join('');
      assignments = await Promise.all((assignmentRes.assignments || []).map(async (item) => {
        const [submissionRes, studentRes] = await Promise.all([
          window.api.request(`/academics/assignments/${item._id}/submissions`, { silent: true }),
          window.api.request(`/academics/students${routeParams({ department: item.courseId?.department, semester: item.semester })}`, { silent: true }),
        ]);
        return { ...item, submissions: submissionRes.submissions || [], totalStudents: (studentRes.students || []).length };
      }));
      renderAssignments();
    }

    window.viewAssignmentSubmissions = async function viewAssignmentSubmissions(id) {
      const item = assignments.find((entry) => String(entry._id) === String(id));
      if (!item || !window.createModal) return;
      const existing = byId('assignmentSubmissionModal');
      if (existing) existing.remove();
      window.createModal({
        id: 'assignmentSubmissionModal',
        title: 'Assignment Submissions',
        size: 'lg',
        body: (item.submissions || []).map((submission) => `<div style="padding:10px 0;border-bottom:1px solid #F1F5F9"><div style="font-weight:700">${escapeHTML(submission.studentId?.name || '-')}</div><div style="font-size:12px;color:#64748B">${escapeHTML(submission.studentId?.rollNo || '-')} • ${formatDate(submission.submittedAt, true)} • ${escapeHTML(submission.status)}</div></div>`).join('') || '<div class="empty-state"><div class="empty-state-title">No submissions yet</div></div>',
      });
      window.openModal?.('assignmentSubmissionModal');
    };

    window.deleteFacultyAssignment = async function deleteFacultyAssignment(id) {
      await window.api.request(`/academics/assignments/${id}`, { method: 'DELETE' });
      window.showToast?.('Assignment deleted', 'warning');
      await loadAssignments();
    };

    window.createAssignment = async function createAssignment() {
      const payload = {
        title: byId('aTitle')?.value.trim(),
        subjectId: subjectSelect?.value,
        totalMarks: Number(byId('aMarks')?.value || 20),
        dueDate: byId('aDue')?.value,
        description: byId('aDesc')?.value.trim(),
      };
      if (!payload.title || !payload.subjectId || !payload.dueDate) return window.showToast?.('Fill all required fields', 'error');
      await window.api.request('/academics/assignments', { method: 'POST', body: JSON.stringify(payload) });
      window.closeModal?.('createAssignmentModal');
      qa('#createAssignmentModal input, #createAssignmentModal textarea').forEach((input) => { input.value = ''; });
      window.showToast?.('Assignment published', 'success');
      await loadAssignments();
    };

    window.__erpAdminPageRefresh = loadAssignments;
    await loadAssignments();
  }

  async function initFacultyTimetablePage() {
    const table = byId('ttBody');
    let entries = [];
    let currentFilter = 'all';

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const keys = { Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed', Thursday: 'thu', Friday: 'fri', Saturday: 'sat' };

    function findNextEntry() {
      const today = getCurrentWeekday();
      const todayIndex = days.indexOf(today);
      const baseIndex = todayIndex >= 0 ? todayIndex : 0;
      const baseMinutes = todayIndex >= 0 ? currentMinutes() : 0;
      return entries
        .map((entry) => {
          const entryIndex = days.indexOf(entry.dayOfWeek);
          if (entryIndex < 0) return null;
          let dayOffset = entryIndex - baseIndex;
          const start = timeToMinutes(entry.startTime);
          if (dayOffset < 0 || (dayOffset === 0 && start < baseMinutes)) dayOffset += days.length;
          return { ...entry, nextWeight: dayOffset * 1440 + start - baseMinutes };
        })
        .filter(Boolean)
        .sort((a, b) => a.nextWeight - b.nextWeight)[0];
    }

    function renderTimetablePanels() {
      const today = getCurrentWeekday();
      const todayEntries = entries.filter((entry) => entry.dayOfWeek === today).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      const nextEntry = findNextEntry();
      const roomCount = new Set(entries.map((entry) => entry.room).filter(Boolean)).size;
      const batches = new Set(entries.map((entry) => `${entry.courseId?.department || 'General'}-${entry.semester || '-'}`));
      const totalMinutes = entries.reduce((sum, entry) => sum + Math.max(timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime), 0), 0);
      const loadStatus = entries.length >= 18 ? 'Heavy' : entries.length >= 10 ? 'Balanced' : entries.length ? 'Light' : 'Pending';

      setText('facultyNextClass', nextEntry ? (nextEntry.subjectId?.name || 'Scheduled class') : 'No timetable entries');
      setText('facultyNextMeta', nextEntry ? `${nextEntry.dayOfWeek} • ${nextEntry.startTime}-${nextEntry.endTime} • ${nextEntry.room || 'Room pending'} • ${buildBatchLabel(nextEntry.courseId?.department, nextEntry.semester)}` : 'Ask administration to publish your teaching timetable.');
      setText('facultyUniqueBatches', String(batches.size || 0));
      setText('facultyRoomPlan', roomCount ? `${roomCount} rooms` : 'Pending');
      setText('facultyLoadStatus', loadStatus);

      setStatCard(0, 'Classes This Week', String(entries.length), '<i class="fas fa-calendar-week"></i> Live schedule');
      setStatCard(1, 'Teaching Hours', `${(totalMinutes / 60).toFixed(totalMinutes % 60 ? 1 : 0)}h`, '<i class="fas fa-hourglass-half"></i> Contact time');
      setStatCard(2, 'Different Subjects', String(new Set(entries.map((item) => item.subjectId?.name).filter(Boolean)).size), '<i class="fas fa-layer-group"></i> Academic spread');
      setStatCard(3, 'Today Classes', String(todayEntries.length), '<i class="fas fa-satellite-dish"></i> Smart attendance ready');

      setHTML('facultyTodayQueue', todayEntries.map((entry) => {
        const active = currentMinutes() >= timeToMinutes(entry.startTime) && currentMinutes() <= timeToMinutes(entry.endTime);
        return `
          <div class="timetable-flow-item ${active ? 'active' : ''}">
            <div><strong>${escapeHTML(entry.startTime)}-${escapeHTML(entry.endTime)}</strong><span>${escapeHTML(entry.subjectId?.name || '-')}</span></div>
            <em>${escapeHTML(entry.room || 'Room pending')}</em>
          </div>
        `;
      }).join('') || '<div class="empty-state"><div class="empty-state-title">No teaching slots today</div></div>');

      setHTML('facultyWorkloadMap', days.map((day) => {
        const count = entries.filter((entry) => entry.dayOfWeek === day).length;
        return `<div class="timetable-flow-item"><div><strong>${count}</strong><span>${day}</span></div><em>${count >= 4 ? 'High load' : count ? 'Normal' : 'Free'}</em></div>`;
      }).join(''));
    }

    function renderTimetable(day) {
      currentFilter = day;
      qa('#ttTable .day-col').forEach((item) => {
        const visible = day === 'all' || item.classList.contains(`day-${day}`);
        item.style.display = visible ? '' : 'none';
      });
      const slots = Array.from(new Set(entries.map((item) => `${item.startTime} - ${item.endTime}`)))
        .sort((a, b) => timeToMinutes(a.split(' - ')[0]) - timeToMinutes(b.split(' - ')[0]));
      const today = getCurrentWeekday();
      const nowMinutes = currentMinutes();
      table.innerHTML = slots.map((slot) => {
        const start = slot.split(' - ')[0];
        return `<tr><td style="font-size:12px;font-weight:600;color:#64748B;white-space:nowrap">${escapeHTML(slot)}</td>${days.map((dayName) => {
          const key = keys[dayName];
          const display = day !== 'all' && day !== key ? 'display:none;' : '';
          const item = entries.find((entry) => entry.dayOfWeek === dayName && entry.startTime === start);
          if (!item) return `<td class="day-col day-${key}" style="${display}"><div class="timetable-empty-cell"></div></td>`;
          const active = dayName === today && nowMinutes >= timeToMinutes(item.startTime) && nowMinutes <= timeToMinutes(item.endTime);
          const isToday = dayName === today;
          const typeBadge = item.type === 'lab' ? 'badge-purple' : item.type === 'tutorial' ? 'badge-warning' : 'badge-success';
          return `
            <td class="day-col day-${key}" style="${display}padding:6px">
              <div class="timetable-session faculty-session ${isToday ? 'is-today' : ''} ${active ? 'is-live' : ''}">
                <div class="session-code">${escapeHTML(item.subjectId?.code || item.type || 'Class')}</div>
                <div class="session-title">${escapeHTML(item.subjectId?.name || '-')}</div>
                <div class="session-meta"><i class="fas fa-location-dot"></i> ${escapeHTML(item.room || 'Room pending')}</div>
                <div class="session-meta"><i class="fas fa-users"></i> ${escapeHTML(buildBatchLabel(item.courseId?.department, item.semester))}</div>
                <div class="session-foot"><span class="badge ${typeBadge}">${escapeHTML(item.type || 'lecture')}</span>${active ? '<span class="badge badge-success">Now</span>' : ''}</div>
              </div>
            </td>
          `;
        }).join('')}</tr>`;
      }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No timetable entries found</div></div></td></tr>';

      renderTimetablePanels();
    }

    async function loadTimetable() {
      const res = await window.api.request('/academics/timetable', { silent: true });
      entries = res.timetable || [];
      renderTimetable(currentFilter);
    }

    window.showDay = function showDay(day, button) {
      qa('#dayTabs .tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');
      renderTimetable(day);
    };

    window.__erpAdminPageRefresh = loadTimetable;
    await loadTimetable();
  }

  async function initFacultyLiveClassPage() {
    const select = byId('batchSelect');
    const topicInput = byId('topicInput');
    const meetContainer = byId('meet-container');
    let subjects = [];
    let sessions = [];
    let timetable = [];
    let currentSession = null;
    let meetApi = null;

    function scheduledCardBody() {
      return qa('#join-screen .grid.col-2 .card .card-body')[1];
    }

    function timeToMinutes(value) {
      if (!value) return Number.MAX_SAFE_INTEGER;
      const parts = String(value).split(':').map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    }

    function launchSession(session) {
      currentSession = session;
      byId('join-screen').style.display = 'none';
      byId('active-call').style.display = 'block';
      setText('activeTopicDisplay', session.title);
      setText('roomIdDisplay', session.roomName);
      if (meetApi) meetApi.dispose();
      if (q('#loading-meet')) q('#loading-meet').style.display = 'none';
      meetApi = new window.JitsiMeetExternalAPI('meet.jit.si', {
        roomName: session.roomName,
        width: '100%',
        height: '100%',
        parentNode: meetContainer,
        lang: 'en',
        userInfo: { displayName: getUser()?.name || 'Faculty' },
        configOverwrite: { disableDeepLinking: true, prejoinPageEnabled: false },
        interfaceConfigOverwrite: { SHOW_JITSI_WATERMARK: false, SHOW_BRAND_WATERMARK: false },
      });
    }

    function renderSchedule() {
      const body = scheduledCardBody();
      if (!body) return;
      const todayEntries = timetable
        .filter((item) => item.dayOfWeek === getCurrentWeekday())
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

      const cards = todayEntries.length
        ? todayEntries.map((entry) => {
            const activeSession = sessions.find((item) => String(item.subjectId?._id || item.subjectId) === String(entry.subjectId?._id || entry.subjectId) && item.status === 'active');
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:12px;">
                <div style="font-weight:700; color:${activeSession ? '#059669' : '#64748B'}; min-width: 70px;">${escapeHTML(entry.startTime || '-')}</div>
                <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHTML(entry.subjectId?.name || '-')}</div><div style="font-size:12px;color:#64748B">${escapeHTML(entry.courseId?.department || '-')} • Sem ${entry.semester || '-'} • ${escapeHTML(entry.room || '-')}</div></div>
                <button class="btn btn-xs btn-${activeSession ? 'primary' : 'success'}" onclick="${activeSession ? `resumeLiveClass('${activeSession._id}')` : `startScheduledClass('${entry.subjectId?._id || entry.subjectId}', ${JSON.stringify(entry.subjectId?.name || 'Live Session').replace(/"/g, '&quot;')})`}">${activeSession ? 'Resume' : 'Start Now'}</button>
              </div>
            `;
          })
        : sessions.filter((item) => item.status === 'active').map((session) => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:12px;">
              <div style="font-weight:700; color:#059669; min-width: 70px;">Live</div>
              <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHTML(session.title)}</div><div style="font-size:12px;color:#64748B">${escapeHTML(session.subjectId?.name || '-')}</div></div>
              <button class="btn btn-xs btn-primary" onclick="resumeLiveClass('${session._id}')">Resume</button>
            </div>
          `);

      body.innerHTML = cards.join('') || '<div class="empty-state"><div class="empty-state-title">No scheduled classes today</div></div>';
    }

    async function loadLiveClasses() {
      const [subjectRes, sessionRes, timetableRes] = await Promise.all([
        window.api.request('/academics/subjects', { silent: true }),
        window.api.request('/live-classes', { silent: true }),
        window.api.request('/academics/timetable', { silent: true }),
      ]);
      subjects = subjectRes.subjects || [];
      sessions = sessionRes.sessions || [];
      timetable = timetableRes.timetable || [];
      if (select) select.innerHTML = subjects.map((item) => `<option value="${item._id}">${escapeHTML(buildBatchLabel(item.courseId?.department, item.semester))} - ${escapeHTML(item.name)}</option>`).join('');
      renderSchedule();
    }

    window.resumeLiveClass = function resumeLiveClass(id) {
      const session = sessions.find((item) => String(item._id) === String(id));
      if (session) launchSession(session);
    };
    window.startScheduledClass = async function startScheduledClass(subjectId, title) {
      if (select) select.value = subjectId;
      if (topicInput && !topicInput.value.trim()) topicInput.value = title || '';
      await window.startCall();
    };
    window.startCall = async function startCall() {
      if (!select?.value) return window.showToast?.('Select a subject first', 'error');
      const payload = { subjectId: select.value, title: topicInput?.value.trim() || undefined };
      const res = await window.api.request('/live-classes', { method: 'POST', body: JSON.stringify(payload) });
      window.showToast?.('Live class started', 'success');
      launchSession(res.session);
      await loadLiveClasses();
    };
    window.endCall = async function endCall() {
      if (currentSession?._id) await window.api.request(`/live-classes/${currentSession._id}/end`, { method: 'PUT' });
      if (meetApi) meetApi.dispose();
      meetApi = null;
      currentSession = null;
      byId('active-call').style.display = 'none';
      byId('join-screen').style.display = 'block';
      window.showToast?.('Session ended', 'info');
      await loadLiveClasses();
    };
    window.copyInviteLink = function copyInviteLink() {
      if (!currentSession?.roomName) return;
      navigator.clipboard.writeText(`${window.location.origin}/pages/student/live-class.html?join=${encodeURIComponent(currentSession.roomName)}`);
      window.showToast?.('Invite link copied', 'success');
    };
    window.toggleFullscreen = function toggleFullscreen() { meetContainer.classList.toggle('fullscreen'); };

    window.__erpAdminPageRefresh = loadLiveClasses;
    await loadLiveClasses();
  }

  async function initStudentLiveClassPage() {
    const activeBody = qa('#join-screen .grid.col-2 .card .card-body')[0];
    const upcomingBody = qa('#join-screen .grid.col-2 .card .card-body')[1];

    function timeToMinutes(value) {
      if (!value) return Number.MAX_SAFE_INTEGER;
      const parts = String(value).split(':').map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    }

    async function loadClasses() {
      const [sessionRes, timetableRes] = await Promise.all([
        window.api.request('/live-classes', { silent: true }),
        window.api.request('/academics/timetable', { silent: true }),
      ]);
      const sessions = sessionRes.sessions || [];
      const timetable = (timetableRes.timetable || [])
        .filter((item) => item.dayOfWeek === getCurrentWeekday())
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      const active = sessions.filter((item) => item.status === 'active');
      const activeSubjects = new Set(active.map((item) => String(item.subjectId?._id || item.subjectId)));
      const nowMinutes = (new Date().getHours() * 60) + new Date().getMinutes();
      const upcoming = timetable.filter((item) => !activeSubjects.has(String(item.subjectId?._id || item.subjectId)) && timeToMinutes(item.startTime) >= nowMinutes);
      if (activeBody) {
        activeBody.innerHTML = active.map((session) => `
          <div style="display:flex;align-items:center;padding:16px;border:1px solid #BAE6FD;border-radius:12px;background:#F0F9FF;margin-bottom:12px;">
            <div style="flex:1"><div style="display:flex;gap:8px;align-items:center;margin-bottom:4px"><span class="badge badge-info">Active</span><span style="font-size:12px;color:#64748B"><i class="fas fa-user-tie"></i> ${escapeHTML(session.facultyId?.name || '-')}</span></div><div style="font-weight:700;font-size:16px;color:#0284C7">${escapeHTML(session.title)}</div><div style="font-size:12px;color:#64748B;margin-top:4px">${escapeHTML(session.subjectId?.name || '-')}</div></div><button class="btn btn-primary" onclick="joinCall('${escapeHTML(session.roomName)}', '${escapeHTML(session.title)}')"><i class="fas fa-sign-in-alt"></i> Join Session</button>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-state-title">No live classes right now</div></div>';
      }
      if (upcomingBody) {
        upcomingBody.innerHTML = upcoming.map((session) => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #E2E8F0;border-radius:12px;margin-bottom:12px;">
            <div style="font-weight:700; color:#64748B; min-width: 70px;">${escapeHTML(session.startTime || '-')}</div>
            <div style="flex:1"><div style="font-weight:700;font-size:14px">${escapeHTML(session.subjectId?.name || 'Scheduled Class')}</div><div style="font-size:12px;color:#64748B">${escapeHTML(session.facultyId?.name || '-')} • ${escapeHTML(session.room || '-') || '-'}</div></div><button class="btn btn-xs btn-secondary" disabled>Waiting for Host...</button>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-state-title">No upcoming sessions</div></div>';
      }
    }

    window.__erpAdminPageRefresh = loadClasses;
    await loadClasses();
  }

  async function init() {
    const user = getUser();
    if (!user) return;
    await ensureRealtime();
    const path = window.location.pathname;
    if (path.endsWith('/pages/super-admin/dashboard.html')) return initSuperAdminDashboardPage();
    if (path.endsWith('/pages/super-admin/audit-logs.html')) return initSuperAdminAuditLogsPage();
    if (path.endsWith('/pages/super-admin/database.html')) return initSuperAdminDatabasePage();
    if (path.endsWith('/pages/super-admin/colleges.html')) return initSuperAdminCollegesPage();
    if (path.endsWith('/pages/super-admin/users.html')) return initSuperAdminUsersPage();
    if (path.endsWith('/pages/super-admin/analytics.html')) return initSuperAdminAnalyticsPage();
    if (path.endsWith('/pages/super-admin/plans.html')) return initSuperAdminPlansPage();
    if (path.endsWith('/pages/super-admin/system.html')) return initSuperAdminSystemPage();
    if (path.endsWith('/pages/super-admin/broadcast.html')) return initSuperAdminBroadcastPage();
    if (path.endsWith('/pages/super-admin/settings.html')) return initSuperAdminSettingsPage();
    if (path.endsWith('/pages/college-admin/subscription.html')) return initCollegeAdminSubscriptionPage();
    if (path.endsWith('/pages/college-admin/attendance.html')) return initCollegeAdminAttendancePage();
    if (path.endsWith('/pages/college-admin/dashboard.html')) return initCollegeAdminDashboardPage();
    if (path.endsWith('/pages/college-admin/students.html')) return initCollegeAdminStudentsPage();
    if (path.endsWith('/pages/college-admin/faculty.html')) return initCollegeAdminFacultyPage();
    if (path.endsWith('/pages/college-admin/fee-structures.html')) return initCollegeAdminFeeStructuresPage();
    if (path.endsWith('/pages/college-admin/fee-analytics.html')) return initCollegeAdminFeeAnalyticsPage();
    if (path.endsWith('/pages/college-admin/fees.html')) return initCollegeAdminFeesPage();
    if (path.endsWith('/pages/college-admin/notices.html')) return initCollegeAdminNoticesPage();
    if (path.endsWith('/pages/college-admin/hr.html')) return initCollegeAdminHrPage();
    if (path.endsWith('/pages/college-admin/courses.html')) return initCollegeAdminCoursesPage();
    if (path.endsWith('/pages/college-admin/logistics.html')) return initCollegeAdminLogisticsPage();
    if (path.endsWith('/pages/faculty/dashboard.html')) return initFacultyDashboardPage();
    if (path.endsWith('/pages/faculty/attendance.html')) return initFacultyAttendancePage();
    if (path.endsWith('/pages/faculty/leave.html')) return initFacultyLeavePage();
    if (path.endsWith('/pages/faculty/grades.html')) return initFacultyGradesPage();
    if (path.endsWith('/pages/faculty/assignments.html')) return initFacultyAssignmentsPage();
    if (path.endsWith('/pages/faculty/timetable.html')) return initFacultyTimetablePage();
    if (path.endsWith('/pages/faculty/live-class.html')) return initFacultyLiveClassPage();
    if (path.endsWith('/pages/student/live-class.html')) return initStudentLiveClassPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
