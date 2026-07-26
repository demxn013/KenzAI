// modules/discord/setup/panels.js
// Renders the /setup dashboard: a category dropdown plus per-category controls
// (native channel/role pickers, toggle buttons, sub-selects). Panels are
// stateless — every render reads current settings; transient selection state
// (which action/group/command is being edited) is carried in `ctx` and encoded
// into component customIds, so no server-side session is needed.
//
// customId scheme (prefix "dset_"):
//   dset_cat                       category dropdown (value = category)
//   dset_toggle_<feature>          basic feature enable toggle (button)
//   dset_gw_hostroles              giveaway host roles (role select)
//   dset_gw_emoji                  giveaway emoji (button -> modal)
//   dset_ml_action                 pick a moderation action (string select)
//   dset_ml_chan|<action>          set channel for that action (channel select)
//   dset_ml_fallback               fallback mod-log channel (channel select)
//   dset_mr_pickgroup              pick a permission group (string select)
//   dset_mr_setroles|<group>       set that group's roles (role select)
//   dset_mr_pickcmd                pick a command (string select)
//   dset_mr_setcmdgroup|<command>  map that command to a group (string select)
//   dset_clan_announce|log|managers, dset_alli_*   clan/alliance pickers
//   dset_boost_toggle_<key>, dset_boost_anchor, dset_boost_log  booster controls

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

const CATEGORIES = [
  { value: "overview", label: "Overview", emoji: "📋", description: "Everything at a glance" },
  { value: "basic", label: "Basic Discord", emoji: "⚙️", description: "Leveling, invites, stats, automod toggles" },
  { value: "giveaways", label: "Giveaways", emoji: "🎉", description: "Host roles, emoji, templates" },
  { value: "modlogs", label: "Moderation logs", emoji: "📜", description: "A channel per moderation action" },
  { value: "modroles", label: "Moderation roles", emoji: "🛡️", description: "Which roles may run which commands" },
  { value: "clan", label: "Clan", emoji: "⚔️", description: "Clan announce/log channels + managers" },
  { value: "alliance", label: "Alliance", emoji: "🤝", description: "Alliance announce/log channels + managers" },
  { value: "boosters", label: "Booster roles", emoji: "💜", description: "Self-service roles for boosters" },
];

const chan = (id) => (id ? `<#${id}>` : "*not set*");
const roles = (ids) => (ids && ids.length ? ids.map((r) => `<@&${r}>`).join(", ") : "*none*");
const onoff = (v) => (v ? "✅ on" : "❌ off");

function categoryRow(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dset_cat")
      .setPlaceholder("Choose a settings category…")
      .addOptions(
        CATEGORIES.map((c) => ({
          label: c.label,
          value: c.value,
          description: c.description,
          emoji: c.emoji,
          default: c.value === current,
        }))
      )
  );
}

function channelRow(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addChannelTypes(ChannelType.GuildText).setMinValues(0).setMaxValues(1)
  );
}
function roleRow(customId, placeholder, max = 25) {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(0).setMaxValues(max)
  );
}

function render(guildId, category = "overview", ctx = {}) {
  const s = getGuildSettings(guildId);
  const components = [categoryRow(category)];
  let embed;

  if (category === "basic") {
    embed = makeEmbed({
      title: "⚙️ Basic Discord",
      color: "brand",
      description: "Toggle the core features. Use the dedicated commands for detailed settings.",
      fields: [
        { name: "Leveling", value: `${onoff(s.leveling.enabled)} · \`/level-config\``, inline: true },
        { name: "Invites", value: `${onoff(s.invites.enabled)} · \`/invite-config\``, inline: true },
        { name: "Statistics", value: `${onoff(s.statistics.enabled)} · \`/discord-config logging\``, inline: true },
        { name: "Automod", value: `${onoff(s.automod.enabled)} · \`/automod\``, inline: true },
      ],
    });
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dset_toggle_leveling").setLabel("Leveling").setStyle(s.leveling.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_toggle_invites").setLabel("Invites").setStyle(s.invites.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_toggle_statistics").setLabel("Statistics").setStyle(s.statistics.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_toggle_automod").setLabel("Automod").setStyle(s.automod.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    );
  } else if (category === "giveaways") {
    embed = makeEmbed({
      title: "🎉 Giveaways",
      color: "brand",
      description: "Configure who can host giveaways and the entry emoji. Templates live in `/giveaway template`; bonus entries are set **per template** (`/giveaway template bonus`) or **per giveaway** (`/giveaway create bonus-role`).",
      fields: [
        { name: "Host roles", value: roles(s.giveaways.hostRoleIds), inline: false },
        { name: "Emoji", value: s.giveaways.emoji || "🎉", inline: true },
      ],
    });
    components.push(roleRow("dset_gw_hostroles", "Select giveaway host roles…"));
    components.push(
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("dset_gw_emoji").setLabel("Set entry emoji").setEmoji("🎉").setStyle(ButtonStyle.Secondary))
    );
  } else if (category === "modlogs") {
    const logs = s.moderation.logs || {};
    embed = makeEmbed({
      title: "📜 Moderation logs",
      color: "brand",
      description: `Assign a channel per action (falls back to the mod-log channel).\nFallback: ${chan(s.moderation.modLogChannelId)}`,
      fields: Object.keys(logs).map((a) => ({ name: a, value: chan(logs[a]), inline: true })),
    });
    const actionOptions = Object.keys(logs).map((a) => ({ label: a, value: a, default: a === ctx.action }));
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("dset_ml_action").setPlaceholder("Pick an action to set its channel…").addOptions(actionOptions)
      )
    );
    if (ctx.action) components.push(channelRow(`dset_ml_chan|${ctx.action}`, `Channel for "${ctx.action}" (clear = fallback)`));
    components.push(channelRow("dset_ml_fallback", "Fallback mod-log channel…"));
  } else if (category === "modroles") {
    const perms = s.permissions || { groups: {}, commandGroup: {} };
    embed = makeEmbed({
      title: "🛡️ Moderation roles",
      color: "brand",
      description: "Grant command access by role. Admins/Manage Server always pass. A command with roles set is restricted to those roles; otherwise it uses the built-in Discord permission.",
      fields: [
        ...Object.entries(perms.groups).map(([g, ids]) => ({ name: `Group: ${g}`, value: roles(ids), inline: true })),
        { name: "Command → group", value: Object.entries(perms.commandGroup).map(([c, g]) => `\`${c}\`→${g}`).join("  ") || "*none*", inline: false },
      ],
    });
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("dset_mr_pickgroup").setPlaceholder("Pick a group to set its roles…").addOptions(
          Object.keys(perms.groups).map((g) => ({ label: g, value: g, default: g === ctx.group }))
        )
      )
    );
    if (ctx.group) components.push(roleRow(`dset_mr_setroles|${ctx.group}`, `Roles for "${ctx.group}"…`));
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId("dset_mr_pickcmd").setPlaceholder("Pick a command to map to a group…").addOptions(
          Object.keys(perms.commandGroup).slice(0, 25).map((c) => ({ label: c, value: c, default: c === ctx.command }))
        )
      )
    );
    if (ctx.command)
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`dset_mr_setcmdgroup|${ctx.command}`).setPlaceholder(`Group for /${ctx.command}…`).addOptions(
            Object.keys(perms.groups).map((g) => ({ label: g, value: g, default: perms.commandGroup[ctx.command] === g }))
          )
        )
      );
  } else if (category === "clan" || category === "alliance") {
    const block = s[category];
    const p = category === "clan" ? "dset_clan" : "dset_alli";
    embed = makeEmbed({
      title: category === "clan" ? "⚔️ Clan" : "🤝 Alliance",
      color: "brand",
      description: `Channels and managing roles for the ${category} system. Manage ${category}s themselves with \`/${category}\`.`,
      fields: [
        { name: "Announce channel", value: chan(block.announceChannelId), inline: true },
        { name: "Log channel", value: chan(block.logChannelId), inline: true },
        { name: "Manager roles", value: roles(block.managerRoleIds), inline: false },
      ],
    });
    components.push(channelRow(`${p}_announce`, "Announcement channel…"));
    components.push(channelRow(`${p}_log`, "Log channel…"));
    components.push(roleRow(`${p}_managers`, "Manager roles…"));
  } else if (category === "boosters") {
    const b = s.boosterRoles;
    embed = makeEmbed({
      title: "💜 Booster roles",
      color: "brand",
      description: "Let boosters create their own role with `/boostrole`.",
      fields: [
        { name: "Enabled", value: onoff(b.enabled), inline: true },
        { name: "Remove on unboost", value: onoff(b.removeOnUnboost), inline: true },
        { name: "Allow gradient", value: onoff(b.allowGradient), inline: true },
        { name: "Allow icons", value: onoff(b.allowIcons), inline: true },
        { name: "Anchor role", value: b.anchorRoleId ? `<@&${b.anchorRoleId}>` : "*below my top role*", inline: true },
        { name: "Log channel", value: chan(b.logChannelId), inline: true },
        { name: "Multi-booster role", value: b.multiBoostRoleId ? `<@&${b.multiBoostRoleId}> at ${b.multiBoostThreshold}+ boosts` : "*not set*", inline: false },
      ],
      footer: "Multi-boost counts are tracked from boost messages while the bot runs; seed history with /boostrole setcount",
    });
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("dset_boost_toggle_enabled").setLabel("Enabled").setStyle(b.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_boost_toggle_removeOnUnboost").setLabel("Remove on unboost").setStyle(b.removeOnUnboost ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_boost_toggle_allowGradient").setLabel("Gradient").setStyle(b.allowGradient ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_boost_toggle_allowIcons").setLabel("Icons").setStyle(b.allowIcons ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("dset_boost_threshold").setLabel(`Threshold: ${b.multiBoostThreshold}`).setStyle(ButtonStyle.Primary)
      )
    );
    components.push(roleRow("dset_boost_anchor", "Anchor role (new roles placed just below)…", 1));
    components.push(roleRow("dset_boost_multirole", "Multi-booster role (granted at threshold)…", 1));
    components.push(channelRow("dset_boost_log", "Booster-role log channel…"));
  } else {
    // overview
    embed = makeEmbed({
      title: "🛠️ KenzAI Setup",
      color: "brand",
      description: "Pick a category below to configure the bot for this server.",
      fields: [
        { name: "⚙️ Basic Discord", value: `Leveling ${onoff(s.leveling.enabled)} · Invites ${onoff(s.invites.enabled)} · Stats ${onoff(s.statistics.enabled)} · Automod ${onoff(s.automod.enabled)}` },
        { name: "🎉 Giveaways", value: `Host roles: ${roles(s.giveaways.hostRoleIds)}` },
        { name: "📜 Moderation logs", value: `Fallback: ${chan(s.moderation.modLogChannelId)}` },
        { name: "🛡️ Moderation roles", value: Object.entries(s.permissions.groups).map(([g, ids]) => `${g}: ${ids.length}`).join(" · ") },
        { name: "💜 Booster roles", value: onoff(s.boosterRoles.enabled) },
      ],
    });
  }

  return { embeds: [embed], components };
}

module.exports = { render, CATEGORIES };
