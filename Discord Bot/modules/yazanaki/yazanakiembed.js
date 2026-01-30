// modules/yazanaki/yazanakiembed.js
const { EmbedBuilder } = require("discord.js");

/**
 * Create Yazanaki Empire embed.
 * - If `flagAttachmentName` is provided (e.g. 'YAZANAKI.png') the caller should send the file
 *   in the same message and set the image to `attachment://<flagAttachmentName>`.
 *
 * empireData: { totalUniquePeople, totalResidents, inviteLink }
 * emperorMention: mention string or "``n/d``"
 * empressMention: mention string or "``n/d``"
 * thumbnailUrl: URL to empire emblem (YZNKI.png)
 * flagAttachmentName: filename for flag attachment (e.g., 'YAZANAKI.png')
 * color: embed color (default black)
 */
function createYazanakiEmbed(
  empireData,
  emperorMention,
  empressMention,
  thumbnailUrl = null,
  flagAttachmentName = null,
  color = 0x000000
) {
  const embed = new EmbedBuilder()
    .setTitle("🏛️ Yazanaki Empire")
    .setColor(color)
    .addFields(
      { 
        name: "👑 Emperor", 
        value: emperorMention || "``n/d``", 
        inline: true 
      },
      { 
        name: "👑 Empress", 
        value: empressMention || "``n/d``", 
        inline: true 
      },
      { 
        name: "‎", 
        value: "‎", 
        inline: true 
      },
      { 
        name: "👥 Unique Members", 
        value: `\`${empireData.totalUniquePeople || 0}\``, 
        inline: true 
      },
      { 
        name: "🏠 Total Residents", 
        value: `\`${empireData.totalResidents || 0}\``, 
        inline: true 
      },
      { 
        name: "‎", 
        value: "‎", 
        inline: true 
      },
      { 
        name: "🔗 Join the Empire", 
        value: empireData.inviteLink || "``n/d``", 
        inline: false 
      }
    )
    .setFooter({ text: "The Yazanaki Empire • Unity Through Strength" });

  // Set thumbnail (empire emblem)
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  // Set image (empire flag)
  if (flagAttachmentName) {
    // caller must attach the file and reference as attachment://<flagAttachmentName>
    embed.setImage(`attachment://${flagAttachmentName}`);
  }

  return embed;
}

module.exports = { createYazanakiEmbed };