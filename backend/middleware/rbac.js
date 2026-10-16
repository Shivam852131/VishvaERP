const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this resource`,
      });
    }
    next();
  };
};

// Ensure user can only access their own college's data
const sameCollege = (req, res, next) => {
  if (req.user.role === 'superadmin') return next();
  
  const collegeIdParam = req.params.collegeId || req.body.collegeId || req.query.collegeId;
  
  if (collegeIdParam && collegeIdParam !== req.user.collegeId?.toString()) {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied: college mismatch' 
    });
  }
  next();
};

module.exports = { authorize, sameCollege };
