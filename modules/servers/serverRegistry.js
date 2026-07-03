// modules/servers/serverRegistry.js
//
// Small resolver so /server and the stock module never hardcode `donutsmp`.
// It answers two questions the rest of the code branches on:
//   - getServerClient(id): the stats/economy API client module, or null.
//   - hasStatsApi(id):      does this server expose a live stats/economy API?
//
// A server is "label-only" until it has a client here. To bring a server's API
// online later (e.g. ElementalMC), do two things and NOTHING else changes:
//   1. add its client module to CLIENTS below, and
//   2. add `apiBaseUrl`/`apiKeyEnv` to its servers.json entry (the client reads
//      those). hasStatsApi() then flips true and the stats/auto-confirm paths
//      light up automatically — no branch rewrites in /server or /stock.

const { stores } = require("../database/stores");

// API client modules, keyed by server id. Only servers with a live stats API
// appear here; ElementalMC/FreshSMP are label-only today (no entry).
const CLIENTS = {
  donutsmp: require("./donutsmp"),
};

function readServers() {
  return stores.servers.readMap();
}

/** The API client module for a server id, or null if it's label-only. */
function getServerClient(serverId) {
  return (serverId && CLIENTS[serverId]) || null;
}

/**
 * Does this server expose a stats/economy API we can call? True only when a
 * client module is registered (the client is what the stats/auto-confirm paths
 * actually need). The servers.json `apiBaseUrl` is the client's config knob.
 */
function hasStatsApi(serverId) {
  return !!getServerClient(serverId);
}

/** Friendly display name from servers.json (falls back to the id). */
function serverDisplayName(serverId) {
  const all = readServers();
  const s = serverId && all && all[serverId];
  return (s && typeof s === "object" && s.name) || serverId;
}

/** Currency label from servers.json (falls back to "<Name> money"). */
function serverCurrencyName(serverId) {
  const all = readServers();
  const s = serverId && all && all[serverId];
  if (s && typeof s === "object" && s.currencyName) return s.currencyName;
  return `${serverDisplayName(serverId)} money`;
}

/** Enabled servers as { id, name } — the set a clan can link to / that /server lists. */
function listServers() {
  const all = readServers();
  return Object.entries(all)
    .filter(([key, s]) => key !== "statEmojis" && s && typeof s === "object" && s.enabled !== false)
    .map(([id, s]) => ({ id, name: (s && s.name) || id }));
}

/** Is a clan linked to this server? DonutSMP uses donutsmpTeamName; others use serverLinks. */
function isClanLinkedToServer(clan, serverId) {
  if (!clan || !serverId) return false;
  if (serverId === "donutsmp") return !!clan.donutsmpTeamName;
  return Array.isArray(clan.serverLinks) && clan.serverLinks.includes(serverId);
}

module.exports = {
  getServerClient,
  hasStatsApi,
  serverDisplayName,
  serverCurrencyName,
  listServers,
  isClanLinkedToServer,
};
