// modules/servers/serverembed.js
const { EmbedBuilder } = require("discord.js");

function escapeDiscord(str) {
  if (typeof str !== "string") return str;
  return str.replace(/_/g, "\\_");
}

function num(s) {
  if (s == null || s === "") return 0;
  const n = parseFloat(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Format a number as money: thousands separators and exactly 2 decimal places (e.g. 50,058,803.23). */
function formatMoney(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return "0.00";
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart != null ? `${withCommas}.${decPart}` : withCommas;
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;
const MIN_PER_WEEK = 7 * MIN_PER_DAY;
const MIN_PER_MONTH = 4 * MIN_PER_WEEK;
const MIN_PER_YEAR = 12 * MIN_PER_MONTH;

/**
 * Format total minutes as Xy Xm Xw Xd Xh (7 days = 1 week, 4 weeks = 1 month, 12 months = 1 year).
 * Only non-zero units are included.
 * @param {number} totalMinutes
 * @returns {string}
 */
function formatPlaytime(totalMinutes) {
  const m = Math.floor(Number(totalMinutes) || 0);
  if (m <= 0) return "0h";
  let rest = m;
  const years = Math.floor(rest / MIN_PER_YEAR);
  rest %= MIN_PER_YEAR;
  const months = Math.floor(rest / MIN_PER_MONTH);
  rest %= MIN_PER_MONTH;
  const weeks = Math.floor(rest / MIN_PER_WEEK);
  rest %= MIN_PER_WEEK;
  const days = Math.floor(rest / MIN_PER_DAY);
  rest %= MIN_PER_DAY;
  const hours = Math.floor(rest / MIN_PER_HOUR);
  const parts = [];
  if (years) parts.push(`${years}y`);
  if (months) parts.push(`${months}m`);
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  return parts.join(" ") || "0h";
}

/** Parse playtime from API string (e.g. "120 min" or "90") into total minutes. */
function parsePlaytimeToMinutes(playtimeStr) {
  if (playtimeStr == null || playtimeStr === "") return 0;
  const s = String(playtimeStr).trim();
  const match = s.match(/(\d+)\s*min/i) || s.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Embed: list of official servers (from servers.json).
 * @param {Array<{id: string, name: string}>} servers
 */
function createServerListEmbed(servers) {
  const embed = new EmbedBuilder()
    .setTitle("Servers Yazanaki is in")
    .setColor(0x5865F2)
    .setDescription(
      servers.length === 0
        ? "No official servers configured."
        : servers.map((s) => `• **${escapeDiscord(s.name)}**`).join("\n")
    )
    .setFooter({ text: "Click a button to view server clans/teams." });
  return embed;
}

/** Prefix a field name with optional emoji from statEmojis[key]. */
function fieldName(key, label, statEmojis) {
  const emoji = statEmojis && statEmojis[key];
  return emoji ? `${emoji} ${label}` : label;
}

/**
 * Embed: DonutSMP team stats (summed + optional leaderboard highlights).
 * @param {string} clanAbbr
 * @param {string} clanName
 * @param {object} summed - { kills, deaths, money, playtime, shards, ... }
 * @param {Array<{username: string, value: string, rank?: number}>} highlights - optional leaderboard entries for this clan
 * @param {object} [statEmojis] - optional map of field keys to emoji strings (e.g. { shards: '<:amethyst:123>', money: '💰' })
 */
function createDonutSMPTeamEmbed(clanAbbr, clanName, summed, highlights = [], statEmojis = null) {
  const playtimeDisplay = typeof summed.playtime === "number"
    ? formatPlaytime(summed.playtime)
    : formatPlaytime(parsePlaytimeToMinutes(summed.playtime));
  const e = (key, label) => fieldName(key, label, statEmojis);
  const fields = [
    { name: e("kills", "Kills"), value: `\`${summed.kills}\``, inline: false },
    { name: e("deaths", "Deaths"), value: `\`${summed.deaths}\``, inline: false },
    { name: e("money", "Money"), value: `\`${formatMoney(summed.money)}\``, inline: false },
    { name: e("playtime", "Playtime"), value: `\`${playtimeDisplay}\``, inline: false },
    { name: e("shards", "Shards"), value: `\`${summed.shards}\``, inline: false },
    { name: e("mobs_killed", "Mobs killed"), value: `\`${summed.mobs_killed}\``, inline: false }
  ];
  if (highlights.length > 0) {
    fields.push({
      name: fieldName("leaderboard", "Leaderboard highlights", statEmojis),
      value: highlights.map((h) => `**${escapeDiscord(h.username)}** — ${h.value} (rank ${h.rank})`).join("\n"),
      inline: false
    });
  }
  return new EmbedBuilder()
    .setTitle(`${escapeDiscord(clanAbbr)}: ${escapeDiscord(clanName)} — DonutSMP`)
    .setColor(0xED6B23)
    .addFields(fields)
    .setFooter({ text: "DonutSMP team stats (summed from clan members)" });
}

/**
 * Embed: DonutSMP player stats (single player).
 * @param {string} mcUsername
 * @param {object} stats - from API (kills, deaths, playtime, money, shards, ...)
 * @param {object} lookup - from API (location, rank) for online status
 * @param {object} [statEmojis] - optional map of field keys to emoji strings (custom or Unicode)
 */
function createDonutSMPPlayerEmbed(mcUsername, stats, lookup = null, statEmojis = null) {
  const safe = (s) => (s != null && s !== "" ? String(s) : "0");
  const playtimeMins = parsePlaytimeToMinutes(stats?.playtime);
  const playtimeDisplay = formatPlaytime(playtimeMins);
  const e = (key, label) => fieldName(key, label, statEmojis);
  const fields = [
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
  return new EmbedBuilder()
    .setTitle(`${escapeDiscord(mcUsername)} — DonutSMP`)
    .setColor(0xED6B23)
    .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(mcUsername)}/100`)
    .addFields(fields)
    .setFooter({ text: "DonutSMP player stats" });
}

/**
 * Embed: "Select a clan" on DonutSMP (list of clans with donutsmpTeamName).
 * @param {Array<{guildId: string, abbr: string, name: string}>} clans
 */
function createDonutSMPClanSelectEmbed(clans) {
  return new EmbedBuilder()
    .setTitle("DonutSMP — View clan / team")
    .setColor(0xED6B23)
    .setDescription(
      clans.length === 0
        ? "No clans linked to DonutSMP yet. Use `/clan edit` to set a DonutSMP team name for a clan."
        : "Click a button to view that clan's DonutSMP team stats."
    )
    .setFooter({ text: "DonutSMP" });
}

module.exports = {
  createServerListEmbed,
  createDonutSMPTeamEmbed,
  createDonutSMPPlayerEmbed,
  createDonutSMPClanSelectEmbed,
  num,
  formatMoney,
  formatPlaytime,
  parsePlaytimeToMinutes,
  escapeDiscord
};
