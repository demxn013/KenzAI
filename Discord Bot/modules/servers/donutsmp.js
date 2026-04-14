// modules/servers/donutsmp.js
// DonutSMP Public API client (https://api.donutsmp.net)

const https = require("https");
const {
  formatMoney,
  formatPlaytime,
  parsePlaytimeToMinutes,
  fieldName,
  escapeDiscord
} = require("./serverembed");

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
 * NOTE: stats.playtime is returned by the DonutSMP API in MILLISECONDS.
 * Use parsePlaytimeToMinutes() to convert before displaying.
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

/**
 * Try to get the in-game team roster from DonutSMP (if the API supports it).
 * @param {string} teamName - In-game team name (e.g. ONF)
 * @returns {Promise<{ ok: boolean, usernames?: string[] }>}
 */
async function getTeamRoster(teamName) {
  if (!teamName || !String(teamName).trim()) return { ok: false };
  const encoded = encodeURIComponent(String(teamName).trim());
  console.log(`[donutsmp] 🌐 API: getTeamRoster("${teamName}")`);
  const res = await request(`/v1/team/${encoded}`);
  if (!res.ok || res.status !== 200) {
    console.log(`[donutsmp] ℹ️ getTeamRoster("${teamName}"): not available (${res.status})`);
    return { ok: false };
  }
  const body = res.body;
  let list = body?.result ?? body?.players ?? body?.members ?? body;
  if (!Array.isArray(list)) list = null;
  if (!list || list.length === 0) {
    console.log(`[donutsmp] ℹ️ getTeamRoster("${teamName}"): empty or invalid response`);
    return { ok: false };
  }
  const usernames = list.map((entry) => (typeof entry === "string" ? entry : entry?.username ?? entry?.name)).filter(Boolean);
  if (usernames.length === 0) {
    console.log(`[donutsmp] ℹ️ getTeamRoster("${teamName}"): no usernames in response`);
    return { ok: false };
  }
  console.log(`[donutsmp] ✅ getTeamRoster("${teamName}"): ${usernames.length} player(s)`);
  return { ok: true, usernames };
}

/** Default embed color for DonutSMP (0xED6B23). */
const defaultEmbedColor = 0xED6B23;

/**
 * Build embed fields for team (clan) stats.
 *
 * summed.playtime is already in MINUTES — it was accumulated via parsePlaytimeToMinutes()
 * in server.js before being stored in playtimeMinutes.total.
 * We call formatPlaytime() directly here; no second conversion.
 *
 * @param {object} summed - { kills, deaths, money, playtime (minutes already), shards, mobs_killed }
 * @param {Array} [highlights]
 * @param {object} [statEmojis]
 * @returns {Array<{ name: string, value: string, inline: boolean }>}
 */
function getTeamEmbedFields(summed, highlights = [], statEmojis = null) {
  const e = (key, label) => fieldName(key, label, statEmojis);

  // summed.playtime is already in minutes (accumulated via parsePlaytimeToMinutes in server.js)
  const playtimeMinutes = typeof summed.playtime === "number" ? summed.playtime : 0;
  const playtimeDisplay = formatPlaytime(playtimeMinutes);

  return [
    { name: e("kills", "Kills"), value: `\`${summed.kills ?? 0}\``, inline: true },
    { name: e("deaths", "Deaths"), value: `\`${summed.deaths ?? 0}\``, inline: true },
    { name: e("money", "Money"), value: `\`${formatMoney(summed.money)}\``, inline: true },
    { name: e("playtime", "Playtime"), value: `\`${playtimeDisplay}\``, inline: true },
    { name: e("shards", "Shards"), value: `\`${summed.shards ?? 0}\``, inline: true },
    { name: e("mobs_killed", "Mobs killed"), value: `\`${summed.mobs_killed ?? 0}\``, inline: true }
  ];
}

/**
 * Build embed fields for single player stats.
 *
 * stats.playtime is the raw MILLISECOND value from the DonutSMP API.
 * We call parsePlaytimeToMinutes() here to convert ms -> minutes before formatting.
 *
 * @param {object} stats - from API (playtime in MILLISECONDS)
 * @param {object} [lookup] - from API (location, rank)
 * @param {object} [statEmojis]
 * @returns {Array<{ name: string, value: string, inline: boolean }>}
 */
function getPlayerEmbedFields(stats, lookup = null, statEmojis = null) {
  const safe = (s) => (s != null && s !== "" ? String(s) : "0");
  const e = (key, label) => fieldName(key, label, statEmojis);

  // Convert raw milliseconds from the API to minutes, then format for display.
  const playtimeMins = parsePlaytimeToMinutes(stats?.playtime);
  const playtimeDisplay = formatPlaytime(playtimeMins);

  return [
    { name: e("kills", "Kills"), value: `\`${safe(stats?.kills)}\``, inline: true },
    { name: e("deaths", "Deaths"), value: `\`${safe(stats?.deaths)}\``, inline: true },
    { name: e("money", "Money"), value: `\`${formatMoney(stats?.money)}\``, inline: true },
    { name: e("playtime", "Playtime"), value: `\`${playtimeDisplay}\``, inline: true },
    { name: e("shards", "Shards"), value: `\`${safe(stats?.shards)}\``, inline: true },
    {
      name: e("online", "Online"),
      value: lookup?.location ? `\`Online\` (${escapeDiscord(lookup.location)})` : "`Offline`",
      inline: true
    },
    { name: e("broken_blocks", "Broken blocks"), value: `\`${safe(stats?.broken_blocks)}\``, inline: true },
    { name: e("placed_blocks", "Placed blocks"), value: `\`${safe(stats?.placed_blocks)}\``, inline: true },
    { name: e("mobs_killed", "Mobs killed"), value: `\`${safe(stats?.mobs_killed)}\``, inline: true }
  ];
}

/**
 * Footer text for team embed based on roster source.
 * @param {string} rosterSource - "api" | "members"
 * @returns {string}
 */
function getTeamEmbedFooter(rosterSource) {
  return rosterSource === "api"
    ? "DonutSMP team stats (in-game team roster from API)"
    : "DonutSMP team stats (summed from accepted clan members)";
}

/**
 * Options for clan select embed (createClanSelectEmbed).
 */
function getClanSelectOptions() {
  return {
    emptyMessage:
      "No clans linked to DonutSMP yet. Use `/clan edit` to set a DonutSMP team name for a clan.",
    clickMessage: "Click a button to view that clan's DonutSMP team stats.",
    footer: "DonutSMP"
  };
}

module.exports = {
  getPlayerStats,
  getPlayerLookup,
  getLeaderboard,
  getTeamRoster,
  getApiKey,
  defaultEmbedColor,
  getTeamEmbedFields,
  getPlayerEmbedFields,
  getTeamEmbedFooter,
  getClanSelectOptions
};