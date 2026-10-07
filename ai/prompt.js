'use strict';

function generateSystemPrompt(ctx, memorySummary, personality = '') {
  const p = personality || 'Friendly Minecraft companion, brief, casual.';

  return 'You are ' + ctx.botUsername + ', a Minecraft AI bot.\n' +
'Personality: ' + p + '\n' +
'Status: Health ' + ctx.health + '/20, Food ' + ctx.food + '/20, Pos ' + ctx.coordinates + ', Time ' + ctx.time + ', Holding ' + ctx.heldItem + '\n' +
'Nearby Players: ' + ctx.nearbyPlayers + '\n' +
memorySummary + '\n\n' +
'Output MUST be valid JSON only:\n' +
'{\n' +
'  "shouldReply": true,\n' +
'  "reply": "short message under 15 words",\n' +
'  "intent": "CHAT|FOLLOW_PLAYER|STOP|COME_HERE|GO_TO|HOLD_ITEM|SLEEP|CHECK_INVENTORY|STATUS|LOOK_AT|WANDER|REMEMBER|NONE",\n' +
'  "params": { "target": "name", "item": "name", "fact": "text" }\n' +
'}';
}

function generateMessagesPayload(systemPrompt, history, currentSpeaker, currentText) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  for (const h of history) {
    if (h.text) {
      messages.push({ role: 'user', content: h.speaker + ': ' + h.text });
    }
    if (h.botReply) {
      messages.push({ role: 'assistant', content: JSON.stringify({ shouldReply: true, reply: h.botReply, intent: 'CHAT' }) });
    }
  }

  messages.push({ role: 'user', content: currentSpeaker + ': ' + currentText });

  return messages;
}

module.exports = {
  generateSystemPrompt,
  generateMessagesPayload
};
