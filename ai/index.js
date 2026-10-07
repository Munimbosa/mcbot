'use strict';

const AIBrain = require('./brain');

let instance = null;

function getAIBrain(config = {}) {
  if (!instance) {
    instance = new AIBrain(config);
  } else if (config && Object.keys(config).length > 0) {
    instance.updateConfig(config);
  }
  return instance;
}

module.exports = {
  getAIBrain,
  AIBrain
};
