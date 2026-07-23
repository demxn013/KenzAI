// modules/discord/setup/setup.js — /setup
// An admin dashboard: an embed + category dropdown with native channel/role
// pickers and toggle buttons that write to the per-guild discord_settings. All
// components use the "dset_" prefix and are routed here from
// events/interactionCreate.js. State is stateless — see panels.js.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { updateGuildSettings } = require("../settings/settingsStore");
const { render } = require("./panels");

// Split "base|param" customIds.
function parse(customId) {
  const [base, param] = customId.split("|");
  return { base, param };
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Open the KenzAI configuration dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: "❌ Server only.", ephemeral: true });
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ You need the **Manage Server** permission.", ephemeral: true });
    const { embeds, components } = render(interaction.guildId, "overview");
    return interaction.reply({ embeds, components, ephemeral: true });
  },

  // ---- string select menus ----
  async selectMenuHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const guildId = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const value = interaction.values[0];

    if (base === "dset_cat") return interaction.update(render(guildId, value));
    if (base === "dset_ml_action") return interaction.update(render(guildId, "modlogs", { action: value }));
    if (base === "dset_mr_pickgroup") return interaction.update(render(guildId, "modroles", { group: value }));
    if (base === "dset_mr_pickcmd") return interaction.update(render(guildId, "modroles", { command: value }));
    if (base === "dset_mr_setcmdgroup") {
      updateGuildSettings(guildId, (s) => {
        s.permissions.commandGroup[param] = value;
        return s;
      });
      return interaction.update(render(guildId, "modroles", { command: param }));
    }
    return interaction.deferUpdate();
  },

  // ---- channel select menus ----
  async channelSelectHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const guildId = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const value = interaction.values[0] || null;

    const map = {
      dset_ml_fallback: (s) => (s.moderation.modLogChannelId = value),
      dset_clan_announce: (s) => (s.clan.announceChannelId = value),
      dset_clan_log: (s) => (s.clan.logChannelId = value),
      dset_alli_announce: (s) => (s.alliance.announceChannelId = value),
      dset_alli_log: (s) => (s.alliance.logChannelId = value),
      dset_boost_log: (s) => (s.boosterRoles.logChannelId = value),
    };

    let category = "overview";
    if (base === "dset_ml_chan") {
      updateGuildSettings(guildId, (s) => ((s.moderation.logs[param] = value), s));
      return interaction.update(render(guildId, "modlogs", { action: param }));
    } else if (map[base]) {
      updateGuildSettings(guildId, (s) => (map[base](s), s));
      category = base.startsWith("dset_clan") ? "clan" : base.startsWith("dset_alli") ? "alliance" : base.startsWith("dset_boost") ? "boosters" : "modlogs";
    }
    return interaction.update(render(guildId, category));
  },

  // ---- role select menus ----
  async roleSelectHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const guildId = interaction.guildId;
    const { base, param } = parse(interaction.customId);
    const values = interaction.values || [];

    if (base === "dset_gw_hostroles") {
      updateGuildSettings(guildId, (s) => ((s.giveaways.hostRoleIds = values), s));
      return interaction.update(render(guildId, "giveaways"));
    }
    if (base === "dset_mr_setroles") {
      updateGuildSettings(guildId, (s) => ((s.permissions.groups[param] = values), s));
      return interaction.update(render(guildId, "modroles", { group: param }));
    }
    if (base === "dset_clan_managers") {
      updateGuildSettings(guildId, (s) => ((s.clan.managerRoleIds = values), s));
      return interaction.update(render(guildId, "clan"));
    }
    if (base === "dset_alli_managers") {
      updateGuildSettings(guildId, (s) => ((s.alliance.managerRoleIds = values), s));
      return interaction.update(render(guildId, "alliance"));
    }
    if (base === "dset_boost_anchor") {
      updateGuildSettings(guildId, (s) => ((s.boosterRoles.anchorRoleId = values[0] || null), s));
      return interaction.update(render(guildId, "boosters"));
    }
    return interaction.deferUpdate();
  },

  // ---- buttons ----
  async buttonHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    const guildId = interaction.guildId;
    const id = interaction.customId;

    if (id.startsWith("dset_toggle_")) {
      const feature = id.slice("dset_toggle_".length);
      updateGuildSettings(guildId, (s) => {
        if (s[feature]) s[feature].enabled = !s[feature].enabled;
        return s;
      });
      return interaction.update(render(guildId, "basic"));
    }

    if (id.startsWith("dset_boost_toggle_")) {
      const key = id.slice("dset_boost_toggle_".length);
      updateGuildSettings(guildId, (s) => {
        s.boosterRoles[key] = !s.boosterRoles[key];
        return s;
      });
      return interaction.update(render(guildId, "boosters"));
    }

    if (id === "dset_gw_emoji") {
      const modal = new ModalBuilder().setCustomId("dset_gw_emoji_modal").setTitle("Giveaway entry emoji").addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("emoji").setLabel("Emoji (a single standard emoji)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)
        )
      );
      return interaction.showModal(modal);
    }
    return interaction.deferUpdate();
  },

  // ---- modals ----
  async modalHandler(interaction) {
    if (!isAdmin(interaction)) return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    if (interaction.customId === "dset_gw_emoji_modal") {
      const emoji = interaction.fields.getTextInputValue("emoji").trim();
      updateGuildSettings(interaction.guildId, (s) => ((s.giveaways.emoji = emoji || "🎉"), s));
      return interaction.update(render(interaction.guildId, "giveaways"));
    }
    return interaction.deferUpdate();
  },
};
