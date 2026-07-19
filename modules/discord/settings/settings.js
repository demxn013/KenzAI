// modules/discord/settings/settings.js
// /discord-config — cross-cutting configuration hub for the Discord module.
// Feature-specific configuration lives in each feature's own command
// (/automod, /level-config, /invite-config). This command owns the moderation
// mod-log, the statistics/logging channels, and a settings overview.

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const { getGuildSettings, updateGuildSettings } = require("./settingsStore");
const { makeEmbed, success } = require("../common/embeds");

function chan(id) {
  return id ? `<#${id}>` : "*not set*";
}
function onoff(v) {
  return v ? "✅ on" : "❌ off";
}

function buildOverview(guildId) {
  const s = getGuildSettings(guildId);
  return makeEmbed({
    title: "⚙️ Discord Module Settings",
    color: "brand",
    fields: [
      {
        name: "🛡️ Moderation",
        value: `Mod-log: ${chan(s.moderation.modLogChannelId)}\nDM on action: ${onoff(s.moderation.dmOnAction)}`,
      },
      {
        name: "🤖 Automod",
        value: `${onoff(s.automod.enabled)} — configure with \`/automod\``,
      },
      {
        name: "📈 Leveling",
        value: `${onoff(s.leveling.enabled)} — configure with \`/level-config\``,
      },
      {
        name: "📨 Invite tracking",
        value: `${onoff(s.invites.enabled)} — configure with \`/invite-config\``,
      },
      {
        name: "📊 Statistics / logging",
        value:
          `${onoff(s.statistics.enabled)}\n` +
          `Join/leave: ${chan(s.statistics.logs.joinLeaveChannelId)}\n` +
          `Messages: ${chan(s.statistics.logs.messageChannelId)}\n` +
          `Voice: ${chan(s.statistics.logs.voiceChannelId)}`,
      },
    ],
    footer: "Giveaways: /giveaway • run each feature's command for details",
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("discord-config")
    .setDescription("Configure the Discord module (moderation log, statistics/logging, overview)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub.setName("view").setDescription("Show the current Discord module settings")
    )
    .addSubcommand((sub) =>
      sub
        .setName("moderation")
        .setDescription("Set the moderation mod-log channel and DM behaviour")
        .addChannelOption((o) =>
          o
            .setName("modlog")
            .setDescription("Channel where moderation actions are logged")
            .addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((o) =>
          o.setName("dm-on-action").setDescription("DM members when they are warned/muted/kicked/banned")
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("logging")
        .setDescription("Enable statistics and set the server log channels")
        .addBooleanOption((o) =>
          o.setName("enabled").setDescription("Enable statistics collection + logging")
        )
        .addChannelOption((o) =>
          o
            .setName("join-leave")
            .setDescription("Channel for member join/leave logs")
            .addChannelTypes(ChannelType.GuildText)
        )
        .addChannelOption((o) =>
          o
            .setName("messages")
            .setDescription("Channel for deleted/edited message logs")
            .addChannelTypes(ChannelType.GuildText)
        )
        .addChannelOption((o) =>
          o
            .setName("voice")
            .setDescription("Channel for voice join/leave/move logs")
            .addChannelTypes(ChannelType.GuildText)
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ This command can only be used in a server.", ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "❌ You need the **Manage Server** permission.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "view") {
      return interaction.reply({ embeds: [buildOverview(guildId)], ephemeral: true });
    }

    if (sub === "moderation") {
      const modlog = interaction.options.getChannel("modlog");
      const dm = interaction.options.getBoolean("dm-on-action");
      updateGuildSettings(guildId, (s) => {
        if (modlog) s.moderation.modLogChannelId = modlog.id;
        if (dm !== null) s.moderation.dmOnAction = dm;
        return s;
      });
      return interaction.reply({
        embeds: [success("Moderation settings updated.")],
        ephemeral: true,
      });
    }

    if (sub === "logging") {
      const enabled = interaction.options.getBoolean("enabled");
      const jl = interaction.options.getChannel("join-leave");
      const msg = interaction.options.getChannel("messages");
      const voice = interaction.options.getChannel("voice");
      updateGuildSettings(guildId, (s) => {
        if (enabled !== null) s.statistics.enabled = enabled;
        if (jl) s.statistics.logs.joinLeaveChannelId = jl.id;
        if (msg) s.statistics.logs.messageChannelId = msg.id;
        if (voice) s.statistics.logs.voiceChannelId = voice.id;
        return s;
      });
      return interaction.reply({
        embeds: [success("Statistics/logging settings updated.")],
        ephemeral: true,
      });
    }

    return interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  },
};
