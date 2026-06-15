// modules/database/db.js
// Admin-only DB tasks (migrate / backfill / parity) for shared hosting without terminal access.

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
      sub
        .setName("migrate")
        .setDescription("Apply MySQL schema migrations (runs 002_flat_schema.sql)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("backfill")
        .setDescription("Backfill all JSON data into MySQL (members, clans, empire IDs)")
    )
    .addSubcommand((sub) =>
      sub
        .setName("parity")
        .setDescription("Compare JSON vs MySQL row counts (quick sanity check)")
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
          "❌ MySQL is disabled.\n\n" +
          "Set `MYSQL_ENABLED=true` and the following in `.env`:\n" +
          "```\n" +
          "MYSQL_ENABLED=true\n" +
          "DB_HOST=your_host\n" +
          "DB_PORT=3306\n" +
          "DB_USER=your_user\n" +
          "DB_PASSWORD=your_password\n" +
          "DB_NAME=your_database\n" +
          "```"
        );
      }

      if (sub === "migrate") {
        const res = await tasks.runMigrations();
        return interaction.editReply(
          `✅ **Migration complete**\nApplied: \`${res.applied.join(", ")}\`\n\n` +
          `Next step: run \`/db backfill\` to populate MySQL from JSON.`
        );
      }

      if (sub === "backfill") {
        const res = await tasks.runBackfill();
        const extraTotal = Object.values(res.extras || {})
          .filter((v) => typeof v === "number")
          .reduce((a, b) => a + b, 0);
        return interaction.editReply(
          `✅ **Backfill complete**\n` +
          `- Members: \`${res.users}\`\n` +
          `- Clans: \`${res.clans}\`\n` +
          `- Empire IDs: \`${res.empireIds}\`\n` +
          `- Extra stores: \`${Object.keys(res.extras || {}).length}\` tables, \`${extraTotal}\` rows\n\n` +
          `Run \`/db parity\` to verify counts match.`
        );
      }

      if (sub === "parity") {
        const res = await tasks.parityCounts();
        const membersMatch = res.jsonMembers === res.sqlUsers ? "✅" : "⚠️";
        const clansMatch   = res.jsonClans   === res.sqlClans  ? "✅" : "⚠️";
        const extraLines = (res.extras || [])
          .map((e) => `${e.json === e.sql ? "✅" : "⚠️"} ${e.name} — JSON: \`${e.json}\` | MySQL: \`${e.sql}\``)
          .join("\n");
        return interaction.editReply(
          `📊 **Parity Check**\n` +
          `${membersMatch} Members — JSON: \`${res.jsonMembers}\` | MySQL: \`${res.sqlUsers}\`\n` +
          `${clansMatch} Clans — JSON: \`${res.jsonClans}\` | MySQL: \`${res.sqlClans}\`` +
          (extraLines ? `\n${extraLines}` : "")
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