'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const MEMORY_PATH = path.join(__dirname, '..', 'memory.json');

class MemoryManager {
  constructor() {
    this.playerMemories = {};
    this.worldMemories = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        const data = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
        this.playerMemories = data.playerMemories || {};
        this.worldMemories = data.worldMemories || [];
      }
    } catch (e) {
      logger.error('Failed to load memory.json', { error: e.message });
    }
  }

  save() {
    try {
      const data = {
        playerMemories: this.playerMemories,
        worldMemories: this.worldMemories
      };
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
      logger.error('Failed to save memory.json', { error: e.message });
    }
  }

  getPlayerMemory(username) {
    if (!username) return null;
    const key = username.toLowerCase();
    if (!this.playerMemories[key]) {
      this.playerMemories[key] = {
        username: username,
        friendshipScore: 0,
        firstMet: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        giftsGiven: 0,
        lastRequests: [],
        facts: []
      };
      this.save();
    }
    return this.playerMemories[key];
  }

  getFriendshipTier(username) {
    const mem = this.getPlayerMemory(username);
    if (!mem) return 'Stranger';
    const score = mem.friendshipScore || 0;
    if (score >= 50) return 'Bestie';
    if (score >= 20) return 'Friend';
    if (score >= 5) return 'Acquaintance';
    return 'Stranger';
  }

  recordRequest(username, requestText) {
    const mem = this.getPlayerMemory(username);
    if (!mem) return;
    mem.lastSeen = new Date().toISOString();
    mem.lastRequests.unshift({ text: requestText, time: new Date().toISOString() });
    if (mem.lastRequests.length > 5) mem.lastRequests.pop();
    mem.friendshipScore = (mem.friendshipScore || 0) + 1;
    this.save();
  }

  recordGift(username, item) {
    const mem = this.getPlayerMemory(username);
    if (!mem) return;
    mem.giftsGiven = (mem.giftsGiven || 0) + 1;
    mem.friendshipScore = (mem.friendshipScore || 0) + 5;
    if (!mem.facts.includes(`Gave gift: ${item}`)) {
      mem.facts.push(`Gave gift: ${item}`);
      if (mem.facts.length > 5) mem.facts.shift();
    }
    this.save();
  }

  recordAttack(username) {
    const mem = this.getPlayerMemory(username);
    if (!mem) return;
    mem.friendshipScore = Math.max(0, (mem.friendshipScore || 0) - 10);
    this.save();
  }

  getSummary(username) {
    const mem = this.getPlayerMemory(username);
    if (!mem) return 'No prior memory.';
    const tier = this.getFriendshipTier(username);
    const facts = mem.facts && mem.facts.length ? mem.facts.join('; ') : 'None';
    return `Tier: ${tier} (Score: ${mem.friendshipScore}) | Gifts: ${mem.giftsGiven} | Facts: ${facts}`;
  }
}

module.exports = new MemoryManager();
