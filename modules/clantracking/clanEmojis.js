// modules/clantracking/clanEmojis.js
// Single source of truth for clan abbreviation → Discord custom emoji mapping.
// The source images live in modules/images/clanemblems/<ABBR>.png and were
// uploaded to the Yazanaki Empire server as custom emojis with these IDs.

// Clan abbreviation → custom emoji ID (from the Yazanaki Empire server)
const CLAN_EMOJI_IDS = {
  ANO:  "1335362902953037884",
  SNU:  "1225251585983119400",
  ONA:  "1334862597798891602",
  ONF:  "1334862640392044616",
  YZNK: "1334529701527683225",
  KSII: "1334862565812994109",
};

/**
 * Get the raw custom emoji ID for a clan abbreviation.
 * @param {string} abbr - e.g. "ONF"
 * @returns {string|null}
 */
function getClanEmojiId(abbr) {
  if (!abbr) return null;
  return CLAN_EMOJI_IDS[abbr.toUpperCase()] || null;
}

/**
 * Get a renderable Discord custom emoji string for a clan abbreviation.
 * Falls back to an empty string when no emoji is configured.
 * @param {string} abbr - e.g. "SNU"
 * @returns {string} e.g. "<:SNU:1225251585983119400> " or ""
 */
function getClanEmoji(abbr) {
  if (!abbr) return "";
  const upper = abbr.toUpperCase();
  const emojiId = CLAN_EMOJI_IDS[upper];
  if (!emojiId) return "";
  return `<:${upper}:${emojiId}> `;
}

module.exports = {
  CLAN_EMOJI_IDS,
  getClanEmojiId,
  getClanEmoji,
};
