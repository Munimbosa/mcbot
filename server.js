'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const mcbot = require('./minecraft');
const qwen = require('./src/qwen');
const configMgr = require('./src/configManager');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const connectedSockets = new Set();

wss.on('connection', (ws) => {
  connectedSockets.add(ws);
  
  ws.send(JSON.stringify({
    type: 'status',
    status: mcbot.status()
  }));

  ws.on('close', () => {
    connectedSockets.delete(ws);
  });
});

function broadcastLog(text, logType = 'info') {
  const payload = JSON.stringify({
    type: 'log',
    text: String(text),
    logType: logType
  });

  for (const client of connectedSockets) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function broadcastStatus() {
  const payload = JSON.stringify({
    type: 'status',
    status: mcbot.status()
  });

  for (const client of connectedSockets) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

mcbot.setMessengerSender((msg) => {
  broadcastLog(msg, msg.includes('💬') ? 'chat' : msg.includes('🧠') ? 'ai' : msg.includes('❌') || msg.includes('⚠️') ? 'warn' : 'info');
});

// API Routes
app.get('/api/status', (req, res) => {
  res.json(mcbot.status());
});

app.post('/api/start', (req, res) => {
  broadcastLog('▶ Starting ShekBot via Web Console...', 'info');
  mcbot.start();
  broadcastStatus();
  res.json({ success: true, message: 'Bot start requested' });
});

app.post('/api/stop', (req, res) => {
  broadcastLog('⏹ Stopping ShekBot via Web Console...', 'warn');
  mcbot.stop();
  broadcastStatus();
  res.json({ success: true, message: 'Bot stop requested' });
});

app.post('/api/say', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  broadcastLog(`💬 Web Console: ${message}`, 'chat');
  const sent = mcbot.sendMinecraft(message);
  res.json({ success: sent });
});

app.post('/api/config', (req, res) => {
  const { username, host, port, version, owner, dryRun } = req.body;
  
  if (username) configMgr.config.botName = String(username).trim();
  if (owner) configMgr.config.owner = String(owner).trim();
  if (host) configMgr.config.server.host = String(host).trim();
  if (port) configMgr.config.server.port = Number(port);
  if (version) configMgr.config.server.version = String(version).trim();
  if (dryRun !== undefined) configMgr.config.dryRun = Boolean(dryRun);

  configMgr.saveConfig();
  broadcastLog(`⚙️ Config updated: BotName=${configMgr.config.botName}, Owner=${configMgr.config.owner}, Server=${configMgr.config.server.host}:${configMgr.config.server.port}`, 'info');

  if (mcbot.isConnected()) {
    mcbot.stop();
    setTimeout(() => {
      mcbot.start();
      broadcastStatus();
    }, 1500);
  } else {
    broadcastStatus();
  }

  res.json({ success: true, config: configMgr.config });
});

app.get('/api/report', (req, res) => {
  const stats = configMgr.state.dailyStats || {};
  const report = {
    date: new Date().toISOString().split('T')[0],
    botName: configMgr.config.botName,
    mood: configMgr.state.mood,
    stats: stats,
    safeMode: qwen.isSafeMode,
    quiet: configMgr.state.quiet
  };
  res.json(report);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🤖 ShekBot AI Web Dashboard running on:`);
  console.log(`   http://163.227.239.243:${PORT}`);
  console.log(`=================================================`);
  broadcastLog(`🚀 Web Dashboard started on port ${PORT}`, 'info');
});
