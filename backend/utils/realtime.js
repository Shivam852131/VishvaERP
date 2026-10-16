function emitToRoom(io, room, event, payload) {
  if (!io || !room) return;
  io.to(room).emit(event, payload);
}

function emitDataChange(req, payload = {}) {
  if (!req?.io) return;

  const { collegeId, userIds = [], roles = [], ...rest } = payload;
  const message = {
    timestamp: new Date().toISOString(),
    ...rest,
  };

  if (collegeId) {
    emitToRoom(req.io, `college:${collegeId}`, 'erp:data-change', message);
  }

  userIds.forEach((userId) => {
    emitToRoom(req.io, `user:${userId}`, 'erp:data-change', message);
  });

  roles.forEach((role) => {
    emitToRoom(req.io, `role:${role}`, 'erp:data-change', message);
  });
}

function emitDirectMessage(req, userIds = [], payload = {}) {
  if (!req?.io) return;

  userIds.forEach((userId) => {
    emitToRoom(req.io, `user:${userId}`, 'erp:message', {
      timestamp: new Date().toISOString(),
      ...payload,
    });
  });
}

module.exports = {
  emitDataChange,
  emitDirectMessage,
};
