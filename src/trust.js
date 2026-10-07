'use strict';

const configMgr = require('./configManager');

const TRUST_LEVELS = {
  OWNER: 3,
  TRUSTED: 2,
  STRANGER: 1
};

function getTrustLevel(username) {
  if (!username) return 'STRANGER';
  const owner = (configMgr.config.owner || '').toLowerCase();
  const lowerUser = username.toLowerCase();

  if (lowerUser === owner) {
    return 'OWNER';
  }

  const trustedList = (configMgr.config.trusted || []).map(u => u.toLowerCase());
  if (trustedList.includes(lowerUser)) {
    return 'TRUSTED';
  }

  return 'STRANGER';
}

function isActionAllowed(username, action, args = {}) {
  const trust = getTrustLevel(username);
  
  if (trust === 'OWNER') {
    return { allowed: true };
  }

  // Owner controls
  if (action === 'owner_control') {
    return { allowed: false, reason: "sorry, only my owner can tell me to do that." };
  }

  if (trust === 'TRUSTED') {
    // Trusted players can request most actions except owner settings
    const restrictedForTrusted = ['set_home', 'set_bed', 'pause_schedule', 'resume_schedule', 'dry_run'];
    if (restrictedForTrusted.includes(action)) {
      return { allowed: false, reason: "sorry, that's an owner-only control." };
    }
    return { allowed: true };
  }

  // STRANGER restrictions
  const allowedForStranger = [
    'hold', 'chat', 'say', 'status', 'follow', 'come', 'look_at', 'stop', 'ask_location', 'ask_player_for'
  ];

  if (allowedForStranger.includes(action)) {
    if (action === 'hold' && args.item) {
      // Basic item check for stranger
      return { allowed: true };
    }
    return { allowed: true };
  }

  // Restricted actions for strangers
  const strangerRefusals = {
    drop: "sorry, can't drop my items for strangers.",
    give: "sorry, I can't give away my gear to strangers.",
    store_items: "sorry, can't mess with chests for strangers.",
    attack: "sorry, I only attack mobs unless my owner says otherwise.",
    harvest_farm: "sorry, the farm is for friends and the village.",
    plant_farm: "sorry, can't let strangers change my farm."
  };

  const reason = strangerRefusals[action] || "sorry, can't do that for strangers.";
  return { allowed: false, reason };
}

module.exports = {
  TRUST_LEVELS,
  getTrustLevel,
  isActionAllowed
};
