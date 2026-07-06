(function () {
  const ROLE_LABELS = {
    superadmin: 'Super Admin',
    collegeAdmin: 'College Admin',
    faculty: 'Faculty',
    student: 'Student',
    parent: 'Parent',
  };

  const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let socketPromise;
  let refreshTimer;
  let studentSmartWatchId;

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(target, value) {
    const element = typeof target === 'string' ? byId(target) : target;
    if (element) {
      element.textContent = value;
    }
  }

  function setHTML(target, value) {
    const element = typeof target === 'string' ? byId(target) : target;
    if (element) {
      element.innerHTML = value;
    }
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getUser() {
    return window.api?.getUser?.() || null;
  }

  function getUserId(user) {
    return user?.id || user?._id || null;
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

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
  }

  function currentMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function isSameDate(value, compare = new Date()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date.toDateString() === compare.toDateString();
  }

  function parseDateInput(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function replaceCanvas(id) {
    const canvas = byId(id);
    if (!canvas || !canvas.parentNode) return null;
    const next = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(next, canvas);
    return next;
  }

  function findCard(title) {
    return Array.from(document.querySelectorAll('.card')).find((card) => {
      const label = card.querySelector('.card-title');
      return label && label.textContent.trim().includes(title);
    });
  }

  function statusBadge(status) {
    const value = String(status || '').toLowerCase();
    const cls = value === 'paid' || value === 'approved' || value === 'active' || value === 'submitted' || value === 'graded'
      ? 'badge-success'
      : value === 'pending' || value === 'partial' || value === 'upcoming' || value === 'late'
        ? 'badge-warning'
        : value === 'overdue' || value === 'rejected' || value === 'fail' || value === 'inactive' || value === 'suspended'
          ? 'badge-danger'
          : 'badge-gray';
    return `<span class="badge ${cls}">${String(status || 'Unknown')}</span>`;
  }

  function gradeColor(grade) {
    const map = {
      O: '#059669',
      'A+': '#10B981',
      A: '#3B82F6',
      'B+': '#8B5CF6',
      B: '#F59E0B',
      C: '#D97706',
      F: '#EF4444',
    };
    return map[grade] || '#64748B';
  }

  async function fetchMe() {
    const response = await window.api.request('/auth/me', { silent: true });
    return response.user;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (typeof window.__erpLivePageRefresh === 'function') {
        window.__erpLivePageRefresh();
      }
    }, 500);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        if (existing.dataset.loaded === 'true') resolve();
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
      socket.on('platform_notice', (payload) => {
        window.showToast?.(payload?.title || payload?.message || 'Platform update received', 'info');
      });
      socket.on('erp:data-change', scheduleRefresh);
      socket.on('erp:message', (payload) => {
        if (!window.location.pathname.endsWith('/pages/messages.html')) {
          const sender = payload?.message?.senderId?.name || 'New message';
          window.showToast?.(`${sender}: ${payload?.message?.content || ''}`.trim(), 'info');
        }
        scheduleRefresh();
      });
      return socket;
    })();

    return socketPromise;
  }

  function getCurrentWeekday() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }

  function groupResultsBySemester(results) {
    return results.reduce((acc, result) => {
      const semester = result.subjectId?.semester || 1;
      if (!acc[semester]) acc[semester] = [];
      acc[semester].push(result);
      return acc;
    }, {});
  }

  function buildSemesterMetrics(grouped) {
    const semesters = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    return semesters.map((semester) => {
      const items = grouped[semester];
      const sgpa = items.length
        ? (items.reduce((sum, item) => sum + Number(item.gradePoints || 0), 0) / items.length).toFixed(2)
        : '0.00';
      const credits = items.reduce((sum, item) => sum + Number(item.subjectId?.credits || 0), 0);
      return { semester, sgpa: Number(sgpa), credits, items };
    });
  }

  function renderResultsCommon(options) {
    const { metrics, cgpa, resultsBodyId, sgpaChartId, radarChartId, semTitleId, semBadgeId } = options;
    const statValues = document.querySelectorAll('.stats-grid .stat-value');
    if (statValues[0]) statValues[0].textContent = cgpa === 'N/A' ? 'N/A' : cgpa;
    if (statValues[1]) statValues[1].textContent = metrics.length ? String(Math.max(...metrics.map((metric) => metric.sgpa)).toFixed(2)) : '0';
    if (statValues[2]) statValues[2].textContent = String(metrics.length);
    if (statValues[3]) statValues[3].textContent = String(metrics.reduce((sum, metric) => sum + metric.credits, 0));

    const renderSemester = (semester, button) => {
      const selected = metrics.find((metric) => metric.semester === Number(semester)) || metrics[0];
      if (!selected) {
        setHTML(resultsBodyId, '<tr><td colspan="8"><div class="empty-state"><div class="empty-state-title">No results available</div></div></td></tr>');
        return;
      }

      document.querySelectorAll('.tab-btn').forEach((item) => item.classList.remove('active'));
      if (button) button.classList.add('active');

      setText(semTitleId, `Semester ${selected.semester} Result`);
      setText(semBadgeId, `SGPA: ${selected.sgpa.toFixed(2)}`);
      setHTML(resultsBodyId, selected.items.map((item) => `
        <tr>
          <td><code style="font-size:12px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${item.subjectId?.code || '-'}</code></td>
          <td style="font-weight:600">${item.subjectId?.name || '-'}</td>
          <td style="text-align:center">-</td>
          <td style="text-align:center">-</td>
          <td style="text-align:center">${item.marksObtained}/${item.totalMarks}</td>
          <td style="text-align:center;font-weight:700">${item.percentage || 0}%</td>
          <td><span style="font-weight:800;color:${gradeColor(item.grade)};font-size:15px">${item.grade || '-'}</span></td>
          <td style="text-align:center"><span class="badge badge-gray">${item.subjectId?.credits || 0}</span></td>
        </tr>
      `).join(''));
    };

    window.showSem = renderSemester;
    renderSemester(metrics[0]?.semester, document.querySelector('.tab-btn.active') || document.querySelector('.tab-btn'));

    if (window.Chart) {
      const sgpaCanvas = replaceCanvas(sgpaChartId);
      if (sgpaCanvas) {
        new window.Chart(sgpaCanvas, {
          type: 'line',
          data: {
            labels: metrics.map((metric) => `Sem ${metric.semester}`),
            datasets: [{
              label: 'SGPA',
              data: metrics.map((metric) => metric.sgpa),
              borderColor: '#5B21B6',
              backgroundColor: 'rgba(91,33,182,0.1)',
              fill: true,
              tension: 0.4,
              borderWidth: 3,
              pointRadius: 5,
              pointBackgroundColor: '#5B21B6',
            }],
          },
          options: { ...window.getChartDefaults(), scales: { y: { min: 0, max: 10 }, x: { grid: { display: false } } } },
        });
      }

      const radarCanvas = replaceCanvas(radarChartId);
      if (radarCanvas) {
        const subjectAverages = {};
        metrics.forEach((metric) => {
          metric.items.forEach((item) => {
            const key = item.subjectId?.code || item.subjectId?.name || 'Subject';
            if (!subjectAverages[key]) subjectAverages[key] = [];
            subjectAverages[key].push(Number(item.percentage || 0));
          });
        });
        const labels = Object.keys(subjectAverages).slice(0, 6);
        new window.Chart(radarCanvas, {
          type: 'radar',
          data: {
            labels,
            datasets: [{
              label: 'Average %',
              data: labels.map((label) => Math.round(subjectAverages[label].reduce((sum, value) => sum + value, 0) / subjectAverages[label].length)),
              backgroundColor: 'rgba(91,33,182,0.2)',
              borderColor: '#5B21B6',
              pointBackgroundColor: '#5B21B6',
              borderWidth: 2,
            }],
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
        });
      }
    }
  }

  function renderAttendanceCommon(options) {
    const { summary, records, tableId, subjectChartId, trendChartId } = options;
    const totals = summary.reduce((acc, item) => {
      acc.total += Number(item.total || 0);
      acc.present += Number(item.present || 0);
      acc.absent += Number(item.absent || 0);
      acc.late += Number(item.late || 0);
      return acc;
    }, { total: 0, present: 0, absent: 0, late: 0 });
    const overall = totals.total ? (((totals.present + totals.late * 0.5) / totals.total) * 100).toFixed(1) : '0.0';
    const shortage = summary.filter((item) => Number(item.percentage || 0) < 75).length;
    const statValues = document.querySelectorAll('.stats-grid .stat-value');
    if (statValues[0]) statValues[0].textContent = `${overall}%`;
    if (statValues[1]) statValues[1].textContent = String(totals.present);
    if (statValues[2]) statValues[2].textContent = String(totals.absent);
    if (statValues[3]) statValues[3].textContent = shortage ? `${shortage} Subjects` : 'None';

    const sortedRecords = records.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const todayRecords = records.filter((record) => isSameDate(record.date));
    const manualCount = records.filter((record) => (record.source || 'manual') === 'manual').length;
    const smartCount = records.filter((record) => record.source === 'smart-location').length;
    const riskSubjects = summary.slice().sort((a, b) => Number(a.percentage || 0) - Number(b.percentage || 0));
    const lowestRisk = riskSubjects[0];
    const belowBenchmark = riskSubjects.filter((item) => Number(item.percentage || 0) < 75);

    setHTML('studentTodayAttendance', todayRecords.length ? todayRecords.map((record) => {
      const status = record.status || 'unknown';
      const badge = status === 'present' ? 'badge-success' : status === 'late' ? 'badge-warning' : status === 'absent' ? 'badge-danger' : 'badge-gray';
      return `<div class="attendance-source-row"><span>${escapeHTML(record.subjectId?.name || record.subject?.name || 'Subject')}</span><strong><span class="badge ${badge}">${escapeHTML(status)}</span></strong></div>`;
    }).join('') : '<div class="attendance-big-number">No class logs today</div><p>Smart or manual attendance will appear here after faculty records today\'s class.</p>');

    setHTML('studentEligibilityPlan', lowestRisk ? `
      <div class="attendance-big-number ${Number(lowestRisk.percentage || 0) < 75 ? 'danger' : 'safe'}">${Number(lowestRisk.percentage || 0).toFixed(1)}%</div>
      <p>${escapeHTML(lowestRisk.subject?.name || 'Lowest subject')} is your lowest tracked subject. ${belowBenchmark.length ? `${belowBenchmark.length} subject(s) need recovery before exam eligibility.` : 'All tracked subjects are currently above the 75% benchmark.'}</p>
    ` : '<div class="attendance-big-number">No history yet</div><p>Attendance forecast will appear after classes are marked.</p>');

    setHTML('studentAttendanceSourceMix', `
      <div class="attendance-source-row"><span>Manual faculty marks</span><strong>${manualCount}</strong></div>
      <div class="attendance-source-row"><span>Smart location marks</span><strong>${smartCount}</strong></div>
      <div class="attendance-source-row"><span>Late entries</span><strong>${totals.late}</strong></div>
    `);

    setHTML('recentAttendanceBody', sortedRecords.slice(0, 8).map((record) => {
      const status = record.status || 'unknown';
      const badge = status === 'present' ? 'badge-success' : status === 'late' ? 'badge-warning' : status === 'absent' ? 'badge-danger' : 'badge-gray';
      const source = record.source === 'smart-location' ? 'Smart Location' : 'Manual';
      const sourceBadge = record.source === 'smart-location' ? 'badge-info' : 'badge-gray';
      return `
        <tr>
          <td style="font-size:12px;color:#64748B">${formatDate(record.date, true)}</td>
          <td style="font-weight:700">${escapeHTML(record.subjectId?.name || record.subject?.name || '-')}</td>
          <td><span class="badge ${badge}">${escapeHTML(status)}</span></td>
          <td><span class="badge ${sourceBadge}">${source}</span></td>
          <td style="font-size:12px;color:#64748B">${escapeHTML(record.remarks || '-')}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No attendance ledger entries yet</div></div></td></tr>');

    setHTML(tableId, summary.map((item) => {
      const percentage = Number(item.percentage || 0);
      const text = percentage >= 75 ? 'Good' : 'Shortage';
      const badge = percentage >= 75 ? 'badge-success' : 'badge-danger';
      return `
        <tr>
          <td style="font-weight:600">${escapeHTML(item.subject?.name || '-')}</td>
          <td style="font-size:13px;color:#64748B">${escapeHTML(item.subject?.code || '-')}</td>
          <td style="text-align:center">${item.total || 0}</td>
          <td style="text-align:center;color:#059669;font-weight:700">${item.present || 0}</td>
          <td style="text-align:center;color:#EF4444;font-weight:700">${item.absent || 0}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar" style="flex:1"><div class="progress-fill" style="width:${percentage}%;background:${percentage >= 75 ? '#059669' : '#EF4444'}"></div></div>
              <strong style="min-width:42px">${percentage}%</strong>
            </div>
          </td>
          <td><span class="badge ${badge}">${text}</span></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No attendance found</div></div></td></tr>');

    if (window.Chart) {
      const subjectCanvas = replaceCanvas(subjectChartId);
      if (subjectCanvas) {
        new window.Chart(subjectCanvas, {
          type: 'bar',
          data: {
            labels: summary.map((item) => item.subject?.code || item.subject?.name || 'Subject'),
            datasets: [{
              label: 'Attendance %',
              data: summary.map((item) => Number(item.percentage || 0)),
              backgroundColor: summary.map((item) => Number(item.percentage || 0) >= 75 ? '#059669' : '#EF4444'),
              borderRadius: 6,
            }],
          },
          options: { ...window.getChartDefaults(), scales: { y: { min: 0, max: 100 }, x: { grid: { display: false } } } },
        });
      }

      const grouped = records.reduce((acc, record) => {
        const month = new Date(record.date).toLocaleDateString('en-US', { month: 'short' });
        if (!acc[month]) acc[month] = { total: 0, present: 0 };
        acc[month].total += 1;
        if (record.status === 'present' || record.status === 'late') acc[month].present += 1;
        return acc;
      }, {});
      const trendLabels = Object.keys(grouped);
      const trendValues = trendLabels.map((label) => Math.round((grouped[label].present / grouped[label].total) * 100));
      const trendCanvas = replaceCanvas(trendChartId);
      if (trendCanvas) {
        new window.Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: trendLabels,
            datasets: [{
              label: 'Attendance %',
              data: trendValues,
              borderColor: '#0284C7',
              backgroundColor: 'rgba(2,132,199,0.1)',
              fill: true,
              tension: 0.35,
              borderWidth: 2.5,
            }],
          },
          options: { ...window.getChartDefaults(), scales: { y: { min: 0, max: 100 }, x: { grid: { display: false } } } },
        });
      }
    }
  }

  async function initMessagesPage() {
    const state = { conversations: [], users: [], activeId: null };

    async function loadContacts() {
      const [usersRes, convoRes] = await Promise.all([
        window.api.request('/communications/users', { silent: true }),
        window.api.request('/communications/conversations', { silent: true }),
      ]);
      state.users = usersRes.users || [];
      state.conversations = convoRes.conversations || [];
      renderContacts();
      if (!state.activeId && state.conversations[0]) {
        await window.selectContact(String(state.conversations[0]._id));
      }
    }

    function renderContacts() {
      const lookup = new Map(state.conversations.map((item) => [String(item._id), item]));
      const query = (byId('contactSearch')?.value || '').toLowerCase();
      const list = state.users
        .map((user) => ({ ...user, conversation: lookup.get(String(user._id)) }))
        .filter((item) => !query || item.name.toLowerCase().includes(query) || item.email.toLowerCase().includes(query));

      setHTML('contactsList', list.map((item) => {
        const unread = item.conversation?.unreadCount || 0;
        const active = String(item._id) === String(state.activeId);
        return `
          <div class="contact-item ${unread ? 'unread' : ''}${active ? ' active' : ''}" id="contact-${item._id}" onclick="selectContact('${item._id}')">
            <div style="position:relative">
              <div class="avatar avatar-sm" style="width:40px;height:40px">${item.name[0]}</div>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.name}</div>
                ${unread ? `<span style="background:#4F46E5;color:white;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px">${unread}</span>` : ''}
              </div>
              <div style="font-size:11px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.conversation?.lastMessage || item.email}</div>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-state"><div class="empty-state-title">No conversations yet</div></div>');
    }

    window.selectContact = async function selectContact(id) {
      state.activeId = id;
      renderContacts();
      const contact = state.users.find((item) => String(item._id) === String(id));
      if (!contact) return;
      setText('chatAvatar', contact.name[0]);
      setText('chatName', contact.name);
      setText('chatStatus', ROLE_LABELS[contact.role] || contact.role);
      const res = await window.api.request(`/communications/messages/${id}`, { silent: true });
      setHTML('chatMessages', (res.messages || []).map((message) => {
        const mine = String(message.senderId?._id || message.senderId) === String(getUserId(getUser()));
        return `
          <div class="msg-wrapper ${mine ? 'sent' : 'received'}">
            <div class="msg-bubble ${mine ? 'sent' : 'received'}">${message.content}</div>
            <div class="msg-time">${formatDate(message.createdAt, true)}</div>
          </div>
        `;
      }).join('') || '<div class="empty-state"><div class="empty-state-title">No messages yet</div></div>');
      const area = byId('chatMessages');
      if (area) area.scrollTop = area.scrollHeight;
      loadContacts();
    };

    window.sendMessage = async function sendMessage() {
      const input = byId('msgInput');
      const content = input?.value.trim();
      if (!content || !state.activeId) return;
      await window.api.request('/communications/messages', {
        method: 'POST',
        body: JSON.stringify({ receiverId: state.activeId, content }),
      });
      input.value = '';
      await window.selectContact(state.activeId);
    };

    window.startConversation = async function startConversation() {
      const to = byId('newMsgTo')?.value.trim().toLowerCase();
      const text = byId('newMsgText')?.value.trim();
      if (!to || !text) {
        window.showToast('Fill in all fields', 'error');
        return;
      }
      const target = state.users.find((user) => user.email.toLowerCase() === to || user.name.toLowerCase().includes(to));
      if (!target) {
        window.showToast('User not found', 'error');
        return;
      }
      await window.api.request('/communications/messages', {
        method: 'POST',
        body: JSON.stringify({ receiverId: target._id, content: text }),
      });
      byId('newMsgTo').value = '';
      byId('newMsgText').value = '';
      window.closeModal?.('newMessageModal');
      await loadContacts();
      await window.selectContact(String(target._id));
    };

    const search = byId('contactSearch');
    if (search) search.oninput = renderContacts;
    window.__erpLivePageRefresh = loadContacts;
    await loadContacts();
  }

  async function initStudentDashboardPage() {
    const [me, profileRes, attendanceRes, resultsRes, assignmentsRes, feesRes, noticesRes, timetableRes] = await Promise.all([
      fetchMe(),
      window.api.request('/academics/student-profile', { silent: true }),
      window.api.request('/attendance/summary', { silent: true }),
      window.api.request('/exams/results', { silent: true }),
      window.api.request('/academics/assignments', { silent: true }),
      window.api.request('/fees', { silent: true }),
      window.api.request('/notices', { silent: true }),
      window.api.request('/academics/timetable', { silent: true }),
    ]);

    const attendanceSummary = attendanceRes.summary || [];
    const overallAttendance = attendanceSummary.length
      ? Math.round(attendanceSummary.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / attendanceSummary.length)
      : 0;
    const pendingAssignments = (assignmentsRes.assignments || []).filter((item) => !item.submission).length;
    const pendingFees = (feesRes.fees || []).filter((item) => item.status !== 'paid').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const metrics = buildSemesterMetrics(groupResultsBySemester(resultsRes.results || []));
    const todayClasses = (timetableRes.timetable || []).filter((item) => item.dayOfWeek === getCurrentWeekday()).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const profile = profileRes.profile || {};
    const student = profile.student || me;
    const notifications = [];
    if (pendingFees[0]) notifications.push({ title: 'Fee Deadline Alert', message: `Next due ${formatDate(pendingFees[0].dueDate)} • ${formatMoney(Math.max(Number(pendingFees[0].amount || 0) - Number(pendingFees[0].paidAmount || 0), 0))}` });
    if (pendingAssignments) notifications.push({ title: 'Assignment Due', message: `${pendingAssignments} assignment(s) pending submission` });
    if ((noticesRes.notices || [])[0]) notifications.push({ title: noticesRes.notices[0].title, message: noticesRes.notices[0].content });

    setText('welcomeMsg', `What's up, ${me.name?.split(' ')[0] || 'Student'}!`);
    setText('sidebar-user-name', me.name || 'Student');
    const sidebarRole = document.querySelector('.sidebar-user-role');
    if (sidebarRole) sidebarRole.textContent = `${me.department || 'Student'}${me.semester ? ` • Sem ${me.semester}` : ''}`;
    const statValues = document.querySelectorAll('.stats-grid .stat-value');
    if (statValues[0]) statValues[0].textContent = `${overallAttendance}%`;
    if (statValues[1]) statValues[1].textContent = resultsRes.cgpa || 'N/A';
    if (statValues[2]) statValues[2].textContent = `${pendingAssignments} Pending`;

    const notifBadge = document.querySelector('#notif-btn .topbar-badge');
    if (notifBadge) notifBadge.textContent = String(Math.min(notifications.length, 9));
    const notifPanel = byId('notif-panel');
    if (notifPanel) {
      setHTML(notifPanel, `<div style="padding:14px 16px;border-bottom:1px solid #F1F5F9;font-weight:700;font-size:14px">Notifications</div>${notifications.map((item) => `<div class="notif-item unread"><div class="notif-dot"></div><div><div style="font-size:13px;font-weight:600">${escapeHTML(item.title)}</div><div style="font-size:12px;color:#64748B">${escapeHTML(item.message)}</div></div></div>`).join('') || '<div style="padding:14px 16px;color:#64748B;font-size:13px">No new notifications</div>'}`);
    }

    setHTML('noticesBody', (noticesRes.notices || []).slice(0, 3).map((notice) => `
      <div style="border-left:3px solid ${notice.type === 'urgent' ? '#EF4444' : notice.type === 'exam' ? '#4F46E5' : '#10B981'};padding:10px 12px;background:#F8FAFC;border-radius:0 8px 8px 0">
        <div style="font-weight:700;font-size:13px;margin-bottom:2px">${notice.title}</div>
        <div style="font-size:12px;color:#64748B">${notice.content}</div>
      </div>
    `).join('') || '<div class="empty-state"><div class="empty-state-title">No notices</div></div>');

    const todayCard = findCard('Today\'s Classes') || findCard('Today\'s Classes'.replace('\\', ''));
    const todayBody = todayCard?.querySelector('.card-body');
    if (todayBody) {
      todayBody.style.padding = '12px';
      setHTML(todayBody, todayClasses.map((item, index) => `
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;border:1px solid ${index === 0 ? '#BAE6FD' : '#E2E8F0'};background:${index === 0 ? '#F0F9FF' : 'white'}">
          <div style="min-width:60px;text-align:center"><div style="font-weight:700;font-size:13px;color:${index === 0 ? '#0284C7' : '#64748B'}">${item.startTime}</div></div>
          <div style="flex:1"><div style="font-weight:700;font-size:13px">${item.subjectId?.name || '-'}</div><div style="font-size:11px;color:#64748B">${item.facultyId?.name || '-'}${item.room ? ` • ${item.room}` : ''}</div></div>
          <span class="badge ${index === 0 ? 'badge-info' : 'badge-gray'}">${index === 0 ? 'Now' : 'Upcoming'}</span>
        </div>
      `).join('') || '<div class="empty-state"><div class="empty-state-title">No classes scheduled today</div></div>');
    }

    const facilityCards = Array.from(document.querySelectorAll('.grid.col-3.mb-6 > div:first-child .card'));
    const hostelText = profile.hostelRoom
      ? `${profile.hostelRoom.hostel?.name || 'Hostel'}${profile.hostelRoom.roomNumber ? ` • Room ${profile.hostelRoom.roomNumber}` : ''}`
      : 'No hostel allocation';
    const hostelMeta = profile.hostelRoom
      ? `${profile.hostelRoom.capacity || '-'} bed capacity`
      : 'Contact administration for allocation';
    const transportText = profile.transportRoute
      ? `${profile.transportRoute.routeName || 'Route'}${profile.transportRoute.firstStop ? ` • ${profile.transportRoute.firstStop}` : ''}`
      : 'No transport route assigned';
    const transportMeta = profile.transportRoute
      ? `${profile.transportRoute.busNumber || 'Bus assigned'}${profile.transportRoute.driverName ? ` • ${profile.transportRoute.driverName}` : ''}`
      : 'Campus transport not assigned';
    const feeOutstanding = pendingFees[0]
      ? `${formatMoney(Math.max(Number(pendingFees[0].amount || 0) - Number(pendingFees[0].paidAmount || 0), 0))} Due`
      : 'No pending dues';
    const feeMeta = pendingFees[0]
      ? `Deadline: ${formatDate(pendingFees[0].dueDate)}`
      : 'All recorded fees are cleared';
    const facilityData = [
      { title: 'Hostel', value: hostelText, meta: hostelMeta, metaColor: '#94A3B8' },
      { title: 'Transport', value: transportText, meta: transportMeta, metaColor: '#059669' },
      { title: 'Fee Status', value: feeOutstanding, meta: feeMeta, metaColor: pendingFees[0] ? '#EF4444' : '#059669' },
    ];
    facilityCards.forEach((card, index) => {
      const data = facilityData[index];
      if (!card || !data) return;
      const info = card.querySelector('div > div:nth-child(2)');
      if (!info) return;
      const blocks = info.querySelectorAll('div');
      if (blocks[0]) blocks[0].textContent = data.title;
      if (blocks[1]) blocks[1].textContent = data.value;
      if (blocks[2]) {
        blocks[2].textContent = data.meta;
        blocks[2].style.color = data.metaColor;
      }
    });

    if (window.Chart) {
      const canvas = replaceCanvas('sgpaChart');
      if (canvas) {
        new window.Chart(canvas, {
          type: 'line',
          data: {
            labels: metrics.map((metric) => `Sem ${metric.semester}`),
            datasets: [{ label: 'SGPA', data: metrics.map((metric) => metric.sgpa), borderColor: '#0284C7', backgroundColor: 'rgba(2,132,199,0.1)', fill: true, tension: 0.35, borderWidth: 3 }],
          },
          options: { ...window.getChartDefaults(), scales: { y: { min: 0, max: 10 }, x: { grid: { display: false } } } },
        });
      }
    }

    window.__erpLivePageRefresh = initStudentDashboardPage;
  }

  async function initStudentAttendancePage() {
    let smartConsentEnabled = false;

    function updateSmartStatus(message, type) {
      const element = byId('studentSmartStatus');
      if (!element) return;
      const icon = type === 'success' ? 'fa-circle-check' : type === 'warning' ? 'fa-triangle-exclamation' : 'fa-shield-halved';
      element.innerHTML = `<i class="fas ${icon}"></i> ${escapeHTML(message)}`;
    }

    function renderStudentSmartResult(res) {
      if (!res?.active) {
        setText('studentSmartClass', 'No active class');
        setText('studentSmartPresence', '--');
        setText('studentSmartAttendance', '--');
        updateSmartStatus(res?.message || 'No active scheduled class found for smart attendance.', 'warning');
        return;
      }
      const presence = res.presence || {};
      const status = presence.status === 'inside' ? 'In class' : presence.status === 'waitingTeacher' ? 'Waiting teacher' : presence.status === 'noClassroom' ? 'No geofence' : 'Outside';
      setText('studentSmartClass', `${res.activeSlot?.subjectCode || ''} ${res.activeSlot?.room || ''}`.trim() || 'Active');
      setText('studentSmartPresence', status);
      setText('studentSmartAttendance', presence.autoAttendanceStatus || 'none');
      updateSmartStatus(`Last location heartbeat processed for ${res.activeSlot?.subject || 'current class'}.`, 'success');
    }

    async function loadSmartConsent() {
      try {
        const res = await window.api.request('/attendance/location-consent', { silent: true });
        smartConsentEnabled = Boolean(res.consent?.enabled);
        setText('studentConsentState', smartConsentEnabled ? 'Enabled' : 'Disabled');
        const button = byId('locationConsentBtn');
        if (button) button.innerHTML = `<i class="fas fa-user-shield"></i> ${smartConsentEnabled ? 'Revoke Consent' : 'Enable Consent'}`;
      } catch (error) {
        setText('studentConsentState', 'Unavailable');
      }
    }

    async function publishStudentPosition(position) {
      const res = await window.api.request('/attendance/live-location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
      });
      renderStudentSmartResult(res);
    }

    const [summaryRes, recordsRes] = await Promise.all([
      window.api.request('/attendance/summary', { silent: true }),
      window.api.request('/attendance', { silent: true }),
    ]);
    renderAttendanceCommon({
      summary: summaryRes.summary || [],
      records: recordsRes.attendance || [],
      tableId: 'attBreakdownBody',
      subjectChartId: 'subjectAttChart',
      trendChartId: 'monthlyAttChart',
    });
    await loadSmartConsent();

    window.toggleLocationConsent = async function toggleLocationConsent() {
      const nextEnabled = !smartConsentEnabled;
      await window.api.request('/attendance/location-consent', { method: 'POST', body: JSON.stringify({ enabled: nextEnabled }) });
      smartConsentEnabled = nextEnabled;
      if (!nextEnabled && studentSmartWatchId !== undefined) {
        navigator.geolocation?.clearWatch(studentSmartWatchId);
        studentSmartWatchId = undefined;
      }
      await loadSmartConsent();
      updateSmartStatus(nextEnabled ? 'Consent enabled. Start live check-in when you enter class.' : 'Consent revoked. Live smart attendance is stopped.', nextEnabled ? 'success' : 'warning');
    };

    window.startStudentSmartAttendance = async function startStudentSmartAttendance() {
      if (!smartConsentEnabled) {
        window.showToast?.('Enable location consent before starting live check-in', 'warning');
        return;
      }
      if (!navigator.geolocation) {
        window.showToast?.('Geolocation is not supported by this browser', 'error');
        return;
      }
      if (studentSmartWatchId !== undefined) {
        window.showToast?.('Live smart attendance is already running', 'info');
        return;
      }
      updateSmartStatus('Starting live location check-in for scheduled class periods...', 'info');
      studentSmartWatchId = navigator.geolocation.watchPosition(
        (position) => publishStudentPosition(position).catch((error) => updateSmartStatus(error.message || 'Location heartbeat failed', 'warning')),
        (error) => updateSmartStatus(error.message || 'Unable to access location', 'warning'),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 }
      );
      window.showToast?.('Live smart attendance started', 'success');
    };
    window.__erpLivePageRefresh = initStudentAttendancePage;
  }

  async function initStudentResultsPage() {
    const res = await window.api.request('/exams/results', { silent: true });
    const grouped = groupResultsBySemester(res.results || []);
    renderResultsCommon({
      metrics: buildSemesterMetrics(grouped),
      cgpa: res.cgpa,
      resultsBodyId: 'resultsBody',
      sgpaChartId: 'sgpaChart',
      radarChartId: 'radarChart',
      semTitleId: 'semTitle',
      semBadgeId: 'semSGPA',
    });
    window.__erpLivePageRefresh = initStudentResultsPage;
  }

  async function initStudentFeesPage() {
    const res = await window.api.request('/fees', { silent: true });
    const fees = res.fees || [];
    const paidTotal = fees.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
    const totalProgram = fees.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const pending = fees.filter((item) => item.status !== 'paid').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const nextPending = pending[0] || null;
    const statValues = document.querySelectorAll('.stats-grid .stat-value');
    if (statValues[0]) statValues[0].textContent = formatMoney(paidTotal);
    if (statValues[1]) statValues[1].textContent = formatMoney(nextPending ? nextPending.amount - Number(nextPending.paidAmount || 0) : 0);
    if (statValues[2]) statValues[2].textContent = formatMoney(totalProgram);

    const banner = document.querySelector('.erp-content > div[style*="linear-gradient(135deg,#EF4444"]');
    if (banner) {
      setHTML(banner, nextPending ? `
        <div>
          <div style="font-size:13px;font-weight:600;color:#FCA5A5;margin-bottom:4px">Outstanding Due</div>
          <div style="font-size:28px;font-weight:900">${formatMoney(nextPending.amount - Number(nextPending.paidAmount || 0))}</div>
          <div style="font-size:13px;color:#FCA5A5">${String(nextPending.feeType || '').toUpperCase()} • Deadline: ${formatDate(nextPending.dueDate)}</div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.4)" onclick="openModal('payNowModal')"><i class="fas fa-credit-card"></i> Pay Now</button>
        </div>
      ` : '<div style="font-weight:700">No outstanding dues</div>');
    }

    setHTML('feeHistory', fees.map((fee, index) => `
      <tr>
        <td style="color:#94A3B8;font-size:12px">${index + 1}</td>
        <td style="font-weight:600">${String(fee.feeType || '').toUpperCase()} Fee${fee.semester ? ` - Sem ${fee.semester}` : ''}</td>
        <td style="font-weight:700">${formatMoney(fee.amount)}</td>
        <td style="font-size:13px;color:#64748B">${fee.paymentMethod || '-'}</td>
        <td style="font-size:12px;color:#64748B">${formatDate(fee.paidDate || fee.dueDate)}</td>
        <td>${fee.receiptNo ? `<code style="font-size:11px;background:#F1F5F9;padding:2px 6px;border-radius:4px">${fee.receiptNo}</code>` : '-'}</td>
        <td>${fee.status === 'paid' ? `<div style="display:flex;gap:6px;align-items:center"><span class="badge badge-success">Paid</span></div>` : `<button class="btn btn-xs btn-danger" onclick="openModal('payNowModal')"><i class="fas fa-credit-card"></i> Pay Now</button>`}</td>
      </tr>
    `).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No fee records found</div></div></td></tr>');

    window.processPayment = async function processPayment() {
      if (!nextPending) {
        window.showToast('No pending fees to pay', 'info');
        return;
      }
      const amount = Number(byId('payAmount')?.value || 0);
      if (!amount) {
        window.showToast('Enter a valid amount', 'error');
        return;
      }
      await window.api.request(`/fees/${nextPending._id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount, paymentMethod: 'online', receiptNo: `STU-${Date.now()}` }),
      });
      window.closeModal?.('payNowModal');
      window.showToast('Payment recorded successfully', 'success');
      initStudentFeesPage();
    };

    window.__erpLivePageRefresh = initStudentFeesPage;
  }

  async function initStudentCoursesPage() {
    const [subjectsRes, attendanceRes] = await Promise.all([
      window.api.request('/academics/subjects', { silent: true }),
      window.api.request('/attendance/summary', { silent: true }),
    ]);
    const subjects = subjectsRes.subjects || [];
    const attendanceMap = new Map((attendanceRes.summary || []).map((item) => [String(item.subject?._id), Number(item.percentage || 0)]));
    const searchInput = document.querySelector('.search-bar input');

    function render() {
      const query = (searchInput?.value || '').toLowerCase();
      setHTML('courseGrid', subjects.filter((subject) => !query || subject.name.toLowerCase().includes(query) || subject.code.toLowerCase().includes(query)).map((subject) => {
        const progress = Math.max(attendanceMap.get(String(subject._id)) || 0, 0);
        return `
          <div class="course-card">
            <div class="course-banner"><i class="fas fa-book"></i></div>
            <div class="course-body">
              <div class="course-code">${subject.code}</div>
              <div class="course-title">${subject.name}</div>
              <div class="course-prof"><div class="prof-avatar">${(subject.facultyId?.name || 'F')[0]}</div>${subject.facultyId?.name || 'Faculty not assigned'}</div>
              <div>
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748B;margin-bottom:4px;font-weight:600"><span>Attendance Health</span><span>${progress}%</span></div>
                <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
              </div>
            </div>
            <div class="card-footer" style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
              <a href="../ai-tools.html?course=${encodeURIComponent(subject.code)}" class="btn btn-xs btn-secondary" style="background:white"><i class="fas fa-robot text-primary"></i> AI Tutor</a>
              <button class="btn btn-xs btn-primary" onclick="showToast('Credits: ${subject.credits || 0} | Semester ${subject.semester}', 'info')">Details</button>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No courses available</div></div>');
    }

    if (searchInput) searchInput.oninput = render;
    render();
    window.__erpLivePageRefresh = initStudentCoursesPage;
  }

  async function initStudentTimetablePage() {
    const res = await window.api.request('/academics/timetable', { silent: true });
    const entries = res.timetable || [];
    const timeSlots = [...new Set(entries.map((entry) => `${entry.startTime} - ${entry.endTime}`))]
      .sort((a, b) => timeToMinutes(a.split(' - ')[0]) - timeToMinutes(b.split(' - ')[0]));
    const today = getCurrentWeekday();
    const nowMinutes = currentMinutes();
    const todayEntries = entries.filter((entry) => entry.dayOfWeek === today).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    const todayIndex = DAY_ORDER.indexOf(today);
    const baseIndex = todayIndex >= 0 ? todayIndex : 0;
    const baseMinutes = todayIndex >= 0 ? nowMinutes : 0;
    const nextEntry = entries
      .map((entry) => {
        const entryIndex = DAY_ORDER.indexOf(entry.dayOfWeek);
        if (entryIndex < 0) return null;
        let dayOffset = entryIndex - baseIndex;
        const start = timeToMinutes(entry.startTime);
        if (dayOffset < 0 || (dayOffset === 0 && start < baseMinutes)) dayOffset += DAY_ORDER.length;
        return { ...entry, nextWeight: dayOffset * 1440 + start - baseMinutes };
      })
      .filter(Boolean)
      .sort((a, b) => a.nextWeight - b.nextWeight)[0];
    const rooms = new Set(entries.map((entry) => entry.room).filter(Boolean));
    const subjects = new Set(entries.map((entry) => entry.subjectId?.name).filter(Boolean));
    const busiestDay = DAY_ORDER.map((day) => ({ day, count: entries.filter((entry) => entry.dayOfWeek === day).length })).sort((a, b) => b.count - a.count)[0];

    setText('studentNextClass', nextEntry ? (nextEntry.subjectId?.name || 'Scheduled class') : 'No timetable entries');
    setText('studentNextMeta', nextEntry ? `${nextEntry.dayOfWeek} • ${nextEntry.startTime}-${nextEntry.endTime} • ${nextEntry.room || 'Room pending'} • ${nextEntry.facultyId?.name || 'Faculty pending'}` : 'Ask the academic office to publish your timetable.');
    setText('studentWeeklyLoad', `${entries.length} periods`);
    setText('studentTodayLoad', `${todayEntries.length} classes`);
    setText('studentRoomCount', rooms.size ? `${rooms.size} rooms` : 'Pending');

    setHTML('studentTodayTimeline', todayEntries.map((entry) => {
      const active = nowMinutes >= timeToMinutes(entry.startTime) && nowMinutes <= timeToMinutes(entry.endTime);
      return `
        <div class="timetable-flow-item ${active ? 'active' : ''}">
          <div><strong>${escapeHTML(entry.startTime)}-${escapeHTML(entry.endTime)}</strong><span>${escapeHTML(entry.subjectId?.name || '-')}</span></div>
          <em>${escapeHTML(entry.room || 'Room pending')}</em>
        </div>
      `;
    }).join('') || '<div class="empty-state"><div class="empty-state-title">No classes scheduled today</div></div>');

    setHTML('studentTimetableInsights', `
      <div class="timetable-flow-item"><div><strong>${subjects.size}</strong><span>Subjects this week</span></div><em>${subjects.size ? 'Published' : 'Pending'}</em></div>
      <div class="timetable-flow-item"><div><strong>${busiestDay?.count || 0}</strong><span>Busiest day${busiestDay?.day ? `: ${escapeHTML(busiestDay.day)}` : ''}</span></div><em>Plan study load</em></div>
      <div class="timetable-flow-item"><div><strong>${entries.filter((entry) => entry.type === 'lab').length}</strong><span>Lab periods</span></div><em>Carry lab records</em></div>
    `);

    setHTML('timetableBody', timeSlots.map((slot) => {
      const [startTime] = slot.split(' - ');
      return `
        <tr>
          <td style="font-size:12px;font-weight:600;color:#64748B;white-space:nowrap">${slot}</td>
          ${DAY_ORDER.map((day) => {
            const entry = entries.find((item) => item.dayOfWeek === day && item.startTime === startTime);
            if (!entry) return '<td><div class="timetable-empty-cell"></div></td>';
            const active = day === today && nowMinutes >= timeToMinutes(entry.startTime) && nowMinutes <= timeToMinutes(entry.endTime);
            const isToday = day === today;
            const typeBadge = entry.type === 'lab' ? 'badge-purple' : entry.type === 'tutorial' ? 'badge-warning' : 'badge-info';
            return `
              <td style="padding:6px">
                <div class="timetable-session ${isToday ? 'is-today' : ''} ${active ? 'is-live' : ''}">
                  <div class="session-code">${escapeHTML(entry.subjectId?.code || entry.type || 'Class')}</div>
                  <div class="session-title">${escapeHTML(entry.subjectId?.name || '-')}</div>
                  <div class="session-meta"><i class="fas fa-location-dot"></i> ${escapeHTML(entry.room || 'Room pending')}</div>
                  <div class="session-meta"><i class="fas fa-user-tie"></i> ${escapeHTML(entry.facultyId?.name || 'Faculty pending')}</div>
                  <div class="session-foot"><span class="badge ${typeBadge}">${escapeHTML(entry.type || 'lecture')}</span>${active ? '<span class="badge badge-success">Now</span>' : ''}</div>
                </div>
              </td>
            `;
          }).join('')}
        </tr>
      `;
    }).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No timetable entries available</div></div></td></tr>');
    window.__erpLivePageRefresh = initStudentTimetablePage;
  }

  async function initStudentLibraryPage() {
    const [booksRes, recordsRes] = await Promise.all([
      window.api.request('/academics/library/books', { silent: true }),
      window.api.request('/academics/library/records', { silent: true }),
    ]);
    const books = booksRes.books || [];
    const records = recordsRes.records || [];
    const searchInput = document.querySelector('.search-bar input');

    function renderBooks() {
      const query = (searchInput?.value || '').toLowerCase();
      setHTML('catalogGrid', books.filter((book) => !query || book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query) || String(book.isbn || '').toLowerCase().includes(query)).map((book) => `
        <div class="book-card">
          <div class="book-cover"><i class="fas fa-book-open"></i></div>
          <div style="flex:1">
            <div class="book-title">${book.title}</div>
            <div class="book-author">${book.author}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;background:${book.availableCopies > 0 ? '#10B98122' : '#EF444422'};color:${book.availableCopies > 0 ? '#10B981' : '#EF4444'}">${book.availableCopies > 0 ? `${book.availableCopies} available` : 'Unavailable'}</span>
              <button class="btn btn-xs ${book.availableCopies > 0 ? 'btn-primary' : 'btn-secondary'}" ${book.availableCopies > 0 ? `onclick="reserveBook('${book._id}')"` : 'disabled'}>${book.availableCopies > 0 ? 'Reserve' : 'Unavailable'}</button>
            </div>
          </div>
        </div>
      `).join('') || '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-title">No books found</div></div>');
    }

    window.reserveBook = async function reserveBook(bookId) {
      await window.api.request('/academics/library/issue', {
        method: 'POST',
        body: JSON.stringify({ bookId }),
      });
      window.showToast('Book reserved successfully', 'success');
      initStudentLibraryPage();
    };

    const myIssuedCard = findCard('My Issued Books');
    if (myIssuedCard) {
      const badge = myIssuedCard.querySelector('.badge');
      if (badge) badge.textContent = `${records.length} Items`;
      const body = myIssuedCard.querySelector('.card-body');
      if (body) {
        setHTML(body, records.map((record) => `
          <div style="border:1px solid #E2E8F0;border-radius:10px;padding:12px">
            <div style="font-weight:700;font-size:13px;margin-bottom:2px">${record.bookId?.title || '-'}</div>
            <div style="font-size:11px;color:#64748B;margin-bottom:8px">${record.bookId?.author || '-'}${record.bookId?.isbn ? ` • ${record.bookId.isbn}` : ''}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:11px;font-weight:600;color:${record.status === 'overdue' ? '#EF4444' : '#059669'}"><i class="fas fa-clock"></i> Due: ${formatDate(record.dueDate)}</span>
              <span class="badge ${record.status === 'overdue' ? 'badge-danger' : 'badge-success'}">${record.status}</span>
            </div>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-state-title">No books currently issued</div></div>');
      }
    }

    if (searchInput) searchInput.oninput = renderBooks;
    renderBooks();
    window.__erpLivePageRefresh = initStudentLibraryPage;
  }

  async function initStudentAssignmentsPage() {
    const res = await window.api.request('/academics/assignments', { silent: true });
    const assignments = res.assignments || [];
    const pending = assignments.filter((item) => !item.submission);
    const submitted = assignments.filter((item) => item.submission);
    let activeAssignmentId = null;
    const layout = document.querySelector('.grid[style*="grid-template-columns:2fr 1fr"]');
    if (!layout) return;
    const leftPane = layout.children[0];
    const rightCard = layout.children[1];

    if (leftPane) {
      setHTML(leftPane, `
        ${pending.map((item) => {
          const due = new Date(item.dueDate);
          return `
            <div class="task-card ${due < new Date() ? 'danger' : ''}">
              <div class="task-date-box"><div class="task-date-month">${due.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</div><div class="task-date-day">${due.getDate()}</div></div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <div>
                    <div style="font-size:11px;font-weight:700;color:#0284C7;margin-bottom:2px">${item.subjectId?.code || '-'} • ${item.subjectId?.name || '-'}</div>
                    <div style="font-weight:800;font-size:16px;color:#0F172A;margin-bottom:6px">${item.title}</div>
                  </div>
                  <span class="badge ${due < new Date() ? 'badge-danger' : 'badge-gray'}">Due ${formatDate(item.dueDate)}</span>
                </div>
                <div style="font-size:13px;color:#64748B;line-height:1.5;margin-bottom:12px">${item.description || 'No description'}</div>
                <div style="display:flex;gap:10px">
                  <button class="btn btn-sm btn-primary" onclick="openUpload('${item._id}')"><i class="fas fa-upload"></i> Submit Work</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
        <h3 style="font-size:13px;font-weight:700;color:#94A3B8;text-transform:uppercase;margin:24px 0 12px 0;border-bottom:1px solid #E2E8F0;padding-bottom:8px">Submitted</h3>
        ${submitted.map((item) => `
          <div class="task-card done" style="opacity:0.9">
            <div class="task-date-box"><div class="task-date-month">${new Date(item.submission.submittedAt).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</div><div class="task-date-day">${new Date(item.submission.submittedAt).getDate()}</div></div>
            <div style="flex:1">
              <div style="font-size:11px;font-weight:700;color:#0284C7;margin-bottom:2px">${item.subjectId?.code || '-'} • ${item.subjectId?.name || '-'}</div>
              <div style="font-weight:800;font-size:16px;color:#0F172A;margin-bottom:2px">${item.title}</div>
              <div style="font-size:12px;color:#059669;font-weight:600;margin-top:8px"><i class="fas fa-check-circle"></i> Submitted on ${formatDate(item.submission.submittedAt, true)}</div>
            </div>
          </div>
        `).join('') || '<div class="empty-state"><div class="empty-state-title">No submissions yet</div></div>'}
      `);
    }

    if (rightCard) {
      const stats = rightCard.querySelectorAll('strong');
      if (stats[0]) stats[0].textContent = `${submitted.length}/${assignments.length}`;
      if (stats[1]) stats[1].textContent = String(pending.length);
      if (stats[2]) stats[2].textContent = String(submitted.length);
      if (stats[3]) stats[3].textContent = submitted.length ? `${(submitted.reduce((sum, item) => sum + Number(item.submission?.marksObtained || 0), 0) / submitted.length).toFixed(1)} / 100` : 'N/A';
      const canvas = replaceCanvas('assignmentChart');
      if (canvas && window.Chart) {
        new window.Chart(canvas, {
          type: 'doughnut',
          data: { labels: ['Submitted', 'Pending'], datasets: [{ data: [submitted.length, pending.length], backgroundColor: ['#10B981', '#E2E8F0'], borderWidth: 0 }] },
          options: { cutout: '75%', plugins: { legend: { display: false }, tooltip: { enabled: false } } },
        });
      }
    }

    window.openUpload = function openUpload(id) {
      activeAssignmentId = id;
      const current = assignments.find((item) => String(item._id) === String(id));
      setText('uploadTaskName', current?.title || 'Assignment');
      window.openModal?.('uploadModal');
    };

    window.submitWork = async function submitWork() {
      if (!activeAssignmentId) return;
      const textareas = document.querySelectorAll('#uploadModal textarea');
      const content = textareas[0]?.value || '';
      await window.api.request(`/academics/assignments/${activeAssignmentId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      window.closeModal?.('uploadModal');
      window.showToast('Assignment submitted successfully', 'success');
      initStudentAssignmentsPage();
    };

    window.__erpLivePageRefresh = initStudentAssignmentsPage;
  }

  async function initParentChildProfilePage() {
    const res = await window.api.request('/academics/student-profile', { silent: true });
    const profile = res.profile || {};
    const child = profile.student;
    if (!child) return;

    const formatField = (value, fallback) => value || fallback || 'Not provided';
    const genderLabel = child.gender ? `${String(child.gender).charAt(0).toUpperCase()}${String(child.gender).slice(1)}` : 'Not provided';
    const transportLabel = profile.transportRoute
      ? [profile.transportRoute.routeName, profile.transportRoute.busNumber].filter(Boolean).join(' • ')
      : 'Not assigned';
    const hostelLabel = profile.hostelRoom
      ? [profile.hostelRoom.hostel?.name, profile.hostelRoom.roomNumber ? `Room ${profile.hostelRoom.roomNumber}` : ''].filter(Boolean).join(' • ')
      : 'Not assigned';

    setText(document.querySelector('.sidebar-user-role'), `Ward: ${child.name}`);
    setText('childProfileName', child.name);
    setText('childProfileMeta', `Enrollment No: ${child.enrollmentNo || child.rollNo || '-'} • Roll No: ${child.rollNo || '-'}`);
    setText('childProfileProgram', child.department || 'Department not set');
    setText('childProfileSemester', child.semester ? `Semester ${child.semester}${child.section ? ` (Section ${child.section})` : ''}` : 'Semester not set');
    setText('childProfileStatus', 'Active Enrollment');

    const profileMap = {
      dateOfBirth: child.dateOfBirth ? formatDate(child.dateOfBirth) : 'Not provided',
      gender: genderLabel,
      bloodGroup: formatField(child.bloodGroup, 'Not provided'),
      email: formatField(child.email, '-'),
      phone: formatField(child.phone, 'Not provided'),
      college: formatField(child.collegeId?.name, '-'),
      admissionDate: child.admissionDate ? formatDate(child.admissionDate) : formatDate(child.createdAt),
      transportRoute: transportLabel,
      hostelRoom: hostelLabel,
      mentor: profile.mentor?.name || 'Not assigned',
    };

    document.querySelectorAll('[data-profile]').forEach((cell) => {
      const key = cell.getAttribute('data-profile');
      if (key === 'mentor' && profile.mentor?.name) {
        cell.innerHTML = `<a href="../messages.html" style="color:#4F46E5">${profile.mentor.name}</a>`;
        return;
      }
      cell.textContent = profileMap[key] || '—';
    });

    window.__erpLivePageRefresh = initParentChildProfilePage;
  }

  async function initParentAttendancePage() {
    const me = await fetchMe();
    const child = me.children?.[0];
    if (!child) return;
    const [summaryRes, recordsRes] = await Promise.all([
      window.api.request(`/attendance/summary/${child._id}`, { silent: true }),
      window.api.request(`/attendance?studentId=${child._id}`, { silent: true }),
    ]);
    renderAttendanceCommon({
      summary: summaryRes.summary || [],
      records: recordsRes.attendance || [],
      tableId: 'attBreakdownBody',
      subjectChartId: 'attChart',
      trendChartId: 'attChart',
    });
    const recentTable = document.querySelector('.card tbody');
    if (recentTable) {
      const absences = (recordsRes.attendance || []).filter((item) => item.status !== 'present').slice(0, 5);
      setHTML(recentTable, absences.map((item) => `
        <tr>
          <td>${formatDate(item.date)}</td>
          <td>${item.subjectId?.name || '-'}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${item.remarks || '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="4"><div class="empty-state"><div class="empty-state-title">No absence records found</div></div></td></tr>');
    }
    window.__erpLivePageRefresh = initParentAttendancePage;
  }

  async function initParentResultsPage() {
    const me = await fetchMe();
    const child = me.children?.[0];
    if (!child) return;
    const res = await window.api.request(`/exams/results/${child._id}`, { silent: true });
    const grouped = groupResultsBySemester(res.results || []);
    renderResultsCommon({
      metrics: buildSemesterMetrics(grouped),
      cgpa: res.cgpa,
      resultsBodyId: 'resultsBody',
      sgpaChartId: 'sgpaChart',
      radarChartId: 'sgpaChart',
      semTitleId: 'semTitle',
      semBadgeId: 'semSGPA',
    });
    window.__erpLivePageRefresh = initParentResultsPage;
  }

  async function initParentFeesPage() {
    const res = await window.api.request('/fees', { silent: true });
    const fees = res.fees || [];
    const pending = fees.filter((item) => item.status !== 'paid').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const outstanding = pending.reduce((sum, item) => sum + Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0), 0);
    const alertBox = document.querySelector('.erp-content > div[style*="#FEF2F2"]');
    if (alertBox) {
      setHTML(alertBox, `
        <div style="width:48px;height:48px;background:#FEE2E2;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#EF4444;font-size:20px;flex-shrink:0"><i class="fas fa-exclamation-triangle"></i></div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:18px;color:#991B1B">Outstanding Balance: ${formatMoney(outstanding)}</div>
          <div style="font-size:13px;color:#B91C1C;margin-top:4px">${pending[0] ? `Next due: ${String(pending[0].feeType || '').toUpperCase()} by ${formatDate(pending[0].dueDate)}` : 'No outstanding balance remaining.'}</div>
        </div>
      `);
    }

    const breakdownTable = document.querySelectorAll('.erp-table tbody')[0];
    if (breakdownTable) {
      setHTML(breakdownTable, fees.map((fee) => `
        <tr><td style="font-weight:600">${String(fee.feeType || '').toUpperCase()}${fee.semester ? ` - Sem ${fee.semester}` : ''}</td><td style="text-align:right">${formatMoney(fee.amount)}</td></tr>
      `).join('') + `<tr style="background:#F8FAFC"><td style="font-weight:800">Total Payable</td><td style="text-align:right;font-weight:800;color:#0F172A;font-size:16px">${formatMoney(fees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0))}</td></tr>`);
    }

    const historyBody = document.querySelectorAll('.erp-table tbody')[1];
    if (historyBody) {
      setHTML(historyBody, fees.map((fee) => `
        <tr>
          <td>${formatDate(fee.paidDate || fee.dueDate)}</td>
          <td>${String(fee.feeType || '').toUpperCase()}</td>
          <td>${formatMoney(fee.amount)}</td>
          <td>${statusBadge(fee.status)}</td>
          <td>${fee.receiptNo ? `<button class="btn btn-xs btn-secondary" onclick="showToast('${fee.receiptNo}', 'info')"><i class="fas fa-download"></i></button>` : '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No fee records found</div></div></td></tr>');
    }

    window.simulatePayment = async function simulatePayment() {
      const next = pending[0];
      if (!next) {
        window.showToast('No outstanding fees to pay', 'info');
        return;
      }
      await window.api.request(`/fees/${next._id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount: next.amount - Number(next.paidAmount || 0), paymentMethod: 'online', receiptNo: `PAR-${Date.now()}` }),
      });
      window.closeModal?.('payModal');
      window.showToast('Payment successful', 'success');
      initParentFeesPage();
    };

    window.__erpLivePageRefresh = initParentFeesPage;
  }

  async function initParentDashboardPage() {
    const [profileRes, resultsRes, attendanceRes, feeRes, noticesRes, assignmentRes] = await Promise.all([
      window.api.request('/academics/student-profile', { silent: true }),
      window.api.request('/exams/results', { silent: true }),
      window.api.request('/attendance/summary', { silent: true }),
      window.api.request('/fees', { silent: true }),
      window.api.request('/notices', { silent: true }),
      window.api.request('/academics/assignments', { silent: true }),
    ]);

    const profile = profileRes.profile || {};
    const child = profile.student;
    if (!child) return;

    const results = resultsRes.results || [];
    const attendanceSummary = attendanceRes.summary || [];
    const fees = feeRes.fees || [];
    const notices = noticesRes.notices || [];
    const assignments = assignmentRes.assignments || [];
    const pendingFees = fees.filter((item) => item.status !== 'paid').sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const outstanding = pendingFees.reduce((sum, item) => sum + Math.max(Number(item.amount || 0) - Number(item.paidAmount || 0), 0), 0);
    const totals = attendanceSummary.reduce((acc, item) => {
      acc.total += Number(item.total || 0);
      acc.present += Number(item.present || 0);
      acc.late += Number(item.late || 0);
      return acc;
    }, { total: 0, present: 0, late: 0 });
    const overallAttendance = totals.total ? Math.round(((totals.present + (totals.late * 0.5)) / totals.total) * 100) : 0;
    const metrics = buildSemesterMetrics(groupResultsBySemester(results));
    const assignmentCompletion = assignments.length ? Math.round((assignments.filter((item) => item.submission).length / assignments.length) * 100) : 0;
    const resultAverage = results.length ? Math.round(results.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / results.length) : 0;
    const subjectRows = attendanceSummary.slice().sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0)).slice(0, 5);

    setText('childName', child.name);
    setText('childMeta', `Roll No: ${child.rollNo || '-'} • ${child.department || 'Course pending'} • ${child.semester ? `Semester ${child.semester}` : 'Semester pending'}`);
    setText('collegeNameDisplay', child.collegeId?.name || '-');

    if (profile.currentLiveClass) {
      const dot = byId('parentLiveStatusDot');
      if (dot) dot.style.background = '#10B981';
      setText('parentLiveStatusText', profile.currentLiveClass.title || 'Live class in progress');
      setHTML('parentLiveStatusMeta', `<i class="fas fa-chalkboard-teacher"></i> ${escapeHTML(profile.currentLiveClass.faculty?.name || profile.mentor?.name || 'Faculty')} • ${formatDate(profile.currentLiveClass.startedAt, true)}`);
    } else {
      const dot = byId('parentLiveStatusDot');
      if (dot) dot.style.background = '#94A3B8';
      setText('parentLiveStatusText', 'No active live class');
      setHTML('parentLiveStatusMeta', '<i class="fas fa-clock"></i> Waiting for the next scheduled session');
    }

    const statValues = document.querySelectorAll('.stats-grid .stat-value');
    const statChanges = document.querySelectorAll('.stats-grid .stat-change');
    if (statValues[0]) statValues[0].textContent = resultsRes.cgpa === 'N/A' ? 'N/A' : resultsRes.cgpa;
    if (statValues[1]) statValues[1].textContent = `${overallAttendance}%`;
    if (statValues[2]) statValues[2].textContent = formatMoney(outstanding);
    if (statValues[3]) statValues[3].textContent = `${assignmentCompletion}%`;
    if (statChanges[0]) statChanges[0].innerHTML = `<i class="fas fa-chart-line"></i> ${metrics.length ? `${metrics.length} semesters tracked` : 'Waiting for results'}`;
    if (statChanges[1]) statChanges[1].innerHTML = `<i class="fas fa-check-circle"></i> ${attendanceSummary.length || 0} subjects monitored`;
    if (statChanges[2]) statChanges[2].innerHTML = pendingFees[0] ? `<i class="fas fa-clock"></i> Next due ${formatDate(pendingFees[0].dueDate)}` : '<i class="fas fa-check-circle"></i> No outstanding fees';
    if (statChanges[3]) statChanges[3].innerHTML = `<i class="fas fa-tasks"></i> ${assignments.filter((item) => item.submission).length}/${assignments.length} submitted`;

    if (window.Chart) {
      const canvas = replaceCanvas('perfChart');
      if (canvas) {
        new window.Chart(canvas, {
          type: 'line',
          data: {
            labels: metrics.length ? metrics.map((metric) => `Semester ${metric.semester}`) : ['No data'],
            datasets: [{ label: 'SGPA', data: metrics.length ? metrics.map((metric) => metric.sgpa) : [0], borderColor: '#D97706', backgroundColor: 'rgba(217,119,6,0.1)', fill: true, tension: 0.4, borderWidth: 3 }],
          },
          options: { ...window.getChartDefaults(), scales: { y: { min: 0, max: 10 }, x: { grid: { display: false } } } },
        });
      }
    }

    const notifications = [];
    if (profile.currentLiveClass) notifications.push({ title: 'Live class in progress', message: profile.currentLiveClass.title || 'A faculty session is active' });
    if (pendingFees[0]) notifications.push({ title: 'Fee reminder', message: `${formatMoney(outstanding)} due by ${formatDate(pendingFees[0].dueDate)}` });
    if (notices[0]) notifications.push({ title: notices[0].title, message: notices[0].content });
    const badge = document.querySelector('#notif-btn .topbar-badge');
    if (badge) badge.textContent = String(Math.min(notifications.length, 9));
    setHTML('parentNotifBody', notifications.map((item) => `<div class="notif-item unread"><div class="notif-dot"></div><div><div style="font-size:13px;font-weight:600">${escapeHTML(item.title)}</div><div style="font-size:12px;color:#64748B">${escapeHTML(item.message)}</div></div></div>`).join('') || '<div style="padding:14px 16px;color:#64748B;font-size:13px">No new notifications</div>');

    setHTML('parentLatestNotices', notices.slice(0, 3).map((item) => {
      const color = item.type === 'urgent' ? '#EF4444' : item.type === 'exam' ? '#4F46E5' : '#10B981';
      return `<div style="border-left:3px solid ${color};padding:12px 14px;background:white;border:1px solid #F1F5F9;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.02)"><div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#334155">${escapeHTML(item.title)}</div><div style="font-size:12px;color:#64748B">${escapeHTML(item.content)}</div></div>`;
    }).join('') || '<div class="empty-state"><div class="empty-state-title">No notices published yet</div></div>');

    setHTML('parentSubjectAttendance', subjectRows.map((item) => {
      const percentage = Math.round(Number(item.percentage || 0));
      const color = percentage >= 75 ? '#10B981' : '#EF4444';
      return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:13px;font-weight:600;color:#475569">${escapeHTML(item.subject?.name || item.subjectId?.name || 'Subject')}</span><span style="font-size:12px;font-weight:700;color:${color}">${percentage}%</span></div><div class="progress-bar" style="background:#F1F5F9;height:6px"><div class="progress-fill" style="width:${percentage}%;background:${color};border-radius:6px"></div></div></div>`;
    }).join('') || '<div class="empty-state"><div class="empty-state-title">No attendance records yet</div></div>');

    const insightRows = [
      { label: 'Assessment Score', value: resultAverage, color: '#3B82F6', bg: '#E0F2FE' },
      { label: 'Attendance Consistency', value: overallAttendance, color: '#10B981', bg: '#D1FAE5' },
      { label: 'Submission Rate', value: assignmentCompletion, color: '#F59E0B', bg: '#FEF3C7' },
    ];
    setText('parentInsightBadge', `${results.length} results • ${assignments.length} assignments`);
    setText('parentInsightSummary', `Insights are generated from live results, attendance logs, fee records, and assignment submissions for ${child.name}.`);
    setHTML('parentInsightMetrics', insightRows.map((item) => `<div><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:13px;font-weight:600;color:#334155">${escapeHTML(item.label)}</span><span style="font-size:12px;font-weight:700;color:${item.color}">${item.value}%</span></div><div class="progress-bar" style="background:${item.bg};"><div class="progress-fill" style="width:${item.value}%;background:${item.color}"></div></div></div>`).join(''));

    let suggestion = 'Live academic data will surface stronger recommendations as more assessments and attendance entries are recorded.';
    if (overallAttendance && overallAttendance < 75) {
      suggestion = 'Attendance is below the 75% benchmark. Prioritize regular class participation over the next few weeks.';
    } else if (assignmentCompletion && assignmentCompletion < 70) {
      suggestion = 'Assignment completion is lagging behind. Encourage faster submissions to avoid academic backlog.';
    } else if (outstanding > 0) {
      suggestion = `There is an outstanding balance of ${formatMoney(outstanding)}. Clearing the dues will avoid late penalties.`;
    } else if (resultAverage >= 80) {
      suggestion = 'Assessment performance is strong. Maintain the current study rhythm and continue the same consistency.';
    }
    setText('parentInsightSuggestion', suggestion);

    window.__erpLivePageRefresh = initParentDashboardPage;
  }

  async function routeStudentPages(path) {
    if (path.endsWith('/pages/student/dashboard.html')) return initStudentDashboardPage();
    if (path.endsWith('/pages/student/attendance.html')) return initStudentAttendancePage();
    if (path.endsWith('/pages/student/results.html')) return initStudentResultsPage();
    if (path.endsWith('/pages/student/fees.html')) return initStudentFeesPage();
    if (path.endsWith('/pages/student/courses.html')) return initStudentCoursesPage();
    if (path.endsWith('/pages/student/timetable.html')) return initStudentTimetablePage();
    if (path.endsWith('/pages/student/library.html')) return initStudentLibraryPage();
    if (path.endsWith('/pages/student/assignments.html')) return initStudentAssignmentsPage();
    return null;
  }

  async function routeParentPages(path) {
    if (path.endsWith('/pages/parent/dashboard.html')) return initParentDashboardPage();
    if (path.endsWith('/pages/parent/child-profile.html')) return initParentChildProfilePage();
    if (path.endsWith('/pages/parent/attendance.html')) return initParentAttendancePage();
    if (path.endsWith('/pages/parent/results.html')) return initParentResultsPage();
    if (path.endsWith('/pages/parent/fees.html')) return initParentFeesPage();
    return null;
  }

  async function init() {
    const user = getUser();
    if (!user) return;
    await ensureRealtime();

    const path = window.location.pathname;
    if (path.endsWith('/pages/messages.html')) {
      await initMessagesPage();
      return;
    }

    if (path.includes('/pages/student/')) {
      await routeStudentPages(path);
      return;
    }

    if (path.includes('/pages/parent/')) {
      await routeParentPages(path);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
