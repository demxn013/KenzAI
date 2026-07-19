// modules/discord/giveaways/giveaway.js — /giveaway
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");
const store = require("./giveawayStore");
const logic = require("./giveawaylogic");
const templates = require("./templates/templates");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed, success, danger } = require("../common/embeds");
const { parseDuration, formatDuration } = require("../common/util");

const MAX_DURATION_MS = 60 * 86400 * 1000; // 60 days

function canHost(member, settings) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return (settings.giveaways.hostRoleIds || []).some((r) => member.roles.cache.has(r));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage giveaways")
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName("start")
        .setDescription("Start a giveaway")
        .addStringOption((o) => o.setName("prize").setDescription("What's being given away"))
        .addStringOption((o) => o.setName("duration").setDescription("e.g. 1h, 2d, 30m"))
        .addIntegerOption((o) => o.setName("winners").setDescription("Number of winners (default 1)").setMinValue(1).setMaxValue(50))
        .addChannelOption((o) => o.setName("channel").setDescription("Channel to post in (default: here)").addChannelTypes(ChannelType.GuildText))
        .addRoleOption((o) => o.setName("required-role").setDescription("Role required to enter"))
        .addIntegerOption((o) => o.setName("required-level").setDescription("Minimum level required to enter").setMinValue(1))
        .addStringOption((o) => o.setName("template").setDescription("Load a saved template as the base"))
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End a giveaway now").addStringOption((o) => o.setName("message-id").setDescription("Giveaway message ID").setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName("reroll")
        .setDescription("Reroll winners for an ended giveaway")
        .addStringOption((o) => o.setName("message-id").setDescription("Giveaway message ID").setRequired(true))
        .addIntegerOption((o) => o.setName("winners").setDescription("How many new winners").setMinValue(1).setMaxValue(50))
    )
    .addSubcommand((s) => s.setName("list").setDescription("List active giveaways"))
    .addSubcommandGroup((g) =>
      g
        .setName("template")
        .setDescription("Manage reusable giveaway templates")
        .addSubcommand((s) =>
          s
            .setName("save")
            .setDescription("Save a giveaway template")
            .addStringOption((o) => o.setName("name").setDescription("Template name").setRequired(true))
            .addStringOption((o) => o.setName("prize").setDescription("Prize").setRequired(true))
            .addStringOption((o) => o.setName("duration").setDescription("Duration, e.g. 1d").setRequired(true))
            .addIntegerOption((o) => o.setName("winners").setDescription("Winners (default 1)").setMinValue(1).setMaxValue(50))
            .addRoleOption((o) => o.setName("required-role").setDescription("Required role"))
            .addIntegerOption((o) => o.setName("required-level").setDescription("Required level").setMinValue(1))
        )
        .addSubcommand((s) => s.setName("list").setDescription("List saved templates"))
        .addSubcommand((s) =>
          s.setName("delete").setDescription("Delete a template").addStringOption((o) => o.setName("name").setDescription("Template name").setRequired(true))
        )
    ),

  async execute(interaction) {
    const settings = getGuildSettings(interaction.guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!canHost(interaction.member, settings))
      return interaction.reply({ embeds: [danger("You need **Manage Server** or a configured giveaway-host role.")], ephemeral: true });

    // ----- template group -----
    if (group === "template") {
      if (sub === "save") {
        const name = interaction.options.getString("name");
        const durationMs = parseDuration(interaction.options.getString("duration"));
        if (!durationMs) return interaction.reply({ embeds: [danger("Invalid duration.")], ephemeral: true });
        templates.save(interaction.guildId, name, {
          prize: interaction.options.getString("prize"),
          winnerCount: interaction.options.getInteger("winners") || 1,
          durationMs,
          requiredRoleId: interaction.options.getRole("required-role")?.id || null,
          requiredLevel: interaction.options.getInteger("required-level") || 0,
        });
        return interaction.reply({ embeds: [success(`Saved template **${name}**.`)], ephemeral: true });
      }
      if (sub === "list") {
        const list = templates.list(interaction.guildId);
        if (!list.length) return interaction.reply({ embeds: [makeEmbed({ description: "No templates saved." })], ephemeral: true });
        const lines = list.map((t) => `• **${t.name}** — ${t.prize}, ${t.winnerCount}w, ${formatDuration(t.durationMs)}`);
        return interaction.reply({ embeds: [makeEmbed({ title: "🎁 Giveaway templates", description: lines.join("\n") })], ephemeral: true });
      }
      if (sub === "delete") {
        const name = interaction.options.getString("name");
        const ok = templates.remove(interaction.guildId, name);
        return interaction.reply({ embeds: [ok ? success(`Deleted template **${name}**.`) : danger("No such template.")], ephemeral: true });
      }
    }

    // ----- start -----
    if (sub === "start") {
      let base = {};
      const tplName = interaction.options.getString("template");
      if (tplName) {
        const tpl = templates.get(interaction.guildId, tplName);
        if (!tpl) return interaction.reply({ embeds: [danger(`No template named **${tplName}**.`)], ephemeral: true });
        base = tpl;
      }

      const prize = interaction.options.getString("prize") || base.prize;
      const durationRaw = interaction.options.getString("duration");
      const durationMs = durationRaw ? parseDuration(durationRaw) : base.durationMs;
      const winnerCount = interaction.options.getInteger("winners") || base.winnerCount || 1;
      const channel = interaction.options.getChannel("channel") || interaction.channel;
      const requiredRoleId = interaction.options.getRole("required-role")?.id ?? base.requiredRoleId ?? null;
      const requiredLevel = interaction.options.getInteger("required-level") ?? base.requiredLevel ?? 0;

      if (!prize) return interaction.reply({ embeds: [danger("A prize is required (provide `prize` or a template).")], ephemeral: true });
      if (!durationMs) return interaction.reply({ embeds: [danger("A valid duration is required (e.g. `1h`, `2d`).")], ephemeral: true });
      if (durationMs > MAX_DURATION_MS) return interaction.reply({ embeds: [danger("Giveaways can last at most **60 days**.")], ephemeral: true });

      const record = {
        messageId: null,
        guildId: interaction.guildId,
        channelId: channel.id,
        prize,
        winnerCount,
        hostId: interaction.user.id,
        endsAt: new Date(Date.now() + durationMs).toISOString(),
        status: "active",
        entries: [],
        requiredRoleId,
        requiredLevel,
        winnerIds: [],
        createdAt: new Date().toISOString(),
      };

      try {
        const msg = await channel.send({ embeds: [logic.buildEmbed(record)] });
        record.messageId = msg.id;
        await msg.edit({ embeds: [logic.buildEmbed(record)], components: [logic.buildRow(msg.id)] });
        store.save(record);
        return interaction.reply({ embeds: [success(`Giveaway for **${prize}** started in ${channel} — ends in ${formatDuration(durationMs)}.`)], ephemeral: true });
      } catch (err) {
        return interaction.reply({ embeds: [danger(`Couldn't start the giveaway: ${err.message}`)], ephemeral: true });
      }
    }

    // ----- end -----
    if (sub === "end") {
      const id = interaction.options.getString("message-id").trim();
      const record = store.get(id);
      if (!record) return interaction.reply({ embeds: [danger("No giveaway with that message ID.")], ephemeral: true });
      if (record.status !== "active") return interaction.reply({ embeds: [danger("That giveaway has already ended.")], ephemeral: true });
      await logic.endGiveaway(interaction.client, record);
      return interaction.reply({ embeds: [success("Giveaway ended.")], ephemeral: true });
    }

    // ----- reroll -----
    if (sub === "reroll") {
      const id = interaction.options.getString("message-id").trim();
      const count = interaction.options.getInteger("winners");
      const record = store.get(id);
      if (!record) return interaction.reply({ embeds: [danger("No giveaway with that message ID.")], ephemeral: true });
      if (record.status === "active") return interaction.reply({ embeds: [danger("End the giveaway before rerolling.")], ephemeral: true });
      const res = await logic.rerollGiveaway(interaction.client, record, count);
      return interaction.reply({ embeds: [res.ok ? success("Rerolled.") : danger(res.reason)], ephemeral: true });
    }

    // ----- list -----
    if (sub === "list") {
      const list = store.activeForGuild(interaction.guildId);
      if (!list.length) return interaction.reply({ embeds: [makeEmbed({ description: "No active giveaways." })], ephemeral: true });
      const lines = list.map(
        (g) => `• **${g.prize}** — ${g.entries.length} entries, ends <t:${Math.floor(new Date(g.endsAt).getTime() / 1000)}:R> (\`${g.messageId}\`)`
      );
      return interaction.reply({ embeds: [makeEmbed({ title: "🎉 Active giveaways", description: lines.join("\n") })], ephemeral: true });
    }
  },

  // Entry button: dgw_enter_<messageId>
  async buttonHandler(interaction) {
    if (!interaction.customId.startsWith("dgw_enter_")) return;
    const messageId = interaction.customId.slice("dgw_enter_".length);
    const record = store.get(messageId);
    if (!record || record.status !== "active")
      return interaction.reply({ content: "This giveaway is no longer active.", ephemeral: true });

    const check = logic.meetsRequirements(interaction.member, record);
    if (!check.ok) return interaction.reply({ content: `❌ ${check.reason}`, ephemeral: true });

    const idx = record.entries.indexOf(interaction.user.id);
    let msg;
    if (idx === -1) {
      record.entries.push(interaction.user.id);
      msg = "✅ You've entered the giveaway! Click again to leave.";
    } else {
      record.entries.splice(idx, 1);
      msg = "You've left the giveaway.";
    }
    store.save(record);

    // Refresh the entry count on the message (best effort).
    try {
      await interaction.message.edit({ embeds: [logic.buildEmbed(record)], components: [logic.buildRow(messageId)] });
    } catch {
      /* ignore */
    }
    return interaction.reply({ content: msg, ephemeral: true });
  },
};
