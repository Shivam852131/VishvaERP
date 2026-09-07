const Subscription = require('../models/Subscription');
const College = require('../models/College');

const requireSubscription = async (req, res, next) => {
  if (!req.user || req.user.role !== 'collegeAdmin') {
    return next();
  }

  if (req.user.role === 'superadmin') {
    return next();
  }

  try {
    const subscription = await Subscription.findOne({
      collegeId: req.user.collegeId,
      status: 'active',
      endDate: { $gt: new Date() },
    });

    if (!subscription) {
      const college = await College.findById(req.user.collegeId).select('planExpiry');
      if (college?.planExpiry && college.planExpiry > new Date()) {
        req.subscription = {
          status: 'active',
          collegeId: req.user.collegeId,
          endDate: college.planExpiry,
          source: 'college-plan-expiry',
        };
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Active subscription required',
        code: 'SUBSCRIPTION_REQUIRED',
        subscriptionRequired: true,
      });
    }

    req.subscription = subscription;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Subscription check failed' });
  }
};

module.exports = { requireSubscription };
