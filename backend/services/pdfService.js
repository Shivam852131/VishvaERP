const PDFDocument = require('pdfkit');

function generateFeeReceipt(fee, user, college) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').text(college?.name || 'VishvaERP', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Fee Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(9).text(`Receipt No: ${fee.receiptNo || 'N/A'}`, { align: 'right' });
    doc.text(`Date: ${new Date(fee.paidDate || Date.now()).toLocaleDateString()}`);
    doc.moveDown();

    // Separator
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown();

    // Student Details
    doc.fontSize(12).font('Helvetica-Bold').text('Student Details');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${user?.name || 'N/A'}`);
    doc.text(`Email: ${user?.email || 'N/A'}`);
    if (user?.rollNo) doc.text(`Roll No: ${user.rollNo}`);
    if (user?.department) doc.text(`Department: ${user.department}`);
    if (user?.semester) doc.text(`Semester: ${user.semester}`);
    doc.moveDown();

    // Payment Details
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown();
    doc.fontSize(12).font('Helvetica-Bold').text('Payment Details');
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const columns = [
      { label: 'Description', x: 50 },
      { label: 'Amount', x: 350 },
      { label: 'Status', x: 450 },
    ];

    doc.fontSize(10).font('Helvetica-Bold');
    columns.forEach((col) => doc.text(col.label, col.x, tableTop, { width: 100 }));
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    const rowY = doc.y;
    doc.text(fee.feeType || 'Fee', 50, rowY);
    doc.text(`₹${fee.amount || 0}`, 350, rowY);
    doc.text(fee.status || 'paid', 450, rowY);
    doc.moveDown(0.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown();

    if (fee.paidAmount !== undefined) {
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text(`Total Paid: ₹${fee.paidAmount}`, { align: 'right' });
      doc.fontSize(8).font('Helvetica');
      doc.text(`Payment Method: ${fee.paymentMethod || 'N/A'}`, { align: 'right' });
    }

    if (fee.remarks) {
      doc.moveDown();
      doc.fontSize(9).font('Helvetica').text(`Remarks: ${fee.remarks}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#888888')
      .text('This is a computer-generated receipt.', { align: 'center' });

    doc.end();
  });
}

function generateResultSheet(exam, subject, students, results) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text(exam?.name || 'Exam Results', { align: 'center' });
    doc.fontSize(10).font('Helvetica');
    if (subject) doc.text(`Subject: ${subject.name} (${subject.code})`, { align: 'center' });
    if (exam) doc.text(`Date: ${new Date(exam.date).toLocaleDateString()}`, { align: 'center' });
    doc.moveDown();

    // Results Table
    const tableTop = doc.y;
    const colWidths = [30, 180, 60, 60, 60, 60, 60];
    const colStarts = [50, 80, 260, 320, 380, 440, 500];
    const headers = ['#', 'Name', 'Roll No', 'Marks', 'Total', 'Grade', 'Status'];

    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, colStarts[i], tableTop, { width: colWidths[i] }));
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke('#cccccc');
    doc.moveDown(0.5);

    doc.fontSize(8).font('Helvetica');
    let y = doc.y;
    students.forEach((student, i) => {
      const result = results.find((r) => String(r.studentId) === String(student._id));
      const marks = result?.marksObtained ?? '-';
      const total = result?.totalMarks ?? exam?.totalMarks ?? '-';
      const grade = result?.grade ?? '-';
      const status = result?.status ?? '-';

      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(String(i + 1), colStarts[0], y, { width: colWidths[0] });
      doc.text(student.name, colStarts[1], y, { width: colWidths[1] });
      doc.text(student.rollNo || '-', colStarts[2], y, { width: colWidths[2] });
      doc.text(String(marks), colStarts[3], y, { width: colWidths[3] });
      doc.text(String(total), colStarts[4], y, { width: colWidths[4] });
      doc.text(grade, colStarts[5], y, { width: colWidths[5] });
      doc.text(status, colStarts[6], y, { width: colWidths[6] });
      y += 18;
    });

    doc.end();
  });
}

function generateIdCard(user, college) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [340, 560], margin: 0 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 340;
    const H = 560;
    const centerX = W / 2;
    const TEAL = '#0D7377';
    const DARK_TEAL = '#0A5C5F';
    const LIGHT_BG = '#F5F5F5';
    const TEXT_DARK = '#1A1A1A';
    const TEXT_GRAY = '#6B7280';

    // ── BACKGROUND ──
    doc.rect(0, 0, W, H).fill('#FFFFFF');

    // ── HEADER: Green geometric pattern ──
    doc.save();
    doc.rect(0, 0, W, 160).fill(TEAL);
    doc.polygon([0, 0], [centerX, 0], [0, 160]).fill(DARK_TEAL);
    doc.polygon([W, 0], [centerX, 0], [W, 160]).fill('#0B6366');
    doc.polygon([centerX - 40, 0], [centerX + 40, 0], [centerX, 160]).fill('#0E8287');
    doc.restore();

    // ── COLLEGE LOGO placeholder ──
    const logoX = 16;
    const logoY = 14;
    const logoSize = 46;
    doc.save();
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 6).fill('#FFFFFF');
    doc.roundedRect(logoX + 2, logoY + 2, logoSize - 4, logoSize - 4, 4).fill(TEAL);
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#FFFFFF');
    const initials = (college?.name || 'V').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
    doc.text(initials, logoX, logoY + 14, { width: logoSize, align: 'center' });
    doc.restore();

    // ── COLLEGE NAME ──
    doc.save();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#FFFFFF');
    const collegeName = (college?.name || 'VishvaERP').toUpperCase();
    doc.text(collegeName, logoX + logoSize + 10, logoY + 8, { width: W - logoX * 2 - logoSize - 10, align: 'left' });
    doc.restore();

    // ── CIRCULAR PHOTO PLACEHOLDER ──
    const photoRadius = 44;
    const photoY = 140;
    doc.save();
    doc.circle(centerX, photoY, photoRadius + 4).fill('#FFFFFF');
    doc.circle(centerX, photoY, photoRadius).fill('#CBD5E1');
    doc.circle(centerX, photoY - 12, 14).fill('#94A3B8');
    doc.polygon(
      [centerX - 18, photoY + 24],
      [centerX, photoY + 4],
      [centerX + 18, photoY + 24],
    ).fill('#94A3B8');
    doc.restore();

    // ── STUDENT NAME ──
    let y = photoY + photoRadius + 18;
    doc.save();
    doc.fontSize(16).font('Helvetica-Bold').fillColor(TEAL);
    doc.text((user.name || 'STUDENT NAME').toUpperCase(), 20, y, { width: W - 40, align: 'center' });
    doc.restore();
    y += 22;

    // ── ROLE LABEL ──
    doc.save();
    doc.fontSize(10).font('Helvetica').fillColor(TEXT_GRAY);
    const roleLabel = user.role === 'faculty' ? 'Faculty ID' : user.role === 'parent' ? 'Parent ID' : 'Student ID';
    doc.text(roleLabel, 20, y, { width: W - 40, align: 'center' });
    doc.restore();
    y += 16;

    // ── ENROLLMENT / ID NUMBER ──
    const idNumber = user.enrollmentNo || user.rollNo || String(user._id).slice(-7);
    doc.save();
    doc.fontSize(14).font('Helvetica-Bold').fillColor(TEAL);
    doc.text(idNumber, 20, y, { width: W - 40, align: 'center' });
    doc.restore();
    y += 26;

    // ── DETAILS CARD ──
    const cardX = 22;
    const cardW = W - 44;
    const cardPadX = 16;
    const labelX = cardX + cardPadX;
    const valueX = cardX + 100;
    const valueW = cardW - 100 - cardPadX;

    const fields = [];
    if (user.department) fields.push(['Branch :', user.department.toUpperCase()]);
    if (user.semester) fields.push(['Semester :', `SEM ${user.semester}`]);
    const session = college?.settings?.academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    fields.push(['Session :', session]);
    if (user.rollNo) fields.push(['Roll No. :', user.rollNo]);
    if (user.phone) fields.push(['Phone :', user.phone]);

    const fieldHeight = 22;
    const cardH = fields.length * fieldHeight + 24;
    doc.save();
    doc.roundedRect(cardX, y, cardW, cardH, 8).fill(LIGHT_BG);
    doc.restore();

    let fieldY = y + 12;
    fields.forEach(([label, value]) => {
      doc.save();
      doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_DARK);
      doc.text(label, labelX, fieldY, { width: 80 });
      doc.fontSize(9).font('Helvetica').fillColor(TEXT_DARK);
      doc.text(value, valueX, fieldY, { width: valueW });
      doc.restore();
      fieldY += fieldHeight;
    });

    y += cardH + 16;

    // ── BARCODE ──
    const barcodeW = 180;
    const barcodeH = 44;
    const barcodeX = (W - barcodeW) / 2;
    const barcodeData = idNumber.replace(/\D/g, '').slice(0, 12).padEnd(12, '0');

    doc.save();
    doc.roundedRect(barcodeX - 8, y - 4, barcodeW + 16, barcodeH + 18, 4).fill('#FFFFFF');
    doc.roundedRect(barcodeX - 8, y - 4, barcodeW + 16, barcodeH + 18, 4).stroke('#E5E7EB');

    let barX = barcodeX;
    const barPatterns = {
      '0': [2,1,1,2,3], '1': [1,2,3,1,2], '2': [1,1,3,2,2], '3': [3,1,1,1,2],
      '4': [1,2,2,3,1], '5': [2,3,1,1,1], '6': [1,3,2,1,1], '7': [1,1,1,3,2],
      '8': [2,1,3,1,1], '9': [3,2,1,1,1],
    };
    const unitsPerDigit = barcodeW / (barcodeData.length * 5);
    const barWidth = Math.max(0.5, Math.floor(unitsPerDigit * 10) / 10);

    for (const digit of barcodeData) {
      const pattern = barPatterns[digit] || barPatterns['0'];
      pattern.forEach((count, i) => {
        const w = count * barWidth;
        if (i % 2 === 0) {
          doc.rect(barX, y, w, barcodeH).fill('#000000');
        }
        barX += w;
      });
    }
    doc.restore();

    y += barcodeH + 6;
    doc.save();
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_DARK);
    doc.text(idNumber, 20, y, { width: W - 40, align: 'center' });
    doc.restore();

    // ── FOOTER ──
    doc.save();
    doc.fontSize(6).font('Helvetica').fillColor(TEXT_GRAY);
    doc.text('Generated by VishvaERP', 20, H - 16, { width: W - 40, align: 'center' });
    doc.restore();

    doc.end();
  });
}

function generateQuestionPaper(paper, college) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // College Header
    doc.fontSize(18).font('Helvetica-Bold').text(college?.name || 'VishvaERP', { align: 'center' });
    doc.moveDown(0.3);

    doc.fontSize(14).font('Helvetica-Bold').text('Question Paper', { align: 'center' });
    doc.moveDown(0.5);

    // Separator
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(0.5);

    // Subject and Meta
    doc.fontSize(11).font('Helvetica-Bold').text(`Subject: ${paper.subject || 'N/A'}`, { align: 'left' });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Date: ${new Date().toLocaleDateString()}    Duration: ${paper.duration || 120} minutes    Total Marks: ${paper.totalMarks || 0}`, { align: 'left' });
    doc.moveDown(0.5);

    // Instructions
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica-Bold').text('Instructions:');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    const instructions = paper.instructions || 'Answer all questions. Write clearly and legibly.';
    doc.text(instructions, { width: 495 });
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown(0.8);

    // Group questions by type
    const typeOrder = ['mcq', 'true_false', 'fill_blank', 'short_answer', 'numerical', 'long_answer'];
    const typeLabels = {
      mcq: 'Multiple Choice Questions',
      true_false: 'True / False',
      fill_blank: 'Fill in the Blanks',
      short_answer: 'Short Answer Questions',
      numerical: 'Numerical Problems',
      long_answer: 'Long Answer Questions',
    };

    const grouped = {};
    (paper.questions || []).forEach((q) => {
      if (!grouped[q.questionType]) grouped[q.questionType] = [];
      grouped[q.questionType].push(q);
    });

    let questionNumber = 1;

    for (const type of typeOrder) {
      const questions = grouped[type];
      if (!questions || !questions.length) continue;

      // Check if we need a new page
      if (doc.y > 680) {
        doc.addPage();
      }

      // Section header
      doc.fontSize(12).font('Helvetica-Bold').text(typeLabels[type] || type.toUpperCase());
      doc.moveDown(0.3);

      questions.forEach((q) => {
        if (doc.y > 720) {
          doc.addPage();
        }

        const marksLabel = `[${q.marks} mark${q.marks !== 1 ? 's' : ''}]`;
        doc.fontSize(10).font('Helvetica-Bold').text(`${questionNumber}. ${q.questionText}  (${marksLabel})`, { width: 495 });
        questionNumber += 1;

        // Options for MCQ
        if (type === 'mcq' && q.options && q.options.length) {
          doc.moveDown(0.2);
          doc.fontSize(9).font('Helvetica');
          const optionLabels = ['a', 'b', 'c', 'd', 'e', 'f'];
          q.options.forEach((opt, i) => {
            if (optionLabels[i]) {
              doc.text(`    ${optionLabels[i]}. ${opt.text}`, { width: 480 });
            }
          });
        }

        // True/False hint
        if (type === 'true_false') {
          doc.moveDown(0.2);
          doc.fontSize(9).font('Helvetica').text('    (a) True          (b) False', { width: 480 });
        }

        doc.moveDown(0.5);
      });

      doc.moveDown(0.5);
    }

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('#888888')
      .text('Generated by VishvaERP', 50, doc.page.height - 40, { align: 'center' });

    doc.end();
  });
}

function generateSubscriptionReceipt(payment, user, college, subscription) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).font('Helvetica-Bold').text(college?.name || 'VishvaERP', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Subscription Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(9).text(`Receipt No: ${payment.receiptNo || payment._id}`, { align: 'right' });
    doc.text(`Date: ${new Date(payment.createdAt || Date.now()).toLocaleDateString()}`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown();

    doc.fontSize(12).font('Helvetica-Bold').text('Billing Details');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Admin: ${user?.name || 'N/A'}`);
    doc.text(`Email: ${user?.email || 'N/A'}`);
    doc.text(`College: ${college?.name || 'N/A'}`);
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
    doc.moveDown();

    const plan = payment.metadata?.plan || subscription?.plan || 'Subscription';
    const billingCycle = payment.metadata?.billingCycle || subscription?.billingCycle || 'N/A';
    doc.fontSize(12).font('Helvetica-Bold').text('Payment Details');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Plan: ${String(plan).toUpperCase()}`);
    doc.text(`Billing Cycle: ${billingCycle}`);
    doc.text(`Amount: ${payment.currency || 'INR'} ${payment.amount || 0}`);
    doc.text(`Payment ID: ${payment.razorpayPaymentId || 'N/A'}`);
    doc.text(`Status: ${payment.status || 'captured'}`);
    if (subscription?.startDate) doc.text(`Start Date: ${new Date(subscription.startDate).toLocaleDateString()}`);
    if (subscription?.endDate) doc.text(`End Date: ${new Date(subscription.endDate).toLocaleDateString()}`);

    doc.moveDown(2);
    doc.fontSize(8).font('Helvetica').fillColor('#888888')
      .text('This is a computer-generated receipt.', { align: 'center' });

    doc.end();
  });
}

module.exports = { generateFeeReceipt, generateResultSheet, generateIdCard, generateQuestionPaper, generateSubscriptionReceipt };
