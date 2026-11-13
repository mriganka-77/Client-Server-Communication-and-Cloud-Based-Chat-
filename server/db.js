const fs = require('fs');
const path = require('path');
const config = require('./config');

let dbInstance = null;
let insertStmt = null;
let selectRecentStmt = null;
let selectByIdStmt = null;

function initDb(dbFilePath = config.DB_PATH) {
  // Ensure target directory exists
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Dual engine support: better-sqlite3 (Node 20 / Linux) or native node:sqlite (Node 22+)
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbFilePath);
  } catch (err) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(dbFilePath);
    } catch (e) {
      throw new Error(`Failed to initialize SQLite driver: neither better-sqlite3 nor node:sqlite is available. Details: ${err.message} / ${e.message}`);
    }
  }

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  `);

  insertStmt = db.prepare('INSERT INTO messages (username, content) VALUES (?, ?)');
  selectRecentStmt = db.prepare(`
    SELECT id, username, content, created_at AS createdAt
    FROM messages
    ORDER BY id DESC
    LIMIT ?
  `);
  selectByIdStmt = db.prepare(`
    SELECT id, username, content, created_at AS createdAt
    FROM messages
    WHERE id = ?
  `);

  dbInstance = db;
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    initDb();
  }
  return dbInstance;
}

function saveMessage(username, content) {
  getDb();
  const info = insertStmt.run(username, content);
  const id = Number(info.lastInsertRowid);
  
  // Return the newly inserted row
  const row = selectByIdStmt.get ? selectByIdStmt.get(id) : selectByIdStmt.all(id)[0];
  return {
    id: row.id,
    username: row.username,
    content: row.content,
    createdAt: row.createdAt,
  };
}

function getRecentMessages(limit = config.HISTORY_LIMIT) {
  getDb();
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || config.HISTORY_LIMIT, 200));
  const rows = selectRecentStmt.all(safeLimit);
  // Rows were fetched ORDER BY id DESC, so reverse them to chronological order
  return rows.reverse().map((r) => ({
    id: r.id,
    username: r.username,
    content: r.content,
    createdAt: r.createdAt,
  }));
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
  saveMessage,
  getRecentMessages,
  close,
};
