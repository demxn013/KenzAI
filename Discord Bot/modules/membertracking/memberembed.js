// modules/membertracking/memberembed.js
const { EmbedBuilder } = require("discord.js");

/** Escape underscores for Discord so _ does not trigger italic formatting. */
function escapeDiscordUnderscores(str) {
  if (typeof str !== "string") return str;
  return str.replace(/_/g, "\\_");
}

/**
 * Get subscription tier badge for a Discord user.
 * Reads from subscriptiondb — silently returns null if the module
 * isn't available (keeps memberembed working even if mcbot isn't loaded).
 * @param {string} discordId
 * @returns {string|null}
 */
function getSubscriptionBadge(discordId) {
  try {
    const db = require("../mcbot/monetization/subscriptiondb");
    const user = db.getUser(discordId);
    if (!user || !user.active || user.subscription_tier === "none") return null;

    const badges = {
      vip:      "👑 VIP",
      premium:  "🟣 Premium",
      standard: "🔵 Standard",
    };
    return badges[user.subscription_tier] || null;
  } catch {
    // subscriptiondb not available — gracefully skip
    return null;
  }
}

/**
 * @param {import("discord.js").User|null} discordUser
 * @param {object} memberData
 * @param {number} embedColor
 */
function createMemberEmbed(discordUser, memberData, embedColor = 0x339eff) {
  const mcUsername = memberData.minecraftUser || "n/d";
  // URL must use raw username (no escaping); only escape for display text
  const skinURL = `https://mc-heads.net/avatar/${encodeURIComponent(mcUsername)}/100`;

  // Attempt to pull subscription badge if we have a discordId
  const discordId = memberData.discordId || (discordUser ? discordUser.id : null);
  const subBadge = discordId ? getSubscriptionBadge(discordId) : null;

  const fields = [
    { name: "__MC Version__", value: `\`${escapeDiscordUnderscores(memberData.minecraftVersion || "n/d")}\``, inline: false },
    { name: "__Clan__",       value: `\`${escapeDiscordUnderscores(memberData.JoinedClan || "n/d")}\``,       inline: false },
    { name: "__Join Date__",  value: `\`${escapeDiscordUnderscores(memberData.JoinDate || "n/d")}\``,         inline: false },
    { name: "__Yazanaki Rank__", value: `\`${escapeDiscordUnderscores(memberData.YazanakiRank || "n/d")}\``, inline: false },
    { name: "__Empire ID__",  value: `\`${escapeDiscordUnderscores(memberData.EmpireID || "n/d")}\``,         inline: false },
    { name: "__Status__",     value: `\`${escapeDiscordUnderscores(memberData.Status || "n/d")}\``,           inline: false },
    { name: "__Points__",     value: `\`${escapeDiscordUnderscores(String(memberData.points ?? 0))}\``,       inline: false },
  ];

  // ── Subscription badge — only shown if the user has an active sub ──
  if (subBadge) {
    fields.push({
      name:   "__KenzAI Bot__",
      value:  `${subBadge}`,
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setTitle(escapeDiscordUnderscores(mcUsername))
    .setDescription(discordUser ? `${discordUser}` : "n/d")
    .setThumbnail(skinURL)
    .addFields(fields)
    .setColor(embedColor)
    .setFooter({ text: `${new Date().toLocaleString("en-GB")}` });
}

module.exports = { createMemberEmbed };