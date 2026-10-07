'use strict';

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', 'ai_memory.json');
const MAX_SHORT_TERM_HISTORY = 10;

class AIMemory {
  constructor() {
    this.shortTermHistory = [];
    this.playerMemories = {};
    this.worldMemories = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.playerMemories = parsed.playerMemories || {};
        this.worldMemories = parsed.worldMemories || [];
        this.shortTermHistory = parsed.shortTermHistory || [];
      }
    } catch (err) {
      console.error('[AI-Memory] Error loading memory file:', err);
    }
  }

  save() {
    try {
      const data = {
        playerMemories: this.playerMemories,
        worldMemories: this.worldMemories,
        shortTermHistory: this.shortTermHistory.slice(-MAX_SHORT_TERM_HISTORY)
      };
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[AI-Memory] Error saving memory file:', err);
    }
  }

  addTurn(speaker, text, botReply = null) {
    if (!speaker || !text) return;
    this.shortTermHistory.push({
      speaker: speaker,
      text: text,
      botReply: botReply,
      timestamp: Date.now()
    });

    if (this.shortTermHistory.length > MAX_SHORT_TERM_HISTORY) {
      this.shortTermHistory.shift();
    }
    this.save();
  }

  getRecentHistory(count = 6) {
    return this.shortTermHistory.slice(-count);
  }

  getPlayerMemory(username) {
    if (!username) return null;
    const key = username.toLowerCase();
    return this.playerMemories[key] || null;
  }

  rememberPlayerFact(username, fact) {
    if (!username || !fact) return;
    const key = username.toLowerCase();
    if (!this.playerMemories[key]) {
      this.playerMemories[key] = {
        username: username,
        facts: [],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
    }

    const mem = this.playerMemories[key];
    mem.lastSeen = new Date().toISOString();
    if (!mem.facts.includes(fact)) {
      mem.facts.push(fact);
      if (mem.facts.length > 8) mem.facts.shift();
    }
    this.save();
  }

  rememberWorldFact(fact) {
    if (!fact) return;
    if (!this.worldMemories.includes(fact)) {
      this.worldMemories.push(fact);
      if (this.worldMemories.length > 15) this.worldMemories.shift();
      this.save();
    }
  }

  getSummaryForPlayer(username) {
    const mem = this.getPlayerMemory(username);
    const facts = (mem && mem.facts && mem.facts.length) ? mem.facts.join('; ') : 'No prior notes stored.';
    const world = this.worldMemories.length ? 'World notes: ' + this.worldMemories.join('; ') : '';
    return 'Player [' + username + '] Memory: ' + facts + (world ? ' | ' + world : '');
  }
}

module.exports = AIMemory;
