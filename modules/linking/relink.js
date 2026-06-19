// modules/linking/relink.js
// Admin-only /relink — rewrites a member's Discord identity (ID + username)
// across EVERY data store. Use when a member loses access to their Discord
// account and returns on a new one: all of their records (member profile,
// applications, kick/ban history, account links, empire ID, subscriptions,
// court requests, judiciary references, …) are moved from the old Discord ID to
// the new one, and stored usernames are refreshed.
//
// Safety:
//   • Discord IDs are 17-19 digit snowflakes, so the old ID is matched by exact
//     string — it can never collide with unrelated data (clan names, MC names…).
//   • Nothing is written until an admin presses "Confirm" on the preview.
//   • Writes go through the normal persistence layers, so MySQL is dual-written
//     automatically (no direct SQL here).

const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const membersPersistence = require("../database/membersPersistence");
const empireRegistryPersistence = require("../database/empireRegistryPersistence");
const { stores } = require("../database/stores");
const { relinkMap } = require("./relinkCore");

// ---------------------------------------------------------------------------
// Which stores carry a Discord user reference, and how.
// ---------------------------------------------------------------------------

// Hybrid stores whose TOP-LEVEL KEY is the Discord ID (the record must be moved
// to the new key) AND whose values may embed the ID.
const KEYED_BY_DISCORD = [
  "applicants",
  "kicked_members",
  "banned_members",
  "linking",
  "archived_members",
  "draft_deserters",
  "court_requests",
  "subscriptions", // keyed by user_id == discord id
];

// Hybrid stores keyed by something else (log id / slot id / case id) but whose
// values embed the Discord ID somewhere — deep-replace only, no key move.
const EMBED_ONLY = [
  "subscription_logs",
  "bot_slots",
  "slot_queue",
  "judiciary_cases",
  "judiciary_archived_cases",
  "judiciary_audit_log",
];

const SNOWFLAKE = /^\d{17,20}$/;

// ---------------------------------------------------------------------------
// Source registry — read/clone/transform/(optionally)write each data store.
// ---------------------------------------------------------------------------

function buildSources() {
  const sources = [
    {
      name: "members",
      kind: "map",
      remapKeys: true,
      read: () => membersPersistence.readMembers(),
      write: (m) => membersPersistence.writeMembers(m),
    },
    {
      name: "empire_ids",
      kind: "registry",
      remapKeys: false,
      read: () => empireRegistryPersistence.loadEmpireRegistry(),
      write: (r) => empireRegistryPersistence.saveEmpireRegistry(r),
    },
  ];

  for (const n of KEYED_BY_DISCORD) {
    sources.push({
      name: n,
      kind: "map",
      remapKeys: true,
      read: () => stores[n].readMap(),
      write: (m) => stores[n].writeMap(m),
    });
  }
  for (const n of EMBED_ONLY) {
    sources.push({
      name: n,
      kind: "map",
      remapKeys: false,
      read: () => stores[n].readMap(),
      write: (m) => stores[n].writeMap(m),
    });
  }
  return sources;
}

/**
 * Run the relink across every store.
 * @param {boolean} apply  when false, computes the plan without writing.
 */
function processAll(oldId, newId, newUsername, apply) {
  const report = [];
  let total = 0;
  const conflicts = [];

  for (const src of buildSources()) {
    let data;
    try {
      data = src.read();
    } catch (e) {
      report.push({ name: src.name, error: e.message });
      continue;
    }

    // Always work on a clone so a preview never mutates live caches.
    const clone = JSON.parse(
      JSON.stringify(data == null ? (src.kind === "registry" ? { nextNumber: 14, ids: {} } : {}) : data)
    );

    const target = src.kind === "registry" ? clone.ids || (clone.ids = {}) : clone;
    const stats = relinkMap(target, { oldId, newId, newUsername, remapKeys: src.remapKeys });

    if (stats.changes || stats.keyMoved) {
      report.push({ name: src.name, ...stats });
      total += stats.changes;
      if (stats.conflict) conflicts.push(src.name);
      if (apply) {
        try {
          src.write(clone);
        } catch (e) {
          report[report.length - 1].writeError = e.message;
        }
      }
    }
  }

  return { report, total, conflicts };
}

// ---------------------------------------------------------------------------
// Discord command
// ---------------------------------------------------------------------------

let running = false;

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function renderReport(report) {
  if (!report.length) return "_No references found._";
  return report
    .map((r) => {
      if (r.error) return `⚠️ \`${r.name}\` — read error: ${r.error}`;
      const tags = [];
      if (r.keyMoved) tags.push(r.conflict ? "record moved ⚠️ overwrote existing" : "record moved");
      if (r.writeError) tags.push(`write error: ${r.writeError}`);
      const tagStr = tags.length ? ` (${tags.join("; ")})` : "";
      return `• \`${r.name}\` — ${r.changes} change${r.changes === 1 ? "" : "s"}${tagStr}`;
    })
    .join("\n");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("relink")
    .setDescription("Admin: move a member's data from an old Discord account to a new one")
    .addStringOption((o) =>
      o
        .setName("old_id")
        .setDescription("The OLD Discord user ID (the account they lost access to)")
        .setRequired(true)
    )
    .addUserOption((o) =>
      o
        .setName("new_account")
        .setDescription("The member's NEW Discord account")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    }

    const oldId = interaction.options.getString("old_id").trim();
    const newUser = interaction.options.getUser("new_account");
    const newId = newUser.id;
    const newUsername = newUser.username;

    if (!SNOWFLAKE.test(oldId)) {
      return interaction.reply({
        content: `❌ \`${oldId}\` is not a valid Discord user ID (17–20 digits).`,
        ephemeral: true,
      });
    }
    if (oldId === newId) {
      return interaction.reply({
        content: "❌ The old and new accounts are the same.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    if (running) {
      return interaction.editReply("⏳ Another relink is already running. Try again in a moment.");
    }

    // Preview only (apply = false)
    let plan;
    try {
      plan = processAll(oldId, newId, newUsername, false);
    } catch (e) {
      console.error("[/relink] preview error:", e);
      return interaction.editReply(`❌ Failed to build relink preview: ${e.message}`);
    }

    if (plan.total === 0 && !plan.report.some((r) => r.keyMoved)) {
      return interaction.editReply(
        `ℹ️ No data found for old ID \`${oldId}\`. Nothing to relink.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("🔗 Relink preview")
      .setColor(plan.conflicts.length ? 0xe67e22 : 0x3498db)
      .setDescription(
        `**Old ID:** \`${oldId}\`\n` +
          `**New account:** ${newUser} \`${newId}\` (\`${newUsername}\`)\n\n` +
          `The following will be rewritten:\n${renderReport(plan.report)}\n\n` +
          `**Total field changes:** ${plan.total}` +
          (plan.conflicts.length
            ? `\n\n⚠️ The new account already has records in: ${plan.conflicts
                .map((c) => `\`${c}\``)
                .join(", ")}. These will be **replaced** by the old account's data.`
            : "")
      )
      .setFooter({ text: "Data only — Discord roles/nickname on the new account are not changed." });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("relink_confirm")
        .setLabel("Confirm relink")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("relink_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Confirm/cancel is handled by an in-command collector so /relink does not
    // depend on events/interactionCreate.js routing (event handlers only reload
    // on a full process restart, not on a command hot-reload). The closure
    // already holds oldId / newId / newUsername, so no re-fetch is needed.
    const message = await interaction.fetchReply();
    let choice;
    try {
      choice = await message.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 120000,
      });
    } catch {
      return interaction.editReply({
        content: "⏱️ Relink confirmation timed out — nothing was changed.",
        embeds: [],
        components: [],
      });
    }

    if (choice.customId === "relink_cancel") {
      return choice.update({ content: "❌ Relink cancelled.", embeds: [], components: [] });
    }

    if (running) {
      return choice.update({
        content: "⏳ Another relink is already running. Try again in a moment.",
        embeds: [],
        components: [],
      });
    }

    await choice.update({ content: "⏳ Relinking…", embeds: [], components: [] });

    running = true;
    let result;
    try {
      result = processAll(oldId, newId, newUsername, true);
    } catch (e) {
      console.error("[/relink] apply error:", e);
      return interaction.editReply({
        content: `❌ Relink failed: ${e.message}`,
        embeds: [],
        components: [],
      });
    } finally {
      running = false;
    }

    const writeErrors = result.report.filter((r) => r.writeError);
    const resultEmbed = new EmbedBuilder()
      .setTitle(writeErrors.length ? "⚠️ Relink completed with errors" : "✅ Relink complete")
      .setColor(writeErrors.length ? 0xe74c3c : 0x2ecc71)
      .setDescription(
        `**Old ID:** \`${oldId}\` → **New ID:** \`${newId}\`` +
          (newUsername ? ` (\`${newUsername}\`)` : "") +
          `\n\n${renderReport(result.report)}\n\n` +
          `**Total field changes:** ${result.total}` +
          (writeErrors.length
            ? `\n\n❌ Some stores failed to write — check the logs.`
            : "\n\nMySQL is dual-written automatically. Run `/db parity` to verify.")
      )
      .setFooter({ text: "Remember to grant the new account the right Discord roles." });

    return interaction.editReply({ content: "", embeds: [resultEmbed], components: [] });
  },
};
