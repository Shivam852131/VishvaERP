(function () {
  'use strict';

  const COLORS = {
    processing: { bg: '#EFF6FF', border: '#BFDBFE', color: '#1E40AF', icon: 'fa-spinner fa-spin' },
    success: { bg: '#F0FDF4', border: '#BBF7D0', color: '#065F46', icon: 'fa-circle-check' },
    error: { bg: '#FEF2F2', border: '#FECACA', color: '#991B1B', icon: 'fa-circle-xmark' },
    warning: { bg: '#FFFBEB', border: '#FDE68A', color: '#92400E', icon: 'fa-triangle-exclamation' },
  };

  function byId(id) { return document.getElementById(id); }

  function escapeHTML(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatDate(value, withTime) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return withTime ? d.toLocaleString() : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') { resolve(); return; }
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
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

  function showStatus(containerId, message, type) {
    const el = byId(containerId);
    if (!el) return;
    el.style.display = 'block';
    const c = COLORS[type] || COLORS.processing;
    el.innerHTML = `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:10px"><i class="fas ${c.icon}" style="color:${c.color};font-size:18px;flex-shrink:0"></i><div style="flex:1;font-size:13px;font-weight:600;color:${c.color}">${escapeHTML(message)}</div></div>`;
  }

  function hideStatus(containerId) {
    const el = byId(containerId);
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }

  function showToast(message, type) {
    if (window.showToast) return window.showToast(message, type);
    console.log(`[PaymentGateway] ${type}: ${message}`);
  }

  function showStepIndicator(containerId, steps, currentStep) {
    const el = byId(containerId);
    if (!el) return;
    const html = steps.map((step, i) => {
      const isActive = i === currentStep;
      const isDone = i < currentStep;
      const color = isDone ? '#059669' : isActive ? '#4F46E5' : '#CBD5E1';
      const icon = isDone ? 'fa-check-circle' : isActive ? step.icon : 'fa-circle';
      return `<div style="display:flex;align-items:center;gap:8px"><div style="width:28px;height:28px;border-radius:50%;background:${isDone ? '#ECFDF5' : isActive ? '#EEF2FF' : '#F8FAFC'};border:2px solid ${color};display:flex;align-items:center;justify-content:center"><i class="fas ${icon}" style="font-size:11px;color:${color}"></i></div><span style="font-size:12px;font-weight:${isActive ? '700' : '500'};color:${isActive ? '#1E293B' : '#94A3B8'}">${step.label}</span></div>`;
    }).join('<div style="width:32px;height:2px;background:#E2E8F0;border-radius:1px;flex-shrink:0"></div>');
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:4px;padding:12px 0">${html}</div>`;
  }

  function renderReceiptModal(feeId, fee, paymentInfo) {
    const modal = byId('receiptModal');
    if (!modal) return;
    const receiptHtml = `
      <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:32px;max-width:400px;margin:0 auto">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:56px;height:56px;background:#ECFDF5;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px"><i class="fas fa-circle-check" style="font-size:28px;color:#059669"></i></div>
          <h3 style="font-size:18px;font-weight:800;color:#0F172A;margin:0">Payment Successful</h3>
          <p style="font-size:13px;color:#64748B;margin:4px 0 0">Transaction completed via Razorpay</p>
        </div>
        <div style="background:#F8FAFC;border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;color:#64748B">Amount Paid</span><span style="font-size:14px;font-weight:700;color:#0F172A">${formatMoney(fee.paidAmount || fee.amount)}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;color:#64748B">Fee Type</span><span style="font-size:13px;font-weight:600;color:#334155">${escapeHTML(fee.feeType || 'College Fee')}</span></div>
          ${fee.semester ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;color:#64748B">Semester</span><span style="font-size:13px;font-weight:600;color:#334155">${fee.semester}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;color:#64748B">Payment ID</span><span style="font-size:12px;font-weight:600;color:#334155;font-family:monospace">${escapeHTML(paymentInfo?.razorpayPaymentId || '-')}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;color:#64748B">Order ID</span><span style="font-size:12px;font-weight:600;color:#334155;font-family:monospace">${escapeHTML(paymentInfo?.razorpayOrderId || '-')}</span></div>
          ${fee.receiptNo ? `<div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:#64748B">Receipt No</span><span style="font-size:13px;font-weight:700;color:#059669">${escapeHTML(fee.receiptNo)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid #E2E8F0"><span style="font-size:12px;color:#64748B">Date</span><span style="font-size:13px;font-weight:600;color:#334155">${formatDate(new Date(), true)}</span></div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" style="flex:1" onclick="closeModal('receiptModal')">Close</button>
          <button class="btn btn-primary" style="flex:1" onclick="window.PaymentGateway.downloadReceipt('${feeId}')"><i class="fas fa-download"></i> Download Receipt</button>
        </div>
      </div>`;
    modal.querySelector('.modal-body').innerHTML = receiptHtml;
    window.openModal?.('receiptModal');
  }

  async function pollPaymentStatus(feeId, orderId, paymentId, attempts) {
    let remaining = Number(attempts || 6);
    while (remaining > 0) {
      await new Promise((r) => setTimeout(r, 2000));
      const query = new URLSearchParams();
      if (orderId) query.set('orderId', orderId);
      if (paymentId) query.set('razorpayPaymentId', paymentId);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      try {
        const res = await window.api.request(`/fees/${feeId}/payment-status${suffix}`, { silent: true });
        if (res?.payment?.status === 'captured' || res?.fee?.status === 'paid' || res?.fee?.status === 'partial') return res;
        if (res?.payment?.status === 'failed' || res?.razorpay?.paymentStatus === 'failed') throw new Error('Payment failed at gateway');
      } catch (e) {
        if (e.message === 'Payment failed at gateway') throw e;
      }
      remaining -= 1;
    }
    throw new Error('Payment verification is still pending');
  }

  async function startCheckout(options) {
    const { fee, amount, onSuccess, onPending, onFailure, onFinally, notes, modalId, accentColor, title } = options || {};

    if (!fee?._id) throw new Error('Fee record is missing');
    const pendingAmount = getFeePendingAmount(fee);
    if (pendingAmount <= 0) throw new Error('Fee already fully paid');

    const payAmount = Number(amount || pendingAmount);
    if (payAmount <= 0 || payAmount > pendingAmount) throw new Error(`Enter amount between ₹1 and ${formatMoney(pendingAmount)}`);

    await ensureRazorpayCheckout();
    if (!window.Razorpay) throw new Error('Payment gateway failed to load');

    const statusContainerId = options?.statusContainerId || 'paymentStatus';
    showStatus(statusContainerId, 'Creating secure payment order...', 'processing');

    const orderRes = await window.api.request(`/fees/${fee._id}/create-order`, { method: 'POST' });
    if (!orderRes?.order || !orderRes?.key) throw new Error('Failed to create payment order');

    showStatus(statusContainerId, 'Opening Razorpay checkout...', 'processing');

    const user = window.api?.getUser?.() || JSON.parse(localStorage.getItem('erp_user') || '{}');

    return new Promise((resolve, reject) => {
      let settled = false;
      const finalize = () => { if (typeof onFinally === 'function') onFinally(); };

      const finishResolve = async (payload) => {
        if (settled) return;
        settled = true;
        try { if (typeof onSuccess === 'function') await onSuccess(payload); } finally { finalize(); }
        resolve(payload);
      };

      const finishReject = async (error) => {
        if (settled) return;
        settled = true;
        try { if (typeof onFailure === 'function') await onFailure(error); } finally { finalize(); }
        reject(error);
      };

      const rzp = new window.Razorpay({
        key: orderRes.key,
        amount: orderRes.order.amount,
        currency: orderRes.order.currency || 'INR',
        name: 'Vishva ERP',
        description: `${title || 'Fee Payment'} - ${fee.feeType || 'College Fee'}`,
        order_id: orderRes.order.id,
        image: '/icons/icon.svg',
        notes: { feeId: String(fee._id), rollNo: fee.studentId?.rollNo || '', ...(notes || {}) },
        prefill: {
          name: fee.studentId?.name || user.name || '',
          email: user.email || '',
          contact: user.phone || '',
        },
        theme: { color: accentColor || '#4F46E5' },
        modal: {
          confirm_close: true,
          ondismiss: function () {
            if (!settled) finishReject(new Error('Payment window closed by user'));
          },
        },
        handler: async function (response) {
          showStatus(statusContainerId, 'Verifying payment with server...', 'processing');
          try {
            const verifyRes = await window.api.request('/fees/verify-payment', {
              method: 'POST',
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                feeId: orderRes.feeId,
              }),
            }).catch(async () => {
              if (typeof onPending === 'function') await onPending(response);
              return pollPaymentStatus(orderRes.feeId, response.razorpay_order_id, response.razorpay_payment_id, 7);
            });
            await finishResolve({ order: orderRes.order, gateway: response, verify: verifyRes, feeId: orderRes.feeId });
          } catch (error) {
            await finishReject(error);
          }
        },
      });

      rzp.on('payment.failed', function (response) {
        finishReject(new Error(response?.error?.description || 'Payment failed'));
      });

      rzp.open();
    });
  }

  async function downloadReceipt(feeId) {
    showToast('Generating receipt...', 'info');
    window.open(`/api/reports/fee-receipt/${feeId}`, '_blank');
  }

  async function initiatePaymentFlow(options) {
    const {
      fee,
      statusContainerId,
      stepsContainerId,
      successContainerId,
      modalId,
      accentColor,
      title,
      onSuccess,
      onFailure,
    } = options;

    const pending = getFeePendingAmount(fee);
    if (pending <= 0) {
      showToast('Fee already fully paid', 'success');
      return;
    }

    const statusId = statusContainerId || 'paymentStatus';
    const stepsId = stepsContainerId || 'paymentSteps';

    showStepIndicator(stepsId, [
      { label: 'Verify', icon: 'fa-shield-halved' },
      { label: 'Checkout', icon: 'fa-credit-card' },
      { label: 'Confirm', icon: 'fa-lock' },
      { label: 'Done', icon: 'fa-circle-check' },
    ], 0);

    try {
      showStatus(statusId, 'Initializing secure payment...', 'processing');

      showStepIndicator(stepsId, [
        { label: 'Verify', icon: 'fa-shield-halved' },
        { label: 'Checkout', icon: 'fa-credit-card' },
        { label: 'Confirm', icon: 'fa-lock' },
        { label: 'Done', icon: 'fa-circle-check' },
      ], 1);

      const result = await startCheckout({
        fee,
        statusContainerId: statusId,
        accentColor: accentColor || '#4F46E5',
        title: title || 'Fee Payment',
        onPending: async () => {
          showStatus(statusId, 'Payment received. Confirming with server...', 'processing');
        },
        onSuccess: async (payload) => {
          showStepIndicator(stepsId, [
            { label: 'Verify', icon: 'fa-shield-halved' },
            { label: 'Checkout', icon: 'fa-credit-card' },
            { label: 'Confirm', icon: 'fa-lock' },
            { label: 'Done', icon: 'fa-circle-check' },
          ], 3);

          showStatus(statusId, 'Payment successful! Refreshing...', 'success');
          showToast('Payment successful!', 'success');

          setTimeout(async () => {
            if (modalId) window.closeModal?.(modalId);
            if (typeof onSuccess === 'function') await onSuccess(payload);
          }, 1500);
        },
        onFailure: async (error) => {
          showStatus(statusId, error.message || 'Payment failed. Please retry.', 'error');
          showStepIndicator(stepsId, [
            { label: 'Verify', icon: 'fa-shield-halved' },
            { label: 'Checkout', icon: 'fa-credit-card' },
            { label: 'Confirm', icon: 'fa-lock' },
            { label: 'Done', icon: 'fa-circle-check' },
          ], 2);
          if (typeof onFailure === 'function') await onFailure(error);
        },
      });
    } catch (error) {
      showStatus(statusId, error.message || 'Could not initiate payment. Please retry.', 'error');
      if (typeof onFailure === 'function') await onFailure(error);
    }
  }

  function renderPayButton(fee, options) {
    const pending = getFeePendingAmount(fee);
    const isPartial = fee.status === 'partial';
    if (pending <= 0) return '';

    const btnClass = options?.btnClass || 'btn btn-xs btn-danger';
    const label = isPartial ? 'Pay Balance' : 'Pay Now';
    return `<button class="${btnClass}" onclick="PaymentGateway.openCheckout('${fee._id}')" title="${label}"><i class="fas fa-credit-card"></i> ${label}</button>`;
  }

  window.PaymentGateway = {
    ensureRazorpayCheckout,
    getFeePendingAmount,
    showStatus,
    hideStatus,
    showStepIndicator,
    startCheckout,
    downloadReceipt,
    initiatePaymentFlow,
    renderPayButton,
    renderReceiptModal,
    formatMoney,
    formatDate,
    escapeHTML,
    pollPaymentStatus,
  };
})();
