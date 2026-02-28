// modules/servers/donutsmp.js
// DonutSMP Public API client (https://api.donutsmp.net)

const https = require("https");

const BASE = "https://api.donutsmp.net";

function getApiKey() {
  return process.env.DONUTSMP_API_KEY || "";
}

function request(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const key = getApiKey();
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {}
    };
    if (key) opts.headers["Authorization"] = `Bearer ${key}`;

    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            resolve({ ok: false, status: res.statusCode, body: json });
          } else {
            resolve({ ok: true, status: res.statusCode, body: json });
          }
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, body: { message: data || "Parse error" } });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("DonutSMP API timeout"));
    });
    req.end();
  });
}

/**
 * Get player stats (kills, deaths, playtime, money, shards, etc.)
 * @param {string} username - Minecraft username
 * @returns {Promise<{ ok: boolean, stats?: object, message?: string }>}
 */
async function getPlayerStats(username) {
  if (!username || !username.trim()) return { ok: false, message: "No username" };
  const encoded = encodeURIComponent(username.trim());
  console.log(`[donutsmp] 🌐 API: getPlayerStats("${username.trim()}")`);
  const res = await request(`/v1/stats/${encoded}`);
  if (!res.ok) {
    console.log(`[donutsmp] ❌ getPlayerStats("${username.trim()}"): ${res.status} - ${res.body?.message || res.body?.reason || "error"}`);
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (result == null) {
    console.log(`[donutsmp] ❌ getPlayerStats("${username.trim()}"): no result`);
    return { ok: false, message: res.body?.message || "No stats for this player." };
  }
  console.log(`[donutsmp] ✅ getPlayerStats("${username.trim()}"): ok`);
  return { ok: true, stats: result };
}

/**
 * Get player lookup (username, rank, location for online status)
 * @param {string} username - Minecraft username
 * @returns {Promise<{ ok: boolean, lookup?: object, message?: string }>}
 */
async function getPlayerLookup(username) {
  if (!username || !username.trim()) return { ok: false, message: "No username" };
  const encoded = encodeURIComponent(username.trim());
  console.log(`[donutsmp] 🌐 API: getPlayerLookup("${username.trim()}")`);
  const res = await request(`/v1/lookup/${encoded}`);
  if (!res.ok) {
    console.log(`[donutsmp] ❌ getPlayerLookup("${username.trim()}"): ${res.status} - ${res.body?.message || res.body?.reason || "error"}`);
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (result == null) {
    console.log(`[donutsmp] ❌ getPlayerLookup("${username.trim()}"): no result`);
    return { ok: false, message: res.body?.message || "Player not found." };
  }
  console.log(`[donutsmp] ✅ getPlayerLookup("${username.trim()}"): ok`);
  return { ok: true, lookup: result };
}

/**
 * Get a leaderboard page.
 * @param {string} type - e.g. kills, deaths, money, playtime, shards
 * @param {number} page - Page number (1-based)
 * @returns {Promise<{ ok: boolean, result?: Array<{username, uuid, value}>, message?: string }>}
 */
async function getLeaderboard(type, page = 1) {
  console.log(`[donutsmp] 🌐 API: getLeaderboard("${type}", ${page})`);
  const res = await request(`/v1/leaderboards/${type}/${page}`);
  if (!res.ok) {
    console.log(`[donutsmp] ❌ getLeaderboard("${type}", ${page}): ${res.status} - ${res.body?.message || res.body?.reason || "error"}`);
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (!Array.isArray(result)) {
    console.log(`[donutsmp] ❌ getLeaderboard("${type}", ${page}): invalid response`);
    return { ok: false, message: "Invalid leaderboard response." };
  }
  console.log(`[donutsmp] ✅ getLeaderboard("${type}", ${page}): ${result.length} entries`);
  return { ok: true, result };
}

module.exports = {
  getPlayerStats,
  getPlayerLookup,
  getLeaderboard,
  getApiKey
};
