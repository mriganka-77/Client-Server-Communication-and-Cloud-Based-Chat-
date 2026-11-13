const db = require('./db');
const { validateNickname, isNicknameAvailable, validateMessage } = require('./validators');
const RateLimiter = require('./rateLimiter');
const config = require('./config');

function setupSockets(io, onlineUsers) {
  const rateLimiter = new RateLimiter({ maxMessages: 5, windowMs: 3000 });

  function getOnlineUsernames() {
    return Array.from(new Set(onlineUsers.values()));
  }

  io.on('connection', (socket) => {
    // 1. Join room
    socket.on('join', (payload = {}, ack) => {
      try {
        const username = payload.username;
        const validation = validateNickname(username);
        if (!validation.valid) {
          if (typeof ack === 'function') ack({ ok: false, error: validation.error });
          return;
        }

        const cleanName = validation.sanitized;
        if (!isNicknameAvailable(cleanName, onlineUsers)) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'That nickname is already in use.' });
          }
          return;
        }

        // Register user
        onlineUsers.set(socket.id, cleanName);

        // Fetch history
        const history = db.getRecentMessages(config.HISTORY_LIMIT);
        const users = getOnlineUsernames();

        // Send confirmation and history to joining socket
        socket.emit('join:ok', {
          username: cleanName,
          history,
          users,
        });

        // Broadcast updated user list to all
        io.emit('users', users);

        // Broadcast system notification to other users
        const nowIso = new Date().toISOString();
        socket.broadcast.emit('system', {
          text: `${cleanName} joined the chat`,
          createdAt: nowIso,
        });

        if (typeof ack === 'function') {
          ack({ ok: true });
        }
      } catch (err) {
        console.error(`Error in 'join' event for socket ${socket.id}:`, err);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Internal server error while joining.' });
        }
      }
    });

    // 2. Chat message
    socket.on('message', (payload = {}, ack) => {
      try {
        const username = onlineUsers.get(socket.id);
        if (!username) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'You must join before sending messages.' });
          }
          return;
        }

        // Rate limiting check
        if (!rateLimiter.check(socket.id)) {
          const errMsg = "You're sending messages too fast. Please wait a moment.";
          socket.emit('error:msg', { code: 'RATE_LIMIT', message: errMsg });
          if (typeof ack === 'function') {
            ack({ ok: false, error: errMsg });
          }
          return;
        }

        // Validation
        const validation = validateMessage(payload.content);
        if (!validation.valid) {
          if (typeof ack === 'function') {
            ack({ ok: false, error: validation.error });
          }
          return;
        }

        const cleanContent = validation.sanitized;

        // Persist message
        const savedMessage = db.saveMessage(username, cleanContent);

        // Broadcast message to everyone
        io.emit('message', savedMessage);

        if (typeof ack === 'function') {
          ack({ ok: true, id: savedMessage.id });
        }
      } catch (err) {
        console.error(`Error in 'message' event for socket ${socket.id}:`, err);
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Internal server error while sending message.' });
        }
      }
    });

    // 3. Typing indicator
    socket.on('typing', (payload = {}) => {
      try {
        const username = onlineUsers.get(socket.id);
        if (!username) return;

        const isTyping = Boolean(payload.isTyping);
        socket.broadcast.emit('typing', {
          username,
          isTyping,
        });
      } catch (err) {
        console.error(`Error in 'typing' event for socket ${socket.id}:`, err);
      }
    });

    // 4. Disconnect
    socket.on('disconnect', () => {
      try {
        rateLimiter.remove(socket.id);
        const username = onlineUsers.get(socket.id);

        if (username) {
          onlineUsers.delete(socket.id);
          const users = getOnlineUsernames();

          // Broadcast updated user list
          io.emit('users', users);

          // Broadcast leave notification
          const nowIso = new Date().toISOString();
          io.emit('system', {
            text: `${username} left the chat`,
            createdAt: nowIso,
          });

          // Also cancel any active typing indicator for this user
          socket.broadcast.emit('typing', {
            username,
            isTyping: false,
          });
        }
      } catch (err) {
        console.error(`Error in 'disconnect' event for socket ${socket.id}:`, err);
      }
    });
  });

  return { rateLimiter };
}

module.exports = setupSockets;
