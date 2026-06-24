// modules/points/pointsconfig.js
// Points EARNING configuration (message/voice/invite) + the promotion blocklist.
// The shop catalog (badges & cosmetics) now lives in the DB — see modules/cosmetics/.

const { ROLES, YAZANAKI_EMPIRE_GUILD_ID } = require("../empire/draftconfig");

// Role IDs that must NEVER be granted via points (promotion/rank roles)
const PROMOTION_ROLE_IDS = new Set([
  ROLES.CITIZEN,
  ROLES.IMPERIAL_ARMY,
  ROLES.DRAFT,
  ROLES.MILITARY,
]);

const YAZANAKI_GUILD_ID = YAZANAKI_EMPIRE_GUILD_ID;

// Message points config
const channelsData = (() => {
  try {
    const ch = require("../data/channels");
    const ids = ch.get("points.messageChannelIds");
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
})();
const POINTS_MESSAGE_CHANNEL_IDS = process.env.POINTS_MESSAGE_CHANNEL_IDS
  ? process.env.POINTS_MESSAGE_CHANNEL_IDS.split(",").map((s) => s.trim())
  : channelsData;
const DAILY_MESSAGE_CAP = 30;
const POINTS_PER_MESSAGE = 1;

// Voice points: 2 pts per 10 minutes, cap 50/day
const VOICE_POINTS_PER_10_MIN = 2;
const DAILY_VOICE_CAP = 50;

// Invite points: per successful recruit via personal invite link
const POINTS_PER_INVITE = 5;

// NOTE: The points shop catalog (badges & cosmetics) now lives in the database
// and is managed via the /catalog admin command — see modules/cosmetics/.
// This file only holds points EARNING configuration + the promotion blocklist.

function isPromotionRoleId(roleId) {
  return PROMOTION_ROLE_IDS.has(roleId);
}

module.exports = {
  PROMOTION_ROLE_IDS,
  YAZANAKI_GUILD_ID,
  POINTS_MESSAGE_CHANNEL_IDS,
  DAILY_MESSAGE_CAP,
  POINTS_PER_MESSAGE,
  VOICE_POINTS_PER_10_MIN,
  DAILY_VOICE_CAP,
  POINTS_PER_INVITE,
  isPromotionRoleId,
};