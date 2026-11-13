const express = require('express');
const db = require('./db');

function createRouter(io, onlineUsers) {
  const router = express.Router();
  const startTime = Date.now();

  // Health check endpoint
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

  // REST API: recent messages
  router.get('/api/messages', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const messages = db.getRecentMessages(limit);
      res.json(messages);
    } catch (err) {
      console.error('Error fetching messages via REST:', err);
      res.status(500).json({ error: 'Failed to retrieve messages' });
    }
  });

  return router;
}

module.exports = createRouter;
