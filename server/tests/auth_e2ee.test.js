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
const { hashPassword, verifyPassword } = require('../auth');

describe('Auth & End-to-End Encryption (E2EE) Tests', () => {
  let server;
  let serverUrl;
  let ioServer;
  let testDbPath;
  let onlineUsers;
  let rateLimiterInstance;

  before(async () => {
    testDbPath = path.join(__dirname, 'test_e2ee.db');
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

  test('Password hashing and verification with scrypt', () => {
    const password = 'SuperSecretPassword123!';
    const hashed = hashPassword(password);
    assert.strictEqual(verifyPassword(password, hashed), true);
    assert.strictEqual(verifyPassword('WrongPassword', hashed), false);
  });

  test('User Registration, duplicate rejection, and Login', async () => {
    const fakePubKey = { kty: 'EC', crv: 'P-256', x: 'dummyX', y: 'dummyY' };

    // Register User 1 (Alice)
    const regRes = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        password: 'Password123!',
        publicKey: fakePubKey,
      }),
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    assert.ok(regData.token);
    assert.strictEqual(regData.user.username, 'alice');

    // Register Duplicate User (Alice) -> Expect 409
    const dupRes = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ALICE',
        password: 'AnotherPassword!',
        publicKey: fakePubKey,
      }),
    });
    assert.strictEqual(dupRes.status, 409);

    // Register User 2 (Bob)
    const regBob = await fetch(`${serverUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'bob',
        password: 'BobPassword123!',
        publicKey: fakePubKey,
      }),
    });
    assert.strictEqual(regBob.status, 201);
    const bobData = await regBob.json();

    // Login Alice
    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        password: 'Password123!',
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);
  });

  test('1-on-1 Direct Chat Room & E2EE Message Delivery via Socket', async () => {
    // 1. Login Alice & Bob to get tokens
    const aliceRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });
    const alice = await aliceRes.json();

    const bobRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'BobPassword123!' }),
    });
    const bob = await bobRes.json();

    // 2. Alice requests direct room with Bob
    const directRes = await fetch(`${serverUrl}/api/rooms/direct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
      },
      body: JSON.stringify({ targetUserId: bob.user.id }),
    });
    assert.strictEqual(directRes.status, 200);
    const room = await directRes.json();
    assert.strictEqual(room.type, 'direct');

    // 3. Connect sockets with auth tokens
    const aliceSocket = Client(serverUrl, { auth: { token: alice.token } });
    const bobSocket = Client(serverUrl, { auth: { token: bob.token } });

    await Promise.all([
      new Promise((res) => aliceSocket.on('connect', res)),
      new Promise((res) => bobSocket.on('connect', res)),
    ]);

    // Join room channel
    aliceSocket.emit('room:join', { roomId: room.id });
    bobSocket.emit('room:join', { roomId: room.id });

    // 4. Send encrypted message from Alice to Bob
    const sampleCiphertext = '4rT7yK...encryptedBase64...==';
    const sampleIV = 'dGhpcyBpcyBhbiBpdg==';

    const msgPromise = new Promise((resolve) => {
      bobSocket.on('chat:message', (msg) => {
        if (msg.room_id === room.id) resolve(msg);
      });
    });

    const sendRes = await new Promise((resolve) => {
      aliceSocket.emit(
        'chat:message',
        {
          roomId: room.id,
          ciphertext: sampleCiphertext,
          iv: sampleIV,
        },
        resolve
      );
    });

    assert.strictEqual(sendRes.ok, true);

    const received = await msgPromise;
    assert.strictEqual(received.ciphertext, sampleCiphertext);
    assert.strictEqual(received.iv, sampleIV);
    assert.strictEqual(received.sender_username, 'alice');

    // 5. Verify the server SQLite database stores ONLY the encrypted ciphertext (Zero-Knowledge)
    const storedInDb = db.getRoomMessages(room.id);
    assert.strictEqual(storedInDb[0].ciphertext, sampleCiphertext);
    assert.strictEqual(storedInDb[0].iv, sampleIV);
    assert.strictEqual(storedInDb[0].content, undefined); // Server has NO plaintext content field!

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  test('Group Chat creation with encrypted key distribution', async () => {
    const aliceRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'Password123!' }),
    });
    const alice = await aliceRes.json();

    const bobRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'BobPassword123!' }),
    });
    const bob = await bobRes.json();

    // Alice creates group "Secret Team" with Bob
    const groupRes = await fetch(`${serverUrl}/api/rooms/group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
      },
      body: JSON.stringify({
        name: 'Secret Team',
        memberKeysMap: {
          [alice.user.id]: { ciphertext: 'encKeyForAlice', iv: 'ivAlice' },
          [bob.user.id]: { ciphertext: 'encKeyForBob', iv: 'ivBob' },
        },
      }),
    });

    assert.strictEqual(groupRes.status, 201);
    const group = await groupRes.json();
    assert.strictEqual(group.type, 'group');
    assert.strictEqual(group.name, 'Secret Team');
    assert.strictEqual(group.members.length, 2);

    // Verify Bob can retrieve his encrypted group key
    const bobRoomsRes = await fetch(`${serverUrl}/api/rooms`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    const bobRooms = await bobRoomsRes.json();
    const bobGroup = bobRooms.find((r) => r.id === group.id);
    assert.ok(bobGroup);
    assert.strictEqual(bobGroup.encrypted_group_key.ciphertext, 'encKeyForBob');
  });
});

