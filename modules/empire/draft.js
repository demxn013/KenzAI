// modules/empire/draft-command.js
// ✅ Admin command for managing drafts

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require("discord.js");
const {
  getDraftStatus,
  getActiveDrafts,
  cancelDraft,
  completeDraft,
  readMembers
} = require("./draftlogic");
const config = require("./draftconfig");
const { restartScheduler } = require("./draftscheduler");
const { createDraftListEmbed } = require("./draftembed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("draft")
    .setDescription("Manage the draft system")
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View a member's draft status")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("Discord user")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all active drafts")
        .addStringOption(opt =>
          opt
            .setName("sort")
            .setDescription("How to sort/group the list")
            .setRequired(false)
            .addChoices(
              { name: "Time Remaining", value: "time" },
              { name: "Clan", value: "clan" },
              { name: "Draft Status", value: "status" }
            )
        )
        .addStringOption(opt =>
          opt
            .setName("clan")
            .setDescription("Only show drafts from this clan (name or abbreviation)")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("cancel")
        .setDescription("Cancel a draft and promote to Citizen")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("Discord user")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("complete")
        .setDescription("Force complete a draft")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("Discord user")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName("outcome")
            .setDescription("Outcome")
            .setRequired(true)
            .addChoices(
              { name: "Imperial Army", value: "army" },
              { name: "Citizen", value: "citizen" }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("stats")
        .setDescription("View draft system statistics")
    )
    .addSubcommand(sub =>
      sub
        .setName("config")
        .setDescription("View draft system configuration")
    )
    .addSubcommand(sub =>
      sub
        .setName("toggle-testing")
        .setDescription("Toggle testing mode (5-minute drafts)")
    ),

  async execute(interaction) {
    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ You need the **Kick Members** permission to use this command.",
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    // ============================================================
    // VIEW DRAFT STATUS
    // ============================================================
    if (sub === "view") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const status = getDraftStatus(user.id);

      if (!status) {
        return interaction.editReply({
          content: `❌ No draft information found for ${user.tag}`
        });
      }

      const members = readMembers();
      const member = members[user.id];

      const embed = new EmbedBuilder()
        .setTitle(`🎖️ Draft Status: ${user.tag}`)
        .setThumbnail(user.displayAvatarURL())
        .setColor(status.isActive ? 0xFFAA00 : 0x00AA00);

      if (status.isActive) {
        const timeframe = config.TESTING_MODE ? "minute(s)" : "day(s)";
        
        embed.setDescription(`**Status:** 🟢 Active Draft`)
          .addFields(
            { name: "Empire ID", value: `\`${member.EmpireID}\``, inline: true },
            { name: "Clan", value: member.JoinedClan, inline: true },
            { name: "Days Remaining", value: `\`${status.daysRemaining}\` ${timeframe}`, inline: true },
            { name: "Start Date", value: `<t:${Math.floor(new Date(status.startDate).getTime() / 1000)}:F>`, inline: false },
            { name: "Expiry Date", value: `<t:${Math.floor(new Date(status.expiryDate).getTime() / 1000)}:F>`, inline: false },
            { name: "Reminder Sent", value: status.reminderSent ? "✅ Yes" : "❌ No", inline: true },
            { name: "Expiry DM Sent", value: status.notified ? "✅ Yes" : "❌ No", inline: true }
          );
      } else {
        embed.setDescription(`**Status:** ✅ Draft Completed`)
          .addFields(
            { name: "Empire ID", value: `\`${member.EmpireID}\``, inline: true },
            { name: "Outcome", value: status.outcome || "Unknown", inline: true },
            { name: "Completed", value: `<t:${Math.floor(new Date(status.completedDate).getTime() / 1000)}:F>`, inline: false }
          );
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ============================================================
    // LIST ALL ACTIVE DRAFTS
    // ============================================================
    if (sub === "list") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const activeDrafts = getActiveDrafts();

      if (activeDrafts.length === 0) {
        return interaction.editReply({
          content: "📋 No active drafts found."
        });
      }

      const sort = interaction.options.getString("sort") || "time";
      const clanFilter = interaction.options.getString("clan");

      const { embed } = createDraftListEmbed(activeDrafts, {
        sort,
        clanFilter,
        testingMode: config.TESTING_MODE
      });

      return interaction.editReply({ embeds: [embed] });
    }

    // ============================================================
    // CANCEL DRAFT (PROMOTE TO CITIZEN)
    // ============================================================
    if (sub === "cancel") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const result = await cancelDraft(user.id, interaction.client);

      if (!result.success) {
        const reasons = {
          member_not_found: "Member not found in database.",
          no_active_draft: "Member does not have an active draft.",
          not_in_guild: "Member is not in Yazanaki Empire guild."
        };

        return interaction.editReply({
          content: `❌ Cannot cancel draft: ${reasons[result.reason] || result.reason}`
        });
      }

      return interaction.editReply({
        content: `✅ Draft cancelled for ${user.tag}. They have been promoted to **Citizen**.`
      });
    }

    // ============================================================
    // FORCE COMPLETE DRAFT
    // ============================================================
    if (sub === "complete") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const outcome = interaction.options.getString("outcome");

      const result = await completeDraft(user.id, outcome, interaction.client);

      if (!result.success) {
        const reasons = {
          member_not_found: "Member not found in database.",
          not_in_guild: "Member is not in Yazanaki Empire guild."
        };

        return interaction.editReply({
          content: `❌ Cannot complete draft: ${reasons[result.reason] || result.reason}`
        });
      }

      const outcomeText = outcome === "army" ? "Imperial Army" : "Citizen";

      return interaction.editReply({
        content: `✅ Draft completed for ${user.tag}. They are now: **${outcomeText}**`
      });
    }

    // ============================================================
    // STATISTICS
    // ============================================================
    if (sub === "stats") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const members = readMembers();
      const allMembers = Object.values(members);

      const activeDrafts = allMembers.filter(m => m.draftExpiryDate && !m.draftCompletedDate);
      const completedDrafts = allMembers.filter(m => m.draftCompletedDate);

      const outcomes = {
        army: completedDrafts.filter(m => m.draftOutcome === "army").length,
        citizen: completedDrafts.filter(m => m.draftOutcome === "citizen").length,
        timeout: completedDrafts.filter(m => m.draftOutcome === "timeout_citizen").length,
        left: completedDrafts.filter(m => m.draftOutcome === "left").length
      };

      const embed = new EmbedBuilder()
        .setTitle("📊 Draft System Statistics")
        .setColor(0x000000)
        .addFields(
          { name: "🟢 Active Drafts", value: `\`${activeDrafts.length}\``, inline: true },
          { name: "✅ Completed Drafts", value: `\`${completedDrafts.length}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "🎖️ Joined Army", value: `\`${outcomes.army}\``, inline: true },
          { name: "🏛️ Became Citizen", value: `\`${outcomes.citizen}\``, inline: true },
          { name: "⏱️ Timeout (Auto-Citizen)", value: `\`${outcomes.timeout}\``, inline: true },
          { name: "👋 Left Empire", value: `\`${outcomes.left}\``, inline: true }
        )
        .setFooter({ text: `Mode: ${config.TESTING_MODE ? "TESTING" : "Production"}` });

      return interaction.editReply({ embeds: [embed] });
    }

    // ============================================================
    // CONFIGURATION
    // ============================================================
    if (sub === "config") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const mode = config.TESTING_MODE ? "🧪 TESTING MODE" : "🚀 PRODUCTION MODE";
      
      let durationText, reminderText, autoText;
      
      if (config.TESTING_MODE) {
        durationText = `${config.DRAFT_DURATION_MINUTES} minutes`;
        reminderText = `${config.REMINDER_MINUTES_BEFORE} minutes before expiry`;
        autoText = `${config.AUTO_CITIZEN_MINUTES} minute after expiry`;
      } else {
        durationText = `${config.DRAFT_DURATION_DAYS} days (${Math.floor(config.DRAFT_DURATION_DAYS / 30)} months)`;
        reminderText = `${config.REMINDER_DAYS_BEFORE} days before expiry`;
        autoText = `${config.AUTO_CITIZEN_HOURS} hours after expiry`;
      }

      const checkInterval = config.getCheckInterval() / 1000 / 60;

      const embed = new EmbedBuilder()
        .setTitle("⚙️ Draft System Configuration")
        .setDescription(`**Mode:** ${mode}`)
        .setColor(config.TESTING_MODE ? 0xFFAA00 : 0x00AA00)
        .addFields(
          { name: "Draft Duration", value: durationText, inline: false },
          { name: "Reminder Timing", value: reminderText, inline: false },
          { name: "Auto-Citizen Timeout", value: autoText, inline: false },
          { name: "Check Interval", value: `${checkInterval} minute(s)`, inline: false },
          { name: "Yazanaki Empire Guild ID", value: `\`${config.YAZANAKI_EMPIRE_GUILD_ID}\``, inline: false }
        )
        .setFooter({ text: "Use /draft toggle-testing to switch modes" });

      return interaction.editReply({ embeds: [embed] });
    }

    // ============================================================
    // TOGGLE TESTING MODE
    // ============================================================
    if (sub === "toggle-testing") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      config.TESTING_MODE = !config.TESTING_MODE;

      const newMode = config.TESTING_MODE ? "🧪 TESTING MODE" : "🚀 PRODUCTION MODE";
      const duration = config.TESTING_MODE
        ? `${config.DRAFT_DURATION_MINUTES} minutes`
        : `${config.DRAFT_DURATION_DAYS} days`;

      // Restart scheduler with new config
      restartScheduler(interaction.client);

      const embed = new EmbedBuilder()
        .setTitle("⚙️ Draft Mode Changed")
        .setDescription(
          `Draft system is now in: **${newMode}**\n\n` +
          `**Draft Duration:** ${duration}\n` +
          `**Scheduler:** Restarted with new configuration\n\n` +
          `⚠️ **Note:** Existing drafts will continue with their original expiry dates. Only NEW drafts will use the new duration.`
        )
        .setColor(config.TESTING_MODE ? 0xFFAA00 : 0x00AA00);

      return interaction.editReply({ embeds: [embed] });
    }
  }
};