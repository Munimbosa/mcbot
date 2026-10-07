'use strict';

const { goals: { GoalNear, GoalFollow } } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');
const logger = require('./logger');

const ITEM_ALIASES = {
  'torch': 'torch', 'torches': 'torch',
  'wood': 'oak_log', 'log': 'oak_log', 'logs': 'oak_log', 'oak_log': 'oak_log',
  'spruce_wood': 'spruce_log', 'spruce_log': 'spruce_log', 'spruce': 'spruce_log',
  'birch_wood': 'birch_log', 'birch_log': 'birch_log', 'birch': 'birch_log',
  'seed': 'wheat_seeds', 'seeds': 'wheat_seeds', 'wheat_seeds': 'wheat_seeds',
  'bread': 'bread', 'wheat': 'wheat',
  'iron': 'iron_ingot', 'coal': 'coal', 'stone': 'cobblestone', 'cobblestone': 'cobblestone', 'dirt': 'dirt'
};

function normalizeItemName(name) {
  if (!name) return 'oak_log';
  const lower = String(name).toLowerCase().trim().replace(/ /g, '_');
  return ITEM_ALIASES[lower] || lower;
}

function findPlayerEntity(bot, username) {
  if (!bot || !bot.players || !username) return null;
  const search = username.toLowerCase().replace(/^[@\.]/, '');
  
  for (const name of Object.keys(bot.players)) {
    const cleanName = name.toLowerCase().replace(/^[\.]/, '');
    if (name.toLowerCase() === search || cleanName === search) {
      const p = bot.players[name];
      if (p && p.entity) return p;
    }
  }
  return null;
}

async function equipBestTool(bot, blockName) {
  if (!bot || !bot.inventory) return;
  const items = bot.inventory.items();
  let tool = null;

  if (blockName.includes('log') || blockName.includes('wood')) {
    tool = items.find(i => i.name.endsWith('_axe'));
  } else if (blockName.includes('stone') || blockName.includes('ore') || blockName.includes('cobblestone')) {
    tool = items.find(i => i.name.endsWith('_pickaxe'));
  } else if (blockName.includes('dirt') || blockName.includes('grass')) {
    tool = items.find(i => i.name.endsWith('_shovel'));
  }

  if (tool) {
    try { await bot.equip(tool, 'hand'); } catch {}
  }
}

async function collectItemFromWorld(bot, itemName, count = 2, sendChatFn) {
  if (!bot || !bot.entity) return false;

  const itemWanted = normalizeItemName(itemName);
  if (typeof sendChatFn === 'function') {
    sendChatFn(`Looking for ${itemWanted.replace(/_/g, ' ')}...`);
  }

  let blockMatcher;
  if (itemWanted.includes('log')) {
    blockMatcher = (b) => b && b.name && b.name.endsWith('_log');
  } else if (itemWanted.includes('stone') || itemWanted.includes('cobblestone')) {
    blockMatcher = (b) => b && b.name && (b.name === 'stone' || b.name === 'cobblestone');
  } else if (itemWanted.includes('seed') || itemWanted.includes('wheat')) {
    blockMatcher = (b) => b && b.name && (b.name === 'wheat' || b.name === 'tall_grass' || b.name === 'grass_block');
  } else {
    blockMatcher = (b) => b && b.name && b.name.includes(itemWanted.replace('_log', ''));
  }

  let collected = 0;
  for (let i = 0; i < count; i++) {
    const block = bot.findBlock({ matching: blockMatcher, maxDistance: 48 });
    if (!block) break;

    try {
      await bot.pathfinder.goto(new GoalNear(block.position.x, block.position.y, block.position.z, 1));
      await equipBestTool(bot, block.name);
      await bot.dig(block);
      collected++;
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      logger.warn(`Failed to mine block at ${block.position}: ${err.message}`);
      break;
    }
  }

  return collected > 0;
}

async function deliverItemToPlayer(bot, itemWanted, count, targetPlayerName, sendChatFn) {
  const player = findPlayerEntity(bot, targetPlayerName);
  if (!player || !player.entity) {
    if (typeof sendChatFn === 'function') sendChatFn(`I have the items, but I can't see ${targetPlayerName} nearby.`);
    return false;
  }

  const normalized = normalizeItemName(itemWanted);
  const itemInInv = bot.inventory.items().find(i => i.name.includes(normalized) || i.name.includes(itemWanted));
  if (!itemInInv) {
    if (typeof sendChatFn === 'function') sendChatFn(`I don't have ${itemWanted.replace(/_/g, ' ')} in my inventory.`);
    return false;
  }

  try {
    const pPos = player.entity.position;
    if (typeof sendChatFn === 'function') sendChatFn(`Bringing ${count} ${itemInInv.name.replace(/_/g, ' ')} to ${player.username}...`);
    await bot.pathfinder.goto(new GoalNear(pPos.x, pPos.y, pPos.z, 2));
    await bot.toss(itemInInv.type, null, Math.min(count, itemInInv.count));
    if (typeof sendChatFn === 'function') sendChatFn(`Here you go, ${player.username}!`);
    return true;
  } catch (err) {
    logger.error('Failed to deliver item to player:', { error: err.message });
    return false;
  }
}

async function executeAction(bot, actionObj, sender, state, sendChatFn) {
  if (!bot || !actionObj || !actionObj.action) return { success: false };

  const action = String(actionObj.action).toLowerCase();
  const args = actionObj.args || {};

  // Resolve "me", "my", "I" to sender
  if (args.target === 'me' || args.target === 'my' || args.target === 'I' || !args.target) {
    args.target = sender;
  }

  logger.info(`[ActionEngine] Executing: ${action}`, { args, sender });

  try {
    switch (action) {
      case 'jump': {
        const count = Math.min(Number(args.count) || 1, 10);
        if (typeof sendChatFn === 'function') sendChatFn(`Jumping ${count} time${count > 1 ? 's' : ''}!`);
        for (let i = 0; i < count; i++) {
          bot.setControlState('jump', true);
          await new Promise(r => setTimeout(r, 400));
          bot.setControlState('jump', false);
          await new Promise(r => setTimeout(r, 400));
        }
        return { success: true };
      }

      case 'collect':
      case 'get':
      case 'bring': {
        const itemWanted = normalizeItemName(args.item || 'spruce_log');
        const count = Number(args.count) || 2;
        const targetPlayer = args.target || sender;

        let itemInInv = bot.inventory.items().find(i => i.name.includes(itemWanted) || i.name.includes('log'));
        if (!itemInInv || itemInInv.count < count) {
          await collectItemFromWorld(bot, itemWanted, count, sendChatFn);
          itemInInv = bot.inventory.items().find(i => i.name.includes(itemWanted) || i.name.includes('log'));
        }

        if (itemInInv) {
          await deliverItemToPlayer(bot, itemWanted, count, targetPlayer, sendChatFn);
          return { success: true };
        } else {
          if (typeof sendChatFn === 'function') sendChatFn(`Sorry, couldn't find any ${args.item || 'wood'} nearby.`);
          return { success: false };
        }
      }

      case 'hold':
      case 'equip': {
        const itemWanted = normalizeItemName(args.item || 'torch');
        const item = bot.inventory.items().find(i => i.name.includes(itemWanted) || i.name.includes(args.item));
        if (!item) {
          if (typeof sendChatFn === 'function') sendChatFn(`I don't have ${args.item || 'that item'} in my inventory.`);
          return { success: false };
        }
        await bot.equip(item, 'hand');
        if (typeof sendChatFn === 'function') sendChatFn(`Holding ${item.name.replace(/_/g, ' ')}.`);
        return { success: true };
      }

      case 'follow': {
        const targetPlayer = findPlayerEntity(bot, args.target || sender);
        if (!targetPlayer || !targetPlayer.entity) {
          if (typeof sendChatFn === 'function') sendChatFn(`I can't see ${args.target || sender} right now.`);
          return { success: false };
        }
        state.followingTarget = targetPlayer.username;
        bot.pathfinder.setGoal(new GoalFollow(targetPlayer.entity, 2), true);
        if (typeof sendChatFn === 'function') sendChatFn(`Following ${targetPlayer.username}! Say "stop" when done.`);
        return { success: true };
      }

      case 'stop': {
        state.followingTarget = null;
        bot.pathfinder.stop();
        if (typeof sendChatFn === 'function') sendChatFn('Stopped all tasks. Resuming my daily schedule!');
        return { success: true };
      }

      case 'come': {
        const targetPlayer = findPlayerEntity(bot, args.target || sender);
        if (!targetPlayer || !targetPlayer.entity) {
          if (typeof sendChatFn === 'function') sendChatFn(`I can't see ${args.target || sender} right now. Step closer!`);
          return { success: false };
        }
        const pos = targetPlayer.entity.position;
        bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 2));
        if (typeof sendChatFn === 'function') sendChatFn(`Coming right over to ${targetPlayer.username}!`);
        return { success: true };
      }

      case 'goto': {
        if (args.target === 'home' && state.home) {
          bot.pathfinder.setGoal(new GoalNear(state.home.x, state.home.y, state.home.z, 2));
          if (typeof sendChatFn === 'function') sendChatFn('Heading home.');
          return { success: true };
        }
        if (args.x !== undefined && args.y !== undefined && args.z !== undefined) {
          bot.pathfinder.setGoal(new GoalNear(Number(args.x), Number(args.y), Number(args.z), 2));
          if (typeof sendChatFn === 'function') sendChatFn(`Going to X:${args.x} Y:${args.y} Z:${args.z}.`);
          return { success: true };
        }
        const player = findPlayerEntity(bot, args.target || sender);
        if (player && player.entity) {
          const p = player.entity.position;
          bot.pathfinder.setGoal(new GoalNear(p.x, p.y, p.z, 2));
          if (typeof sendChatFn === 'function') sendChatFn(`Heading to ${player.username}.`);
          return { success: true };
        }
        return { success: false };
      }

      case 'sleep': {
        const bed = bot.findBlock({
          matching: block => block && block.name && block.name.endsWith('_bed'),
          maxDistance: 32
        });
        if (!bed) {
          if (typeof sendChatFn === 'function') sendChatFn("I can't find a bed nearby.");
          return { success: false };
        }
        await bot.pathfinder.goto(new GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
        if (!bot.isSleeping) {
          await bot.sleep(bed);
          if (typeof sendChatFn === 'function') sendChatFn('Going to sleep. Goodnight!');
        }
        return { success: true };
      }

      case 'give':
      case 'drop': {
        const rawItem = String(args.item || 'all').toLowerCase();
        const player = findPlayerEntity(bot, sender);

        if (player && player.entity) {
          const pPos = player.entity.position;
          try {
            await bot.pathfinder.goto(new GoalNear(pPos.x, pPos.y, pPos.z, 2));
          } catch {}
        }

        const items = bot.inventory.items();
        if (!items || items.length === 0) {
          if (typeof sendChatFn === 'function') sendChatFn(`My inventory is empty!`);
          return { success: false };
        }

        if (rawItem === 'all' || rawItem === 'everything' || rawItem === 'inventory') {
          let droppedCount = 0;
          for (const item of items) {
            try {
              await bot.toss(item.type, null, item.count);
              droppedCount++;
              await new Promise(r => setTimeout(r, 200));
            } catch {}
          }
          if (typeof sendChatFn === 'function') sendChatFn(`Dropped all items for you!`);
          return { success: true };
        } else {
          const itemWanted = normalizeItemName(rawItem);
          const count = Math.min(Number(args.count) || 8, 64);
          const item = items.find(i => i.name.includes(itemWanted));
          if (!item) {
            if (typeof sendChatFn === 'function') sendChatFn(`I don't have any ${rawItem} in my inventory.`);
            return { success: false };
          }
          await bot.toss(item.type, null, Math.min(count, item.count));
          if (typeof sendChatFn === 'function') sendChatFn(`Dropped ${Math.min(count, item.count)} ${item.name.replace(/_/g, ' ')}.`);
          return { success: true };
        }
      }

      case 'harvest_farm': {
        if (typeof sendChatFn === 'function') sendChatFn('Harvesting crops on the farm...');
        
        let harvestedAny = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const crop = bot.findBlock({
            matching: b => b && b.name && (b.name === 'wheat' || b.name === 'carrots' || b.name === 'potatoes'),
            maxDistance: 32
          });
          if (!crop) break;

          try {
            await bot.pathfinder.goto(new GoalNear(crop.position.x, crop.position.y, crop.position.z, 1));
            await bot.dig(crop);
            harvestedAny = true;
            await new Promise(r => setTimeout(r, 400));

            // Replant
            const seeds = bot.inventory.items().find(i => i.name.includes('seed') || i.name.includes('carrot') || i.name.includes('potato'));
            if (seeds) {
              const farmland = bot.findBlock({ matching: b => b && b.name === 'farmland', maxDistance: 3 });
              if (farmland) {
                await bot.equip(seeds, 'hand');
                await bot.placeBlock(farmland, new Vec3(0, 1, 0));
              }
            }
          } catch (err) {
            break;
          }
        }

        if (harvestedAny) {
          if (typeof sendChatFn === 'function') sendChatFn('Harvested and replanted crops!');
          return { success: true };
        } else {
          if (typeof sendChatFn === 'function') sendChatFn('No grown crops found nearby.');
          return { success: true };
        }
      }

      case 'check_inventory':
      case 'status': {
        const items = bot.inventory.items().map(i => `${i.name.replace(/_/g, ' ')} x${i.count}`);
        if (!items.length) {
          if (typeof sendChatFn === 'function') sendChatFn('My inventory is empty.');
        } else {
          if (typeof sendChatFn === 'function') sendChatFn(`Inventory: ${items.slice(0, 10).join(', ')}`);
        }
        return { success: true };
      }

      case 'chat':
      case 'say': {
        return { success: true };
      }

      default:
        logger.warn(`[ActionEngine] Unsupported action: ${action}`);
        return { success: false };
    }
  } catch (err) {
    logger.error(`[ActionEngine] Action execution failed (${action}):`, { error: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = {
  executeAction,
  normalizeItemName,
  findPlayerEntity,
  collectItemFromWorld,
  deliverItemToPlayer
};
