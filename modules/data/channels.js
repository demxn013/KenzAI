// modules/data/channels.js
// Channel configuration for KenzAI (points, applications, etc.). Single source for channel IDs and names.

const fs = require("fs");
const path = require("path");

const channelsPath = path.join(__dirname, "channels.json");

function readChannels() {
  try {
    if (!fs.existsSync(channelsPath)) {
      const defaultData = {
        points: { staffChannelId: null, messageChannelIds: [] },
        applications: { categoryName: "applications" },
      };
      fs.writeFileSync(channelsPath, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    const raw = fs.readFileSync(channelsPath, "utf8");
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[channels] Error reading channels.json:", err);
    return {};
  }
}

function writeChannels(data) {
  try {
    fs.writeFileSync(channelsPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error("[channels] Error writing channels.json:", err);
    return false;
  }
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
