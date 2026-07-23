// modules/discord/moderation/automod/automod.js — /automod
// Per-guild automod configuration. Rules are enforced in rules.js.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const { getAutomod, updateAutomod } = require("./automodStore");
const { authorize } = require("../../common/commandGuard");
const { makeEmbed, success, danger } = require("../../common/embeds");

const ACTIONS = [
  { name: "Delete message", value: "delete" },
  { name: "Delete + warn", value: "warn" },
  { name: "Delete + mute", value: "mute" },
];

function onoff(v) {
  return v ? "✅" : "❌";
}

function statusEmbed(guildId) {
  const a = getAutomod(guildId);
  return makeEmbed({
    title: "🤖 Automod configuration",
    color: "brand",
    description: `Automod is **${a.enabled ? "enabled" : "disabled"}**.\nLog channel: ${a.logChannelId ? `<#${a.logChannelId}>` : "*mod-log fallback*"}`,
    fields: [
      { name: "Anti-invite", value: `${onoff(a.antiInvite.enabled)} → \`${a.antiInvite.action}\``, inline: true },
      { name: "Anti-spam", value: `${onoff(a.antiSpam.enabled)} → \`${a.antiSpam.action}\` (${a.antiSpam.maxMessages}/${Math.round(a.antiSpam.intervalMs / 1000)}s)`, inline: true },
      { name: "Anti-mention", value: `${onoff(a.antiMention.enabled)} → \`${a.antiMention.action}\` (>${a.antiMention.maxMentions})`, inline: true },
      { name: "Anti-caps", value: `${onoff(a.antiCaps.enabled)} → \`${a.antiCaps.action}\` (${a.antiCaps.percent}%)`, inline: true },
      { name: "Word filter", value: `${onoff(a.wordFilter.enabled)} → \`${a.wordFilter.action}\` (${a.wordFilter.words.length} words)`, inline: true },
      { name: "Anti-raid", value: `${onoff(a.antiRaid.enabled)} → \`${a.antiRaid.action}\` (${a.antiRaid.joinCount}/${Math.round(a.antiRaid.intervalMs / 1000)}s)`, inline: true },
      { name: "Exempt roles", value: a.exemptRoleIds.length ? a.exemptRoleIds.map((r) => `<@&${r}>`).join(" ") : "*none*", inline: false },
      { name: "Exempt channels", value: a.exemptChannelIds.length ? a.exemptChannelIds.map((c) => `<#${c}>`).join(" ") : "*none*", inline: false },
    ],
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure automatic moderation rules")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("status").setDescription("Show the current automod configuration"))
    .addSubcommand((s) =>
      s
        .setName("toggle")
        .setDescription("Enable/disable automod and set the log channel")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Master on/off switch"))
        .addChannelOption((o) => o.setName("log-channel").setDescription("Automod log channel").addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((s) =>
      s
        .setName("invites")
        .setDescription("Block Discord invite links")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) => o.setName("action").setDescription("Action on violation").addChoices(...ACTIONS))
    )
    .addSubcommand((s) =>
      s
        .setName("spam")
        .setDescription("Block message spam")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) => o.setName("action").setDescription("Action on violation").addChoices(...ACTIONS))
        .addIntegerOption((o) => o.setName("max-messages").setDescription("Messages allowed in the window").setMinValue(2).setMaxValue(30))
        .addIntegerOption((o) => o.setName("interval-seconds").setDescription("Window length (seconds)").setMinValue(1).setMaxValue(60))
        .addIntegerOption((o) => o.setName("mute-seconds").setDescription("Mute length if action is mute").setMinValue(10).setMaxValue(2419200))
    )
    .addSubcommand((s) =>
      s
        .setName("mentions")
        .setDescription("Block mass mentions")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) => o.setName("action").setDescription("Action on violation").addChoices(...ACTIONS))
        .addIntegerOption((o) => o.setName("max-mentions").setDescription("Max mentions per message").setMinValue(1).setMaxValue(50))
        .addIntegerOption((o) => o.setName("mute-seconds").setDescription("Mute length if action is mute").setMinValue(10).setMaxValue(2419200))
    )
    .addSubcommand((s) =>
      s
        .setName("caps")
        .setDescription("Block excessive capital letters")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) => o.setName("action").setDescription("Action on violation").addChoices(...ACTIONS))
        .addIntegerOption((o) => o.setName("min-length").setDescription("Ignore messages shorter than this").setMinValue(4).setMaxValue(200))
        .addIntegerOption((o) => o.setName("percent").setDescription("Caps percentage that triggers").setMinValue(50).setMaxValue(100))
    )
    .addSubcommand((s) =>
      s
        .setName("words")
        .setDescription("Manage the blocked-word filter")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) => o.setName("action").setDescription("Action on violation").addChoices(...ACTIONS))
        .addStringOption((o) => o.setName("add").setDescription("Add a blocked word/phrase"))
        .addStringOption((o) => o.setName("remove").setDescription("Remove a blocked word/phrase"))
    )
    .addSubcommand((s) =>
      s
        .setName("raid")
        .setDescription("Detect and act on join raids")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable this rule"))
        .addStringOption((o) =>
          o.setName("action").setDescription("Action on raid").addChoices(
            { name: "Alert only", value: "alert" },
            { name: "Kick new joiners", value: "kick" },
            { name: "Ban new joiners", value: "ban" }
          )
        )
        .addIntegerOption((o) => o.setName("join-count").setDescription("Joins that trigger a raid").setMinValue(3).setMaxValue(100))
        .addIntegerOption((o) => o.setName("interval-seconds").setDescription("Time window (seconds)").setMinValue(2).setMaxValue(120))
    )
    .addSubcommand((s) =>
      s
        .setName("exempt")
        .setDescription("Add/remove automod exemptions")
        .addRoleOption((o) => o.setName("add-role").setDescription("Role to exempt"))
        .addRoleOption((o) => o.setName("remove-role").setDescription("Role to un-exempt"))
        .addChannelOption((o) => o.setName("add-channel").setDescription("Channel to exempt").addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName("remove-channel").setDescription("Channel to un-exempt").addChannelTypes(ChannelType.GuildText))
    ),

  async execute(interaction) {
    if (!(await authorize(interaction, "automod", (m) => m.permissions?.has(PermissionFlagsBits.ManageGuild)))) return;

    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const b = (n) => interaction.options.getBoolean(n);
    const i = (n) => interaction.options.getInteger(n);
    const st = (n) => interaction.options.getString(n);

    if (sub === "status") return interaction.reply({ embeds: [statusEmbed(guildId)], ephemeral: true });

    if (sub === "toggle") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.enabled = b("enabled");
        const ch = interaction.options.getChannel("log-channel");
        if (ch) a.logChannelId = ch.id;
      });
    } else if (sub === "invites") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.antiInvite.enabled = b("enabled");
        if (st("action")) a.antiInvite.action = st("action");
      });
    } else if (sub === "spam") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.antiSpam.enabled = b("enabled");
        if (st("action")) a.antiSpam.action = st("action");
        if (i("max-messages") !== null) a.antiSpam.maxMessages = i("max-messages");
        if (i("interval-seconds") !== null) a.antiSpam.intervalMs = i("interval-seconds") * 1000;
        if (i("mute-seconds") !== null) a.antiSpam.muteSeconds = i("mute-seconds");
      });
    } else if (sub === "mentions") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.antiMention.enabled = b("enabled");
        if (st("action")) a.antiMention.action = st("action");
        if (i("max-mentions") !== null) a.antiMention.maxMentions = i("max-mentions");
        if (i("mute-seconds") !== null) a.antiMention.muteSeconds = i("mute-seconds");
      });
    } else if (sub === "caps") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.antiCaps.enabled = b("enabled");
        if (st("action")) a.antiCaps.action = st("action");
        if (i("min-length") !== null) a.antiCaps.minLength = i("min-length");
        if (i("percent") !== null) a.antiCaps.percent = i("percent");
      });
    } else if (sub === "words") {
      const add = st("add");
      const remove = st("remove");
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.wordFilter.enabled = b("enabled");
        if (st("action")) a.wordFilter.action = st("action");
        if (add) {
          const w = add.toLowerCase().trim();
          if (w && !a.wordFilter.words.includes(w)) a.wordFilter.words.push(w);
        }
        if (remove) {
          const w = remove.toLowerCase().trim();
          a.wordFilter.words = a.wordFilter.words.filter((x) => x !== w);
        }
      });
    } else if (sub === "raid") {
      updateAutomod(guildId, (a) => {
        if (b("enabled") !== null) a.antiRaid.enabled = b("enabled");
        if (st("action")) a.antiRaid.action = st("action");
        if (i("join-count") !== null) a.antiRaid.joinCount = i("join-count");
        if (i("interval-seconds") !== null) a.antiRaid.intervalMs = i("interval-seconds") * 1000;
      });
    } else if (sub === "exempt") {
      const addRole = interaction.options.getRole("add-role");
      const removeRole = interaction.options.getRole("remove-role");
      const addCh = interaction.options.getChannel("add-channel");
      const removeCh = interaction.options.getChannel("remove-channel");
      updateAutomod(guildId, (a) => {
        if (addRole && !a.exemptRoleIds.includes(addRole.id)) a.exemptRoleIds.push(addRole.id);
        if (removeRole) a.exemptRoleIds = a.exemptRoleIds.filter((r) => r !== removeRole.id);
        if (addCh && !a.exemptChannelIds.includes(addCh.id)) a.exemptChannelIds.push(addCh.id);
        if (removeCh) a.exemptChannelIds = a.exemptChannelIds.filter((c) => c !== removeCh.id);
      });
    }

    return interaction.reply({ embeds: [statusEmbed(guildId)], ephemeral: true });
  },
};
