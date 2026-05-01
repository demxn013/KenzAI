// modules/data/cache.js
// ✅ UPDATED: Added court_request ticket counter

const fs = require("fs");
const path = require("path");

const cachePath = path.join(__dirname, "cache.json");
if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, "{}");

function readCache() {
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function writeCache(data) {
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

module.exports = {
  get(channelId) {
    const cache = readCache();
    return cache[channelId] || null;
  },

  set(channelId, data) {
    const cache = readCache();
    cache[channelId] = data;
    writeCache(cache);
  },

  delete(channelId) {
    const cache = readCache();
    delete cache[channelId];
    writeCache(cache);
  },

  getAll() {
    return readCache();
  },

  getNextNumber(type, scopeId = null) {
    const cache = readCache();

    // Ensure counters object exists (keep existing data if present)
    if (!cache.__counters) {
      cache.__counters = {
        application: 0,
        normal: 0,
        court_request: 0 // ✅ Court request counter (global fallback)
      };
    }

    // If a scopeId is provided (e.g., per-clan/guild), create a scoped key
    // This keeps existing global counters untouched and adds new per-scope ones.
    const key = scopeId ? `${type}:${scopeId}` : type;

    cache.__counters[key] = (cache.__counters[key] || 0) + 1;
    writeCache(cache);

    return cache.__counters[key];
  }
};