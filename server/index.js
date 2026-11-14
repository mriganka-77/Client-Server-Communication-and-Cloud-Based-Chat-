const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const createRouter = require('./routes');
const setupSockets = require('./socket');

// Initialize database
db.initDb(config.DB_PATH);

const app = express();
const server = http.createServer(app);

// In-memory online user roster: Map<socketId, username>
const onlineUsers = new Map();

// Configure Socket.IO
const io = new Server(server, {
  cors: {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// JSON middleware
app.use(express.json());

// Serve static frontend assets from ../client
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// Attach REST routes (/health, /api/messages)
app.use(createRouter(io, onlineUsers));

// Fallback to index.html for root or client navigation
app.get('/', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

// Setup WebSocket event handlers
const { rateLimiter } = setupSockets(io, onlineUsers);

// Start listening
server.listen(config.PORT, config.HOST, () => {
  console.log(`====================================================`);
  console.log(`  LANChat Server listening on http://${config.HOST}:${config.PORT}`);
  console.log(`  Database path: ${config.DB_PATH}`);
  console.log(`  Static files served from: ${clientDir}`);
  console.log(`====================================================`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  
  rateLimiter.destroy();

  server.close(() => {
    console.log('HTTP & WebSocket server closed.');
    try {
      db.close();
      console.log('SQLite database connection closed.');
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });

  // Force close after 5 seconds
  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

module.exports = { app, server, io, onlineUsers };

