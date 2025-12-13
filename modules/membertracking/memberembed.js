// modules/membertracking/memberembed.js
const { EmbedBuilder } = require("discord.js");

function createMemberEmbed(discordUser, memberData, embedColor = 0x339eff) {
  const mcUsername = memberData.minecraftUser || "n/d";
  const skinURL = `https://mc-heads.net/avatar/${encodeURIComponent(mcUsername)}/100`;

  return new EmbedBuilder()
    .setTitle(mcUsername)
    .setDescription(discordUser ? `${discordUser}` : "n/d")
    .setThumbnail(skinURL)
    .addFields(
      { name: "__MC Version__", value: `\`${memberData.minecraftVersion || "n/d"}\``, inline: false },
      { name: "__Clan__", value: `\`${memberData.JoinedClan || "n/d"}\``, inline: false },
      { name: "__Join Date__", value: `\`${memberData.JoinDate || "n/d"}\``, inline: false },
      { name: "__Yazanaki Rank__", value: `\`${memberData.YazanakiRank || "n/d"}\``, inline: false },
      { name: "__Empire ID__", value: `\`${memberData.EmpireID || "n/d"}\``, inline: false },
      { name: "__Status__", value: `\`${memberData.Status || "n/d"}\``, inline: false }
    )
    .setColor(embedColor)
    .setFooter({ text: `${new Date().toLocaleString("en-GB")}` });
}

module.exports = { createMemberEmbed };
