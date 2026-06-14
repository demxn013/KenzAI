// modules/judiciary/court.js
// ✅ Main judiciary command interface

const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ChannelType } = require("discord.js");
const { hasAuthority, isAssignedInquisitor } = require('./permissions');
const caselogic = require('./caselogic');
const investigation = require('./investigationlogic');
const verdict = require('./verdictlogic');
const enforcement = require('./enforcementlogic');
const { updateCaseEmbeds } = require('./embedrenderer');
const { STATES } = require('./statemachine');

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("court")
    .setDescription("Yazanaki Imperial Judiciary System")
    
    // ============================================================
    // CASE MANAGEMENT
    // ============================================================
    .addSubcommandGroup(group =>
      group
        .setName("case")
        .setDescription("Case management")
        .addSubcommand(sub =>
          sub
            .setName("create")
            .setDescription("Create a new case [High Inquisitor+]")
            .addStringOption(opt =>
              opt
                .setName("type")
                .setDescription("Case type")
                .setRequired(true)
                .addChoices(
                  { name: "Criminal", value: "CRIMINAL" },
                  { name: "Civil", value: "CIVIL" },
                  { name: "Constitutional", value: "CONSTITUTIONAL" }
                )
            )
            .addStringOption(opt =>
              opt
                .setName("clan")
                .setDescription("Clan abbreviation (e.g., ONA, SNU)")
                .setRequired(true)
            )
            .addUserOption(opt =>
              opt
                .setName("accused")
                .setDescription("Accused member")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("charges")
                .setDescription("Charges (separate multiple with ;)")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("severity")
                .setDescription("Case severity")
                .setRequired(true)
                .addChoices(
                  { name: "Minor", value: "MINOR" },
                  { name: "Moderate", value: "MODERATE" },
                  { name: "Severe", value: "SEVERE" }
                )
            )
            .addUserOption(opt =>
              opt
                .setName("plaintiff")
                .setDescription("Plaintiff (optional, defaults to you)")
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("view")
            .setDescription("View case details [All]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID (e.g., ONA-CRIM-2026-004)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("list")
            .setDescription("List cases [All]")
            .addStringOption(opt =>
              opt
                .setName("state")
                .setDescription("Filter by state")
                .setRequired(false)
                .addChoices(
                  { name: "Requested", value: "REQUESTED" },
                  { name: "Intake Review", value: "INTAKE_REVIEW" },
                  { name: "Investigation", value: "INVESTIGATION" },
                  { name: "Pre-Hearing", value: "PRE_HEARING" },
                  { name: "Hearing Scheduled", value: "HEARING_SCHEDULED" },
                  { name: "Hearing Completed", value: "HEARING_COMPLETED" },
                  { name: "Verdict Pending", value: "VERDICT_PENDING" },
                  { name: "Signed Off", value: "SIGNED_OFF" },
                  { name: "Enforced", value: "ENFORCED" },
                  { name: "Closed", value: "CLOSED" }
                )
            )
            .addStringOption(opt =>
              opt
                .setName("type")
                .setDescription("Filter by case type")
                .setRequired(false)
                .addChoices(
                  { name: "Criminal", value: "CRIMINAL" },
                  { name: "Civil", value: "CIVIL" },
                  { name: "Constitutional", value: "CONSTITUTIONAL" }
                )
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("assign")
            .setDescription("Assign inquisitor to case [High Inquisitor+]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addUserOption(opt =>
              opt
                .setName("inquisitor")
                .setDescription("Inquisitor to assign")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("dismiss")
            .setDescription("Dismiss case [Grand Magistrate+]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("reason")
                .setDescription("Dismissal reason")
                .setRequired(true)
            )
        )
    )
    
    // ============================================================
    // INVESTIGATION
    // ============================================================
    .addSubcommandGroup(group =>
      group
        .setName("investigation")
        .setDescription("Investigation management")
        .addSubcommand(sub =>
          sub
            .setName("add-finding")
            .setDescription("Add investigation finding [Assigned Inquisitor]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("title")
                .setDescription("Finding title")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("description")
                .setDescription("Detailed description")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("severity")
                .setDescription("Finding severity")
                .setRequired(true)
                .addChoices(
                  { name: "Low", value: "LOW" },
                  { name: "Medium", value: "MEDIUM" },
                  { name: "High", value: "HIGH" },
                  { name: "Critical", value: "CRITICAL" }
                )
            )
            .addStringOption(opt =>
              opt
                .setName("evidence")
                .setDescription("Evidence links (separate multiple with ;)")
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("edit-finding")
            .setDescription("Edit investigation finding [Assigned Inquisitor]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("finding_id")
                .setDescription("Finding ID (e.g., F001)")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("title")
                .setDescription("New title")
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName("description")
                .setDescription("New description")
                .setRequired(false)
            )
            .addStringOption(opt =>
              opt
                .setName("severity")
                .setDescription("New severity")
                .setRequired(false)
                .addChoices(
                  { name: "Low", value: "LOW" },
                  { name: "Medium", value: "MEDIUM" },
                  { name: "High", value: "HIGH" },
                  { name: "Critical", value: "CRITICAL" }
                )
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("verify-finding")
            .setDescription("Verify finding [High Inquisitor]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("finding_id")
                .setDescription("Finding ID (e.g., F001)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("set-summary")
            .setDescription("Set investigation summary [Assigned Inquisitor]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("summary")
                .setDescription("Investigation summary")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("complete")
            .setDescription("Complete investigation [High Inquisitor]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
    )
    
    // ============================================================
    // VERDICT
    // ============================================================
    .addSubcommandGroup(group =>
      group
        .setName("verdict")
        .setDescription("Verdict management")
        .addSubcommand(sub =>
          sub
            .setName("propose")
            .setDescription("Propose verdict [Grand Vizier]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("decision")
                .setDescription("Verdict decision (GUILTY/NOT GUILTY)")
                .setRequired(true)
                .addChoices(
                  { name: "Guilty", value: "GUILTY" },
                  { name: "Not Guilty", value: "NOT_GUILTY" }
                )
            )
            .addStringOption(opt =>
              opt
                .setName("reasoning")
                .setDescription("Legal reasoning")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("punishment")
                .setDescription("Punishment (if guilty)")
                .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("finalize")
            .setDescription("Finalize verdict [Grand Vizier]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
    )
    
    // ============================================================
    // SIGNOFF
    // ============================================================
    .addSubcommandGroup(group =>
      group
        .setName("signoff")
        .setDescription("Verdict signoff")
        .addSubcommand(sub =>
          sub
            .setName("sign")
            .setDescription("Sign off on verdict [Required Authority]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("reject")
            .setDescription("Reject verdict [Required Authority]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("reason")
                .setDescription("Rejection reason")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("status")
            .setDescription("View signoff status [All]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
    )
    
    // ============================================================
    // ENFORCEMENT
    // ============================================================
    .addSubcommandGroup(group =>
      group
        .setName("enforcement")
        .setDescription("Enforcement and case closure")
        .addSubcommand(sub =>
          sub
            .setName("execute")
            .setDescription("Execute enforcement [DEMXN06]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("actions")
                .setDescription("Actions taken (separate multiple with ;)")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("verify")
            .setDescription("Verify enforcement [DEMXN01]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("close")
            .setDescription("Close case [Grand Vizier]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("pardon")
            .setDescription("Pardon case [Emperor/Empress]")
            .addStringOption(opt =>
              opt
                .setName("case_id")
                .setDescription("Case ID")
                .setRequired(true)
            )
            .addStringOption(opt =>
              opt
                .setName("reason")
                .setDescription("Pardon reason")
                .setRequired(true)
            )
        )
    ),

  async execute(interaction) {
    // Get subcommand group and subcommand
    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    
    console.log(`[/court] ${group ? `${group} ` : ''}${subcommand} invoked by ${interaction.user.tag}`);
    
    // Route to appropriate handler
    if (group === "case") {
      return handleCaseCommands(interaction, subcommand);
    } else if (group === "investigation") {
      return handleInvestigationCommands(interaction, subcommand);
    } else if (group === "verdict") {
      return handleVerdictCommands(interaction, subcommand);
    } else if (group === "signoff") {
      return handleSignoffCommands(interaction, subcommand);
    } else if (group === "enforcement") {
      return handleEnforcementCommands(interaction, subcommand);
    }
  }
};

// Continue in next part...

// ============================================================
// CASE COMMAND HANDLERS
// ============================================================

async function handleCaseCommands(interaction, subcommand) {
    const member = interaction.member;
    
    // ============================================================
    // CREATE CASE
    // ============================================================
    if (subcommand === "create") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "HIGH_INQUISITOR")) {
        return interaction.editReply({
          content: "❌ Only High Inquisitors can create cases.",
          ephemeral: true
        });
      }
      
      const caseType = interaction.options.getString("type");
      const clanAbbr = interaction.options.getString("clan").toUpperCase();
      const accused = interaction.options.getUser("accused");
      const chargesRaw = interaction.options.getString("charges");
      const severity = interaction.options.getString("severity");
      const plaintiff = interaction.options.getUser("plaintiff") || interaction.user;
      
      const charges = chargesRaw.split(';').map(c => c.trim());
      
      const params = {
        caseType,
        clanAbbr,
        accusedId: accused.id,
        charges,
        severity,
        plaintiffId: plaintiff.id,
        isConstitutional: caseType === "CONSTITUTIONAL"
      };
      
      try {
        const caseData = caselogic.createCase(params, member);
        
        // Create forum threads
        await createCaseThreads(interaction, caseData);
        
        const embed = new EmbedBuilder()
          .setTitle(`✅ Case Created: ${caseData.case_id}`)
          .setColor(0x00AA00)
          .addFields(
            { name: "Type", value: caseType, inline: true },
            { name: "Severity", value: severity, inline: true },
            { name: "Accused", value: `<@${accused.id}>`, inline: false },
            { name: "Charges", value: charges.map((c, i) => `${i + 1}. ${c}`).join("\n"), inline: false },
            { name: "State", value: "REQUESTED", inline: false }
          )
          .setFooter({ text: `Case ID: ${caseData.case_id}` });
        
        return interaction.editReply({ embeds: [embed], ephemeral: true });
        
      } catch (err) {
        console.error("[/court case create] Error:", err);
        return interaction.editReply({
          content: `❌ Failed to create case: ${err.message}`,
          ephemeral: true
        });
      }
    }
    
    // ============================================================
    // VIEW CASE
    // ============================================================
    if (subcommand === "view") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const caseData = caselogic.getCase(caseId);
      
      if (!caseData) {
        return interaction.editReply({
          content: `❌ Case not found: ${caseId}`,
          ephemeral: true
        });
      }
      
      const { renderJudiciaryEmbed } = require('./embedrenderer');
      const embed = renderJudiciaryEmbed(caseData);
      
      // Add thread links
      const threadLinks = [];
      if (caseData.threads.inquisitor_thread_id) {
        threadLinks.push(`🔍 [Inquisitor Thread](https://discord.com/channels/${YAZANAKI_EMPIRE_GUILD_ID}/${caseData.threads.inquisitor_thread_id})`);
      }
      if (caseData.threads.judiciary_thread_id) {
        threadLinks.push(`⚖️ [Judiciary Records](https://discord.com/channels/${YAZANAKI_EMPIRE_GUILD_ID}/${caseData.threads.judiciary_thread_id})`);
      }
      
      if (threadLinks.length > 0) {
        embed.addFields({
          name: "📂 Case Threads",
          value: threadLinks.join("\n"),
          inline: false
        });
      }
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // LIST CASES
    // ============================================================
    if (subcommand === "list") {
      await interaction.deferReply({ ephemeral: true });
      
      const filters = {};
      
      const state = interaction.options.getString("state");
      if (state) filters.state = state;
      
      const type = interaction.options.getString("type");
      if (type) filters.caseType = type;
      
      const cases = caselogic.getAllCases(filters);
      
      if (cases.length === 0) {
        return interaction.editReply({
          content: "📋 No cases found matching your filters.",
          ephemeral: true
        });
      }
      
      const embed = new EmbedBuilder()
        .setTitle("📋 Case List")
        .setColor(0x000000)
        .setDescription(`Found ${cases.length} case(s)`)
        .setFooter({ text: `Filters: ${Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(", ") || "None"}` });
      
      // Show up to 25 cases
      cases.slice(0, 25).forEach(c => {
        const statemachine = require('./statemachine');
        embed.addFields({
          name: `${c.case_id} - ${c.classification.type}`,
          value: 
            `**State:** ${statemachine.getStateDescription(c.metadata.state)}\n` +
            `**Accused:** <@${c.parties.accused.discord_id}>\n` +
            `**Created:** <t:${Math.floor(new Date(c.metadata.created_at).getTime() / 1000)}:R>`,
          inline: false
        });
      });
      
      if (cases.length > 25) {
        embed.addFields({
          name: "⚠️ Too Many Results",
          value: `Showing first 25 of ${cases.length} cases. Use filters to narrow results.`,
          inline: false
        });
      }
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // ASSIGN INQUISITOR
    // ============================================================
    if (subcommand === "assign") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "HIGH_INQUISITOR")) {
        return interaction.editReply({
          content: "❌ Only High Inquisitors can assign inquisitors.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const inquisitor = interaction.options.getUser("inquisitor");
      
      const result = investigation.assignInquisitor(caseId, inquisitor.id, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          already_assigned: `${inquisitor.tag} is already assigned to this case`
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ ${inquisitor.tag} assigned to case ${caseId}`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // DISMISS CASE
    // ============================================================
    if (subcommand === "dismiss") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "GRAND_MAGISTRATE")) {
        return interaction.editReply({
          content: "❌ Only Grand Magistrates can dismiss cases.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const reason = interaction.options.getString("reason");
      
      const result = enforcement.dismissCase(caseId, reason, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          case_too_advanced: "Cannot dismiss cases that have been signed off or enforced"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.message || result.reason}`,
          ephemeral: true
        });
      }
      
      return interaction.editReply({
        content: `✅ Case ${caseId} dismissed.\n**Reason:** ${reason}`,
        ephemeral: true
      });
    }
  }
  
  // ============================================================
  // INVESTIGATION COMMAND HANDLERS
  // ============================================================
  
  async function handleInvestigationCommands(interaction, subcommand) {
    const member = interaction.member;
    
    // ============================================================
    // ADD FINDING
    // ============================================================
    if (subcommand === "add-finding") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const title = interaction.options.getString("title");
      const description = interaction.options.getString("description");
      const severity = interaction.options.getString("severity");
      const evidenceRaw = interaction.options.getString("evidence");
      
      const evidenceLinks = evidenceRaw ? evidenceRaw.split(';').map(e => e.trim()) : [];
      
      const findingData = {
        title,
        description,
        severity,
        evidenceLinks
      };
      
      const result = investigation.addFinding(caseId, findingData, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message,
          not_assigned: "You are not assigned to this case"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Finding Added: ${result.findingId}`)
        .setColor(0x00AA00)
        .addFields(
          { name: "Case", value: caseId, inline: true },
          { name: "Finding ID", value: result.findingId, inline: true },
          { name: "Title", value: title, inline: false },
          { name: "Severity", value: severity, inline: true },
          { name: "Status", value: "⚠️ Unverified - Pending High Inquisitor review", inline: false }
        )
        .setFooter({ text: "Finding has been added to both investigation and judiciary records" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // EDIT FINDING
    // ============================================================
    if (subcommand === "edit-finding") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const findingId = interaction.options.getString("finding_id").toUpperCase();
      
      const updates = {};
      
      const title = interaction.options.getString("title");
      if (title) updates.title = title;
      
      const description = interaction.options.getString("description");
      if (description) updates.description = description;
      
      const severity = interaction.options.getString("severity");
      if (severity) updates.severity = severity;
      
      if (Object.keys(updates).length === 0) {
        return interaction.editReply({
          content: "❌ You must provide at least one field to update.",
          ephemeral: true
        });
      }
      
      const result = investigation.editFinding(caseId, findingId, updates, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          finding_not_found: `Finding not found: ${findingId}`,
          finding_redacted: "Cannot edit redacted findings",
          insufficient_permission: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ Finding ${findingId} updated successfully.\n**Changes:** ${Object.keys(updates).join(", ")}`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // VERIFY FINDING
    // ============================================================
    if (subcommand === "verify-finding") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "HIGH_INQUISITOR")) {
        return interaction.editReply({
          content: "❌ Only High Inquisitors can verify findings.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const findingId = interaction.options.getString("finding_id").toUpperCase();
      
      const result = investigation.verifyFinding(caseId, findingId, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          finding_not_found: `Finding not found: ${findingId}`,
          already_verified: "Finding is already verified"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ Finding ${findingId} verified.\n\nThis finding will now appear in official judiciary records.`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // SET SUMMARY
    // ============================================================
    if (subcommand === "set-summary") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const summary = interaction.options.getString("summary");
      
      const result = investigation.setSummary(caseId, summary, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message,
          not_assigned: "You are not assigned to this case"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ Investigation summary updated for case ${caseId}`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // COMPLETE INVESTIGATION
    // ============================================================
    if (subcommand === "complete") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "HIGH_INQUISITOR")) {
        return interaction.editReply({
          content: "❌ Only High Inquisitors can complete investigations.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = investigation.completeInvestigation(caseId, member);
      
      if (!result.success) {
        if (result.reason === "incomplete_investigation") {
          const errorList = result.errors.join("\n");
          return interaction.editReply({
            content: `❌ Investigation cannot be completed:\n\n${errorList}`,
            ephemeral: true
          });
        }
        
        const reasons = {
          case_not_found: `Case not found: ${caseId}`
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.message || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Investigation Completed: ${caseId}`)
        .setColor(0x00AA00)
        .setDescription("Case has been transitioned to PRE_HEARING state.")
        .addFields(
          { name: "Next Steps", value: "Grand Magistrates will now schedule a hearing.", inline: false }
        )
        .setFooter({ text: "Investigation records are now locked" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
  
  // ============================================================
  // VERDICT COMMAND HANDLERS
  // ============================================================
  
  async function handleVerdictCommands(interaction, subcommand) {
    const member = interaction.member;
    
    // ============================================================
    // PROPOSE VERDICT
    // ============================================================
    if (subcommand === "propose") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "GRAND_VIZIER")) {
        return interaction.editReply({
          content: "❌ Only Grand Vizier can propose verdicts.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const decision = interaction.options.getString("decision");
      const reasoning = interaction.options.getString("reasoning");
      const punishment = interaction.options.getString("punishment");
      
      const verdictData = {
        decision,
        reasoning,
        punishment
      };
      
      const result = verdict.proposeVerdict(caseId, verdictData, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      // Get signoff status
      const signoffStatus = verdict.checkSignoffStatus(caseData);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Verdict Proposed: ${caseId}`)
        .setColor(0x00AA00)
        .addFields(
          { name: "Decision", value: decision, inline: true },
          { name: "Punishment", value: punishment || "n/d", inline: true },
          { name: "Reasoning", value: reasoning, inline: false },
          { name: "Required Signoffs", value: signoffStatus.required.join(", "), inline: false }
        )
        .setFooter({ text: "Awaiting required signoffs before finalization" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // FINALIZE VERDICT
    // ============================================================
    if (subcommand === "finalize") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "GRAND_VIZIER")) {
        return interaction.editReply({
          content: "❌ Only Grand Vizier can finalize verdicts.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = verdict.finalizeVerdict(caseId, member);
      
      if (!result.success) {
        if (result.reason === "incomplete_signoffs") {
          const pendingList = result.pending.join(", ");
          return interaction.editReply({
            content: `❌ All required signoffs must be complete before finalizing.\n\n**Pending:** ${pendingList}`,
            ephemeral: true
          });
        }
        
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message,
          no_verdict: "No verdict has been proposed yet"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      const embed = new EmbedBuilder()
        .setTitle(`✅ Verdict Finalized: ${caseId}`)
        .setColor(0x00AA00)
        .setDescription("Case has been transitioned to SIGNED_OFF state.")
        .addFields(
          { name: "Next Steps", value: "DEMXN06 (Master of Laws) will now execute enforcement.", inline: false }
        )
        .setFooter({ text: "Verdict is now immutable" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
  
  // ============================================================
  // SIGNOFF COMMAND HANDLERS
  // ============================================================
  
  async function handleSignoffCommands(interaction, subcommand) {
    const member = interaction.member;
    
    // ============================================================
    // SIGN OFF
    // ============================================================
    if (subcommand === "sign") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = verdict.signOffVerdict(caseId, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          not_required_authority: result.message,
          already_signed: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      // Check if all signoffs are complete
      const signoffStatus = verdict.checkSignoffStatus(caseData);
      
      let message = `✅ You have signed off on case ${caseId}`;
      
      if (signoffStatus.complete) {
        message += "\n\n🎉 **All required signoffs are now complete!**\nGrand Vizier can now finalize the verdict.";
      } else {
        message += `\n\n**Still pending:** ${signoffStatus.pending.join(", ")}`;
      }
      
      return interaction.editReply({
        content: message,
        ephemeral: true
      });
    }
    
    // ============================================================
    // REJECT VERDICT
    // ============================================================
    if (subcommand === "reject") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const reason = interaction.options.getString("reason");
      
      const result = verdict.rejectVerdict(caseId, reason, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          not_required_authority: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ Verdict rejected for case ${caseId}\n\n**Reason:** ${reason}\n\nCase returned to HEARING_SCHEDULED for re-deliberation.`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // SIGNOFF STATUS
    // ============================================================
    if (subcommand === "status") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = verdict.getSignoffStatus(caseId);
      
      if (!result.success) {
        return interaction.editReply({
          content: `❌ Case not found: ${caseId}`,
          ephemeral: true
        });
      }
      
      const status = result.status;
      const caseData = result.caseData;
      
      const embed = new EmbedBuilder()
        .setTitle(`📜 Signoff Status: ${caseId}`)
        .setColor(status.complete ? 0x00AA00 : 0xFFAA00);
      
      const signoffList = status.required.map(auth => {
        const signature = caseData.signoff.signatures.find(s => s.authority === auth);
        if (signature) {
          return `✅ **${auth}** - <@${signature.signed_by}> (<t:${Math.floor(new Date(signature.signed_at).getTime() / 1000)}:R>)`;
        } else {
          return `⏳ **${auth}** - Pending`;
        }
      }).join("\n");
      
      embed.addFields({
        name: "Required Signoffs",
        value: signoffList,
        inline: false
      });
      
      if (status.complete) {
        embed.setDescription("✅ **All signoffs complete** - Ready for finalization");
      } else {
        embed.setDescription(`⏳ **Awaiting ${status.pending.length} signoff(s)**`);
      }
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
  
  // ============================================================
  // ENFORCEMENT COMMAND HANDLERS
  // ============================================================
  
  async function handleEnforcementCommands(interaction, subcommand) {
    const member = interaction.member;
    
    // ============================================================
    // EXECUTE ENFORCEMENT
    // ============================================================
    if (subcommand === "execute") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "DEMXN06")) {
        return interaction.editReply({
          content: "❌ Only DEMXN06 (Master of Laws) can execute enforcement.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const actionsRaw = interaction.options.getString("actions");
      
      const actionsTaken = actionsRaw.split(';').map(a => a.trim());
      
      const result = enforcement.executeEnforcement(caseId, actionsTaken, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Enforcement Executed: ${caseId}`)
        .setColor(0x00AA00)
        .setDescription("Case has been transitioned to ENFORCED state.")
        .addFields(
          { name: "Actions Taken", value: actionsTaken.map((a, i) => `${i + 1}. ${a}`).join("\n"), inline: false },
          { name: "Next Steps", value: "DEMXN01 (Record Keeper) must verify enforcement before case can be closed.", inline: false }
        )
        .setFooter({ text: "Awaiting verification" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // VERIFY ENFORCEMENT
    // ============================================================
    if (subcommand === "verify") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "DEMXN01")) {
        return interaction.editReply({
          content: "❌ Only DEMXN01 (Record Keeper) can verify enforcement.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = enforcement.verifyEnforcement(caseId, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message,
          not_executed: "Enforcement has not been executed yet",
          already_verified: "Enforcement has already been verified"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      // Update embeds
      const caseData = caselogic.getCase(caseId);
      await updateCaseEmbeds(caseData, interaction.client);
      
      return interaction.editReply({
        content: `✅ Enforcement verified for case ${caseId}\n\nGrand Vizier can now close the case.`,
        ephemeral: true
      });
    }
    
    // ============================================================
    // CLOSE CASE
    // ============================================================
    if (subcommand === "close") {
      await interaction.deferReply({ ephemeral: true });
      
      // Check authority
      if (!hasAuthority(member, "GRAND_VIZIER")) {
        return interaction.editReply({
          content: "❌ Only Grand Vizier can close cases.",
          ephemeral: true
        });
      }
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      
      const result = enforcement.closeCase(caseId, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          invalid_state: result.message,
          enforcement_not_verified: "Enforcement must be verified by DEMXN01 before closing"
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`🔒 Case Closed: ${caseId}`)
        .setColor(0x000000)
        .setDescription("Case has been closed and archived.")
        .addFields(
          { name: "Status", value: "This case is now in terminal state and cannot be modified.", inline: false }
        )
        .setFooter({ text: "Case archived to archived_cases.json" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
    
    // ============================================================
    // PARDON CASE
    // ============================================================
    if (subcommand === "pardon") {
      await interaction.deferReply({ ephemeral: true });
      
      const caseId = interaction.options.getString("case_id").toUpperCase();
      const reason = interaction.options.getString("reason");
      
      const result = enforcement.pardonCase(caseId, reason, member);
      
      if (!result.success) {
        const reasons = {
          case_not_found: `Case not found: ${caseId}`,
          insufficient_authority: result.message,
          invalid_state: result.message
        };
        
        return interaction.editReply({
          content: `❌ ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`🕊️ Case Pardoned: ${caseId}`)
        .setColor(0xF1C40F)
        .setDescription("Case has been pardoned by imperial decree.")
        .addFields(
          { name: "Pardoned By", value: `<@${member.id}>`, inline: false },
          { name: "Reason", value: reason, inline: false }
        )
        .setFooter({ text: "Case archived to archived_cases.json" });
      
      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
  
  // ============================================================
  // HELPER: CREATE CASE THREADS
  // ============================================================
  
  async function createCaseThreads(interaction, caseData) {
    console.log(`[court] 📂 Creating threads for ${caseData.case_id}`);
    
    const guild = interaction.guild;
    
    // Find Inquisitor Case Forum
    const inquisitorForum = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildForum &&
      c.name.toLowerCase().includes("inquisitor") &&
      c.name.toLowerCase().includes("case")
    );
    
    // Find Judiciary Records Forum
    const judiciaryForum = guild.channels.cache.find(c =>
      c.type === ChannelType.GuildForum &&
      c.name.toLowerCase().includes("judiciary") &&
      c.name.toLowerCase().includes("record")
    );
    
    if (!inquisitorForum) {
      console.warn(`[court] ⚠️ Inquisitor Case Forum not found`);
    }
    
    if (!judiciaryForum) {
      console.warn(`[court] ⚠️ Judiciary Records Forum not found`);
    }
    
    const { renderInquisitorEmbed, renderJudiciaryEmbed } = require('./embedrenderer');
    
    // Create inquisitor thread
    if (inquisitorForum) {
      try {
        const inquisitorEmbed = renderInquisitorEmbed(caseData);
        
        const inquisitorThread = await inquisitorForum.threads.create({
          name: caseData.case_id,
          message: {
            embeds: [inquisitorEmbed]
          }
        });
        
        caseData.threads.inquisitor_thread_id = inquisitorThread.id;
        
        // Pin the embed
        const messages = await inquisitorThread.messages.fetch({ limit: 1 });
        const embedMessage = messages.first();
        if (embedMessage) {
          await embedMessage.pin();
        }
        
        console.log(`[court] ✅ Created inquisitor thread: ${inquisitorThread.id}`);
        
      } catch (err) {
        console.error(`[court] ❌ Failed to create inquisitor thread:`, err);
      }
    }
    
    // Create judiciary thread
    if (judiciaryForum) {
      try {
        const judiciaryEmbed = renderJudiciaryEmbed(caseData);
        
        const judiciaryThread = await judiciaryForum.threads.create({
          name: caseData.case_id,
          message: {
            embeds: [judiciaryEmbed]
          }
        });
        
        caseData.threads.judiciary_thread_id = judiciaryThread.id;
        
        // Pin the embed
        const messages = await judiciaryThread.messages.fetch({ limit: 1 });
        const embedMessage = messages.first();
        if (embedMessage) {
          await embedMessage.pin();
        }
        
        console.log(`[court] ✅ Created judiciary thread: ${judiciaryThread.id}`);
        
      } catch (err) {
        console.error(`[court] ❌ Failed to create judiciary thread:`, err);
      }
    }
    
    // Update case with thread IDs
    caselogic.updateCase(caseData.case_id, caseData);
  }