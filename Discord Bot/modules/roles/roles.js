// modules/roles/roles.js
// ✅ Management command for role configuration
// Allows admins to manage multi-guild role detection

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const {
  addGuildRoles,
  updateGuildRoles,
  removeGuildRoles,
  getAllGuildRoles,
  categorizeRole,
  loadRolesConfig
} = require("./rolesconfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("Manage role detection configuration for guilds")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add current guild to role detection")
    )
    .addSubcommand(sub =>
      sub
        .setName("update")
        .setDescription("Update role detection for current guild (refresh from Discord)")
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a guild from role detection")
        .addStringOption(opt =>
          opt
            .setName("guildid")
            .setDescription("Discord Guild ID to remove")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all guilds in role detection")
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View role configuration for current guild")
    )
    .addSubcommand(sub =>
      sub
        .setName("categorize")
        .setDescription("Change a role's category (rank or status)")
        .addRoleOption(opt =>
          opt
            .setName("role")
            .setDescription("The role to categorize")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName("type")
            .setDescription("Category type")
            .setRequired(true)
            .addChoices(
              { name: "Rank", value: "rank" },
              { name: "Status", value: "status" }
            )
        )
    ),

  async execute(interaction) {
    // Check permissions (requires Kick Members or Administrator)
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ You need the **Kick Members** permission to use this command.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    // ============================================================
    // ADD GUILD
    // ============================================================
    if (sub === "add") {
      await interaction.deferReply({ ephemeral: true });

      console.log(`[/roles add] 🎯 Adding guild: ${guild.name} (${guild.id})`);

      const success = await addGuildRoles(guild.id, guild.name, guild);

      if (success) {
        return interaction.editReply({
          content: `✅ Successfully added **${guild.name}** to role detection!\n\nAll roles have been imported and prioritized based on their Discord hierarchy.\n\nUse \`/roles view\` to see the configuration.`,
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: "❌ Failed to add guild to role detection. Check console for errors.",
          ephemeral: true
        });
      }
    }

    // ============================================================
    // UPDATE GUILD
    // ============================================================
    if (sub === "update") {
      await interaction.deferReply({ ephemeral: true });

      console.log(`[/roles update] 🔄 Updating guild: ${guild.name} (${guild.id})`);

      const success = await updateGuildRoles(guild.id, guild);

      if (success) {
        return interaction.editReply({
          content: `✅ Successfully updated role configuration for **${guild.name}**!\n\nAll roles have been refreshed from Discord while preserving your status/rank categorizations.`,
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: "❌ Failed to update guild roles. Check console for errors.",
          ephemeral: true
        });
      }
    }

    // ============================================================
    // REMOVE GUILD
    // ============================================================
    if (sub === "remove") {
      await interaction.deferReply({ ephemeral: true });

      const guildId = interaction.options.getString("guildid");
      console.log(`[/roles remove] 🗑️ Removing guild: ${guildId}`);

      const success = removeGuildRoles(guildId);

      if (success) {
        return interaction.editReply({
          content: `✅ Successfully removed guild **${guildId}** from role detection.`,
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: "❌ Guild not found or failed to remove. Check console for errors.",
          ephemeral: true
        });
      }
    }

    // ============================================================
    // LIST GUILDS
    // ============================================================
    if (sub === "list") {
      await interaction.deferReply({ ephemeral: true });

      const allGuilds = getAllGuildRoles();
      
      if (!allGuilds || Object.keys(allGuilds).length === 0) {
        return interaction.editReply({
          content: "📋 No guilds configured for role detection.\n\nUse `/roles add` in a guild to add it.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🎭 Role Detection Guilds")
        .setColor(0x000000)
        .setDescription("Guilds configured for automatic role detection:")
        .setFooter({ text: `Total: ${Object.keys(allGuilds).length} guilds` });

      for (const [guildId, config] of Object.entries(allGuilds)) {
        const rankCount = Object.keys(config.rankRoles || {}).length;
        const statusCount = Object.keys(config.statusRoles || {}).length;
        
        embed.addFields({
          name: config.name,
          value: `**ID:** \`${guildId}\`\n**Ranks:** ${rankCount} | **Statuses:** ${statusCount}`,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // VIEW GUILD
    // ============================================================
    if (sub === "view") {
      await interaction.deferReply({ ephemeral: true });

      const config = loadRolesConfig();
      
      if (!config || !config.guilds || !config.guilds[guild.id]) {
        return interaction.editReply({
          content: `❌ **${guild.name}** is not configured for role detection.\n\nUse \`/roles add\` to add it.`,
          ephemeral: true
        });
      }

      const guildConfig = config.guilds[guild.id];

      const embed = new EmbedBuilder()
        .setTitle(`🎭 Role Configuration: ${guild.name}`)
        .setColor(0x000000)
        .setThumbnail(guild.iconURL());

      // Rank Roles
      const rankRoles = Object.entries(guildConfig.rankRoles || {})
        .sort((a, b) => b[1].priority - a[1].priority) // Highest priority first
        .slice(0, 25) // Max 25 fields per embed
        .map(([id, data]) => `\`${data.priority}\` - <@&${id}> (${data.name})`)
        .join("\n");

      if (rankRoles) {
        embed.addFields({
          name: "📊 Rank Roles",
          value: rankRoles || "None",
          inline: false
        });
      }

      // Status Roles
      const statusRoles = Object.entries(guildConfig.statusRoles || {})
        .sort((a, b) => b[1].priority - a[1].priority) // Highest priority first
        .slice(0, 25)
        .map(([id, data]) => `\`${data.priority}\` - <@&${id}> (${data.name})`)
        .join("\n");

      if (statusRoles) {
        embed.addFields({
          name: "🏷️ Status Roles",
          value: statusRoles || "None",
          inline: false
        });
      }

      embed.setFooter({ 
        text: `Ranks: ${Object.keys(guildConfig.rankRoles || {}).length} | Statuses: ${Object.keys(guildConfig.statusRoles || {}).length}` 
      });

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // CATEGORIZE ROLE
    // ============================================================
    if (sub === "categorize") {
      await interaction.deferReply({ ephemeral: true });

      const role = interaction.options.getRole("role");
      const type = interaction.options.getString("type");

      console.log(`[/roles categorize] 🏷️ Categorizing role: ${role.name} as ${type}`);

      const success = categorizeRole(guild.id, role.id, type);

      if (success) {
        return interaction.editReply({
          content: `✅ Successfully categorized **${role.name}** as a **${type}** role!`,
          ephemeral: true
        });
      } else {
        return interaction.editReply({
          content: `❌ Failed to categorize role. Make sure this guild is added to role detection first with \`/roles add\`.`,
          ephemeral: true
        });
      }
    }
  }
};