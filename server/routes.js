const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const { hashPassword, verifyPassword, generateToken } = require('./auth');
const { validateNickname } = require('./validators');

function createRouter(io, onlineUsers) {
  const router = express.Router();
  const startTime = Date.now();

  // Auth Middleware
  function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authHeader.slice(7).trim();
    const user = db.getSessionUser(token);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.user = user;
    req.token = token;
    next();
  }

  // Health check
  router.get('/health', (req, res) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const connectionCount = io.engine ? io.engine.clientsCount : onlineUsers.size;
    res.json({
      status: 'ok',
      uptime: uptimeSeconds,
      connections: connectionCount,
      onlineUsers: onlineUsers.size,
    });
  });

  // Auth: Register
  router.post('/api/auth/register', (req, res) => {
    try {
      const { username, password, publicKey } = req.body;

      const nameVal = validateNickname(username);
      if (!nameVal.valid) {
        return res.status(400).json({ error: nameVal.error });
      }

      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }

      if (!publicKey) {
        return res.status(400).json({ error: 'E2EE Public Key is required for registration.' });
      }

      const existing = db.getUserByUsername(nameVal.sanitized);
      if (existing) {
        return res.status(409).json({ error: 'Username is already taken.' });
      }

      const pubKeyStr = typeof publicKey === 'object' ? JSON.stringify(publicKey) : publicKey;
      const passHash = hashPassword(password);
      const user = db.createUser(nameVal.sanitized, passHash, pubKeyStr);

      const token = generateToken();
      db.createSession(token, user.id);

      res.status(201).json({
        token,
        user: {
          id: user.id,
          username: user.username,
          public_key: user.public_key,
        },
      });
    } catch (err) {
      console.error('Registration error:', err);
      res.status(500).json({ error: 'Registration failed due to a server error.' });
    }
  });

  // Auth: Login
  router.post('/api/auth/login', (req, res) => {
    try {
      const { username, password, publicKey } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      const user = db.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      if (!verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      // If user has a new public key (e.g. logged in on a new device), update it
      let activePubKey = user.public_key;
      if (publicKey) {
        const pubKeyStr = typeof publicKey === 'object' ? JSON.stringify(publicKey) : publicKey;
        db.updateUserPublicKey(user.id, pubKeyStr);
        activePubKey = pubKeyStr;
      }

      const token = generateToken();
      db.createSession(token, user.id);

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          public_key: activePubKey,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed due to a server error.' });
    }
  });

  // Auth: Me
  router.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        username: req.user.username,
        public_key: req.user.public_key,
      },
    });
  });

  // Auth: Logout
  router.post('/api/auth/logout', requireAuth, (req, res) => {
    db.deleteSession(req.token);
    res.json({ ok: true });
  });

  // Directory: List all other users
  router.get('/api/users', requireAuth, (req, res) => {
    try {
      const users = db.getAllUsers(req.user.id);
      res.json(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      res.status(500).json({ error: 'Failed to fetch users list.' });
    }
  });

  // Rooms: List user's rooms
  router.get('/api/rooms', requireAuth, (req, res) => {
    try {
      const rooms = db.getUserRooms(req.user.id);
      res.json(rooms);
    } catch (err) {
      console.error('Error fetching rooms:', err);
      res.status(500).json({ error: 'Failed to fetch rooms.' });
    }
  });

  // Rooms: Direct Chat (get or create)
  router.post('/api/rooms/direct', requireAuth, (req, res) => {
    try {
      const targetUserId = Number(req.body.targetUserId);
      if (!targetUserId || targetUserId === req.user.id) {
        return res.status(400).json({ error: 'Invalid target user for direct chat.' });
      }

      const targetUser = db.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found.' });
      }

      db.getOrCreateDirectRoom(req.user.id, targetUserId);
      const userRooms = db.getUserRooms(req.user.id);
      const room = userRooms.find(r => r.type === 'direct' && r.peerUser && r.peerUser.id === targetUserId);

      res.json(room);
    } catch (err) {
      console.error('Error creating direct room:', err);
      res.status(500).json({ error: 'Failed to initiate direct chat.' });
    }
  });

  // Rooms: Group Chat (create with encrypted group key per member)
  router.post('/api/rooms/group', requireAuth, (req, res) => {
    try {
      const { name, memberKeysMap } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'Group name must be at least 2 characters.' });
      }

      if (!memberKeysMap || typeof memberKeysMap !== 'object') {
        return res.status(400).json({ error: 'Encrypted group keys for members are required.' });
      }

      // Creator must be in memberKeysMap
      if (!memberKeysMap[req.user.id]) {
        return res.status(400).json({ error: 'Creator must be included in member key map.' });
      }

      const roomId = `group_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      db.createGroupRoom(roomId, name.trim(), req.user.id, memberKeysMap);

      const userRooms = db.getUserRooms(req.user.id);
      const createdRoom = userRooms.find(r => r.id === roomId);

      // Notify all connected online members about the new group
      for (const memberIdStr of Object.keys(memberKeysMap)) {
        io.to(`user_${memberIdStr}`).emit('room:created', createdRoom);
      }

      res.status(201).json(createdRoom);
    } catch (err) {
      console.error('Error creating group room:', err);
      res.status(500).json({ error: 'Failed to create group.' });
    }
  });

  // Messages: Get encrypted messages for a room
  router.get('/api/rooms/:roomId/messages', requireAuth, (req, res) => {
    try {
      const { roomId } = req.params;
      if (!db.isUserInRoom(roomId, req.user.id)) {
        return res.status(403).json({ error: 'Access denied to this conversation.' });
      }

      const messages = db.getRoomMessages(roomId, req.query.limit || 50);
      res.json(messages);
    } catch (err) {
      console.error('Error fetching room messages:', err);
      res.status(500).json({ error: 'Failed to load messages.' });
    }
  });

  return router;
}

module.exports = createRouter;
