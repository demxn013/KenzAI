// modules/points/pointsconfig.js
// Rewards catalog and promotion blocklist.
// Rewards now include optional categoryRequirements (hidden from users).

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

// Color roles (cosmetic role IDs in Yazanaki Empire). Add your server's cosmetic role IDs.
const COLOR_ROLE_IDS = [];

/**
 * categoryRequirements: hidden thresholds per category that must be met
 * alongside the total cost. Not shown to users.
 * deductMap: how points are deducted per category on purchase.
 * If deductMap is omitted, proportional deduction is used.
 */
const REWARDS = [
  // ---- Discord (bot-delivered) ----
  {
    id: "custom_role",
    name: "Custom Role",
    cost: 300,
    type: "custom_role",
    category: "discord",
    categoryRequirements: { activity: 100, contribution: 50 },
    deductMap: { activity: 150, contribution: 100, skill: 50 }
  },
  {
    id: "nickname",
    name: "Nickname Change",
    cost: 200,
    type: "nickname",
    category: "discord",
    categoryRequirements: { activity: 50 },
    deductMap: { activity: 100, contribution: 100 }
  },
  {
    id: "color_role",
    name: "Color Role",
    cost: 150,
    type: "color_role",
    category: "discord",
    roleIds: COLOR_ROLE_IDS,
    categoryRequirements: { activity: 50 },
    deductMap: { activity: 150 }
  },
  // ---- In-game (staff-fulfilled) ----
  {
    id: "currency",
    name: "In-game Currency",
    cost: 500,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { contribution: 100 },
    deductMap: { contribution: 250, activity: 150, skill: 100 }
  },
  {
    id: "currency_large",
    name: "In-game Currency (Larger)",
    cost: 750,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { contribution: 200 },
    deductMap: { contribution: 400, activity: 200, skill: 150 }
  },
  {
    id: "ender_pearls",
    name: "2 Stacks Ender Pearls",
    cost: 200,
    type: "in_game",
    category: "in_game",
    categoryRequirements: {},
    deductMap: { activity: 100, contribution: 100 }
  },
  {
    id: "totems",
    name: "9 Totems",
    cost: 400,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 50 },
    deductMap: { skill: 200, activity: 100, contribution: 100 }
  },
  {
    id: "diamond_armor",
    name: "Maxed Diamond Armor Set",
    cost: 600,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 100, development: 50 },
    deductMap: { skill: 300, development: 150, activity: 150 }
  },
  {
    id: "sword",
    name: "Maxed Sword",
    cost: 400,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 75 },
    deductMap: { skill: 200, activity: 100, contribution: 100 }
  },
  {
    id: "axe",
    name: "Maxed Axe",
    cost: 400,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 75 },
    deductMap: { skill: 200, activity: 100, contribution: 100 }
  },
  {
    id: "pickaxe",
    name: "Maxed Pickaxe",
    cost: 400,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 75 },
    deductMap: { skill: 200, activity: 100, contribution: 100 }
  },
  {
    id: "netherite_armor",
    name: "Maxed Netherite Armor Set",
    cost: 1000,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { skill: 200, development: 100 },
    deductMap: { skill: 500, development: 300, activity: 200 }
  },
  {
    id: "beacon",
    name: "Beacon",
    cost: 1200,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { development: 200, contribution: 150 },
    deductMap: { development: 500, contribution: 400, activity: 300 }
  },
  {
    id: "spawner",
    name: "Spawner",
    cost: 1500,
    type: "in_game",
    category: "in_game",
    categoryRequirements: { development: 300, contribution: 200 },
    deductMap: { development: 700, contribution: 500, activity: 300 }
  },
  // ---- Clan services ----
  {
    id: "custom_build",
    name: "Custom Build",
    cost: 5000,
    type: "clan_service",
    category: "clan",
    categoryRequirements: { development: 1000, contribution: 1000, activity: 500 },
    deductMap: { development: 2000, contribution: 2000, activity: 1000 }
  },
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