// modules/alliances/allianceembed.js
const { EmbedBuilder } = require("discord.js");

/**
 * Create an alliance embed.
 * - If `flagAttachmentName` is provided (e.g. 'the-iron-pact.png') the caller should send
 *   the file in the same message; the image is referenced as attachment://<flagAttachmentName>.
 *
 * alliance: { name, invite, clanAbbr, clanName, createdAt }
 * clanText: mention/label string for the owning Yazanaki clan
 * inviteText: markdown link string or placeholder
 */
function createAllianceEmbed(alliance, clanText, inviteText, flagAttachmentName = null, color = 0x000000) {
  const jd = alliance.createdAt?.split("-");
  const createdText = jd?.length === 3 ? `\`${jd[2]}/${jd[1]}/${jd[0]}\`` : "``n/d``";

  const fields = [
    { name: "🏯 Clan", value: clanText || "``n/d``", inline: false },
    { name: "🔗 Invite link", value: inviteText || "``n/d``", inline: false },
    { name: "📅 Formed", value: createdText, inline: false },
  ];

  const embed = new EmbedBuilder()
    .setTitle(`🤝 ${alliance.name}`)
    .setColor(color)
    .addFields(fields);

  if (flagAttachmentName) {
    // caller must attach the file and reference as attachment://<flagAttachmentName>
    embed.setImage(`attachment://${flagAttachmentName}`);
  }

  return embed;
}

module.exports = { createAllianceEmbed };
