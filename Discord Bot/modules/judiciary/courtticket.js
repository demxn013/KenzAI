// modules/judiciary/courtticket.js
// ✅ Court Request Ticket System for Yazanaki Empire

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
  
  const cache = require("../data/cache");
  const transcript = require("../tickets/transcript");
  const { saveCourtRequest, getCourtRequest } = require("./courtrequests");
  
  // Yazanaki Empire Guild ID
  const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName("courtrequest")
      .setDescription("[Yazanaki Only] Post the court request starter embed"),
  
    async execute(interaction) {
      // ============================================================
      // CHECK: Must be in Yazanaki Empire
      // ============================================================
      if (interaction.guild.id !== YAZANAKI_EMPIRE_GUILD_ID) {
        return interaction.reply({
          content: "❌ This command can only be used in the Yazanaki Empire discord.",
          ephemeral: true
        });
      }
  
      // Check permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You need the **Kick Members** permission to use this command.",
          ephemeral: true
        });
      }
  
      const guild = interaction.guild;
  
      const requestEmbed = new EmbedBuilder()
        .setTitle("⚖️ File a Court Request")
        .setDescription(
          `**Yazanaki Imperial Judiciary**\n\n` +
          `If you believe a member of the Yazanaki Empire has violated imperial law or committed a crime, ` +
          `you may file a formal court request.\n` +
          `You may also file a court request if you wish to appeal an active verdict.\n` +
          `**Before Filing:**\n` +
          `• Ensure you have evidence of the alleged crime\n` +
          `• Be prepared to provide detailed testimony\n` +
          `• False accusations will result in consequences\n\n` +
          `Click the button below to begin your court request.`
        )
        .setColor("#000000")
        .setFooter({ text: "Yazanaki Imperial Judiciary • Court Requests" });
  
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("start_court_request")
          .setLabel("⚖️ File Court Request")
          .setStyle(ButtonStyle.Danger)
      );
  
      await interaction.reply({
        embeds: [requestEmbed],
        components: [row]
      });
    },
  
    async buttonHandler(interaction) {
      const guild = interaction.guild;
  
      // ============================================================
      // OPEN COURT REQUEST TICKET (Modal)
      // ============================================================
      if (interaction.customId === "start_court_request") {
        // Check if user already has an open court request
        const category = guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase().includes("court") &&
            c.name.toLowerCase().includes("request")
        );
  
        if (!category) {
          return interaction.reply({
            content:
              "❌ No category for court requests found. Create one with 'court requests' in its name.",
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
            content: `❌ You already have an open court request: ${existing}`,
            flags: MessageFlags.Ephemeral
          });
        }
  
        const modal = new ModalBuilder()
          .setCustomId(`court_request_modal_${interaction.user.id}`)
          .setTitle("Imperial Court Request")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("reporter_minecraft")
                .setLabel("Your Minecraft Username")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("e.g., Notch")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("accused_minecraft")
                .setLabel("Accused's Minecraft Username")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("e.g., Herobrine")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("accused_discord")
                .setLabel("Accused's Discord (Username or ID)")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("e.g., @username or 123456789012345678")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("crime_type")
                .setLabel("Type of Crime/Violation")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("e.g., Theft, Griefing, Harassment, etc.")
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("incident_details")
                .setLabel("Detailed Explanation of Incident")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder("Provide a detailed account of what happened, when, where, and any evidence you have...")
            )
          );
  
        return interaction.showModal(modal);
      }
  
      // ============================================================
      // CLOSE COURT REQUEST TICKET
      // ============================================================
      if (interaction.customId === "close_court_request") {
        const modal = new ModalBuilder()
          .setCustomId(`close_court_request_modal_${interaction.channel.id}`)
          .setTitle("Close Court Request")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("close_reason")
                .setLabel("Reason for closing this court request")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setPlaceholder("e.g., Case filed, Request dismissed, Resolved informally...")
            )
          );
        return interaction.showModal(modal);
      }
  
      // ============================================================
      // ESCALATE TO FORMAL CASE
      // ============================================================
      if (interaction.customId.startsWith("escalate_court_request_")) {
        const member = interaction.member;
  
        if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return interaction.reply({
            content: "❌ You lack the required permission (Kick Members).",
            ephemeral: true
          });
        }
  
        const discordId = interaction.customId.split("_").pop();
  
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`[courtrequest] 🔼 Escalating court request to formal case`);
        console.log(`[courtrequest] 👤 Reporter: ${discordId}`);
        console.log(`[courtrequest] 👮 Staff: ${interaction.user.tag}`);
  
        const requestData = getCourtRequest(discordId);
        
        if (!requestData) {
          console.log(`[courtrequest] ❌ Court request not found`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return interaction.reply({
            content: "⚠️ Court request data not found.",
            ephemeral: true
          });
        }
  
        // Check if already escalated
        if (requestData.escalated) {
          console.log(`[courtrequest] ⚠️ Request already escalated`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          
          return interaction.reply({
            content: `⚠️ **This request has already been escalated.**\n\nEscalated on: ${new Date(requestData.escalatedAt).toLocaleString('en-GB')}\nBy: <@${requestData.escalatedBy}>`,
            ephemeral: true
          });
        }
  
        // Mark as escalated
        const { saveCourtRequest: updateCourtRequest } = require("./courtrequests");
        updateCourtRequest(discordId, {
          ...requestData,
          escalated: true,
          escalatedAt: new Date().toISOString(),
          escalatedBy: interaction.user.id
        });
  
        console.log(`[courtrequest] ✅ Request escalated successfully`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
        // Disable escalate button, keep close button
        try {
          const currentMessage = interaction.message;
          
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("close_court_request")
              .setLabel("🔒 Close Request")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`escalate_court_request_${discordId}`)
              .setLabel("🔼 Escalate to Formal Case")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true) // ✅ Disabled
          );
  
          await currentMessage.edit({ components: [newRow] });
          console.log(`[courtrequest] 🔒 Escalate button disabled`);
        } catch (err) {
          console.warn(`[courtrequest] ⚠️ Could not disable button:`, err.message);
        }
  
        return interaction.reply({
          content: 
            `✅ **Court request escalated to formal case.**\n\n` +
            `**Reporter:** <@${discordId}>\n` +
            `**Escalated by:** ${interaction.user.tag}\n\n` +
            `A High Inquisitor should now use \`/court case create\` to file the formal case.\n\n` +
            `**Case Details:**\n` +
            `• Accused: ${requestData.accusedMinecraft} (<@${requestData.accusedDiscord}> or Discord: ${requestData.accusedDiscord})\n` +
            `• Crime Type: ${requestData.crimeType}\n` +
            `• Details: See ticket for full details`,
          ephemeral: false
        });
      }
  
      // ============================================================
      // DISMISS COURT REQUEST
      // ============================================================
      if (interaction.customId.startsWith("dismiss_court_request_")) {
        const member = interaction.member;
  
        if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return interaction.reply({
            content: "❌ You lack the required permission.",
            ephemeral: true
          });
        }
  
        const discordId = interaction.customId.split("_").pop();
  
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`[courtrequest] ❌ Dismissing court request`);
        console.log(`[courtrequest] 👤 Reporter: ${discordId}`);
        console.log(`[courtrequest] 👮 Staff: ${interaction.user.tag}`);
  
        const requestData = getCourtRequest(discordId);
        
        if (!requestData) {
          console.log(`[courtrequest] ❌ Court request not found`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return interaction.reply({
            content: "⚠️ Court request data not found.",
            ephemeral: true
          });
        }
  
        // Check if already dismissed
        if (requestData.dismissed) {
          console.log(`[courtrequest] ⚠️ Request already dismissed`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          
          return interaction.reply({
            content: `⚠️ **This request has already been dismissed.**\n\nDismissed on: ${new Date(requestData.dismissedAt).toLocaleString('en-GB')}\nBy: <@${requestData.dismissedBy}>`,
            ephemeral: true
          });
        }
  
        // Mark as dismissed
        const { saveCourtRequest: updateCourtRequest } = require("./courtrequests");
        updateCourtRequest(discordId, {
          ...requestData,
          dismissed: true,
          dismissedAt: new Date().toISOString(),
          dismissedBy: interaction.user.id
        });
  
        console.log(`[courtrequest] ✅ Request dismissed successfully`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
        // Disable both escalate and dismiss buttons
        try {
          const currentMessage = interaction.message;
          
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("close_court_request")
              .setLabel("🔒 Close Request")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`escalate_court_request_${discordId}`)
              .setLabel("🔼 Escalate to Formal Case")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`dismiss_court_request_${discordId}`)
              .setLabel("❌ Dismiss Request")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true)
          );
  
          await currentMessage.edit({ components: [newRow] });
          console.log(`[courtrequest] 🔒 Escalate and Dismiss buttons disabled`);
        } catch (err) {
          console.warn(`[courtrequest] ⚠️ Could not disable buttons:`, err.message);
        }
  
        return interaction.reply({
          content: 
            `✅ **Court request dismissed.**\n\n` +
            `**Reporter:** <@${discordId}>\n` +
            `**Dismissed by:** ${interaction.user.tag}\n\n` +
            `The request has been reviewed and dismissed. The ticket can now be closed.`,
          ephemeral: false
        });
      }
    },
  
    async modalHandler(interaction) {
      const guild = interaction.guild;
  
      // ============================================================
      // COURT REQUEST MODAL SUBMISSION
      // ============================================================
      if (interaction.customId.startsWith("court_request_modal_")) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
        const reporterMinecraft = interaction.fields.getTextInputValue("reporter_minecraft");
        const accusedMinecraft = interaction.fields.getTextInputValue("accused_minecraft");
        const accusedDiscord = interaction.fields.getTextInputValue("accused_discord");
        const crimeType = interaction.fields.getTextInputValue("crime_type");
        const incidentDetails = interaction.fields.getTextInputValue("incident_details");
  
        const category = guild.channels.cache.find((c) =>
          c.name.toLowerCase().includes("court") &&
          c.name.toLowerCase().includes("request")
        );
  
        if (!category) {
          return interaction.editReply({
            content: "❌ Court requests category not found.",
            flags: MessageFlags.Ephemeral
          });
        }
  
        const ticketNumber = cache.getNextNumber("court_request");
        const channelName = `${interaction.user.username
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")}-cr-${ticketNumber}`;
  
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { 
              id: guild.roles.everyone.id, 
              deny: [PermissionsBitField.Flags.ViewChannel] 
            },
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
  
        // Save court request data
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log(`[courtrequest] 💾 Saving court request for ${interaction.user.tag}`);
        
        saveCourtRequest(interaction.user.id, {
          discordId: interaction.user.id,
          discordUser: interaction.user.tag,
          reporterMinecraft,
          accusedMinecraft,
          accusedDiscord,
          crimeType,
          incidentDetails,
          ticketChannel: channel.id,
          ticketNumber,
          openedAt: new Date().toISOString(),
          escalated: false,
          dismissed: false
        });
        
        console.log(`[courtrequest] ✅ Court request data saved`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
        cache.set(channel.id, {
          type: "court_request",
          openerId: interaction.user.id,
          openerTag: interaction.user.tag,
          ticketNumber,
          openedAt: new Date().toISOString()
        });
  
        const infoEmbed = new EmbedBuilder()
          .setTitle("⚖️ New Court Request")
          .addFields(
            { name: "Reporter", value: `<@${interaction.user.id}>`, inline: false },
            { name: "Reporter's Minecraft", value: reporterMinecraft, inline: true },
            { name: "Request #", value: `CR-${ticketNumber}`, inline: true },
            { name: "Accused (Minecraft)", value: accusedMinecraft, inline: true },
            { name: "Accused (Discord)", value: accusedDiscord, inline: true },
            { name: "Crime Type", value: crimeType, inline: false },
            { name: "Incident Details", value: incidentDetails.length > 1024 ? incidentDetails.substring(0, 1020) + "..." : incidentDetails, inline: false },
            { name: "Opened At", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
          )
          .setColor("#8B0000")
          .setFooter({ text: "Yazanaki Imperial Judiciary • Court Request" });
  
        const guidelinesEmbed = new EmbedBuilder()
          .setTitle("📋 Court Request Guidelines")
          .setDescription(
            "**What Happens Next:**\n" +
            "1. A High Inquisitor will review your request\n" +
            "2. If valid, your request may be escalated to a formal case\n" +
            "3. You may be contacted for additional information\n" +
            "4. False accusations will result in penalties\n\n" +
            "**Please Note:**\n" +
            "• Keep all evidence safe and accessible\n" +
            "• Be available to provide testimony if needed\n" +
            "• Do not harass or contact the accused directly\n" +
            "• Respect the judiciary's decision"
          )
          .setColor("#8B0000");
  
        const controlRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_court_request")
            .setLabel("🔒 Close Request")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`escalate_court_request_${interaction.user.id}`)
            .setLabel("🔼 Escalate to Formal Case")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`dismiss_court_request_${interaction.user.id}`)
            .setLabel("❌ Dismiss Request")
            .setStyle(ButtonStyle.Danger)
        );
  
        await channel.send({
          embeds: [infoEmbed, guidelinesEmbed],
          components: [controlRow]
        });
  
        await interaction.editReply({
          content: `✅ Your court request has been submitted: ${channel}`,
          flags: MessageFlags.Ephemeral
        });
      }
  
      // ============================================================
      // CLOSE COURT REQUEST MODAL
      // ============================================================
      if (interaction.customId.startsWith("close_court_request_modal_")) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
        const reason = interaction.fields.getTextInputValue("close_reason");
        const channelId = interaction.customId.split("close_court_request_modal_")[1];
        const channel = interaction.guild.channels.cache.get(channelId);
  
        if (!channel) {
          return interaction.editReply({
            content: "❌ Channel not found.",
            flags: MessageFlags.Ephemeral
          });
        }
  
        const ticketData = cache.get(channelId);
        if (ticketData) {
          const requestData = getCourtRequest(ticketData.openerId);
          if (requestData) {
            const { saveCourtRequest: updateCourtRequest } = require("./courtrequests");
            updateCourtRequest(
              ticketData.openerId,
              {
                ...requestData,
                closeReason: reason,
                closedAt: new Date().toISOString()
              }
            );
          }
        }
  
        await transcript.generate(interaction, channel, reason);
  
        return interaction.editReply({
          content: "✅ Court request closed and transcript saved.",
          flags: MessageFlags.Ephemeral
        });
      }
    }
  };