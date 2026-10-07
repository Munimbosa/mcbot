'use strict';

const qwen = require('./qwen');
const logger = require('./logger');
const configMgr = require('./configManager');

class AutoTalkManager {
  constructor() {
    this.lastTalkTime = 0;
    this.hourlyCount = 0;
    this.hourlyResetTime = Date.now();
    this.recentLines = [];
  }

  isSpamConstrained() {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.hourlyResetTime > 3600000) {
      this.hourlyCount = 0;
      this.hourlyResetTime = now;
    }

    const cooldownSec = configMgr.config.talkCooldownSec || 30;
    if (now - this.lastTalkTime < cooldownSec * 1000) {
      return true;
    }

    if (this.hourlyCount >= 10) {
      return true;
    }

    return false;
  }

  recordTalk(text) {
    this.lastTalkTime = Date.now();
    this.hourlyCount++;
    this.recentLines.push(text.toLowerCase());
    if (this.recentLines.length > 20) {
      this.recentLines.shift();
    }
  }

  isDuplicate(text) {
    if (!text) return true;
    const lower = text.toLowerCase().trim();
    return this.recentLines.includes(lower);
  }

  getFallbackLine(category, params = {}) {
    const fallbacks = configMgr.fallbacks[category] || ["hey there!"];
    let line = fallbacks[Math.floor(Math.random() * fallbacks.length)];

    if (params.name) {
      line = line.replace(/\{name\}/g, params.name);
    }
    return line;
  }

  async triggerEvent(category, bot, sendChatFn, params = {}) {
    if (!configMgr.config.autoTalk) return;
    if (configMgr.state.quiet) return;

    // Check if alone mode (no players online)
    const playersOnline = bot && bot.players ? Object.keys(bot.players).filter(p => p !== bot.username).length : 0;
    if (playersOnline === 0) return; // Alone mode is silent

    if (this.isSpamConstrained()) return;

    let line = '';

    // Fast fallback line for urgent events or safe mode
    if (qwen.isSafeMode || category === 'creeper' || category === 'hurt') {
      line = this.getFallbackLine(category, params);
    } else {
      // Small Qwen prompt under 150 tokens
      const prompt = `You are ShekBot, a friendly Minecraft village farmer.
Event: ${category} | Mood: ${configMgr.state.mood} | Params: ${JSON.stringify(params)}
Say 1 short casual line, max 80 chars, no emojis, no markdown.`;

      const res = await qwen.sendCompletion([{ role: 'system', content: prompt }], 50, 5000);
      if (res.success && res.content) {
        line = res.content.replace(/[\"']/g, '').trim();
      } else {
        line = this.getFallbackLine(category, params);
      }
    }

    if (!line || this.isDuplicate(line)) return;

    if (configMgr.config.dryRun || configMgr.state.dryRun) {
      logger.info(`[DryRun AutoTalk] would say: "${line}"`);
      return;
    }

    this.recordTalk(line);
    sendChatFn(line);
  }

  async handleJobAsking(bot, sendChatFn) {
    const now = Date.now();
    const state = configMgr.state;

    if (state.asksToday >= 3) return;
    if (now - (state.lastAskTimestamp || 0) < 15 * 60 * 1000) return;

    // Check if a friendly player is within 10 blocks
    if (!bot || !bot.players) return;
    let nearbyFriend = null;

    for (const name of Object.keys(bot.players)) {
      if (name === bot.username) continue;
      const p = bot.players[name];
      if (p && p.entity && bot.entity.position.distanceTo(p.entity.position) <= 10) {
        nearbyFriend = name;
        break;
      }
    }

    if (!nearbyFriend) return;

    // Ask for seeds or wood
    state.asksToday++;
    state.lastAskTimestamp = now;
    state.dailyStats.asksMade = (state.dailyStats.asksMade || 0) + 1;
    configMgr.saveState();

    const line = this.getFallbackLine('ask_seeds', { name: nearbyFriend });
    sendChatFn(line);
  }
}

module.exports = new AutoTalkManager();
