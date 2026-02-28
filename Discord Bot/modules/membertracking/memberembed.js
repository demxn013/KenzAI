// modules/membertracking/memberembed.js
const { EmbedBuilder } = require("discord.js");

/** Escape underscores for Discord so _ does not trigger italic formatting. */
function escapeDiscordUnderscores(str) {
  if (typeof str !== "string") return str;
  return str.replace(/_/g, "\\_");
}

function createMemberEmbed(discordUser, memberData, embedColor = 0x339eff) {
  const mcUsername = memberData.minecraftUser || "n/d";
  // URL must use raw username (no escaping); only escape for display text
  const skinURL = `https://mc-heads.net/avatar/${encodeURIComponent(mcUsername)}/100`;

  return new EmbedBuilder()
    .setTitle(escapeDiscordUnderscores(mcUsername))
    .setDescription(discordUser ? `${discordUser}` : "n/d")
    .setThumbnail(skinURL)
    .addFields(
      { name: "__MC Version__", value: `\`${escapeDiscordUnderscores(memberData.minecraftVersion || "n/d")}\``, inline: false },
      { name: "__Clan__", value: `\`${escapeDiscordUnderscores(memberData.JoinedClan || "n/d")}\``, inline: false },
      { name: "__Join Date__", value: `\`${escapeDiscordUnderscores(memberData.JoinDate || "n/d")}\``, inline: false },
      { name: "__Yazanaki Rank__", value: `\`${escapeDiscordUnderscores(memberData.YazanakiRank || "n/d")}\``, inline: false },
      { name: "__Empire ID__", value: `\`${escapeDiscordUnderscores(memberData.EmpireID || "n/d")}\``, inline: false },
      { name: "__Status__", value: `\`${escapeDiscordUnderscores(memberData.Status || "n/d")}\``, inline: false },
      { name: "__Points__", value: `\`${escapeDiscordUnderscores(String(memberData.points ?? 0))}\``, inline: false }
    )
    .setColor(embedColor)
    .setFooter({ text: `${new Date().toLocaleString("en-GB")}` });
}

module.exports = { createMemberEmbed };
