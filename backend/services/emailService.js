const nodemailer = require('nodemailer');

let transporter = null;

function initTransporter() {
  if (transporter) return transporter;

  const host = process.env.EMAIL_HOST;
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

function isEmailConfigured() {
  return Boolean(initTransporter());
}

async function sendMail({ to, subject, html, text }) {
  const transport = initTransporter();
  if (!transport) {
    return { success: false, skipped: true, message: 'Email is not configured. Set EMAIL_HOST, EMAIL_USER, and EMAIL_PASS.' };
  }

  const from = process.env.EMAIL_FROM || `"VishvaERP" <${process.env.EMAIL_USER}>`;

  try {
    await transport.sendMail({ from, to, subject, html, text });
    return { success: true, messageId: null };
  } catch (error) {
    return {
      success: false,
      skipped: true,
      message: 'Email delivery is unavailable. Check SMTP configuration.',
      error: error.message,
    };
  }
}

async function sendPasswordResetEmail(email, resetUrl, name) {
  return sendMail({
    to: email,
    subject: 'Password Reset - VishvaERP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e293b;">Password Reset</h2>
        <p>Hi ${name || 'User'},</p>
        <p>You requested a password reset for your VishvaERP account.</p>
        <p>
          <a href="${resetUrl}"
             style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p>Or copy this link into your browser:</p>
        <p style="word-break: break-all; color: #2563eb;">${resetUrl}</p>
        <p>This link expires in 1 hour.</p>
        <p>If you did not request this, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0;" />
        <p style="color: #64748b; font-size: 12px;">VishvaERP - Multi-College ERP Platform</p>
      </div>
    `,
    text: `Password Reset\n\nHi ${name || 'User'},\n\nYou requested a password reset.\n\nVisit: ${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

async function sendWelcomeEmail(email, name, password, role) {
  return sendMail({
    to: email,
    subject: `Welcome to VishvaERP - Your ${role} account has been created`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e293b;">Welcome to VishvaERP</h2>
        <p>Hi ${name},</p>
        <p>Your account has been created as <strong>${role}</strong>.</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p>Please log in and change your password.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0;" />
        <p style="color: #64748b; font-size: 12px;">VishvaERP - Multi-College ERP Platform</p>
      </div>
    `,
    text: `Welcome to VishvaERP\n\nHi ${name},\n\nYour account has been created.\nEmail: ${email}\nPassword: ${password}\n\nPlease log in and change your password.`,
  });
}

async function sendFeeReceiptEmail(email, name, feeDetails, pdfBuffer) {
  const transport = initTransporter();
  if (!transport) {
    return { success: false, skipped: true, message: 'Email is not configured.' };
  }

  const from = process.env.EMAIL_FROM || `"VishvaERP" <${process.env.EMAIL_USER}>`;

  try {
    await transport.sendMail({
      from,
      to: email,
      subject: `Fee Receipt - ${feeDetails.receiptNo || 'Payment'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1e293b;">Payment Receipt</h2>
          <p>Hi ${name},</p>
          <p>Your payment of <strong>₹${feeDetails.amount}</strong> has been received.</p>
          <p><strong>Receipt No:</strong> ${feeDetails.receiptNo || 'N/A'}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          <p>Please find the receipt attached.</p>
        </div>
      `,
      text: `Payment Receipt\n\nHi ${name},\n\nYour payment of ₹${feeDetails.amount} has been received.\nReceipt: ${feeDetails.receiptNo || 'N/A'}`,
      attachments: pdfBuffer
        ? [{ filename: `receipt-${feeDetails.receiptNo || 'payment'}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
        : [],
    });

    return { success: true, messageId: null };
  } catch (error) {
    return {
      success: false,
      skipped: true,
      message: 'Email delivery is unavailable. Check SMTP configuration.',
      error: error.message,
    };
  }
}

async function sendOTP(email, otpCode) {
  return sendMail({
    to: email,
    subject: 'Your Login OTP - VishvaERP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e293b;">Login Verification</h2>
        <p>Use the following OTP to log in to your VishvaERP account:</p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: 900; color: #4F46E5; letter-spacing: 8px;">${otpCode}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This OTP expires in 10 minutes. Do not share this code with anyone.</p>
        <p style="color: #64748b; font-size: 13px;">If you did not request this OTP, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0;" />
        <p style="color: #64748b; font-size: 12px;">VishvaERP - Multi-College ERP Platform</p>
      </div>
    `,
    text: `Your OTP: ${otpCode}\n\nThis OTP expires in 10 minutes.`,
  });
}

async function sendVerificationOTP(email, otpCode, name) {
  return sendMail({
    to: email,
    subject: 'Verify Your Email - VishvaERP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1e293b;">Email Verification</h2>
        <p>Hi ${name || 'User'},</p>
        <p>Thank you for registering with VishvaERP. Please verify your email address with the code below:</p>
        <div style="background: #f1f5f9; border-radius: 12px; padding: 24px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: 900; color: #10B981; letter-spacing: 8px;">${otpCode}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This code expires in 10 minutes.</p>
        <p style="color: #64748b; font-size: 13px;">If you did not register for an account, please ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0;" />
        <p style="color: #64748b; font-size: 12px;">VishvaERP - Multi-College ERP Platform</p>
      </div>
    `,
    text: `Hi ${name || 'User'},\n\nYour verification code: ${otpCode}\n\nThis code expires in 10 minutes.`,
  });
}

module.exports = {
  isEmailConfigured,
  sendMail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendFeeReceiptEmail,
  sendOTP,
  sendVerificationOTP,
};
