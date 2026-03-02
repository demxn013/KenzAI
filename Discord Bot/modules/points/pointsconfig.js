// modules/points/pointsconfig.js
// Rewards catalog and promotion blocklist. Do NOT add any reward that grants promotion roles.

const { ROLES, YAZANAKI_EMPIRE_GUILD_ID } = require("../empire/draftconfig");

// Role IDs that must NEVER be granted via points (promotion/rank roles)
const PROMOTION_ROLE_IDS = new Set([
  ROLES.CITIZEN,
  ROLES.IMPERIAL_ARMY,
  ROLES.DRAFT,
  ROLES.MILITARY,
]);

const YAZANAKI_GUILD_ID = YAZANAKI_EMPIRE_GUILD_ID;

// Message points: only in these channel IDs (empty = no message points). From channels.json or env.
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

// Predefined color roles (Discord role IDs in Yazanaki Empire). Add your server's cosmetic role IDs.
// Members can spend 150 pts to get one of these. Leave empty if not configured.
const COLOR_ROLE_IDS = [];

const REWARDS = [
  // ---- Discord (bot-delivered) ----
  { id: "custom_role", name: "Custom Role", cost: 300, type: "custom_role", category: "discord" },
  { id: "nickname", name: "Nickname Change", cost: 200, type: "nickname", category: "discord" },
  { id: "color_role", name: "Color Role", cost: 150, type: "color_role", category: "discord", roleIds: COLOR_ROLE_IDS },
  // ---- In-game (loot & money, staff-fulfilled) ----
  { id: "currency", name: "In-game Currency", cost: 500, type: "in_game", category: "in_game" },
  { id: "currency_large", name: "In-game Currency (Larger)", cost: 750, type: "in_game", category: "in_game" },
  { id: "ender_pearls", name: "2 Stacks Ender Pearls", cost: 200, type: "in_game", category: "in_game" },
  { id: "totems", name: "9 Totems", cost: 400, type: "in_game", category: "in_game" },
  { id: "diamond_armor", name: "Maxed Diamond Armor Set", cost: 600, type: "in_game", category: "in_game" },
  { id: "sword", name: "Maxed Sword", cost: 400, type: "in_game", category: "in_game" },
  { id: "axe", name: "Maxed Axe", cost: 400, type: "in_game", category: "in_game" },
  { id: "pickaxe", name: "Maxed Pickaxe", cost: 400, type: "in_game", category: "in_game" },
  { id: "netherite_armor", name: "Maxed Netherite Armor Set", cost: 1000, type: "in_game", category: "in_game" },
  { id: "beacon", name: "Beacon", cost: 1200, type: "in_game", category: "in_game" },
  { id: "spawner", name: "Spawner", cost: 1500, type: "in_game", category: "in_game" },
  // ---- Clan services ----
  { id: "custom_build", name: "Custom Build", cost: 5000, type: "clan_service", category: "clan" },
];

function getRewardById(id) {
  return REWARDS.find((r) => r.id === id);
}

function getRewardsByCategory(category) {
  return REWARDS.filter((r) => r.category === category);
}

function isPromotionRoleId(roleId) {
  return PROMOTION_ROLE_IDS.has(roleId);
}

module.exports = {
  REWARDS,
  PROMOTION_ROLE_IDS,
  YAZANAKI_GUILD_ID,
  POINTS_MESSAGE_CHANNEL_IDS,
  DAILY_MESSAGE_CAP,
  POINTS_PER_MESSAGE,
  VOICE_POINTS_PER_10_MIN,
  DAILY_VOICE_CAP,
   POINTS_PER_INVITE,
  getRewardById,
  getRewardsByCategory,
  isPromotionRoleId,
};
