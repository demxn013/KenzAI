// modules/discord/invites/inviteconfig.js — /invite-config
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const { getGuildSettings, updateGuildSettings } = require("../settings/settingsStore");
const { makeEmbed, danger } = require("../common/embeds");

function viewEmbed(guildId) {
  const inv = getGuildSettings(guildId).invites;
  const rewards = Object.entries(inv.rewards || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([n, r]) => `${n} invites → <@&${r}>`)
    .join("\n") || "*none*";
  return makeEmbed({
    title: "📨 Invite tracking configuration",
    color: "brand",
    description: `Invite tracking is **${inv.enabled ? "enabled" : "disabled"}**.`,
    fields: [
      { name: "Fake threshold", value: `accounts younger than **${inv.fakeAccountAgeDays}d** count as fake`, inline: false },
      { name: "Join log", value: inv.joinLogChannelId ? `<#${inv.joinLogChannelId}>` : "*not set*", inline: false },
      { name: "Milestone rewards", value: rewards, inline: false },
    ],
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("invite-config")
    .setDescription("Configure invite tracking")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("view").setDescription("Show invite-tracking configuration"))
    .addSubcommand((s) =>
      s
        .setName("settings")
        .setDescription("Core invite-tracking settings")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable invite tracking"))
        .addIntegerOption((o) => o.setName("fake-days").setDescription("Account age (days) below which a join is 'fake'").setMinValue(0).setMaxValue(365))
        .addChannelOption((o) => o.setName("join-log").setDescription("Channel for join attribution logs").addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) =>
      s
        .setName("reward")
        .setDescription("Add or remove an invite-milestone role reward")
        .addIntegerOption((o) => o.setName("invites").setDescription("Invite count threshold").setRequired(true).setMinValue(1))
        .addRoleOption((o) => o.setName("role").setDescription("Role to grant (omit to remove the reward at this threshold)"))
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ embeds: [danger("You need the **Manage Server** permission.")], ephemeral: true });

    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === "view") return interaction.reply({ embeds: [viewEmbed(guildId)], ephemeral: true });

    if (sub === "settings") {
      const enabled = interaction.options.getBoolean("enabled");
      const fakeDays = interaction.options.getInteger("fake-days");
      const joinLog = interaction.options.getChannel("join-log");
      updateGuildSettings(guildId, (s) => {
        if (enabled !== null) s.invites.enabled = enabled;
        if (fakeDays !== null) s.invites.fakeAccountAgeDays = fakeDays;
        if (joinLog) s.invites.joinLogChannelId = joinLog.id;
        return s;
      });
    } else if (sub === "reward") {
      const threshold = interaction.options.getInteger("invites");
      const role = interaction.options.getRole("role");
      updateGuildSettings(guildId, (s) => {
        if (role) s.invites.rewards[String(threshold)] = role.id;
        else delete s.invites.rewards[String(threshold)];
        return s;
      });
    }

    return interaction.reply({ embeds: [viewEmbed(guildId)], ephemeral: true });
  },
};
