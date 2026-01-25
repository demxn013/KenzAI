// modules/applications/application.js
// ✅ COMPLETE: Application ticket system with accept/reject functionality

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType
} = require("discord.js");

const { saveApplicant, getApplicant } = require("./applicants");
const { acceptApplicant } = require("./acceptedapplicants");
const cache = require("../data/cache");
const transcript = require("../tickets/transcript");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("application")
    .setDescription("Manage application system")
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Setup application panel in current channel")
    ),

  // ✅ FIXED: Added async
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ============================================================
    // SETUP APPLICATION PANEL
    // ============================================================
    if (sub === "setup") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: "❌ You need Administrator permission to use this command.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 Yazanaki Empire Application")
        .setDescription(
          "Click the button below to start your application to join the **Yazanaki Empire**.\n\n" +
          "You will be asked to provide:\n" +
          "• Your Minecraft username\n" +
          "• Your Minecraft version (Java/Bedrock)\n" +
          "• Your timezone\n" +
          "• Previous groups/clans\n" +
          "• Why you want to join\n\n" +
          "A private ticket channel will be created for your application."
        )
        .setColor(0x000000)
        .setFooter({ text: "Yazanaki Empire • Application System" });

      const button = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("start_application")
          .setLabel("📝 Start Application")
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        content: "✅ Application panel created!",
        ephemeral: true
      });

      await interaction.channel.send({
        embeds: [embed],
        components: [button]
      });
    }
  },

  // ============================================================
  // BUTTON HANDLER
  // ============================================================
  // ✅ FIXED: Added async
  async buttonHandler(interaction) {
    const customId = interaction.customId;

    // -------------------------------------------------------------------------
    // START APPLICATION
    // -------------------------------------------------------------------------
    if (customId === "start_application") {
      // Check if user already has an open ticket
      const allCache = cache.getAll();
      const existingTicket = Object.entries(allCache).find(
        ([channelId, data]) =>
          data.type === "application" &&
          data.openerId === interaction.user.id &&
          channelId !== "__counters"
      );

      if (existingTicket) {
        return interaction.reply({
          content: `❌ You already have an open application: <#${existingTicket[0]}>`,
          ephemeral: true
        });
      }

      // Create modal
      const modal = new ModalBuilder()
        .setCustomId(`application_modal_${interaction.user.id}`)
        .setTitle("Yazanaki Empire Application");

      const mcNameInput = new TextInputBuilder()
        .setCustomId("minecraft_name")
        .setLabel("Minecraft Username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g., Steve");

      const mcVersionInput = new TextInputBuilder()
        .setCustomId("minecraft_version")
        .setLabel("Minecraft Version (Java or Bedrock)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("Java or Bedrock");

      const timezoneInput = new TextInputBuilder()
        .setCustomId("timezone")
        .setLabel("Timezone (e.g., GMT+2, EST)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("e.g., GMT+2");

      const previousGroupsInput = new TextInputBuilder()
        .setCustomId("previous_groups")
        .setLabel("Previous Groups/Clans")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder("List any previous groups or clans you've been in (or 'None')");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Why do you want to join?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Tell us why you want to join the Yazanaki Empire...");

      modal.addComponents(
        new ActionRowBuilder().addComponents(mcNameInput),
        new ActionRowBuilder().addComponents(mcVersionInput),
        new ActionRowBuilder().addComponents(timezoneInput),
        new ActionRowBuilder().addComponents(previousGroupsInput),
        new ActionRowBuilder().addComponents(reasonInput)
      );

      await interaction.showModal(modal);
    }

    // -------------------------------------------------------------------------
    // CLOSE TICKET
    // -------------------------------------------------------------------------
    if (customId === "close_ticket") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You lack the required permission.",
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`close_reason_modal_${interaction.channel.id}`)
        .setTitle("Close Ticket");

      const reasonInput = new TextInputBuilder()
        .setCustomId("close_reason")
        .setLabel("Reason for closing")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder("Why are you closing this ticket?");

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }

    // -------------------------------------------------------------------------
    // ACCEPT / REJECT APPLICATION
    // -------------------------------------------------------------------------
    if (customId.startsWith("accept_application_") || customId.startsWith("reject_application_")) {
      const member = interaction.member;

      if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You lack the required permission.",
          ephemeral: true
        });
      }

      const isAccepted = customId.startsWith("accept_application_");
      const discordId = customId.split("_").pop();

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
  },

  // ============================================================
  // MODAL HANDLER
  // ============================================================
  // ✅ FIXED: Added async
  async modalHandler(interaction) {
    const customId = interaction.customId;

    // -------------------------------------------------------------------------
    // APPLICATION MODAL SUBMISSION
    // -------------------------------------------------------------------------
    if (customId.startsWith("application_modal_")) {
      await interaction.deferReply({ ephemeral: true });

      const minecraftName = interaction.fields.getTextInputValue("minecraft_name");
      const minecraftVersion = interaction.fields.getTextInputValue("minecraft_version");
      const timezone = interaction.fields.getTextInputValue("timezone");
      const previousGroups = interaction.fields.getTextInputValue("previous_groups") || "None";
      const reason = interaction.fields.getTextInputValue("reason");

      const guild = interaction.guild;
      const ticketNumber = cache.getNextNumber("application");
      const channelName = `application-${ticketNumber}`;

      // Create ticket channel
      const ticketChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          }
        ]
      });

      // Store in cache
      cache.set(ticketChannel.id, {
        type: "application",
        openerId: interaction.user.id,
        openerTag: interaction.user.tag,
        ticketNumber,
        openedAt: new Date().toISOString()
      });

      // Save applicant data
      saveApplicant(interaction.user.id, {
        discordUser: interaction.user.tag,
        minecraftUser: minecraftName,
        minecraftVersion: minecraftVersion,
        timezone: timezone,
        previousGroups: previousGroups,
        reason: reason,
        openedAt: new Date().toISOString(),
        server: guild.id,
        ticketChannel: ticketChannel.id,
        ticketNumber: ticketNumber
      });

      // Create application embed
      const embed = new EmbedBuilder()
        .setTitle(`📋 Application #${ticketNumber}`)
        .setDescription(`Application from ${interaction.user}`)
        .addFields(
          { name: "🎮 Minecraft Username", value: `\`${minecraftName}\``, inline: false },
          { name: "📱 Minecraft Version", value: `\`${minecraftVersion}\``, inline: true },
          { name: "🌍 Timezone", value: `\`${timezone}\``, inline: true },
          { name: "👥 Previous Groups", value: previousGroups, inline: false },
          { name: "📝 Reason", value: reason, inline: false }
        )
        .setColor(0x000000)
        .setFooter({ text: `Opened: ${new Date().toLocaleString("en-GB")}` });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_application_${interaction.user.id}`)
          .setLabel("✅ Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_application_${interaction.user.id}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("🔒 Close")
          .setStyle(ButtonStyle.Secondary)
      );

      await ticketChannel.send({
        content: `${interaction.user} - Your application has been submitted!`,
        embeds: [embed],
        components: [buttons]
      });

      return interaction.editReply({
        content: `✅ Your application has been created: ${ticketChannel}`,
        ephemeral: true
      });
    }

    // -------------------------------------------------------------------------
    // CLOSE REASON MODAL
    // -------------------------------------------------------------------------
    if (customId.startsWith("close_reason_modal_")) {
      const reason = interaction.fields.getTextInputValue("close_reason");
      const channel = interaction.channel;

      await interaction.reply({
        content: `🔒 Closing ticket with reason: "${reason}"...`,
        ephemeral: true
      });

      // Generate transcript
      await transcript.generate(interaction, channel, reason);
    }
  }
};