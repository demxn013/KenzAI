// modules/empire/empireid-command.js
// ✅ Command to manage Empire IDs (reserve, view, update)

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const {
  reserveEmpireId,
  updateReservedId,
  getAllEmpireIds,
  getEmpireIdInfo,
  getEmpireId,
  EMPIRE_ABBR,
  RESERVED_COUNT
} = require("./empireid");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("empireid")
    .setDescription("Manage Yazanaki Empire IDs")
    .addSubcommand(sub =>
      sub
        .setName("reserve")
        .setDescription(`Reserve a YZNK ID (1-${RESERVED_COUNT})`)
        .addIntegerOption(opt =>
          opt
            .setName("number")
            .setDescription(`ID number (1-${RESERVED_COUNT})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(RESERVED_COUNT)
        )
        .addUserOption(opt =>
          opt
            .setName("discord")
            .setDescription("Discord user (optional)")
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName("minecraft")
            .setDescription("Minecraft username (optional)")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("update")
        .setDescription("Update a reserved YZNK ID")
        .addStringOption(opt =>
          opt
            .setName("empireid")
            .setDescription("Empire ID (e.g., YZNK-000001)")
            .setRequired(true)
        )
        .addUserOption(opt =>
          opt
            .setName("discord")
            .setDescription("Discord user")
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName("minecraft")
            .setDescription("Minecraft username")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View Empire ID info")
        .addStringOption(opt =>
          opt
            .setName("empireid")
            .setDescription("Empire ID (e.g., SNU-000014)")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("lookup")
        .setDescription("Look up a user's Empire ID")
        .addUserOption(opt =>
          opt
            .setName("discord")
            .setDescription("Discord user")
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName("minecraft")
            .setDescription("Minecraft username")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all Empire IDs")
        .addStringOption(opt =>
          opt
            .setName("filter")
            .setDescription("Filter by type")
            .setRequired(false)
            .addChoices(
              { name: "All", value: "all" },
              { name: "Reserved (YZNK)", value: "reserved" },
              { name: "Regular", value: "regular" }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("stats")
        .setDescription("View Empire ID statistics")
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

    // ============================================================
    // RESERVE
    // ============================================================
    if (sub === "reserve") {
      await interaction.deferReply({ ephemeral: true });

      const num = interaction.options.getInteger("number");
      const discordUser = interaction.options.getUser("discord");
      const mcName = interaction.options.getString("minecraft");

      const result = reserveEmpireId(
        num,
        discordUser?.id || null,
        mcName || null
      );

      if (!result.success) {
        if (result.reason === "already_reserved") {
          return interaction.editReply({
            content: `⚠️ **${result.empireId}** is already reserved.`,
            ephemeral: true
          });
        }
        return interaction.editReply({
          content: `❌ Failed to reserve ID: ${result.reason}`,
          ephemeral: true
        });
      }

      let msg = `✅ Reserved **${result.empireId}**`;
      if (discordUser) msg += `\n👤 Discord: ${discordUser.tag}`;
      if (mcName) msg += `\n🎮 Minecraft: \`${mcName}\``;

      return interaction.editReply({
        content: msg,
        ephemeral: true
      });
    }

    // ============================================================
    // UPDATE
    // ============================================================
    if (sub === "update") {
      await interaction.deferReply({ ephemeral: true });

      const empireId = interaction.options.getString("empireid").toUpperCase();
      const discordUser = interaction.options.getUser("discord");
      const mcName = interaction.options.getString("minecraft");

      if (!discordUser && !mcName) {
        return interaction.editReply({
          content: "❌ You must provide at least one of: Discord user or Minecraft username",
          ephemeral: true
        });
      }

      const result = updateReservedId(
        empireId,
        discordUser?.id || null,
        mcName || null
      );

      if (!result.success) {
        return interaction.editReply({
          content: `❌ Failed to update: ${result.reason}`,
          ephemeral: true
        });
      }

      let msg = `✅ Updated **${empireId}**`;
      if (discordUser) msg += `\n👤 Discord: ${discordUser.tag}`;
      if (mcName) msg += `\n🎮 Minecraft: \`${mcName}\``;

      return interaction.editReply({
        content: msg,
        ephemeral: true
      });
    }

    // ============================================================
    // VIEW
    // ============================================================
    if (sub === "view") {
      await interaction.deferReply({ ephemeral: true });

      const empireId = interaction.options.getString("empireid").toUpperCase();
      const info = getEmpireIdInfo(empireId);

      if (!info) {
        return interaction.editReply({
          content: `❌ Empire ID **${empireId}** not found.`,
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🆔 ${empireId}`)
        .setColor(info.reserved ? 0xFFD700 : 0x000000)
        .addFields(
          { name: "Type", value: info.reserved ? "Reserved (YZNK)" : "Regular", inline: true },
          { name: "Clan", value: info.clanAbbr || "n/d", inline: true },
          { name: "Discord ID", value: info.discordId ? `<@${info.discordId}>` : "Not assigned", inline: false },
          { name: "Minecraft", value: info.minecraftUser ? `\`${info.minecraftUser}\`` : "Not assigned", inline: false },
          { name: "Assigned At", value: `<t:${Math.floor(new Date(info.assignedAt).getTime() / 1000)}:F>`, inline: false }
        );

      if (info.updatedAt) {
        embed.addFields({
          name: "Last Updated",
          value: `<t:${Math.floor(new Date(info.updatedAt).getTime() / 1000)}:R>`,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // LOOKUP
    // ============================================================
    if (sub === "lookup") {
      await interaction.deferReply({ ephemeral: true });

      const discordUser = interaction.options.getUser("discord");
      const mcName = interaction.options.getString("minecraft");

      if (!discordUser && !mcName) {
        return interaction.editReply({
          content: "❌ You must provide at least one of: Discord user or Minecraft username",
          ephemeral: true
        });
      }

      const empireId = getEmpireId(discordUser?.id, mcName);

      if (!empireId) {
        let msg = "❌ No Empire ID found for ";
        if (discordUser) msg += `**${discordUser.tag}**`;
        if (mcName) msg += ` (MC: \`${mcName}\`)`;
        
        return interaction.editReply({
          content: msg,
          ephemeral: true
        });
      }

      const info = getEmpireIdInfo(empireId);

      const embed = new EmbedBuilder()
        .setTitle(`🆔 ${empireId}`)
        .setColor(info.reserved ? 0xFFD700 : 0x000000)
        .addFields(
          { name: "Type", value: info.reserved ? "Reserved (YZNK)" : "Regular", inline: true },
          { name: "Clan", value: info.clanAbbr || "n/d", inline: true },
          { name: "Discord", value: info.discordId ? `<@${info.discordId}>` : "n/d", inline: false },
          { name: "Minecraft", value: info.minecraftUser ? `\`${info.minecraftUser}\`` : "n/d", inline: false },
          { name: "Assigned At", value: `<t:${Math.floor(new Date(info.assignedAt).getTime() / 1000)}:F>`, inline: false }
        );

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // LIST
    // ============================================================
    if (sub === "list") {
      await interaction.deferReply({ ephemeral: true });

      const filter = interaction.options.getString("filter") || "all";
      const data = getAllEmpireIds();

      let ids = Object.entries(data.ids);

      // Apply filter
      if (filter === "reserved") {
        ids = ids.filter(([, info]) => info.reserved);
      } else if (filter === "regular") {
        ids = ids.filter(([, info]) => !info.reserved);
      }

      if (ids.length === 0) {
        return interaction.editReply({
          content: `📋 No Empire IDs found (filter: ${filter})`,
          ephemeral: true
        });
      }

      // Sort by Empire ID
      ids.sort((a, b) => a[0].localeCompare(b[0]));

      // Group by clan abbreviation
      const grouped = {};
      for (const [empireId, info] of ids) {
        const abbr = info.clanAbbr || "Unknown";
        if (!grouped[abbr]) grouped[abbr] = [];
        grouped[abbr].push({ empireId, info });
      }

      const embed = new EmbedBuilder()
        .setTitle(`🆔 Empire IDs (${ids.length})`)
        .setColor(0x000000)
        .setFooter({ text: `Filter: ${filter} | Next: ${data.nextNumber}` });

      for (const [abbr, entries] of Object.entries(grouped)) {
        const list = entries
          .slice(0, 10) // Limit to 10 per field
          .map(({ empireId, info }) => {
            let line = `\`${empireId}\``;
            if (info.minecraftUser) line += ` - ${info.minecraftUser}`;
            else if (info.discordId) line += ` - <@${info.discordId}>`;
            else line += ` - *Unassigned*`;
            return line;
          })
          .join("\n");

        const more = entries.length > 10 ? `\n*...and ${entries.length - 10} more*` : "";

        embed.addFields({
          name: `${abbr} (${entries.length})`,
          value: list + more,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // STATS
    // ============================================================
    if (sub === "stats") {
      await interaction.deferReply({ ephemeral: true });

      const data = getAllEmpireIds();
      const ids = Object.entries(data.ids);

      const reserved = ids.filter(([, info]) => info.reserved).length;
      const regular = ids.length - reserved;
      const assigned = ids.filter(([, info]) => info.discordId || info.minecraftUser).length;
      const unassigned = ids.length - assigned;

      // Group by clan
      const byClan = {};
      for (const [, info] of ids) {
        const abbr = info.clanAbbr || "Unknown";
        byClan[abbr] = (byClan[abbr] || 0) + 1;
      }

      const clanStats = Object.entries(byClan)
        .sort((a, b) => b[1] - a[1])
        .map(([abbr, count]) => `**${abbr}**: ${count}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("📊 Empire ID Statistics")
        .setColor(0x000000)
        .addFields(
          { name: "Total IDs", value: `\`${ids.length}\``, inline: true },
          { name: "Next Number", value: `\`${data.nextNumber}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "Reserved (YZNK)", value: `\`${reserved}\``, inline: true },
          { name: "Regular", value: `\`${regular}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "Assigned", value: `\`${assigned}\``, inline: true },
          { name: "Unassigned", value: `\`${unassigned}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "By Clan", value: clanStats || "None", inline: false }
        );

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
};