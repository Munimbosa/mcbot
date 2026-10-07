'use strict';

const AIClient = require('./client');
const AIMemory = require('./memory');
const { buildMinecraftContext } = require('./context');
const { generateSystemPrompt, generateMessagesPayload } = require('./prompt');

class AIBrain {
  constructor(config = {}) {
    this.config = config;
    this.client = new AIClient({
      url: config.url || 'http://127.0.0.1:8080',
      model: config.model || 'qwen.gguf',
      timeoutMs: config.timeoutMs || 12000
    });
    this.memory = new AIMemory();

    this.playerCooldowns = new Map();
    this.cooldownMs = config.playerCooldownMs || 3000;
    this.isProcessing = false;
  }

  updateConfig(newConfig = {}) {
    this.config = { ...this.config, ...newConfig };
    this.client = new AIClient({
      url: this.config.url || 'http://127.0.0.1:8080',
      model: this.config.model || 'qwen.gguf',
      timeoutMs: this.config.timeoutMs || 12000
    });
    this.cooldownMs = this.config.playerCooldownMs || 3000;
  }

  isCoolingDown(username) {
    const key = username.toLowerCase();
    const lastTime = this.playerCooldowns.get(key) || 0;
    const now = Date.now();
    if (now - lastTime < this.cooldownMs) {
      return true;
    }
    return false;
  }

  recordRequest(username) {
    const key = username.toLowerCase();
    this.playerCooldowns.set(key, Date.now());
  }

  cleanJSON(str) {
    if (!str) return null;
    let text = str.trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      text = match[0];
    }

    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  inferIntentFromText(text, speaker) {
    const lower = text.toLowerCase();
    if (lower.includes('follow')) {
      return { intent: 'FOLLOW_PLAYER', params: { target: speaker } };
    }
    if (lower.includes('stop') || lower.includes('stay')) {
      return { intent: 'STOP', params: {} };
    }
    if (lower.includes('come')) {
      return { intent: 'COME_HERE', params: { target: speaker } };
    }
    if (lower.includes('sleep')) {
      return { intent: 'SLEEP', params: {} };
    }
    if (lower.includes('inventory')) {
      return { intent: 'CHECK_INVENTORY', params: {} };
    }
    if (lower.includes('status')) {
      return { intent: 'STATUS', params: {} };
    }
    return { intent: 'CHAT', params: {} };
  }

  async processMessage(bot, username, text, extraInfo = {}) {
    if (this.config.enabled === false) {
      return null;
    }

    if (!text || !username) {
      return null;
    }

    if (bot && username === bot.username) {
      return null;
    }

    if (this.isCoolingDown(username)) {
      return null;
    }

    if (this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    this.recordRequest(username);

    try {
      const mcContext = buildMinecraftContext(bot, extraInfo);
      const memorySummary = this.memory.getSummaryForPlayer(username);
      const systemPrompt = generateSystemPrompt(mcContext, memorySummary, this.config.personality);
      const recentHistory = this.memory.getRecentHistory(4);
      const messages = generateMessagesPayload(systemPrompt, recentHistory, username, text);

      const response = await this.client.sendCompletion(messages, this.config.maxTokens || 80);

      if (!response.success) {
        console.warn('[AI-Brain] AI completion failed: ' + response.error);
        return null;
      }

      const parsed = this.cleanJSON(response.content);

      if (parsed) {
        const result = {
          shouldReply: parsed.shouldReply !== false,
          reply: parsed.reply ? String(parsed.reply).trim() : '',
          intent: (parsed.intent || 'CHAT').toUpperCase(),
          params: parsed.params || {}
        };

        if (result.intent === 'REMEMBER' && result.params && result.params.fact) {
          this.memory.rememberPlayerFact(username, result.params.fact);
        }

        if (result.reply) {
          this.memory.addTurn(username, text, result.reply);
        } else {
          this.memory.addTurn(username, text, null);
        }

        return result;
      } else {
        const rawReply = response.content.replace(/[{}"']/g, '').slice(0, 100).trim();
        const inferred = this.inferIntentFromText(text, username);

        if (rawReply) {
          this.memory.addTurn(username, text, rawReply);
          return {
            shouldReply: true,
            reply: rawReply,
            intent: inferred.intent,
            params: inferred.params
          };
        }
        return null;
      }

    } catch (err) {
      console.error('[AI-Brain] Exception during processMessage:', err);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }
}

module.exports = AIBrain;
