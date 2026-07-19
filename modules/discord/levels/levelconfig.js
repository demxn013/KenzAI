// modules/discord/levels/levelconfig.js — /level-config
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const { getGuildSettings, updateGuildSettings } = require("../settings/settingsStore");
const { makeEmbed, danger } = require("../common/embeds");

function viewEmbed(guildId) {
  const lv = getGuildSettings(guildId).leveling;
  const rewards = Object.entries(lv.roleRewards || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([l, r]) => `Lv ${l} → <@&${r}>`)
    .join("\n") || "*none*";
  const mults = Object.entries(lv.multiplierRoles || {})
    .map(([r, f]) => `<@&${r}> ×${f}`)
    .join("\n") || "*none*";
  return makeEmbed({
    title: "📈 Leveling configuration",
    color: "brand",
    description: `Leveling is **${lv.enabled ? "enabled" : "disabled"}**.`,
    fields: [
      { name: "Message XP", value: `${lv.xpPerMessageMin}–${lv.xpPerMessageMax} every ${lv.messageCooldownSeconds}s`, inline: true },
      { name: "Voice XP", value: `${lv.voiceXpPerMinute}/min`, inline: true },
      { name: "Announce", value: `${lv.announceLevelUp ? lv.announceTarget : "off"}`, inline: true },
      { name: "No-XP channels", value: lv.noXpChannelIds.length ? lv.noXpChannelIds.map((c) => `<#${c}>`).join(" ") : "*none*", inline: false },
      { name: "No-XP roles", value: lv.noXpRoleIds.length ? lv.noXpRoleIds.map((r) => `<@&${r}>`).join(" ") : "*none*", inline: false },
      { name: "Role rewards", value: rewards, inline: true },
      { name: "Multipliers", value: mults, inline: true },
    ],
    footer: "Level-up message placeholders: {user} {level}",
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("level-config")
    .setDescription("Configure the leveling / message + voice rewards system")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("view").setDescription("Show the leveling configuration"))
    .addSubcommand((s) =>
      s
        .setName("settings")
        .setDescription("Core leveling settings")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable leveling"))
        .addIntegerOption((o) => o.setName("xp-min").setDescription("Min XP per message").setMinValue(0).setMaxValue(500))
        .addIntegerOption((o) => o.setName("xp-max").setDescription("Max XP per message").setMinValue(0).setMaxValue(500))
        .addIntegerOption((o) => o.setName("cooldown-seconds").setDescription("Seconds between XP-earning messages").setMinValue(0).setMaxValue(3600))
        .addIntegerOption((o) => o.setName("voice-xp-per-minute").setDescription("XP earned per minute in voice").setMinValue(0).setMaxValue(500))
    )
    .addSubcommand((s) =>
      s
        .setName("announce")
        .setDescription("Configure level-up announcements")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Announce level-ups"))
        .addStringOption((o) =>
          o.setName("where").setDescription("Where to announce").addChoices(
            { name: "Current channel", value: "current" },
            { name: "Direct message", value: "dm" },
            { name: "A specific channel", value: "channel" }
          )
        )
        .addChannelOption((o) => o.setName("channel").setDescription("Channel (when where = specific channel)").addChannelTypes(ChannelType.GuildText))
        .addStringOption((o) => o.setName("message").setDescription("Message text — use {user} and {level}"))
    )
    .addSubcommand((s) =>
      s
        .setName("noxp")
        .setDescription("Add/remove no-XP channels and roles")
        .addChannelOption((o) => o.setName("add-channel").setDescription("Channel that earns no XP").addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName("remove-channel").setDescription("Re-enable XP in a channel").addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("add-role").setDescription("Role that earns no XP"))
        .addRoleOption((o) => o.setName("remove-role").setDescription("Re-enable XP for a role"))
    )
    .addSubcommand((s) =>
      s
        .setName("reward")
        .setDescription("Add or remove a level-reward role")
        .addIntegerOption((o) => o.setName("level").setDescription("Level").setRequired(true).setMinValue(1))
        .addRoleOption((o) => o.setName("role").setDescription("Role to grant (omit to remove the reward at this level)"))
        .addBooleanOption((o) => o.setName("stack").setDescription("Keep lower reward roles when a higher one is earned"))
    )
    .addSubcommand((s) =>
      s
        .setName("multiplier")
        .setDescription("Set an XP multiplier for a role")
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
        .addIntegerOption((o) => o.setName("factor").setDescription("Multiplier (1 = normal, 0 = remove)").setRequired(true).setMinValue(0).setMaxValue(10))
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ embeds: [danger("You need the **Manage Server** permission.")], ephemeral: true });

    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const b = (n) => interaction.options.getBoolean(n);
    const i = (n) => interaction.options.getInteger(n);
    const st = (n) => interaction.options.getString(n);

    if (sub === "view") return interaction.reply({ embeds: [viewEmbed(guildId)], ephemeral: true });

    if (sub === "settings") {
      updateGuildSettings(guildId, (s) => {
        const lv = s.leveling;
        if (b("enabled") !== null) lv.enabled = b("enabled");
        if (i("xp-min") !== null) lv.xpPerMessageMin = i("xp-min");
        if (i("xp-max") !== null) lv.xpPerMessageMax = i("xp-max");
        if (lv.xpPerMessageMax < lv.xpPerMessageMin) lv.xpPerMessageMax = lv.xpPerMessageMin;
        if (i("cooldown-seconds") !== null) lv.messageCooldownSeconds = i("cooldown-seconds");
        if (i("voice-xp-per-minute") !== null) lv.voiceXpPerMinute = i("voice-xp-per-minute");
        return s;
      });
    } else if (sub === "announce") {
      const where = st("where");
      const channel = interaction.options.getChannel("channel");
      if (where === "channel" && !channel)
        return interaction.reply({ embeds: [danger("Pick a channel when choosing *a specific channel*.")], ephemeral: true });
      updateGuildSettings(guildId, (s) => {
        const lv = s.leveling;
        if (b("enabled") !== null) lv.announceLevelUp = b("enabled");
        if (where) lv.announceTarget = where === "channel" ? channel.id : where;
        if (st("message")) lv.levelUpMessage = st("message");
        return s;
      });
    } else if (sub === "noxp") {
      const addCh = interaction.options.getChannel("add-channel");
      const rmCh = interaction.options.getChannel("remove-channel");
      const addRole = interaction.options.getRole("add-role");
      const rmRole = interaction.options.getRole("remove-role");
      updateGuildSettings(guildId, (s) => {
        const lv = s.leveling;
        if (addCh && !lv.noXpChannelIds.includes(addCh.id)) lv.noXpChannelIds.push(addCh.id);
        if (rmCh) lv.noXpChannelIds = lv.noXpChannelIds.filter((c) => c !== rmCh.id);
        if (addRole && !lv.noXpRoleIds.includes(addRole.id)) lv.noXpRoleIds.push(addRole.id);
        if (rmRole) lv.noXpRoleIds = lv.noXpRoleIds.filter((r) => r !== rmRole.id);
        return s;
      });
    } else if (sub === "reward") {
      const level = i("level");
      const role = interaction.options.getRole("role");
      updateGuildSettings(guildId, (s) => {
        const lv = s.leveling;
        if (role) lv.roleRewards[String(level)] = role.id;
        else delete lv.roleRewards[String(level)];
        if (b("stack") !== null) lv.stackRewards = b("stack");
        return s;
      });
    } else if (sub === "multiplier") {
      const role = interaction.options.getRole("role");
      const factor = i("factor");
      updateGuildSettings(guildId, (s) => {
        if (factor <= 1) delete s.leveling.multiplierRoles[role.id];
        else s.leveling.multiplierRoles[role.id] = factor;
        return s;
      });
    }

    return interaction.reply({ embeds: [viewEmbed(guildId)], ephemeral: true });
  },
};
