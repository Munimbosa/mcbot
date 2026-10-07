'use strict';

const logger = require('./logger');
const configMgr = require('./configManager');

class QwenService {
  constructor() {
    this.consecutiveFailures = 0;
    this.isSafeMode = false;
    this.lastSafeModeRetry = 0;
    this.playerLastCall = new Map();
    this.rateLimitMs = 1500;
  }

  isRateLimited(username) {
    if (!username) return false;
    const key = username.toLowerCase();
    const last = this.playerLastCall.get(key) || 0;
    const now = Date.now();
    if (now - last < this.rateLimitMs) {
      return true;
    }
    return false;
  }

  recordCall(username) {
    if (username) {
      this.playerLastCall.set(username.toLowerCase(), Date.now());
    }
  }

  async sendCompletion(messages, maxTokens = 100, timeoutMs = 15000) {
    const qwenUrl = configMgr.config.qwenUrl || 'http://127.0.0.1:8080';
    const endpoint = `${qwenUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: messages,
          max_tokens: maxTokens,
          temperature: 0.4
        })
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = (data?.choices?.[0]?.message?.content || '').trim();

      this.consecutiveFailures = 0;
      if (this.isSafeMode) {
        this.isSafeMode = false;
        logger.info('[Qwen] Safe Mode EXITED automatically - Qwen restored.');
      }

      return { success: true, content };

    } catch (err) {
      clearTimeout(timer);
      this.consecutiveFailures++;
      logger.warn(`[Qwen] Call failed (${this.consecutiveFailures} in a row): ${err.message}`);

      if (this.consecutiveFailures >= 3 && !this.isSafeMode) {
        this.isSafeMode = true;
        logger.warn('[Qwen] Entered SAFE MODE (Qwen down or slow). Using fallback responses.');
      }

      return { success: false, error: err.message, safeMode: this.isSafeMode };
    }
  }

  cleanAndParseJSON(str) {
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

  async generateActionResponse(contextPayload) {
    const { botName, sender, trustLevel, friendshipTier, mood, gameTime, mcStatus, recentHistory, userMessage } = contextPayload;

    if (this.isSafeMode) {
      const now = Date.now();
      if (now - this.lastSafeModeRetry > 45000) {
        this.lastSafeModeRetry = now;
        logger.info('[Qwen] Safe Mode retry attempt...');
      } else {
        return { success: false, safeMode: true };
      }
    }

    if (this.isRateLimited(sender)) {
      return { success: false, rateLimited: true };
    }
    this.recordCall(sender);

    const systemPrompt = `You are ${botName}, a friendly Minecraft village farmer/guard. Speak in short casual lines (<100 chars).
Output ONLY valid JSON:
{"reply":"short string","actions":[{"action":"hold|equip|drop|give|collect|follow|goto|come|stop|sleep|harvest_farm|check_inventory|status|chat","args":{}}]}

EXAMPLES:
User: "follow me" -> {"reply":"On my way!","actions":[{"action":"follow","args":{"target":"${sender}"}}]}
User: "come here" -> {"reply":"Coming!","actions":[{"action":"come","args":{"target":"${sender}"}}]}
User: "hello" -> {"reply":"Hey ${sender}! How are you?","actions":[{"action":"chat","args":{}}]}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${sender}: ${userMessage}` }
    ];

    const result = await this.sendCompletion(messages, 90, 12000);
    if (!result.success) {
      return result;
    }

    const parsed = this.cleanAndParseJSON(result.content);
    if (parsed && (parsed.reply || parsed.actions)) {
      return {
        success: true,
        reply: parsed.reply ? String(parsed.reply).slice(0, 100).trim() : '',
        actions: Array.isArray(parsed.actions) ? parsed.actions : []
      };
    }

    return { success: false, parseError: true };
  }
}

module.exports = new QwenService();
