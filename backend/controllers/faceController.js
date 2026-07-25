const asyncHandler = require('express-async-handler');
const FaceData = require('../models/FaceData');
const Attendance = require('../models/Attendance');

const euclideanDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
};

const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
};

const VERIFY_THRESHOLD = 0.55;
const SPOOF_THRESHOLD = 3;
const MAX_DESCRIPTORS = 5;

const registerFace = asyncHandler(async (req, res) => {
  const { descriptors, livenessScore, livenessChallenges } = req.body;
  const userId = req.user._id;
  const collegeId = req.user.collegeId;

  if (!descriptors || !Array.isArray(descriptors) || descriptors.length === 0) {
    return res.status(400).json({ success: false, message: 'Face descriptors are required' });
  }

  if (descriptors.length > MAX_DESCRIPTORS) {
    return res.status(400).json({ success: false, message: `Maximum ${MAX_DESCRIPTORS} face samples allowed` });
  }

  for (const desc of descriptors) {
    if (!Array.isArray(desc) || desc.length !== 128) {
      return res.status(400).json({ success: false, message: 'Invalid face descriptor format' });
    }
  }

  if (livenessScore !== undefined && livenessScore < 60) {
    return res.status(400).json({ success: false, message: 'Liveness score too low. Please try again.' });
  }

  let faceData = await FaceData.findOne({ collegeId, userId });

  if (faceData) {
    const combined = [...faceData.descriptors, ...descriptors].slice(-MAX_DESCRIPTORS);
    faceData.descriptors = combined;
    faceData.avgLivenessScore = livenessScore || faceData.avgLivenessScore;
    await faceData.save();
  } else {
    faceData = await FaceData.create({
      collegeId,
      userId,
      descriptors: descriptors.slice(-MAX_DESCRIPTORS),
      avgLivenessScore: livenessScore || 0,
    });
  }

  res.json({
    success: true,
    message: 'Face registered successfully',
    data: {
      registered: true,
      descriptorCount: faceData.descriptors.length,
      livenessScore: faceData.avgLivenessScore,
    },
  });
});

const verifyFace = asyncHandler(async (req, res) => {
  const { descriptor, livenessScore, livenessChallenges, antiSpoofData } = req.body;
  const userId = req.user._id;
  const collegeId = req.user.collegeId;

  if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
    return res.status(400).json({ success: false, message: 'Invalid face descriptor' });
  }

  const faceData = await FaceData.findOne({ collegeId, userId, isActive: true });
  if (!faceData) {
    return res.status(404).json({ success: false, message: 'No face data registered. Please register first.' });
  }

  if (antiSpoofData) {
    if (antiSpoofData.screenReflection > 0.3) {
      faceData.spoofAttempts += 1;
      await faceData.save();
      return res.status(403).json({ success: false, message: 'Screen detected. Use your real face.' });
    }
    if (antiSpoofData.flatnessScore > 0.7) {
      faceData.spoofAttempts += 1;
      await faceData.save();
      return res.status(403).json({ success: false, message: 'Photo/print detected. Use your real face.' });
    }
    if (antiSpoofData.motionConsistency < 0.2) {
      faceData.spoofAttempts += 1;
      await faceData.save();
      return res.status(403).json({ success: false, message: 'Insufficient natural movement. Please move slightly.' });
    }
  }

  if (faceData.spoofAttempts >= SPOOF_THRESHOLD) {
    return res.status(403).json({
      success: false,
      message: 'Too many spoof attempts. Account locked for verification. Contact admin.',
    });
  }

  if (livenessScore !== undefined && livenessScore < 60) {
    return res.status(400).json({ success: false, message: 'Liveness check failed. Please try again.' });
  }

  let bestDistance = Infinity;
  let bestSimilarity = 0;
  for (const stored of faceData.descriptors) {
    const dist = euclideanDistance(descriptor, stored);
    const sim = cosineSimilarity(descriptor, stored);
    if (dist < bestDistance) bestDistance = dist;
    if (sim > bestSimilarity) bestSimilarity = sim;
  }

  const isMatch = bestDistance < VERIFY_THRESHOLD || bestSimilarity > 0.7;

  if (!isMatch) {
    faceData.spoofAttempts += 1;
    await faceData.save();
    return res.status(401).json({
      success: false,
      message: 'Face not recognized. Please try again.',
      data: { confidence: Math.max(0, (1 - bestDistance) * 100).toFixed(1) },
    });
  }

  faceData.lastVerifiedAt = new Date();
  faceData.verificationCount += 1;
  faceData.spoofAttempts = 0;
  await faceData.save();

  res.json({
    success: true,
    message: 'Face verified successfully',
    data: {
      verified: true,
      confidence: Math.max(0, (1 - bestDistance) * 100).toFixed(1),
      similarity: (bestSimilarity * 100).toFixed(1),
      verificationCount: faceData.verificationCount,
    },
  });
});

const checkFaceRegistered = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const collegeId = req.user.collegeId;

  const faceData = await FaceData.findOne({ collegeId, userId, isActive: true })
    .select('descriptors registeredAt lastVerifiedAt verificationCount avgLivenessScore');

  res.json({
    success: true,
    data: {
      registered: !!faceData,
      descriptorCount: faceData ? faceData.descriptors.length : 0,
      registeredAt: faceData?.registeredAt,
      lastVerifiedAt: faceData?.lastVerifiedAt,
      verificationCount: faceData?.verificationCount || 0,
      livenessScore: faceData?.avgLivenessScore || 0,
    },
  });
});

const deleteFaceData = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const collegeId = req.user.collegeId;

  const faceData = await FaceData.findOneAndDelete({ collegeId, userId });
  if (!faceData) {
    return res.status(404).json({ success: false, message: 'No face data found' });
  }

  res.json({ success: true, message: 'Face data deleted successfully' });
});

const faceCheckIn = asyncHandler(async (req, res) => {
  const { descriptor, livenessScore, antiSpoofData, subjectId, timetableId } = req.body;
  const userId = req.user._id;
  const collegeId = req.user.collegeId;

  const faceData = await FaceData.findOne({ collegeId, userId, isActive: true });
  if (!faceData) {
    return res.status(404).json({ success: false, message: 'No face registered. Please register your face first.' });
  }

  if (antiSpoofData) {
    if (antiSpoofData.screenReflection > 0.3 || antiSpoofData.flatnessScore > 0.7) {
      faceData.spoofAttempts += 1;
      await faceData.save();
      return res.status(403).json({ success: false, message: 'Spoof attempt detected. Access denied.' });
    }
  }

  if (livenessScore !== undefined && livenessScore < 60) {
    return res.status(400).json({ success: false, message: 'Liveness check failed.' });
  }

  let bestDistance = Infinity;
  for (const stored of faceData.descriptors) {
    const dist = euclideanDistance(descriptor, stored);
    if (dist < bestDistance) bestDistance = dist;
  }

  if (bestDistance >= VERIFY_THRESHOLD) {
    faceData.spoofAttempts += 1;
    await faceData.save();
    return res.status(401).json({ success: false, message: 'Face not recognized for check-in.' });
  }

  faceData.lastVerifiedAt = new Date();
  faceData.verificationCount += 1;
  faceData.spoofAttempts = 0;
  await faceData.save();

  let attendance = null;
  if (subjectId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    attendance = await Attendance.findOneAndUpdate(
      {
        collegeId,
        studentId: userId,
        subjectId,
        date: { $gte: today, $lt: new Date(today.getTime() + 86400000) },
      },
      {
        $setOnInsert: {
          collegeId,
          studentId: userId,
          subjectId,
          facultyId: req.user.facultyId || userId,
          date: new Date(),
          status: 'present',
          source: 'face-id',
          timetableId: timetableId || undefined,
          confidence: Math.max(0, (1 - bestDistance) * 100),
          firstSeenAt: new Date(),
        },
        $set: { lastSeenAt: new Date() },
        $inc: { verificationCount: 1 },
      },
      { upsert: true, new: true }
    );
  }

  res.json({
    success: true,
    message: 'Face check-in successful',
    data: {
      verified: true,
      confidence: Math.max(0, (1 - bestDistance) * 100).toFixed(1),
      timestamp: new Date(),
      attendance: attendance ? {
        id: attendance._id,
        status: attendance.status,
        time: attendance.firstSeenAt,
      } : null,
    },
  });
});

module.exports = {
  registerFace,
  verifyFace,
  checkFaceRegistered,
  deleteFaceData,
  faceCheckIn,
};
