// In application.js buttonHandler, replace the accept/reject section with this:

// Accept / Reject
if (
  interaction.customId.startsWith("accept_application_") ||
  interaction.customId.startsWith("reject_application_")
) {
  const member = interaction.member;

  if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
    return interaction.reply({
      content: "❌ You lack the required permission.",
      ephemeral: true
    });
  }

  const isAccepted = interaction.customId.startsWith("accept_application_");
  const discordId = interaction.customId.split("_").pop();

  const applicantData = getApplicant(discordId);
  if (!applicantData) {
    return interaction.reply({
      content: "⚠️ Applicant not found.",
      ephemeral: true
    });
  }

  // Normalize values from applicantData
  const savedMCUser = applicantData.minecraftUser || applicantData.minecraftName || "";
  const savedMCVersion = applicantData.minecraftVersion || applicantData.minecraftVersion || "";

  // Save applicant with unified fields
  saveApplicant(
    discordId,
    {
      discordId,
      discordUser: applicantData.discordUser || applicantData.discordTag || null,
      minecraftUser: savedMCUser,
      ticketChannel: applicantData.ticketChannel,
      ticketNumber: applicantData.ticketNumber,
      timezone: applicantData.timezone,
      previousGroups: applicantData.previousGroups,
      reason: applicantData.reason,
      server: applicantData.server,
      minecraftVersion: savedMCVersion
    },
    applicantData.server ?? interaction.guild.id,
    applicantData.closeReason ?? null,
    isAccepted,
    new Date().toISOString()
  );

  if (isAccepted) {
    // ✅ DEFER REPLY FIRST (acceptance takes time)
    await interaction.deferReply({ ephemeral: true });
    
    // ✅ PASS CLIENT FOR ROLE DETECTION AND GET RESULT
    const result = await acceptApplicant(discordId, interaction.client);
    
    // ✅ CHECK IF ACCEPTANCE FAILED
    if (!result || !result.success) {
      const reason = result?.reason || "unknown";
      
      if (reason === "not_in_yazanaki") {
        return interaction.editReply({
          content: 
            `❌ **Cannot accept <@${discordId}>**\n\n` +
            `**Reason:** User is not in the Yazanaki Empire discord.\n\n` +
            `**Solution:** User must join the Yazanaki Empire discord first before being accepted.\n` +
            `Provide them with the Yazanaki Empire invite link.`,
          ephemeral: true
        });
      } else if (reason === "clan_not_registered") {
        return interaction.editReply({
          content: 
            `❌ **Cannot accept <@${discordId}>**\n\n` +
            `**Reason:** This clan is not registered in the system.\n\n` +
            `**Solution:** Use \`/clan add\` to register this clan first.`,
          ephemeral: true
        });
      } else if (reason === "no_yazanaki_role_configured") {
        return interaction.editReply({
          content: 
            `❌ **Cannot accept <@${discordId}>**\n\n` +
            `**Reason:** This clan has no Yazanaki Empire role configured.\n\n` +
            `**Solution:** Use \`/clan setrole\` to set the Yazanaki role for this clan.`,
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: 
            `❌ **Failed to accept <@${discordId}>**\n\n` +
            `**Reason:** ${reason}\n\n` +
            `Check console logs for details.`,
          ephemeral: true
        });
      }
    }
    
    // ✅ SUCCESS
    return interaction.editReply({
      content: 
        `✅ **<@${discordId}> has been accepted!**\n\n` +
        `**Empire ID:** \`${result.empireId}\`\n` +
        `**Clan:** ${result.clan.abbr} (${result.clan.name})\n` +
        `**Roles Assigned:** Military, Recruit, ${result.clan.abbr}\n` +
        `**Draft:** Started (3 months)`,
      ephemeral: true
    });
  } else {
    // REJECTED
    return interaction.reply({
      content: `❌ <@${discordId}> marked as **Rejected**.`,
      ephemeral: true
    });
  }
}