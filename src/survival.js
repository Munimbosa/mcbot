'use strict';

const { goals: { GoalNear, GoalInvert, GoalFollow } } = require('mineflayer-pathfinder');
const logger = require('./logger');

function checkSurvivalEmergency(bot, state) {
  if (!bot || !bot.entity) return null;

  const pos = bot.entity.position;
  const health = bot.health !== undefined ? bot.health : 20;

  // 1. Creeper within 6 blocks -> Flee
  if (bot.entities) {
    for (const id of Object.keys(bot.entities)) {
      const e = bot.entities[id];
      if (e && e.name === 'creeper' && e.position) {
        const dist = pos.distanceTo(e.position);
        if (dist <= 6) {
          logger.warn(`[P0 Survival] Creeper detected ${Math.round(dist)}m away! Fleeing...`);
          state.mood = 'scared';
          return {
            type: 'flee_creeper',
            targetEntity: e,
            message: 'creeper!! nope nope nope!'
          };
        }
      }
    }
  }

  // 2. Health <= 6 -> Low health emergency
  if (health <= 6) {
    state.mood = 'scared';
    return {
      type: 'low_health',
      health: health,
      message: 'taking heavy damage! retreating!'
    };
  }

  // 3. Environmental hazards (in lava / on fire)
  if (bot.entity.isInLava || bot.entity.isOnFire) {
    state.mood = 'scared';
    return {
      type: 'hazard',
      message: 'oof! getting out of danger!'
    };
  }

  return null;
}

async function handleEmergency(bot, emergency, state, sendChatFn) {
  if (!bot || !bot.pathfinder) return;

  if (emergency.type === 'flee_creeper' && emergency.targetEntity) {
    if (emergency.message) sendChatFn(emergency.message);
    const creeperPos = emergency.targetEntity.position;
    const currentPos = bot.entity.position;

    // Calculate opposite vector direction away from creeper
    const dx = currentPos.x - creeperPos.x;
    const dz = currentPos.z - creeperPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const targetX = Math.round(currentPos.x + (dx / dist) * 14);
    const targetZ = Math.round(currentPos.z + (dz / dist) * 14);

    try {
      bot.pathfinder.setGoal(new GoalNear(targetX, Math.round(currentPos.y), targetZ, 2));
    } catch (e) {
      logger.error('[Survival] Flee pathfinding error:', { error: e.message });
    }
  } else if (emergency.type === 'low_health') {
    // Try eating food
    eatFoodIfAvailable(bot);
    if (state.home) {
      try {
        bot.pathfinder.setGoal(new GoalNear(state.home.x, state.home.y, state.home.z, 2));
      } catch {}
    }
  } else if (emergency.type === 'hazard') {
    eatFoodIfAvailable(bot);
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 500);
  }
}

function eatFoodIfAvailable(bot) {
  if (!bot || !bot.inventory) return false;
  const foodItems = ['bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'baked_potato', 'apple', 'carrot'];
  const item = bot.inventory.items().find(i => foodItems.includes(i.name));
  if (item) {
    try {
      bot.equip(item, 'hand').then(() => {
        bot.consume().catch(() => {});
      }).catch(() => {});
      return true;
    } catch {}
  }
  return false;
}

module.exports = {
  checkSurvivalEmergency,
  handleEmergency,
  eatFoodIfAvailable
};
