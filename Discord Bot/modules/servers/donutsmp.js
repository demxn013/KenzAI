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
  const res = await request(`/v1/stats/${encoded}`);
  if (!res.ok) {
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (result == null) return { ok: false, message: res.body?.message || "No stats for this player." };
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
  const res = await request(`/v1/lookup/${encoded}`);
  if (!res.ok) {
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (result == null) return { ok: false, message: res.body?.message || "Player not found." };
  return { ok: true, lookup: result };
}

/**
 * Get a leaderboard page.
 * @param {string} type - e.g. kills, deaths, money, playtime, shards
 * @param {number} page - Page number (1-based)
 * @returns {Promise<{ ok: boolean, result?: Array<{username, uuid, value}>, message?: string }>}
 */
async function getLeaderboard(type, page = 1) {
  const res = await request(`/v1/leaderboards/${type}/${page}`);
  if (!res.ok) {
    return { ok: false, message: res.body?.message || res.body?.reason || `HTTP ${res.status}` };
  }
  if (res.status === 401) return { ok: false, message: "DonutSMP API key missing or invalid." };
  const result = res.body?.result;
  if (!Array.isArray(result)) return { ok: false, message: "Invalid leaderboard response." };
  return { ok: true, result };
}

module.exports = {
  getPlayerStats,
  getPlayerLookup,
  getLeaderboard,
  getApiKey
};
