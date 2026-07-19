// modules/discord/discordconfig.js
// Central constants + per-guild default settings for the all-in-one Discord
// module (moderation/automod, leveling, giveaways, invite tracking, stats).
//
// This module is config-driven and guild-agnostic: nothing here hardcodes a
// specific server. All runtime configuration lives per-guild in the
// `discord_settings` store (see settings/settingsStore.js); the shape below is
// the default that a guild starts from and is deep-merged under any overrides.
//
// Optional env overrides (all have safe defaults — the module works with none):
//   DISCORD_GIVEAWAY_TICK_SECONDS   giveaway auto-end poll interval (default 30)
//   DISCORD_VOICE_TICK_SECONDS      voice-XP accrual flush interval (default 60)

const EMBED_COLORS = {
  brand: 0x5865f2,
  success: 0x57f287,
  warn: 0xfee75c,
  danger: 0xed4245,
  info: 0x5865f2,
  neutral: 0x2b2d31,
};

// customId prefixes routed in events/interactionCreate.js.
const IDS = {
  giveaway: "dgw_", // giveaway entry button / management
  moderation: "dmod_",
  leveling: "dlvl_",
  invites: "dinv_",
  settings: "dset_",
};

const DEFAULT_SETTINGS = {
  moderation: {
    modLogChannelId: null,
    dmOnAction: true, // DM the target when they are warned/muted/kicked/banned
  },
  automod: {
    enabled: false,
    logChannelId: null,
    exemptRoleIds: [], // roles immune to automod
    exemptChannelIds: [],
    antiInvite: { enabled: false, action: "delete" }, // delete | warn | mute
    antiSpam: {
      enabled: false,
      maxMessages: 5,
      intervalMs: 5000,
      action: "mute", // delete | warn | mute
      muteSeconds: 300,
    },
    antiMention: {
      enabled: false,
      maxMentions: 5,
      action: "mute",
      muteSeconds: 600,
    },
    antiCaps: { enabled: false, minLength: 10, percent: 70, action: "delete" },
    wordFilter: { enabled: false, words: [], action: "delete" },
    antiRaid: {
      enabled: false,
      joinCount: 10, // this many joins...
      intervalMs: 10000, // ...within this window triggers a raid alert/lockdown
      action: "alert", // alert | kick | ban
    },
  },
  leveling: {
    enabled: false,
    xpPerMessageMin: 15,
    xpPerMessageMax: 25,
    messageCooldownSeconds: 60,
    voiceXpPerMinute: 5,
    countAfkChannel: false,
    countMutedVoice: false,
    announceLevelUp: true,
    // Where to announce: "current" (same channel), "dm", or a channel id.
    announceTarget: "current",
    levelUpMessage: "GG {user}, you just reached level **{level}**! 🎉",
    noXpChannelIds: [],
    noXpRoleIds: [],
    stackRewards: true, // keep lower reward roles when a higher one is earned
    roleRewards: {}, // { "5": "<roleId>", "10": "<roleId>" }
    multiplierRoles: {}, // { "<roleId>": 2 }  (XP multiplier while holding role)
  },
  giveaways: {
    hostRoleIds: [], // may run /giveaway in addition to Manage Server perm
    emoji: "🎉",
  },
  invites: {
    enabled: false,
    fakeAccountAgeDays: 7, // joiner account younger than this counts as "fake"
    joinLogChannelId: null, // posts "X joined — invited by Y (N invites)"
    rewards: {}, // { "10": "<roleId>" }  role granted at N real invites
  },
  statistics: {
    enabled: false,
    logs: {
      joinLeaveChannelId: null,
      messageChannelId: null, // deleted / edited message logs
      voiceChannelId: null, // voice join/leave/move logs
    },
  },
};

module.exports = { EMBED_COLORS, IDS, DEFAULT_SETTINGS };
