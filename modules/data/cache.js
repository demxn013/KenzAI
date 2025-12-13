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

  getNextNumber(type) {
    const cache = readCache();
    if (!cache.__counters) cache.__counters = { application: 0, normal: 0 };

    cache.__counters[type] = (cache.__counters[type] || 0) + 1;
    writeCache(cache);

    return cache.__counters[type];
  }
};
