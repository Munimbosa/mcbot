'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state.json');
const SCHEDULE_PATH = path.join(__dirname, '..', 'schedule.json');
const FALLBACK_PATH = path.join(__dirname, '..', 'fallback_lines.json');

class ConfigManager {
  constructor() {
    this.config = {};
    this.state = {};
    this.schedule = [];
    this.fallbacks = {};
    this.loadAll();
  }

  loadAll() {
    this.loadConfig();
    this.loadState();
    this.loadSchedule();
    this.loadFallbacks();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        this.config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      }
    } catch (e) {
      logger.error('Failed to load config.json', { error: e.message });
    }
  }

  saveConfig() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (e) {
      logger.error('Failed to save config.json', { error: e.message });
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_PATH)) {
        this.state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      }
    } catch (e) {
      logger.error('Failed to load state.json', { error: e.message });
    }
  }

  saveState() {
    try {
      fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
    } catch (e) {
      logger.error('Failed to save state.json', { error: e.message });
    }
  }

  loadSchedule() {
    try {
      if (fs.existsSync(SCHEDULE_PATH)) {
        this.schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
      }
    } catch (e) {
      logger.error('Failed to load schedule.json', { error: e.message });
    }
  }

  loadFallbacks() {
    try {
      if (fs.existsSync(FALLBACK_PATH)) {
        this.fallbacks = JSON.parse(fs.readFileSync(FALLBACK_PATH, 'utf8'));
      }
    } catch (e) {
      logger.error('Failed to load fallback_lines.json', { error: e.message });
    }
  }
}

module.exports = new ConfigManager();
