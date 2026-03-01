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
// Treat a month as 30 days instead of 4 weeks
const MIN_PER_MONTH = 30 * MIN_PER_DAY;
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

/** Parse playtime from API string into total minutes.
 * - If it explicitly contains "min", treat the number as minutes.
 * - Otherwise, DonutSMP's stats API returns the raw Minecraft playtime value in TICKS (1/20s),
 *   so convert ticks -> seconds -> minutes before formatting as y m w d h.
 */
function parsePlaytimeToMinutes(playtimeStr) {
  if (playtimeStr == null || playtimeStr === "") return 0;
  const s = String(playtimeStr).trim();

  const minMatch = s.match(/(\d+)\s*min/i);
  if (minMatch) return parseInt(minMatch[1], 10);

  const numeric = parseFloat(s.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return 0;

  // ticks -> seconds (÷20) -> minutes (÷60)
  const minutes = Math.floor(numeric / (20 * 60));
  return minutes >= 0 ? minutes : 0;
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
 * Generic embed: team stats (summed + optional leaderboard highlights).
 * @param {string} serverDisplayName - e.g. "DonutSMP"
 * @param {string} clanAbbr
 * @param {string} clanName
 * @param {Array<{ name: string, value: string, inline?: boolean }>} fields - produced by server module
 * @param {object} [options] - { highlights?, rosterSource?, embedColor?, footer? }
 */
function createTeamEmbed(serverDisplayName, clanAbbr, clanName, fields, options = {}) {
  const { highlights = [], embedColor, footer } = options;
  const allFields = [...fields];
  if (highlights && highlights.length > 0) {
    const statEmojis = options.statEmojis || null;
    allFields.push({
      name: fieldName("leaderboard", "Leaderboard highlights", statEmojis),
      value: highlights.map((h) => `**${escapeDiscord(h.username)}** — ${h.value} (rank ${h.rank})`).join("\n"),
      inline: false
    });
  }
  const embed = new EmbedBuilder()
    .setTitle(`${escapeDiscord(clanAbbr)}: ${escapeDiscord(clanName)} — ${escapeDiscord(serverDisplayName)}`)
    .addFields(allFields);
  if (embedColor != null) embed.setColor(embedColor);
  if (footer != null && footer !== "") embed.setFooter({ text: footer });
  return embed;
}

/**
 * Generic embed: player stats (single player).
 * @param {string} serverDisplayName - e.g. "DonutSMP"
 * @param {string} mcUsername
 * @param {Array<{ name: string, value: string, inline?: boolean }>} fields - produced by server module
 * @param {object} [options] - { thumbnailUrl?, embedColor?, footer? }
 */
function createPlayerEmbed(serverDisplayName, mcUsername, fields, options = {}) {
  const { thumbnailUrl, embedColor, footer } = options;
  const embed = new EmbedBuilder()
    .setTitle(`${escapeDiscord(mcUsername)} — ${escapeDiscord(serverDisplayName)}`)
    .addFields(fields);
  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (embedColor != null) embed.setColor(embedColor);
  if (footer != null && footer !== "") embed.setFooter({ text: footer });
  return embed;
}

/**
 * Generic embed: "Select a clan" for a server (list of clans linked to that server).
 * @param {string} serverDisplayName - e.g. "DonutSMP"
 * @param {Array<{ guildId: string, abbr: string, name: string }>} clans
 * @param {object} [options] - { emptyMessage?, clickMessage?, footer? }
 */
function createClanSelectEmbed(serverDisplayName, clans, options = {}) {
  const { emptyMessage, clickMessage, footer, embedColor } = options;
  const description =
    clans.length === 0
      ? (emptyMessage != null ? emptyMessage : "No clans linked to this server yet.")
      : (clickMessage != null ? clickMessage : "Click a button to view that clan's team stats.");
  const embed = new EmbedBuilder()
    .setTitle(`${escapeDiscord(serverDisplayName)} — View clan / team`)
    .setDescription(description);
  if (embedColor != null) embed.setColor(embedColor);
  if (footer != null && footer !== "") embed.setFooter({ text: footer });
  return embed;
}

module.exports = {
  createServerListEmbed,
  createTeamEmbed,
  createPlayerEmbed,
  createClanSelectEmbed,
  num,
  formatMoney,
  formatPlaytime,
  parsePlaytimeToMinutes,
  escapeDiscord,
  fieldName
};
