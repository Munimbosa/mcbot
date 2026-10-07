'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const configMgr = require('./configManager');
const trustMgr = require('./trust');
const memoryMgr = require('./memoryManager');
const qwen = require('./qwen');
const survival = require('./survival');
const actions = require('./actions');
const scheduleRunner = require('./scheduleRunner');
const { goals: { GoalFollow } } = require('mineflayer-pathfinder');

const KILL_SWITCH_FILE = path.join(__dirname, '..', 'STOP');

class BotBrain {
  constructor() {
    this.playerQueue = [];
    this.maxQueueSize = 5;
    this.currentRequest = null;
    this.isExecutingPlayerAction = false;
  }

  isKillSwitchActive() {
    if (fs.existsSync(KILL_SWITCH_FILE)) return true;
    if (configMgr.state.emergencyStop) return true;
    return false;
  }

  parsePronouncedCommand(text, sender) {
    const lower = text.toLowerCase().trim();

    // 1. Jump
    if (lower.includes('jump') || lower.includes('hop')) {
      const countMatch = lower.match(/\b\d+\b/);
      const count = countMatch ? Number(countMatch[0]) : 1;
      return {
        reply: `Jumping ${count} time${count > 1 ? 's' : ''}!`,
        actions: [{ action: 'jump', args: { count: count } }]
      };
    }

    // 2. Equip / Hold (Check BEFORE sleep so "hold yellow bed" holds the bed)
    if (lower.includes('hold') || lower.includes('equip') || lower.includes('wield')) {
      let item = 'torch';
      if (lower.includes('seed')) item = 'wheat_seeds';
      else if (lower.includes('bed')) item = 'bed';
      else if (lower.includes('sword')) item = 'iron_sword';
      else if (lower.includes('pickaxe')) item = 'iron_pickaxe';
      else if (lower.includes('wood') || lower.includes('log')) item = 'oak_log';

      return {
        reply: `Holding ${item.replace(/_/g, ' ')}!`,
        actions: [{ action: 'hold', args: { item: item } }]
      };
    }

    // 3. Give / Drop items
    if (lower.includes('give') || lower.includes('drop') || lower.includes('hand over') || lower.includes('share') || lower.includes('pass me') || lower.includes('toss')) {
      let item = 'all';
      if (lower.includes('seed')) item = 'wheat_seeds';
      else if (lower.includes('wood') || lower.includes('log') || lower.includes('spruce') || lower.includes('oak')) item = 'oak_log';
      else if (lower.includes('wheat') || lower.includes('bread')) item = 'wheat';
      else if (lower.includes('torch')) item = 'torch';

      const countMatch = lower.match(/\b\d+\b/);
      const count = countMatch ? Number(countMatch[0]) : 8;

      return {
        reply: `Dropping ${item.replace(/_/g, ' ')} for you, ${sender}!`,
        actions: [{ action: 'drop', args: { item: item, count: count, target: sender } }]
      };
    }

    // 4. Harvest crops / wheats
    if (lower.includes('harvest') || lower.includes('wheat') || lower.includes('farm') || lower.includes('crop') || lower.includes('replant')) {
      return {
        reply: `On it, ${sender}! Harvesting crops now!`,
        actions: [{ action: 'harvest_farm', args: {} }]
      };
    }

    // 5. Wood / Get / Bring item
    if (lower.includes('wood') || lower.includes('spruce') || lower.includes('log') || lower.includes('get') || lower.includes('bring') || lower.includes('chop') || lower.includes('tree')) {
      let count = 2;
      const numMatch = lower.match(/\b\d+\b/);
      if (numMatch) count = Math.min(Number(numMatch[0]), 32);

      let item = 'spruce_log';
      if (lower.includes('oak')) item = 'oak_log';
      else if (lower.includes('birch')) item = 'birch_log';

      return {
        reply: `On it, ${sender}! Getting ${count} ${item.replace('_log', '')} wood for you!`,
        actions: [{ action: 'collect', args: { item: item, count: count, target: sender } }]
      };
    }

    // 6. Follow
    if (lower.includes('follow') || lower.includes('walk with')) {
      return {
        reply: `Following you, ${sender}! Say "stop" when done.`,
        actions: [{ action: 'follow', args: { target: sender } }]
      };
    }

    // 7. Come
    if (lower.includes('come') || lower.includes('with me') || lower.includes('here')) {
      return {
        reply: `Coming to your location, ${sender}!`,
        actions: [{ action: 'come', args: { target: sender } }]
      };
    }

    // 8. Stop / Stay
    if (lower.includes('stop') || lower.includes('stay') || lower.includes('cancel') || lower.includes('nevermind')) {
      return {
        reply: 'Stopped all actions. Resuming my schedule!',
        actions: [{ action: 'stop', args: {} }]
      };
    }

    // 9. Sleep / Bed
    if (lower.includes('sleep') || lower.includes('bed') || lower.includes('night')) {
      return {
        reply: 'Heading to bed to sleep!',
        actions: [{ action: 'sleep', args: {} }]
      };
    }

    // 10. Kill / Guard
    if (lower.includes('kill') || lower.includes('attack') || lower.includes('fight') || lower.includes('guard')) {
      return {
        reply: `Keeping an eye out and guarding the area, ${sender}!`,
        actions: [{ action: 'chat', args: {} }]
      };
    }

    // 11. Inventory / Status
    if (lower.includes('inventory') || lower.includes('items')) {
      return {
        reply: 'Checking inventory...',
        actions: [{ action: 'check_inventory', args: {} }]
      };
    }
    if (lower.includes('status') || lower.includes('doing')) {
      return {
        reply: `I'm online and working on my schedule (${configMgr.state.currentTaskId || 'farming'})!`,
        actions: [{ action: 'status', args: {} }]
      };
    }

    // Greetings
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('yo') || lower.includes('sup') || lower.includes('greetings')) {
      return {
        reply: `Hey ${sender}! I'm ShekBot the village farmer. What can I do for you?`,
        actions: [{ action: 'chat', args: {} }]
      };
    }

    // Default fallback chat response
    return {
      reply: `Hey ${sender}! I can harvest wheat, get wood, follow you, jump, drop items, or sleep. What do you need?`,
      actions: [{ action: 'chat', args: {} }]
    };
  }

  async processIncomingChat(bot, username, text, sendChatFn) {
    if (this.isKillSwitchActive()) return;
    if (!username || username === (configMgr.config.botName || 'ShekBot')) return;

    const lowerText = text.toLowerCase().trim();
    const botName = (configMgr.config.botName || 'ShekBot').toLowerCase();

    // Direct address OR proximity check (within 14 blocks)
    const isDirectlyAddressed = lowerText.includes(botName) || lowerText.includes('bot') || lowerText.includes('shek');

    let isNearBot = false;
    const playerEntity = actions.findPlayerEntity(bot, username);
    if (playerEntity && playerEntity.entity && bot.entity) {
      const dist = bot.entity.position.distanceTo(playerEntity.entity.position);
      if (dist <= 14) {
        isNearBot = true;
      }
    }

    if (!isDirectlyAddressed && !isNearBot) {
      return; // Ignore general server chat from far away players
    }

    logger.info(`[Brain] Message from <${username}> (near=${isNearBot}): "${text}"`);

    // Owner emergency controls
    const trustLevel = trustMgr.getTrustLevel(username);
    if (trustLevel === 'OWNER') {
      if (lowerText.includes('emergency stop')) {
        configMgr.state.emergencyStop = true;
        configMgr.saveState();
        sendChatFn('Emergency stop activated!');
        return;
      }
      if (lowerText.includes('resume')) {
        configMgr.state.emergencyStop = false;
        configMgr.saveState();
        sendChatFn('Resuming operations!');
        return;
      }
    }

    memoryMgr.recordRequest(username, text);

    // 1. Try Qwen AI first
    let handledByQwen = false;
    try {
      const mcStatus = {
        health: bot.health || 20,
        food: bot.food || 20,
        coords: bot.entity ? `${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)}` : 'unknown',
        heldItem: bot.heldItem ? bot.heldItem.name : 'empty',
        currentAction: configMgr.state.currentTaskId || 'idle',
        nearbyPlayers: Object.keys(bot.players || {}).filter(p => p !== bot.username).join(', ') || 'none',
        nearbyMobs: 'none'
      };

      const qwenRes = await qwen.generateActionResponse({
        botName: configMgr.config.botName || 'ShekBot',
        sender: username,
        trustLevel: trustLevel,
        friendshipTier: memoryMgr.getFriendshipTier(username),
        mood: configMgr.state.mood || 'happy',
        gameTime: (bot.time && typeof bot.time.timeOfDay === 'number') ? (bot.time.timeOfDay < 12000 ? 'day' : 'night') : 'day',
        mcStatus: mcStatus,
        userMessage: text
      });

      if (qwenRes.success && (qwenRes.reply || (qwenRes.actions && qwenRes.actions.length))) {
        handledByQwen = true;
        if (qwenRes.reply && !configMgr.state.quiet) {
          sendChatFn(qwenRes.reply);
        }

        if (qwenRes.actions && qwenRes.actions.length) {
          this.isExecutingPlayerAction = true;
          try {
            for (const act of qwenRes.actions) {
              const allowedCheck = trustMgr.isActionAllowed(username, act.action, act.args);
              if (!allowedCheck.allowed) {
                sendChatFn(allowedCheck.reason);
                continue;
              }
              await actions.executeAction(bot, act, username, configMgr.state, sendChatFn);
            }
          } finally {
            this.isExecutingPlayerAction = false;
          }
        }
      }
    } catch (err) {
      logger.warn(`[Brain] Qwen call error: ${err.message}`);
    }

    // 2. Smart NLU Fallback if Qwen timed out or didn't handle
    if (!handledByQwen) {
      logger.info(`[Brain] Using NLU fallback for <${username}>: "${text}"`);
      const parsed = this.parsePronouncedCommand(text, username);

      if (parsed.reply && !configMgr.state.quiet) {
        sendChatFn(parsed.reply);
      }

      if (parsed.actions && parsed.actions.length) {
        this.isExecutingPlayerAction = true;
        try {
          for (const act of parsed.actions) {
            const allowedCheck = trustMgr.isActionAllowed(username, act.action, act.args);
            if (!allowedCheck.allowed) {
              sendChatFn(allowedCheck.reason);
              continue;
            }
            await actions.executeAction(bot, act, username, configMgr.state, sendChatFn);
          }
        } finally {
          this.isExecutingPlayerAction = false;
        }
      }
    }
  }

  async mainLoopStep(bot, sendChatFn) {
    if (!bot || !bot.entity) return;
    if (this.isKillSwitchActive()) return;

    // 1. P0 Survival Emergency Check
    const emergency = survival.checkSurvivalEmergency(bot, configMgr.state);
    if (emergency) {
      await survival.handleEmergency(bot, emergency, configMgr.state, sendChatFn);
      return;
    }

    // 2. Active Following Target Maintenance (Blocks schedule while following)
    if (configMgr.state.followingTarget) {
      const player = actions.findPlayerEntity(bot, configMgr.state.followingTarget);
      if (player && player.entity) {
        const dist = bot.entity.position.distanceTo(player.entity.position);
        if (dist > 2.5) {
          try {
            bot.pathfinder.setGoal(new GoalFollow(player.entity, 2), true);
          } catch {}
        }
      }
      return; // DO NOT EXECUTE SCHEDULE TASKS WHILE FOLLOWING A PLAYER!
    }

    // 3. Active Player Action Execution Block
    if (this.isExecutingPlayerAction) {
      return; // DO NOT OVERRIDE ACTIVE PLAYER ACTION WITH SCHEDULE!
    }

    // 4. P3 Schedule Task Execution
    scheduleRunner.tick(bot, sendChatFn);

    // 5. P4 Alone Mode
    const playersOnline = Object.keys(bot.players || {}).filter(p => p !== bot.username).length;
    if (playersOnline === 0) {
      scheduleRunner.handleAloneWander(bot);
    }
  }
}

module.exports = new BotBrain();
