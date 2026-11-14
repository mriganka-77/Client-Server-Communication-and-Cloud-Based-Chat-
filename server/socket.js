const db = require('./db');
const RateLimiter = require('./rateLimiter');

function setupSockets(io, onlineUsers) {
  const rateLimiter = new RateLimiter({ maxMessages: 10, windowMs: 3000 });

  // Socket Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth ? socket.handshake.auth.token : null;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const user = db.getSessionUser(token);
    if (!user) {
      return next(new Error('Invalid or expired session token'));
    }

    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    onlineUsers.set(user.id, { username: user.username, socketId: socket.id });

    // Join personal user notification channel
    socket.join(`user_${user.id}`);

    // Join all conversation rooms the user is currently a member of
    const userRooms = db.getUserRooms(user.id);
    for (const r of userRooms) {
      socket.join(r.id);
    }

    // Broadcast online status
    const onlineIds = Array.from(onlineUsers.keys());
    io.emit('presence', onlineIds);

    // Client dynamically joins a newly created room channel
    socket.on('room:join', ({ roomId }) => {
      if (roomId && db.isUserInRoom(roomId, user.id)) {
        socket.join(roomId);
      }
    });

    // Encrypted Chat Message
    socket.on('chat:message', (payload = {}, ack) => {
      try {
        const { roomId, ciphertext, iv } = payload;

        if (!roomId || !ciphertext || !iv) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Malformed encrypted message payload.' });
          return;
        }

        if (!db.isUserInRoom(roomId, user.id)) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Unauthorized to post in this room.' });
          return;
        }

        if (!rateLimiter.check(socket.id)) {
          const errMsg = "You're sending messages too fast. Please wait.";
          socket.emit('error:msg', { code: 'RATE_LIMIT', message: errMsg });
          if (typeof ack === 'function') ack({ ok: false, error: errMsg });
          return;
        }

        // Save strictly the encrypted ciphertext & IV to the database (Server CANNOT read plaintext)
        const savedMessage = db.saveMessage(roomId, user.id, ciphertext, iv);

        // Broadcast encrypted message to the specific room only
        io.to(roomId).emit('chat:message', savedMessage);

        if (typeof ack === 'function') {
          ack({ ok: true, id: savedMessage.id });
        }
      } catch (err) {
        console.error(`Error in chat:message for user ${user.username}:`, err);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Server error delivering message.' });
        }
      }
    });

    // Typing Indicator (scoped to room)
    socket.on('typing', ({ roomId, isTyping }) => {
      if (!roomId || !db.isUserInRoom(roomId, user.id)) return;
      socket.to(roomId).emit('typing', {
        roomId,
        username: user.username,
        isTyping: Boolean(isTyping),
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      rateLimiter.remove(socket.id);
      onlineUsers.delete(user.id);
      io.emit('presence', Array.from(onlineUsers.keys()));
    });
  });

  return { rateLimiter };
}

module.exports = setupSockets;
