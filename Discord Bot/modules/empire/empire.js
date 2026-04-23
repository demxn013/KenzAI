// modules/empire/empireid-command.js
// Command to manage Empire IDs (reserve, update, list, stats)

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const {
  reserveEmpireId,
  updateReservedId,
  getAllEmpireIds,
  RESERVED_COUNT,
} = require("./empireid");

const LIST_PREFIX = "empireid_list";
const LINES_PER_PAGE = 20;
const MAX_SELECT_OPTIONS = 25;
const STATIC_FILTER_OPTIONS = 3;

function applyListFilter(entries, filterKey) {
  if (filterKey === "all") return entries;
  if (filterKey === "reserved") return entries.filter(([, info]) => info.reserved);
  if (filterKey === "regular") return entries.filter(([, info]) => !info.reserved);
  if (filterKey.startsWith("c:")) {
    const abbr = filterKey.slice(2).toUpperCase();
    return entries.filter(([, info]) => (info.clanAbbr || "").toUpperCase() === abbr);
  }
  return entries;
}

function formatListLine(empireId, info) {
  let line = `\`${empireId}\``;
  if (info.minecraftUser) line += ` — ${info.minecraftUser}`;
  else if (info.discordId) line += ` — <@${info.discordId}>`;
  else line += ` — *Unassigned*`;
  if (info.active === false) line += ` *(deactivated)*`;
  return line;
}

function distinctClanAbbrs(entries) {
  const set = new Set();
  for (const [, info] of entries) {
    if (info.clanAbbr) set.add(String(info.clanAbbr).toUpperCase());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function filterLabel(filterKey) {
  if (filterKey === "all") return "All";
  if (filterKey === "reserved") return "Reserved (YZNK)";
  if (filterKey === "regular") return "Regular";
  if (filterKey.startsWith("c:")) return `Clan ${filterKey.slice(2)}`;
  return filterKey;
}

/**
 * @param {Array<[string, object]>} allEntries — full registry for clan option list
 */
function buildFilterSelect(allEntries, ownerId) {
  const maxClanOpts = MAX_SELECT_OPTIONS - STATIC_FILTER_OPTIONS;
  const clans = distinctClanAbbrs(allEntries);
  const truncatedClans = clans.length > maxClanOpts;
  const clanSlice = truncatedClans ? clans.slice(0, maxClanOpts) : clans;

  /** @type {import("discord.js").APISelectMenuOption[]} */
  const options = [
    { label: "All", value: "all" },
    { label: "Reserved (YZNK)", value: "reserved" },
    { label: "Regular (non-reserved)", value: "regular" },
    ...clanSlice.map((abbr) => ({
      label: `Clan: ${abbr}`,
      value: `c:${abbr}`,
    })),
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${LIST_PREFIX}|filter|${ownerId}`)
    .setPlaceholder("Filter by type or clan")
    .addOptions(options);

  return { select, truncatedClans };
}

/**
 * @returns {{ embed: EmbedBuilder, components: ActionRowBuilder[] }}
 */
function buildEmpireListUI(data, ownerId, page, filter) {
  const allEntries = Object.entries(data.ids);
  const filtered = applyListFilter(allEntries, filter);
  filtered.sort((a, b) => a[0].localeCompare(b[0]));

  const lines = filtered.map(([id, info]) => formatListLine(id, info));
  const totalPages = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * LINES_PER_PAGE;
  const pageLines = lines.slice(start, start + LINES_PER_PAGE);
  const description = pageLines.length ? pageLines.join("\n") : "*No entries on this page.*";

  const { select, truncatedClans } = buildFilterSelect(allEntries, ownerId);

  let footer = `Page ${safePage + 1}/${totalPages} · ${filterLabel(filter)} · Next #: ${data.nextNumber}`;
  if (truncatedClans) footer += " · Clan menu capped (use slash filter + browse)";

  const embed = new EmbedBuilder()
    .setTitle(`Empire IDs — ${filtered.length} match(es)`)
    .setColor(0x000000)
    .setDescription(description)
    .setFooter({ text: footer });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LIST_PREFIX}|nav|${ownerId}|${safePage - 1}|${filter}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`${LIST_PREFIX}|nav|${ownerId}|${safePage + 1}|${filter}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages - 1)
  );

  const filterRow = new ActionRowBuilder().addComponents(select);

  return { embed, components: [navRow, filterRow] };
}

function parseNavCustomId(customId) {
  const parts = customId.split("|");
  if (parts.length !== 5 || parts[0] !== LIST_PREFIX || parts[1] !== "nav") return null;
  const ownerId = parts[2];
  const page = parseInt(parts[3], 10);
  const filter = parts[4];
  if (!ownerId || Number.isNaN(page)) return null;
  return { ownerId, page, filter };
}

function parseFilterCustomId(customId) {
  const prefix = `${LIST_PREFIX}|filter|`;
  if (!customId.startsWith(prefix)) return null;
  const ownerId = customId.slice(prefix.length);
  return ownerId || null;
}

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
        .setName("list")
        .setDescription("List all Empire IDs (paginated; use buttons and menu to browse)")
        .addStringOption(opt =>
          opt
            .setName("filter")
            .setDescription("Initial filter (refine with the menu after sending)")
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
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ You need the **Kick Members** permission to use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "reserve") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const num = interaction.options.getInteger("number");
      const discordUser = interaction.options.getUser("discord");
      const mcName = interaction.options.getString("minecraft");

      const result = reserveEmpireId(num, discordUser?.id || null, mcName || null);

      if (!result.success) {
        if (result.reason === "already_reserved") {
          return interaction.editReply({
            content: `⚠️ **${result.empireId}** is already reserved.`,
          });
        }
        return interaction.editReply({
          content: `❌ Failed to reserve ID: ${result.reason}`,
        });
      }

      let msg = `✅ Reserved **${result.empireId}**`;
      if (discordUser) msg += `\n👤 Discord: ${discordUser.tag}`;
      if (mcName) msg += `\n🎮 Minecraft: \`${mcName}\``;

      return interaction.editReply({ content: msg });
    }

    if (sub === "update") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const empireId = interaction.options.getString("empireid").toUpperCase();
      const discordUser = interaction.options.getUser("discord");
      const mcName = interaction.options.getString("minecraft");

      if (!discordUser && !mcName) {
        return interaction.editReply({
          content: "❌ You must provide at least one of: Discord user or Minecraft username",
        });
      }

      const result = updateReservedId(empireId, discordUser?.id || null, mcName || null);

      if (!result.success) {
        return interaction.editReply({
          content: `❌ Failed to update: ${result.reason}`,
        });
      }

      let msg = `✅ Updated **${empireId}**`;
      if (discordUser) msg += `\n👤 Discord: ${discordUser.tag}`;
      if (mcName) msg += `\n🎮 Minecraft: \`${mcName}\``;

      return interaction.editReply({ content: msg });
    }

    if (sub === "list") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const filter = interaction.options.getString("filter") || "all";
      const data = getAllEmpireIds();
      const allEntries = Object.entries(data.ids);

      const filtered = applyListFilter(allEntries, filter);
      if (filtered.length === 0) {
        return interaction.editReply({
          content: `📋 No Empire IDs found (filter: ${filter})`,
        });
      }

      const ownerId = interaction.user.id;
      const { embed, components } = buildEmpireListUI(data, ownerId, 0, filter);
      return interaction.editReply({ embeds: [embed], components });
    }

    if (sub === "stats") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const data = getAllEmpireIds();
      const ids = Object.entries(data.ids);

      const reserved = ids.filter(([, info]) => info.reserved).length;
      const regular = ids.length - reserved;
      const assigned = ids.filter(([, info]) => info.discordId || info.minecraftUser).length;
      const unassigned = ids.length - assigned;
      const deactivated = ids.filter(([, info]) => info.active === false).length;
      const activeRegistry = ids.length - deactivated;

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
          { name: "Deactivated", value: `\`${deactivated}\``, inline: true },
          { name: "Active registry", value: `\`${activeRegistry}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "Reserved (YZNK)", value: `\`${reserved}\``, inline: true },
          { name: "Regular", value: `\`${regular}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "Assigned", value: `\`${assigned}\``, inline: true },
          { name: "Unassigned", value: `\`${unassigned}\``, inline: true },
          { name: "‎", value: "‎", inline: true },
          { name: "By Clan", value: clanStats || "None", inline: false }
        );

      return interaction.editReply({ embeds: [embed] });
    }
  },

  async buttonHandler(interaction) {
    const parsed = parseNavCustomId(interaction.customId);
    if (!parsed) return;

    if (interaction.user.id !== parsed.ownerId) {
      return interaction.reply({
        content: "❌ Only the staff member who ran `/empireid list` can use these controls.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const data = getAllEmpireIds();
    const filtered = applyListFilter(Object.entries(data.ids), parsed.filter);
    if (filtered.length === 0) {
      return interaction.update({
        content: `📋 No Empire IDs found (filter: ${parsed.filter})`,
        embeds: [],
        components: [],
      });
    }

    const { embed, components } = buildEmpireListUI(data, parsed.ownerId, parsed.page, parsed.filter);
    return interaction.update({ embeds: [embed], components });
  },

  async selectMenuHandler(interaction) {
    const ownerId = parseFilterCustomId(interaction.customId);
    if (!ownerId) return;

    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "❌ Only the staff member who ran `/empireid list` can use this menu.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const filter = interaction.values[0] || "all";
    const data = getAllEmpireIds();
    const filtered = applyListFilter(Object.entries(data.ids), filter);

    if (filtered.length === 0) {
      return interaction.update({
        content: `📋 No Empire IDs found (filter: ${filter})`,
        embeds: [],
        components: [],
      });
    }

    const { embed, components } = buildEmpireListUI(data, ownerId, 0, filter);
    return interaction.update({ embeds: [embed], components });
  },
};
