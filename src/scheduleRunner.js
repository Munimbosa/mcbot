'use strict';

const { goals: { GoalNear } } = require('mineflayer-pathfinder');
const logger = require('./logger');
const configMgr = require('./configManager');
const { eatFoodIfAvailable } = require('./survival');

class ScheduleRunner {
  constructor() {
    this.currentTask = null;
    this.taskStartTime = 0;
    this.taskTimeoutMs = 120000; // 2 minutes
    this.pausedTask = null;
    this.aloneModeTimer = null;
    this.deathRecovery = null;
  }

  getCurrentTaskForTime(timeOfDay) {
    const tasks = configMgr.schedule || [];
    return tasks.find(t => timeOfDay >= t.startTick && timeOfDay < t.endTick) || null;
  }

  tick(bot, sendChatFn) {
    if (!bot || !bot.entity) return;

    const timeOfDay = (bot.time && typeof bot.time.timeOfDay === 'number') ? bot.time.timeOfDay : 6000;
    const task = this.getCurrentTaskForTime(timeOfDay);

    if (!task) return;

    const now = Date.now();
    if (this.currentTask?.id !== task.id) {
      logger.info(`[Schedule] Starting Task: ${task.name} (${task.id})`);
      this.currentTask = task;
      this.taskStartTime = now;
      configMgr.state.currentTaskId = task.id;
      configMgr.saveState();
      this.executeTaskStart(bot, task, sendChatFn);
    } else if (now - this.taskStartTime > this.taskTimeoutMs) {
      logger.warn(`[Schedule] Task ${task.id} timed out after 2 minutes.`);
      const fails = (configMgr.state.taskFailCounters[task.id] || 0) + 1;
      configMgr.state.taskFailCounters[task.id] = fails;
      configMgr.saveState();
      if (fails >= 3) {
        logger.warn(`[Schedule] Task ${task.id} failed 3 times. Skipping.`);
      }
      this.taskStartTime = now;
    }
  }

  async executeTaskStart(bot, task, sendChatFn) {
    try {
      switch (task.id) {
        case 'wake_up':
          eatFoodIfAvailable(bot);
          break;

        case 'check_farm': {
          const crop = bot.findBlock({
            matching: b => b && b.name && (b.name === 'wheat' || b.name === 'carrots' || b.name === 'potatoes'),
            maxDistance: 32
          });
          if (crop) {
            await bot.pathfinder.goto(new GoalNear(crop.position.x, crop.position.y, crop.position.z, 1));
            await bot.dig(crop);
          }
          break;
        }

        case 'collect_wood': {
          const log = bot.findBlock({
            matching: b => b && b.name && b.name.endsWith('_log'),
            maxDistance: 32
          });
          if (log) {
            await bot.pathfinder.goto(new GoalNear(log.position.x, log.position.y, log.position.z, 1));
            await bot.dig(log);
          }
          break;
        }

        case 'return_home':
          if (configMgr.state.home) {
            const h = configMgr.state.home;
            bot.pathfinder.setGoal(new GoalNear(h.x, h.y, h.z, 2));
          }
          break;

        case 'sleep': {
          const bed = bot.findBlock({
            matching: b => b && b.name && b.name.endsWith('_bed'),
            maxDistance: 32
          });
          if (bed) {
            await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
            if (!bot.isSleeping) {
              await bot.sleep(bed);
            }
          }
          break;
        }
      }
    } catch (err) {
      logger.warn(`[Schedule] Task ${task.id} execution warning: ${err.message}`);
    }
  }

  handleAloneWander(bot) {
    if (!bot || !bot.entity) return;
    const pos = bot.entity.position;
    const home = configMgr.state.home || pos;

    const rx = Math.round(home.x + (Math.random() - 0.5) * 40);
    const rz = Math.round(home.z + (Math.random() - 0.5) * 40);

    try {
      bot.pathfinder.setGoal(new GoalNear(rx, Math.round(home.y), rz, 2));
    } catch {}
  }

  handleDeath(bot, state, sendChatFn) {
    if (!bot || !bot.entity) return;
    const pos = bot.entity.position;
    const deathLoc = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };

    logger.warn(`[DeathRoutine] Bot died at X:${deathLoc.x} Y:${deathLoc.y} Z:${deathLoc.z}`);
    state.lastDeath = {
      ...deathLoc,
      timestamp: Date.now()
    };
    state.dailyStats.deaths = (state.dailyStats.deaths || 0) + 1;
    state.mood = 'grumpy';
    configMgr.saveState();

    if (typeof sendChatFn === 'function') sendChatFn('ouch... that hurt.');

    state.dangerZones.push({ ...deathLoc, radius: 16, expireTime: Date.now() + 600000 });
  }

  async recoverDeathItems(bot, state) {
    if (!state.lastDeath || Date.now() - state.lastDeath.timestamp > 300000) {
      return;
    }

    const loc = state.lastDeath;
    logger.info(`[DeathRoutine] Attempting death item recovery at X:${loc.x} Y:${loc.y} Z:${loc.z}`);

    try {
      await bot.pathfinder.goto(new GoalNear(loc.x, loc.y, loc.z, 2));
      eatFoodIfAvailable(bot);
      logger.info('[DeathRoutine] Reached death location and recovered items.');
    } catch (e) {
      logger.warn('[DeathRoutine] Failed to recover items:', { error: e.message });
    }
  }
}

module.exports = new ScheduleRunner();
