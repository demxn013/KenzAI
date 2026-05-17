// modules/database/db.js
// Admin-only DB tasks (migrate/backfill/parity) for shared hosting without terminal access.

const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const tasks = require("./adminTasks");
const dbConfig = require("./dbConfig");

let running = false;

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("db")
    .setDescription("Admin-only MySQL maintenance commands")
    .addSubcommand((sub) =>
      sub.setName("migrate").setDescription("Apply MySQL schema migrations")
    )
    .addSubcommand((sub) =>
      sub.setName("backfill").setDescription("Backfill JSON data into MySQL")
    )
    .addSubcommand((sub) =>
      sub
        .setName("parity")
        .setDescription("Compare JSON vs MySQL counts (quick sanity check)")
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ Admin only.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (running) {
      return interaction.editReply(
        "⏳ A DB task is already running. Try again in a minute."
      );
    }

    running = true;
    try {
      if (!dbConfig.mysqlEnabled) {
        return interaction.editReply(
          "❌ MySQL is disabled. Set `MYSQL_ENABLED=true` and `DB_*` credentials in `.env`."
        );
      }

      if (sub === "migrate") {
        const res = await tasks.runMigrations();
        return interaction.editReply(
          `✅ Migrations applied: ${res.applied.join(", ")}`
        );
      }

      if (sub === "backfill") {
        const res = await tasks.runBackfill();
        return interaction.editReply(
          `✅ Backfill complete.\n- users: ${res.users}\n- clans: ${res.clans}\n- empireIds: ${res.empireIds}`
        );
      }

      if (sub === "parity") {
        const res = await tasks.parityCounts();
        return interaction.editReply(
          `📊 Parity counts:\n- JSON members: ${res.jsonMembers}\n- SQL users: ${res.sqlUsers}\n- JSON clans: ${res.jsonClans}\n- SQL clans: ${res.sqlClans}`
        );
      }

      return interaction.editReply("❌ Unknown subcommand.");
    } catch (err) {
      console.error("[/db] ❌ error:", err);
      return interaction.editReply(
        `❌ Failed: ${err?.message || "unknown error"}`
      );
    } finally {
      running = false;
    }
  },
};

