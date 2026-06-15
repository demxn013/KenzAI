// modules/data/channels.js
// Channel configuration for KenzAI (points, applications, etc.). Single source for channel IDs and names.

// Persistence is handled by the dual-write MapStore (JSON + MySQL `channels_config`).
// channels.json is a single config object, stored as one row keyed "channels".
const { stores } = require("../database/stores");

function readChannels() {
  return stores.channels_config.readObject();
}

function writeChannels(data) {
  return stores.channels_config.writeObject(data || {});
}

/**
 * Get a nested value by dot path (e.g. "points.staffChannelId").
 */
function get(pathKey) {
  const data = readChannels();
  const keys = pathKey.split(".");
  let v = data;
  for (const k of keys) {
    v = v?.[k];
  }
  return v;
}

/**
 * Set a nested value by dot path. Creates intermediate objects if needed.
 */
function set(pathKey, value) {
  const data = readChannels();
  const keys = pathKey.split(".");
  let current = data;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (current[k] == null || typeof current[k] !== "object") current[k] = {};
    current = current[k];
  }
  current[keys[keys.length - 1]] = value;
  return writeChannels(data);
}

module.exports = {
  readChannels,
  writeChannels,
  get,
  set,
};
