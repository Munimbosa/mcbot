'use strict';

function buildMinecraftContext(bot, extraInfo = {}) {
  if (!bot || !bot.entity) {
    return { status: 'Disconnected' };
  }

  const pos = bot.entity.position || { x: 0, y: 0, z: 0 };
  const coords = 'X:' + Math.round(pos.x) + ', Y:' + Math.round(pos.y) + ', Z:' + Math.round(pos.z);

  let isNight = false;
  let timeStr = 'Day';
  if (bot.time && typeof bot.time.timeOfDay === 'number') {
    const t = bot.time.timeOfDay;
    isNight = t >= 12500 && t <= 23500;
    timeStr = isNight ? 'Night' : 'Day';
  }

  const nearbyPlayers = [];
  if (bot.players) {
    for (const name of Object.keys(bot.players)) {
      if (name === bot.username) continue;
      const player = bot.players[name];
      if (player && player.entity && player.entity.position) {
        const dist = Math.round(bot.entity.position.distanceTo(player.entity.position));
        if (dist <= 32) {
          nearbyPlayers.push(name + ' (' + dist + 'm away)');
        }
      }
    }
  }

  const nearbyMobs = [];
  if (bot.entities) {
    for (const id of Object.keys(bot.entities)) {
      const entity = bot.entities[id];
      if (!entity || entity.type !== 'mob' || !entity.position) continue;
      const dist = Math.round(bot.entity.position.distanceTo(entity.position));
      if (dist <= 16) {
        const name = entity.name || entity.mobType || 'mob';
        nearbyMobs.push(name + ' (' + dist + 'm)');
      }
    }
  }

  const inventoryItems = [];
  if (bot.inventory) {
    for (const item of bot.inventory.items()) {
      inventoryItems.push(item.name + ' x' + item.count);
    }
  }

  const heldItem = bot.heldItem ? bot.heldItem.name : 'empty hand';

  return {
    botUsername: bot.username || 'ShekBot',
    health: bot.health !== undefined ? Math.round(bot.health) : 20,
    food: bot.food !== undefined ? Math.round(bot.food) : 20,
    dimension: (bot.game && bot.game.dimension) ? bot.game.dimension : 'overworld',
    coordinates: coords,
    time: timeStr,
    isNight: isNight,
    nearbyPlayers: nearbyPlayers.length ? nearbyPlayers.join(', ') : 'None nearby',
    nearbyMobs: nearbyMobs.slice(0, 5).length ? nearbyMobs.slice(0, 5).join(', ') : 'None nearby',
    heldItem: heldItem,
    inventorySummary: inventoryItems.slice(0, 8).length ? inventoryItems.slice(0, 8).join(', ') : 'Empty',
    currentAction: extraInfo.following ? 'Following ' + extraInfo.following : 'Idle'
  };
}

module.exports = { buildMinecraftContext };
