const { ChannelType, AttachmentBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const discordTranscripts = require("discord-html-transcripts");
const cache = require("../data/cache");
const { getApplicant } = require("../applications/applicants");

module.exports = {
  async generate(interaction, channel, reason = "No reason provided.") {
    try {
      if (!channel || channel.type !== ChannelType.GuildText)
        return console.warn("Transcript: provided channel is not a text channel.");

      const guild = interaction.guild;
      const closer = interaction.user;
      const ticketData = cache.get(channel.id);
      const applicantData = getApplicant(ticketData?.openerId);

      const filename = `transcript-${channel.name}.html`;

      const openedAt = ticketData?.openedAt
        ? new Date(ticketData.openedAt).toLocaleString("en-GB")
        : "Unknown";
      const closedAt = new Date().toLocaleString("en-GB");

      const buffer = await discordTranscripts.createTranscript(channel, {
        limit: -1,
        returnType: "buffer",
        fileName: filename,
        saveImages: true
      });

      const attachment = new AttachmentBuilder(buffer, { name: filename });

      const embed = new EmbedBuilder()
        .setTitle(`📝 Transcript — ${channel.name}`)
        .addFields(
          { name: "Ticket Type", value: ticketData?.type || "Unknown", inline: true },
          { name: "Ticket Number", value: `${ticketData?.ticketNumber || "Unknown"}`, inline: true },
          { name: "Opened By", value: ticketData?.openerId ? `<@${ticketData.openerId}>` : "Unknown", inline: false },
          { name: "Closed By", value: closer ? `<@${closer.id}>` : "Unknown", inline: false },
          { name: "Opened At", value: `\`${openedAt}\``, inline: false },
          { name: "Closed At", value: `\`${closedAt}\``, inline: false },
          { name: "Close Reason", value: reason, inline: false },
          { name: "File", value: `Attached below: \`${filename}\`` }
        )
        .setColor("#000000")
        .setFooter({ text: "Yazanaki Empire • Transcript Log" });

      const transcriptsChannel = guild.channels.cache.find((c) =>
        c.name.toLowerCase().includes("transcript")
      );

      if (transcriptsChannel)
        await transcriptsChannel.send({ embeds: [embed], files: [attachment] });

      // DM the applicant if possible
      if (applicantData?.discordTag) {
        const member = guild.members.cache.get(ticketData.openerId);
        if (member) {
          member
            .send({
              content: `Here is your ticket transcript from **${guild.name}**.`,
              embeds: [embed],
              files: [attachment]
            })
            .catch(() => console.warn("Could not DM transcript to applicant."));
        }
      }

      cache.delete(channel.id);

      // Delete channel after 2s
      setTimeout(async () => {
        await channel.delete().catch(() => {});
      }, 2000);
    } catch (err) {
      console.error("Transcript.generate error:", err);
    }
  }
};
