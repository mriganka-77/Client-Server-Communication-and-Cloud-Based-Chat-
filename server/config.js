const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db'),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  HISTORY_LIMIT: parseInt(process.env.HISTORY_LIMIT, 10) || 50,
};
