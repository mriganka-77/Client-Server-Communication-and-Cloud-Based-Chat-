const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');

const db = require('../db');
const createRouter = require('../routes');
const setupSockets = require('../socket');

describe('Chat Server Integration Tests', () => {
  let server;
  let serverUrl;
  let ioServer;
  let testDbPath;
  let onlineUsers;
  let rateLimiterInstance;

  before(async () => {
    testDbPath = path.join(__dirname, 'test_chat.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    db.initDb(testDbPath);

    const app = express();
    server = http.createServer(app);
    onlineUsers = new Map();

    ioServer = new Server(server);
    app.use(express.json());
    app.use(createRouter(ioServer, onlineUsers));

    const { rateLimiter } = setupSockets(ioServer, onlineUsers);
    rateLimiterInstance = rateLimiter;

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        serverUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (rateLimiterInstance) rateLimiterInstance.destroy();
    if (ioServer) ioServer.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${serverUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(typeof body.uptime, 'number');
  });

  test('Two clients join, exchange message, and reject duplicate nickname', async () => {
    // 1. Connect Client A
    const clientA = Client(serverUrl);
    await new Promise((resolve) => clientA.on('connect', resolve));

    // Join Client A as 'alice'
    const joinARes = await new Promise((resolve) => {
      clientA.emit('join', { username: 'alice' }, resolve);
    });
    assert.strictEqual(joinARes.ok, true);

    // 2. Connect Client B
    const clientB = Client(serverUrl);
    await new Promise((resolve) => clientB.on('connect', resolve));

    // Try duplicate join as 'ALICE' -> should fail
    const dupRes = await new Promise((resolve) => {
      clientB.emit('join', { username: 'ALICE' }, resolve);
    });
    assert.strictEqual(dupRes.ok, false);
    assert.match(dupRes.error, /already in use/i);

    // Join Client B as 'bob'
    const joinBRes = await new Promise((resolve) => {
      clientB.emit('join', { username: 'bob' }, resolve);
    });
    assert.strictEqual(joinBRes.ok, true);

    // 3. Client A sends a message -> Client B receives it
    const msgPromise = new Promise((resolve) => {
      clientB.on('message', (msg) => {
        if (msg.username === 'alice' && msg.content === 'Hello Bob!') {
          resolve(msg);
        }
      });
    });

    const sendRes = await new Promise((resolve) => {
      clientA.emit('message', { content: 'Hello Bob!' }, resolve);
    });
    assert.strictEqual(sendRes.ok, true);

    const receivedMsg = await msgPromise;
    assert.strictEqual(receivedMsg.username, 'alice');
    assert.strictEqual(receivedMsg.content, 'Hello Bob!');
    assert.strictEqual(typeof receivedMsg.id, 'number');

    // 4. Verify message persisted in REST API
    const historyRes = await fetch(`${serverUrl}/api/messages?limit=10`);
    assert.strictEqual(historyRes.status, 200);
    const history = await historyRes.json();
    assert.ok(history.some((m) => m.content === 'Hello Bob!'));

    // Disconnect clients
    clientA.disconnect();
    clientB.disconnect();
  });
});
