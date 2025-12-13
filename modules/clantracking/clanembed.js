// modules/clantracking/clanembed.js
const { EmbedBuilder } = require("discord.js");

/**
 * Create clan embed.
 * - If `flagAttachmentName` is provided (e.g. 'SNU.png') the caller should send the file
 *   in the same message and set the image to `attachment://<flagAttachmentName>`.
 *
 * clan: { abbr, name, joinedEmpire }
 * leader: mention string or "``n/d``"
 * sizeText: string like "`123`"
 * invite: string or placeholder
 */
function createClanEmbed(clan, leader, residentsText, joinedText, sizeText, invite, thumbnailUrl = null, flagAttachmentName = null, color = 0x000000) {
  const embed = new EmbedBuilder()
    .setTitle(`${clan.abbr}: ${clan.name}`)
    .setColor(color)
    .addFields(
      { name: "👑 Leader", value: leader || "``n/d``", inline: false },
      { name: "🏠 Residents", value: residentsText || "``n/d``", inline: false },
      { name: "📅 Joined Empire", value: joinedText || "``n/d``", inline: false },
      { name: "👥 Size", value: sizeText || "``n/d``", inline: false },
      { name: "🔗 Invite link", value: invite || "``n/d``", inline: false }
    );

  if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
  if (flagAttachmentName) {
    // caller must attach the file and reference as attachment://<flagAttachmentName>
    embed.setImage(`attachment://${flagAttachmentName}`);
  }

  return embed;
}

module.exports = { createClanEmbed };
