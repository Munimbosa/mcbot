"use strict";

const path = require("path");
const mineflayer = require("mineflayer");
const { pathfinder, Movements } = require("mineflayer-pathfinder");

const configMgr = require("./src/configManager");
const logger = require("./src/logger");
const brain = require("./src/brain");
const scheduleRunner = require("./src/scheduleRunner");

let bot = null;
let starting = false;
let reconnectTimer = null;
let mainLoopTimer = null;
let messengerSender = null;

// Outgoing Chat Queue (Throttled to prevent server anti-spam kick)
const outgoingQueue = [];
let isProcessingQueue = false;
let lastChatSentTime = 0;

// Incoming Message Deduplication Cache
const recentIncomingMap = new Map();

function setMessengerSender(fn) {
  messengerSender = typeof fn === "function" ? fn : null;
}

function sendMessenger(text) {
  if (!text) return;
  if (messengerSender) {
    try { messengerSender(String(text)); } catch {}
  }
}

function isConnected() {
  return !!(bot && bot.entity && bot.player);
}

function sendMinecraft(text) {
  if (!isConnected()) return false;
  const clean = String(text || "").trim();
  if (!clean) return false;

  outgoingQueue.push(clean);
  processOutgoingQueue();
  return true;
}

function processOutgoingQueue() {
  if (isProcessingQueue || outgoingQueue.length === 0) return;
  if (!isConnected()) return;

  const now = Date.now();
  const timeSinceLast = now - lastChatSentTime;
  const minDelay = 2500; // 2.5 seconds minimum delay between messages

  if (timeSinceLast < minDelay) {
    setTimeout(processOutgoingQueue, minDelay - timeSinceLast);
    return;
  }

  isProcessingQueue = true;
  const text = outgoingQueue.shift();
  lastChatSentTime = Date.now();

  try {
    bot.chat(text);
    sendMessenger(`💬 **ShekBot:** ${text}`);
  } catch (err) {
    logger.error("[MCBOT] Chat error:", { error: err.message });
  } finally {
    isProcessingQueue = false;
    if (outgoingQueue.length > 0) {
      setTimeout(processOutgoingQueue, 2500);
    }
  }
}

function stopTimers() {
  if (mainLoopTimer) {
    clearInterval(mainLoopTimer);
    mainLoopTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!configMgr.config.server) return;
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    start();
  }, 15000);
}

function dispatchIncomingChat(username, text) {
  if (!username || !text) return;
  if (bot && username === bot.username) return;

  const cleanUser = username.replace(/^[\.@]/, '');
  const key = `${cleanUser.toLowerCase()}:${text.toLowerCase().trim()}`;
  const now = Date.now();
  const lastTime = recentIncomingMap.get(key) || 0;

  if (now - lastTime < 2500) {
    return; // Deduplicate identical message
  }
  recentIncomingMap.set(key, now);

  logger.info(`[ChatReceived] <${username}> "${text}"`);
  sendMessenger(`💬 **MC — ${username}:** ${text}`);
  brain.processIncomingChat(bot, username, text, sendMinecraft);
}

function start() {
  if (bot || starting) return false;

  starting = true;
  configMgr.loadAll();

  const server = configMgr.config.server || { host: "catsmpv5byshek.aternos.me", port: 45259, version: "1.20.4" };
  const username = configMgr.config.botName || "ShekBot";

  logger.info(`Connecting Mineflayer bot [${username}] to ${server.host}:${server.port}...`);
  sendMessenger(`⛏️ ShekBot connecting to ${server.host}:${server.port}...`);

  let newBot;
  try {
    newBot = mineflayer.createBot({
      host: server.host,
      port: Number(server.port),
      username: username,
      auth: "offline",
      version: "1.20.4",
      checkTimeoutInterval: 60000
    });
  } catch (error) {
    starting = false;
    logger.error(`Mineflayer createBot error: ${error.message}`);
    scheduleReconnect();
    return false;
  }

  bot = newBot;
  bot.loadPlugin(pathfinder);

  bot.once("spawn", () => {
    starting = false;
    if (!bot) return;

    const movements = new Movements(bot);
    movements.canDig = true; // ENABLE DIGGING FOR HARVEST & WOOD CHOPPING
    movements.allow1by1towers = true;
    movements.allowParkour = false;
    bot.pathfinder.setMovements(movements);

    logger.info(`✅ ${bot.username} spawned into Minecraft.`);
    sendMessenger(`✅ **${bot.username}** joined Minecraft server ${server.host}:${server.port}`);

    if (!configMgr.state.home && bot.entity && bot.entity.position) {
      const p = bot.entity.position;
      configMgr.state.home = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
      configMgr.saveState();
    }

    stopTimers();
    mainLoopTimer = setInterval(() => {
      brain.mainLoopStep(bot, sendMinecraft);
    }, 1000);
  });

  bot.on("chat", (username, message) => {
    if (!message) return;
    dispatchIncomingChat(username, String(message).trim());
  });

  bot.on("messagestr", (message) => {
    if (!message) return;
    const clean = String(message).replace(/§[0-9a-fk-or]/gi, "").trim();
    if (!clean) return;

    let username = null;
    let text = clean;

    const match = clean.match(/^(?:\[[^\]]+\]\s*)?[<]?([.\w]{2,20})[>]?[\s:>]+(.+)$/);
    if (match) {
      username = match[1];
      text = match[2];
    } else {
      if (bot && bot.players) {
        for (const name of Object.keys(bot.players)) {
          if (name !== bot.username && clean.includes(name)) {
            username = name;
            const idx = clean.indexOf(name);
            text = clean.slice(idx + name.length).replace(/^[\s:>]+/, '');
            break;
          }
        }
      }
    }

    if (username && text) {
      dispatchIncomingChat(username, text);
    }
  });

  bot.on("death", () => {
    scheduleRunner.handleDeath(bot, configMgr.state, sendMinecraft);
  });

  bot.on("kicked", reason => {
    starting = false;
    const reasonText = typeof reason === "string" ? reason : JSON.stringify(reason);
    logger.warn(`Minecraft bot kicked: ${reasonText}`);
    sendMessenger(`⚠️ Mineflayer bot was kicked: ${reasonText}`);

    if (bot === newBot) bot = null;
    stopTimers();
    scheduleReconnect();
  });

  bot.on("end", () => {
    starting = false;
    logger.warn("Minecraft bot disconnected.");
    if (bot === newBot) bot = null;
    stopTimers();
    scheduleReconnect();
  });

  bot.on("error", error => {
    starting = false;
    logger.error("[MCBOT] Mineflayer error:", { error: error.message });
  });

  return true;
}

function stop() {
  stopTimers();
  if (bot) {
    try { bot.quit("bot stopped"); } catch {}
    bot = null;
  }
  starting = false;
  return true;
}

function status() {
  configMgr.loadAll();
  return {
    connected: isConnected(),
    starting,
    username: bot?.username || configMgr.config.botName || "ShekBot",
    server: configMgr.config.server,
    mood: configMgr.state.mood || "happy",
    currentTask: configMgr.state.currentTaskId || "idle",
    home: configMgr.state.home,
    safeMode: require("./src/qwen").isSafeMode,
    dryRun: configMgr.state.dryRun || configMgr.config.dryRun,
    quiet: configMgr.state.quiet
  };
}

module.exports = {
  start,
  stop,
  status,
  isConnected,
  sendMinecraft,
  setMessengerSender,
  getData: () => configMgr.config,
  getState: () => configMgr.state
};
