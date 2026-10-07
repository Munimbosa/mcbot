'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'bot.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function rotateLogIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupFile = path.join(__dirname, '..', `bot.log.${Date.now()}.old`);
        fs.renameSync(LOG_FILE, backupFile);
      }
    }
  } catch (e) {
    console.error('[Logger] Log rotation error:', e.message);
  }
}

function log(level, message, meta = {}) {
  rotateLogIfNeeded();
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}\n`;
  
  console.log(`[${level.toUpperCase()}] ${message}`);
  try {
    fs.appendFileSync(LOG_FILE, formatted);
  } catch (e) {
    console.error('[Logger] Error appending to log:', e.message);
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta)
};
