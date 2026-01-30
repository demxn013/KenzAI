const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  MessageFlags
} = require("discord.js");

const transcript = require("../tickets/transcript");
const cache = require("../data/cache");
const { saveApplicant, getApplicant } = require("./applicants");
const autolink = require("../linking/autolink");
const { acceptApplicant } = require("./acceptedapplicants.js");
const { checkApplicationEligibility } = require("../membertracking/memberkickban"); // ✅ NEW

module.exports = {
  data: new SlashCommandBuilder()
    .setName("application")
    .setDescription("Post the application starter embed for the Yazanaki Empire."),

  async execute(interaction) {
    const guild = interaction.guild;

    const appEmbed = new EmbedBuilder()
      .setTitle("Start your Application!")
      .setDescription(
        `Join **${guild.name}** of the Yazanaki Empire by clicking the button below to open an application ticket!`
      )
      .setColor("#000000");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("start_application")
        .setLabel("Apply")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({
      embeds: [appEmbed],
      components: [row]
    });
  },

  async buttonHandler(interaction) {
    const guild = interaction.guild;

    // 🟢 Open Application Ticket (Modal)
    if (interaction.customId === "start_application") {
      // ============================================================
      // ✅ NEW: CHECK KICK/BAN STATUS BEFORE ALLOWING APPLICATION
      // ============================================================
      const eligibility = checkApplicationEligibility(interaction.user.id);
      
      if (!eligibility.eligible) {
        console.log(`[application] ⛔ Application blocked for ${interaction.user.tag}`);
        console.log(`[application] 📋 Status: ${eligibility.status}`);
        console.log(`[application] 📋 Reason: ${eligibility.reason}`);
        
        // User is banned or on kick cooldown
        return interaction.reply({
          content: eligibility.message,
          ephemeral: true
        });
      }
      
      console.log(`[application] ✅ ${interaction.user.tag} is eligible to apply`);
      
      // ============================================================
      // CONTINUE WITH NORMAL APPLICATION FLOW
      // ============================================================
      
      const category = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          c.name.toLowerCase().includes("applications")
      );

      if (!category) {
        return interaction.reply({
          content:
            "❌ No category for applications found. Create one with 'applications' in its name.",
          flags: MessageFlags.Ephemeral
        });
      }

      const existing = guild.channels.cache.find(
        (ch) =>
          ch.parentId === category.id &&
          ch.name.startsWith(
            interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")
          )
      );

      if (existing) {
        return interaction.reply({
          content: `❌ You already have an open application: ${existing}`,
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`application_modal_${interaction.user.id}`)
        .setTitle("Empire Application")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("minecraft_name")
              .setLabel("Minecraft Username")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("minecraft_version")
              .setLabel("Minecraft Version (Bedrock/Java)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("timezone")
              .setLabel("Your Timezone (e.g., GMT+1)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("previous_groups")
              .setLabel("Previous Groups")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Why do you want to join?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );

      return interaction.showModal(modal);
    }

    // 🔒 Close Ticket modal
    if (interaction.customId === "close_ticket") {
      const modal = new ModalBuilder()
        .setCustomId(`close_reason_modal_${interaction.channel.id}`)
        .setTitle("Close Ticket")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("close_reason")
              .setLabel("Reason for closing this ticket")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // ============================================================
    // ✅ ACCEPT / REJECT WITH DUPLICATE PREVENTION
    // ============================================================
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

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[application] 🎯 ${isAccepted ? 'Accept' : 'Reject'} button clicked`);
      console.log(`[application] 👤 Target: ${discordId}`);
      console.log(`[application] 👮 Moderator: ${interaction.user.tag}`);

      const applicantData = getApplicant(discordId);
      if (!applicantData) {
        console.log(`[application] ❌ Applicant not found`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.reply({
          content: "⚠️ Applicant not found.",
          ephemeral: true
        });
      }

      // ============================================================
      // ✅ CHECK IF ALREADY PROCESSED
      // ============================================================
      if (applicantData.closedAt) {
        console.log(`[application] ⚠️ Application already processed`);
        console.log(`[application] 📅 Original close date: ${applicantData.closedAt}`);
        console.log(`[application] 📊 Status: ${applicantData.accepted ? 'Accepted' : 'Rejected'}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        // ✅ DISABLE ONLY THE ACCEPT AND REJECT BUTTONS, KEEP CLOSE BUTTON
        try {
          const currentMessage = interaction.message;
          
          // Rebuild the buttons with Accept/Reject disabled
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("close_ticket")
              .setLabel("🔒 Close Ticket")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`accept_application_${discordId}`)
              .setLabel("✅ Accept")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true), // ✅ Disabled
            new ButtonBuilder()
              .setCustomId(`reject_application_${discordId}`)
              .setLabel("❌ Reject")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true) // ✅ Disabled
          );

          await currentMessage.edit({ components: [newRow] });
          console.log(`[application] 🔒 Accept/Reject buttons disabled`);
        } catch (err) {
          console.warn(`[application] ⚠️ Could not disable buttons:`, err.message);
        }

        const statusText = applicantData.accepted ? "✅ Accepted" : "❌ Rejected";
        const closeDate = new Date(applicantData.closedAt).toLocaleString('en-GB');

        return interaction.reply({
          content: 
            `⚠️ **This application has already been processed!**\n\n` +
            `**Status:** ${statusText}\n` +
            `**Processed on:** ${closeDate}\n\n` +
            `The Accept/Reject buttons have been disabled.`,
          ephemeral: true
        });
      }

      // ============================================================
      // ✅ PROCESS THE APPLICATION (FIRST TIME ONLY)
      // ============================================================
      
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
        new Date().toISOString() // ✅ This is the FIRST and ONLY close date
      );

      console.log(`[application] 📝 Application marked as ${isAccepted ? 'accepted' : 'rejected'}`);
      console.log(`[application] 📅 Close date: ${new Date().toISOString()}`);

      // ============================================================
      // ✅ DISABLE ONLY ACCEPT/REJECT BUTTONS (KEEP CLOSE BUTTON)
      // ============================================================
      try {
        const currentMessage = interaction.message;
        
        const newRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("🔒 Close Ticket")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`accept_application_${discordId}`)
            .setLabel("✅ Accept")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true), // ✅ Disabled
          new ButtonBuilder()
            .setCustomId(`reject_application_${discordId}`)
            .setLabel("❌ Reject")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true) // ✅ Disabled
        );

        await currentMessage.edit({ components: [newRow] });
        console.log(`[application] 🔒 Accept/Reject buttons disabled successfully`);
      } catch (err) {
        console.warn(`[application] ⚠️ Could not disable buttons:`, err.message);
      }

      // ============================================================
      // ✅ ACCEPT APPLICANT (if accepted)
      // ============================================================
      if (isAccepted) {
        console.log(`[application] 🎯 Running acceptance process...`);
        
        const acceptResult = await acceptApplicant(discordId, interaction.client);
        
        if (acceptResult.success) {
          console.log(`[application] ✅ Acceptance successful`);
          console.log(`[application] 🆔 Empire ID: ${acceptResult.empireId}`);
          console.log(`[application] 🏷️ Clan: ${acceptResult.clan?.abbr}`);
        } else {
          console.error(`[application] ❌ Acceptance failed: ${acceptResult.reason}`);
        }
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.reply({
        content: isAccepted
          ? `✅ <@${discordId}> has been **Accepted**. The Accept/Reject buttons have been disabled.`
          : `❌ <@${discordId}> has been **Rejected**. The Accept/Reject buttons have been disabled.`,
        ephemeral: true
      });
    }
  },

  async modalHandler(interaction) {
    const guild = interaction.guild;

    if (interaction.customId.startsWith("application_modal_")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const mcName = interaction.fields.getTextInputValue("minecraft_name");
      const mcVersion = interaction.fields.getTextInputValue("minecraft_version");
      const tZone = interaction.fields.getTextInputValue("timezone");
      const prevGroups = interaction.fields.getTextInputValue("previous_groups");
      const reason = interaction.fields.getTextInputValue("reason");

      const category = guild.channels.cache.find((c) =>
        c.name.toLowerCase().includes("applications")
      );

      if (!category) {
        return interaction.editReply({
          content: "❌ Applications category not found.",
          flags: MessageFlags.Ephemeral
        });
      }

      const ticketNumber = cache.getNextNumber("application");
      const channelName = `${interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}-${ticketNumber}`;

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.EmbedLinks
            ]
          },
          {
            id: guild.members.me.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.ManageMessages
            ]
          }
        ]
      });

      // ✅ FIXED: Save applicant IMMEDIATELY with minecraftUser field
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[application] 💾 Saving applicant data for ${interaction.user.tag}`);
      console.log(`[application] 🎮 Minecraft: ${mcName}`);
      
      saveApplicant(interaction.user.id, {
        discordId: interaction.user.id,
        discordUser: interaction.user.tag,
        minecraftUser: mcName, // ✅ FIXED: Using minecraftUser instead of minecraftName
        ticketChannel: channel.id,
        ticketNumber,
        minecraftVersion: mcVersion,
        timezone: tZone,
        previousGroups: prevGroups,
        reason,
        server: guild.id,
        accepted: false,
        closeReason: null,
        closedAt: null
      });
      
      console.log(`[application] ✅ Applicant data saved`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      // ✅ FIXED: Run autolink AFTER saving, with async/await
      console.log(`[application] 🔗 Starting autolink process...`);
      
      // Run autolink asynchronously (don't wait for it to complete the modal response)
      autolink.processApplicant(interaction.user.id, 1000).then(result => {
        if (result.success) {
          console.log(`[application] ✅ Autolink successful: ${result.minecraftUser}`);
        } else {
          console.warn(`[application] ⚠️ Autolink failed: ${result.reason}`);
          console.warn(`[application] ℹ️ User will need to use /link command manually`);
        }
      }).catch(err => {
        console.error(`[application] ❌ Autolink error:`, err);
      });

      cache.set(channel.id, {
        type: "application",
        openerId: interaction.user.id,
        openerTag: interaction.user.tag,
        ticketNumber,
        openedAt: new Date().toISOString()
      });

      const infoEmbed = new EmbedBuilder()
        .setTitle("New Application")
        .addFields(
          { name: "Applicant", value: `<@${interaction.user.id}>` },
          { name: "Minecraft Username", value: mcName },
          { name: "Minecraft Version", value: mcVersion },
          { name: "Timezone", value: tZone },
          { name: "Previous Groups", value: prevGroups },
          { name: "Reason", value: reason },
          { name: "Opened At", value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
        )
        .setColor("#000000");

      const termsEmbed = new EmbedBuilder()
        .setTitle("Pre-Application")
        .setDescription(
          "**__Constitution & Values__**\n" +
            "[Yazanaki Empire Constitution](https://docs.google.com/document/d/1rDxBfjuo2fkrK_LGpmce3vEPy-ImDIDZ-FFJwhDE6mE/edit)\n\n" +
            "**__Terms__**\n" +
            "By applying, you vow to uphold all Yazanakian values.\n\n" +
            "**Rules**\n- Don't ping staff unnecessarily\n- No spam\n- Be respectful"
        )
        .setColor("#000000");

      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("🔒 Close Ticket")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`accept_application_${interaction.user.id}`)
          .setLabel("✅ Accept")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_application_${interaction.user.id}`)
          .setLabel("❌ Reject")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        embeds: [infoEmbed, termsEmbed],
        components: [controlRow]
      });

      await interaction.editReply({
        content: `✅ Your application has been created: ${channel}`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Close reason modal
    if (interaction.customId.startsWith("close_reason_modal_")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reason = interaction.fields.getTextInputValue("close_reason");
      const channelId = interaction.customId.split("close_reason_modal_")[1];
      const channel = interaction.guild.channels.cache.get(channelId);

      if (!channel) {
        return interaction.editReply({
          content: "❌ Channel not found.",
          flags: MessageFlags.Ephemeral
        });
      }

      const ticketData = cache.get(channelId);
      if (ticketData) {
        const applicantData = getApplicant(ticketData.openerId);
        if (applicantData) {
          const mcUser = applicantData.minecraftUser || applicantData.minecraftName || "";
          saveApplicant(
            ticketData.openerId,
            {
              ...applicantData,
              discordId: ticketData.openerId,
              discordUser: interaction.user.tag,
              minecraftUser: mcUser
            },
            interaction.guild.id,
            reason,
            applicantData.accepted ?? false,
            new Date().toISOString()
          );
        }
      }

      await transcript.generate(interaction, channel, reason);

      return interaction.editReply({
        content: "✅ Ticket closed and transcript saved.",
        flags: MessageFlags.Ephemeral
      });
    }
  }
};