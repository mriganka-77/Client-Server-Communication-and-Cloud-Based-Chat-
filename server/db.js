const fs = require('fs');
const path = require('path');
const config = require('./config');

let dbInstance = null;

function initDb(dbFilePath = config.DB_PATH) {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbFilePath);
  } catch (err) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(dbFilePath);
    } catch (e) {
      throw new Error(`Failed to initialize SQLite driver: ${err.message} / ${e.message}`);
    }
  }

  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON;');

  // Migration check: if old legacy messages table exists without room_id, drop or recreate it
  try {
    const tableInfo = db.prepare("PRAGMA table_info(messages)").all();
    const hasRoomId = tableInfo.some(col => col.name === 'room_id');
    if (tableInfo.length > 0 && !hasRoomId) {
      db.exec('DROP TABLE IF EXISTS messages;');
    }
  } catch (_) {}

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT    NOT NULL,
      public_key    TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT    PRIMARY KEY,
      type        TEXT    NOT NULL CHECK(type IN ('direct', 'group')),
      name        TEXT,
      created_by  INTEGER REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id              TEXT    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      encrypted_group_key  TEXT,
      joined_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id     TEXT    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_id   INTEGER NOT NULL REFERENCES users(id),
      ciphertext  TEXT    NOT NULL,
      iv          TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
  `);

  dbInstance = db;
  return dbInstance;
}

function getDb() {
  if (!dbInstance) initDb();
  return dbInstance;
}

// User operations
function createUser(username, passwordHash, publicKey) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO users (username, password_hash, public_key) VALUES (?, ?, ?)');
  const res = stmt.run(username, passwordHash, publicKey);
  const id = Number(res.lastInsertRowid);
  return getUserById(id);
}

function getUserByUsername(username) {
  const db = getDb();
  const stmt = db.prepare('SELECT id, username, password_hash, public_key, created_at FROM users WHERE username = ? COLLATE NOCASE');
  const rows = stmt.all(username);
  return rows[0] || null;
}

function getUserById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT id, username, public_key, created_at FROM users WHERE id = ?');
  const rows = stmt.all(id);
  return rows[0] || null;
}

function updateUserPublicKey(userId, publicKey) {
  const db = getDb();
  const stmt = db.prepare('UPDATE users SET public_key = ? WHERE id = ?');
  stmt.run(publicKey, userId);
  return getUserById(userId);
}

function getAllUsers(excludeUserId) {
  const db = getDb();
  const stmt = db.prepare('SELECT id, username, public_key, created_at FROM users WHERE id != ? ORDER BY username ASC');
  return stmt.all(excludeUserId);
}

// Session operations
function createSession(token, userId) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)');
  stmt.run(token, userId);
  return { token, userId };
}

function getSessionUser(token) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT u.id, u.username, u.public_key, u.created_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `);
  const rows = stmt.all(token);
  return rows[0] || null;
}

function deleteSession(token) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
  stmt.run(token);
}

// Room operations
function getOrCreateDirectRoom(userAId, userBId) {
  const db = getDb();
  const [minId, maxId] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
  const roomId = `direct_${minId}_${maxId}`;

  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').all(roomId)[0];
  if (existing) {
    return existing;
  }

  // Create room and add both members
  db.prepare("INSERT INTO rooms (id, type, name, created_by) VALUES (?, 'direct', NULL, ?)").run(roomId, userAId);
  db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(roomId, userAId);
  db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)').run(roomId, userBId);

  return db.prepare('SELECT * FROM rooms WHERE id = ?').all(roomId)[0];
}

function createGroupRoom(roomId, name, creatorId, memberKeysMap) {
  const db = getDb();

  db.prepare("INSERT INTO rooms (id, type, name, created_by) VALUES (?, 'group', ?, ?)").run(roomId, name, creatorId);

  // Insert members with their encrypted group key
  const insertMember = db.prepare('INSERT INTO room_members (room_id, user_id, encrypted_group_key) VALUES (?, ?, ?)');
  for (const [userIdStr, keyPayload] of Object.entries(memberKeysMap)) {
    const userId = Number(userIdStr);
    insertMember.run(roomId, userId, JSON.stringify(keyPayload));
  }

  return db.prepare('SELECT * FROM rooms WHERE id = ?').all(roomId)[0];
}

function getUserRooms(userId) {
  const db = getDb();
  // Get all rooms the user is a member of, along with details and member list
  const rooms = db.prepare(`
    SELECT r.id, r.type, r.name, r.created_by, r.created_at, rm.encrypted_group_key
    FROM room_members rm
    JOIN rooms r ON rm.room_id = r.id
    WHERE rm.user_id = ?
    ORDER BY r.created_at DESC
  `).all(userId);

  // For each room, attach members information
  const memberStmt = db.prepare(`
    SELECT u.id, u.username, u.public_key, rm.encrypted_group_key
    FROM room_members rm
    JOIN users u ON rm.user_id = u.id
    WHERE rm.room_id = ?
  `);

  return rooms.map(room => {
    const members = memberStmt.all(room.id);
    let displayName = room.name;
    let peerUser = null;

    if (room.type === 'direct') {
      peerUser = members.find(m => m.id !== userId) || members[0];
      displayName = peerUser ? peerUser.username : 'Direct Chat';
    }

    return {
      id: room.id,
      type: room.type,
      name: displayName,
      created_by: room.created_by,
      created_at: room.created_at,
      encrypted_group_key: room.encrypted_group_key ? JSON.parse(room.encrypted_group_key) : null,
      peerUser: peerUser ? { id: peerUser.id, username: peerUser.username, public_key: peerUser.public_key } : null,
      members: members.map(m => ({
        id: m.id,
        username: m.username,
        public_key: m.public_key,
      })),
    };
  });
}

function getRoom(roomId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM rooms WHERE id = ?').all(roomId);
  return rows[0] || null;
}

function getRoomMembers(roomId) {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.username, u.public_key, rm.encrypted_group_key
    FROM room_members rm
    JOIN users u ON rm.user_id = u.id
    WHERE rm.room_id = ?
  `).all(roomId);
}

function isUserInRoom(roomId, userId) {
  const db = getDb();
  const rows = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').all(roomId, userId);
  return rows.length > 0;
}

// Message operations
function saveMessage(roomId, senderId, ciphertext, iv) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO messages (room_id, sender_id, ciphertext, iv) VALUES (?, ?, ?, ?)');
  const res = stmt.run(roomId, senderId, ciphertext, iv);
  const id = Number(res.lastInsertRowid);

  const row = db.prepare(`
    SELECT m.id, m.room_id, m.sender_id, u.username AS sender_username, m.ciphertext, m.iv, m.created_at
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.id = ?
  `).all(id)[0];

  return row;
}

function getRoomMessages(roomId, limit = 50) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const rows = db.prepare(`
    SELECT m.id, m.room_id, m.sender_id, u.username AS sender_username, m.ciphertext, m.iv, m.created_at
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ?
    ORDER BY m.id DESC
    LIMIT ?
  `).all(roomId, safeLimit);

  return rows.reverse();
}

function close() {
  if (dbInstance && typeof dbInstance.close === 'function') {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = {
  initDb,
  getDb,
  createUser,
  getUserByUsername,
  getUserById,
  updateUserPublicKey,
  getAllUsers,
  createSession,
  getSessionUser,
  deleteSession,
  getOrCreateDirectRoom,
  createGroupRoom,
  getUserRooms,
  getRoom,
  getRoomMembers,
  isUserInRoom,
  saveMessage,
  getRoomMessages,
  close,
};
