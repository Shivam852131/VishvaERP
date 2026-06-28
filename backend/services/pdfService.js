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
    const doc = new PDFDocument({ size: [340, 550], margin: 20 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const centerX = 170;

    // Border
    doc.rect(10, 10, 320, 530).stroke('#2563eb');
    doc.rect(13, 13, 314, 524).stroke('#93c5fd');

    // College Name
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1e3a5f')
      .text(college?.name || 'VishvaERP', centerX, 40, { align: 'center' });
    doc.moveDown(0.5);

    // Separator
    doc.moveTo(40, doc.y).lineTo(300, doc.y).stroke('#2563eb');
    doc.moveDown();

    // Photo Placeholder
    doc.roundedRect(125, doc.y, 90, 100, 8).stroke('#2563eb');
    doc.fontSize(10).fillColor('#64748b').text('PHOTO', centerX, doc.y + 40, { align: 'center' });

    doc.moveDown(6);

    // User Details
    const fields = [
      ['Name', user.name],
      ['Role', user.role],
      ['Email', user.email],
    ];
    if (user.rollNo) fields.push(['Roll No', user.rollNo]);
    if (user.department) fields.push(['Department', user.department]);
    if (user.semester) fields.push(['Semester', String(user.semester)]);
    if (user.phone) fields.push(['Phone', user.phone]);

    fields.forEach(([label, value]) => {
      if (!value) return;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748b').text(`${label}: `, 40, doc.y + 4);
      doc.fontSize(9).font('Helvetica').fillColor('#1e293b').text(String(value), 120, doc.y - 11);
    });

    doc.moveDown(2);
    doc.moveTo(40, doc.y).lineTo(300, doc.y).stroke('#93c5fd');
    doc.moveDown(0.5);

    doc.fontSize(7).fillColor('#94a3b8').text('Valid for academic year', centerX, doc.y, { align: 'center' });

    doc.end();
  });
}

module.exports = { generateFeeReceipt, generateResultSheet, generateIdCard };
