let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

function emitToRoom(io, room, event, payload) {
  const targetIo = io || ioInstance;
  if (!targetIo || !room) return;
  targetIo.to(room).emit(event, payload);
}

function emitNotification(userId, notification) {
  const io = ioInstance;
  if (!io || !userId || !notification) return;
  const payload = notification.toObject ? notification.toObject() : notification;
  emitToRoom(io, `user:${userId}`, 'notification', payload);
  emitToRoom(io, `user:${userId}`, 'erp:notification', payload);
}

function emitDataChange(req, payload = {}) {
  const io = req?.io || ioInstance;
  if (!io) return;

  const { collegeId, userIds = [], roles = [], ...rest } = payload;
  const message = {
    timestamp: new Date().toISOString(),
    ...rest,
  };

  if (collegeId) {
    emitToRoom(io, `college:${collegeId}`, 'erp:data-change', message);
  }

  userIds.forEach((userId) => {
    emitToRoom(io, `user:${userId}`, 'erp:data-change', message);
  });

  roles.forEach((role) => {
    emitToRoom(io, `role:${role}`, 'erp:data-change', message);
  });
}

function emitDirectMessage(req, userIds = [], payload = {}) {
  const io = req?.io || ioInstance;
  if (!io) return;

  userIds.forEach((userId) => {
    emitToRoom(io, `user:${userId}`, 'erp:message', {
      timestamp: new Date().toISOString(),
      ...payload,
    });
    emitToRoom(io, `user:${userId}`, 'message', {
      timestamp: new Date().toISOString(),
      ...payload,
    });
  });
}

module.exports = {
  setIO,
  getIO,
  emitNotification,
  emitDataChange,
  emitDirectMessage,
};

