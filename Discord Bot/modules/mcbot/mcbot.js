// Discord Bot/modules/mcbot/mcbot.js
// /mcbot — Allows verified Yazanaki Empire members to control a Minecraft bot
// on the empire VPS from Discord.
//
// Subcommands:
//   start  <server> [version]  — Start your MC bot on a server
//   stop                       — Stop your running bot
//   status                     — Check your bot's current status
//   list                       — [Admin] List all active bots
//   stopall                    — [Admin] Emergency stop all bots

"use strict";

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
} = require("discord.js");

const {
  validateMember,
  pingVps,
  startBotOnVps,
  stopBotOnVps,
  getBotStatusFromVps,
  listAllBotsOnVps,
  stopAllBotsOnVps,
} = require("./mcbotlogic");

// Yazanaki Empire Guild ID — command is locked to this server
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Supported Minecraft versions (common ones — extend as needed)
const SUPPORTED_VERSIONS = [
  "1.21.4", "1.21.1", "1.21", "1.20.4", "1.20.2", "1.20.1",
  "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2",
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mcbot")
    .setDescription("Control your Minecraft bot on the Yazanaki VPS")

    // ── start ────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start your Minecraft bot on a server")
        .addStringOption((opt) =>
          opt
            .setName("server")
            .setDescription("Minecraft server address (e.g. play.example.net or 123.45.67.89:25565)")
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("version")
            .setDescription("Minecraft version (default: 1.20.1)")
            .setRequired(false)
            .addChoices(
              ...SUPPORTED_VERSIONS.map((v) => ({ name: v, value: v }))
            )
        )
    )

    // ── stop ─────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Stop your currently running Minecraft bot")
    )

    // ── status ───────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check the status of your Minecraft bot")
    )

    // ── list (admin) ─────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("[Admin] List all active bots on the VPS")
    )

    // ── stopall (admin) ──────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName("stopall")
        .setDescription("[Admin] Emergency stop — kill ALL active bots")
    ),

  // ============================================================
  // EXECUTE
  // ============================================================
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/mcbot] 🎯 /${sub} — ${interaction.user.tag} (${userId})`);

    // ── GUILD LOCK: Yazanaki Empire only ─────────────────────
    if (interaction.guild?.id !== YAZANAKI_EMPIRE_GUILD_ID) {
      return interaction.reply({
        content: "❌ This command can only be used in the **Yazanaki Empire** discord.",
        ephemeral: true,
      });
    }

    // ============================================================
    // ADMIN SUBCOMMANDS (require KickMembers permission)
    // ============================================================

    if (sub === "list" || sub === "stopall") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You need the **Kick Members** permission to use this command.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // ── list ─────────────────────────────────────────────
      if (sub === "list") {
        const response = await listAllBotsOnVps();

        if (!response.ok) {
          return interaction.editReply({
            content: `❌ Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``,
          });
        }

        const bots = response.data.bots || [];

        if (bots.length === 0) {
          return interaction.editReply({ content: "📋 No bots are currently running." });
        }

        const embed = new EmbedBuilder()
          .setTitle(`🤖 Active Bots (${bots.length})`)
          .setColor(0x000000)
          .setTimestamp();

        for (const bot of bots) {
          const uptime = bot.uptimeSeconds
            ? formatUptime(bot.uptimeSeconds)
            : "Unknown";

          embed.addFields({
            name: `${bot.minecraftUser} — ${getStatusEmoji(bot.status)} ${bot.status}`,
            value: [
              `👤 Discord: <@${bot.discordId}>`,
              `🌐 Server: \`${bot.serverHost}:${bot.serverPort}\``,
              `🎮 Version: \`${bot.version}\``,
              `⏱️ Uptime: \`${uptime}\``,
              `📅 Started: <t:${Math.floor(new Date(bot.startedAt).getTime() / 1000)}:R>`,
            ].join("\n"),
            inline: false,
          });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // ── stopall ───────────────────────────────────────────
      if (sub === "stopall") {
        const response = await stopAllBotsOnVps();

        if (!response.ok) {
          return interaction.editReply({
            content: `❌ Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``,
          });
        }

        const stopped = response.data?.stopped ?? "?";
        return interaction.editReply({
          content: `🚨 **Emergency stop executed.** Stopped \`${stopped}\` bot(s).`,
        });
      }
    }

    // ============================================================
    // MEMBER SUBCOMMANDS (require active empire membership)
    // ============================================================

    await interaction.deferReply({ ephemeral: true });

    // Run security checks
    const validation = validateMember(userId);

    if (!validation.valid) {
      console.warn(`[/mcbot] 🚫 Validation failed for ${userId}: ${validation.reason}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({ content: validation.message });
    }

    const { minecraftUser, empireId } = validation;
    console.log(`[/mcbot] ✅ Member validated: ${minecraftUser} (${empireId})`);

    // ── start ─────────────────────────────────────────────────
    if (sub === "start") {
      const serverAddress = interaction.options.getString("server").trim();
      const version = interaction.options.getString("version") || "1.20.1";

      // Basic server address sanity check
      if (!serverAddress || serverAddress.length < 3) {
        return interaction.editReply({
          content: "❌ Invalid server address. Example: `play.example.net` or `123.45.67.89:25565`",
        });
      }

      console.log(`[/mcbot] 🤖 Starting bot: ${minecraftUser} → ${serverAddress} (v${version})`);

      const response = await startBotOnVps(userId, minecraftUser, serverAddress, version);

      if (!response.ok) {
        if (response.data?.reason === "already_running") {
          return interaction.editReply({
            content: `⚠️ You already have a bot running on \`${response.data.serverAddress || "a server"}\`.\nUse \`/mcbot stop\` first.`,
          });
        }
        if (response.data?.reason === "max_bots_reached") {
          return interaction.editReply({
            content: `⚠️ The VPS has reached its bot limit (\`${response.data.max}\`). Try again later.`,
          });
        }
        if (response.status === 0) {
          return interaction.editReply({
            content: `❌ Could not reach the VPS bot server. It may be offline.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``,
          });
        }
        return interaction.editReply({
          content: `❌ Failed to start bot: ${response.data?.error || response.data?.reason || "Unknown error"}`,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🤖 Bot Started")
        .setColor(0x00c853)
        .setDescription(`Your Minecraft bot is now connecting to **${serverAddress}**`)
        .addFields(
          { name: "🎮 Minecraft User", value: `\`${minecraftUser}\``, inline: true },
          { name: "🆔 Empire ID", value: `\`${empireId}\``, inline: true },
          { name: "🌐 Server", value: `\`${serverAddress}\``, inline: false },
          { name: "📦 Version", value: `\`${version}\``, inline: true },
        )
        .setFooter({ text: "Use /mcbot stop to disconnect your bot" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── stop ──────────────────────────────────────────────────
    if (sub === "stop") {
      console.log(`[/mcbot] 🛑 Stopping bot for: ${minecraftUser}`);

      const response = await stopBotOnVps(userId);

      if (!response.ok) {
        if (response.data?.reason === "no_bot_running") {
          return interaction.editReply({
            content: "⚠️ You don't have a bot currently running.",
          });
        }
        if (response.status === 0) {
          return interaction.editReply({
            content: `❌ Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``,
          });
        }
        return interaction.editReply({
          content: `❌ Failed to stop bot: ${response.data?.error || "Unknown error"}`,
        });
      }

      return interaction.editReply({
        content: `✅ Your bot (\`${minecraftUser}\`) has been disconnected.`,
      });
    }

    // ── status ────────────────────────────────────────────────
    if (sub === "status") {
      console.log(`[/mcbot] 📊 Status check for: ${minecraftUser}`);

      const response = await getBotStatusFromVps(userId);

      if (!response.ok) {
        if (response.status === 404) {
          return interaction.editReply({
            content: `📴 You have no bot currently running.\nUse \`/mcbot start <server>\` to launch one.`,
          });
        }
        if (response.status === 0) {
          return interaction.editReply({
            content: `❌ Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``,
          });
        }
        return interaction.editReply({
          content: `❌ Could not fetch bot status: ${response.data?.error || "Unknown error"}`,
        });
      }

      const bot = response.data.bot;
      const uptime = bot.uptimeSeconds ? formatUptime(bot.uptimeSeconds) : "Unknown";

      const embed = new EmbedBuilder()
        .setTitle(`${getStatusEmoji(bot.status)} Bot Status`)
        .setColor(bot.status === "online" ? 0x00c853 : bot.status === "reconnecting" ? 0xffab00 : 0xf44336)
        .addFields(
          { name: "🎮 Minecraft User", value: `\`${bot.minecraftUser}\``, inline: true },
          { name: "🔌 Status", value: `\`${bot.status}\``, inline: true },
          { name: "🌐 Server", value: `\`${bot.serverHost}:${bot.serverPort}\``, inline: false },
          { name: "📦 Version", value: `\`${bot.version}\``, inline: true },
          { name: "⏱️ Uptime", value: `\`${uptime}\``, inline: true },
          { name: "📅 Started", value: `<t:${Math.floor(new Date(bot.startedAt).getTime() / 1000)}:R>`, inline: false },
        )
        .setFooter({ text: `Empire ID: ${empireId}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },
};

// ============================================================
// HELPERS
// ============================================================

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function getStatusEmoji(status) {
  switch (status) {
    case "online":       return "🟢";
    case "connecting":   return "🟡";
    case "reconnecting": return "🟠";
    default:             return "🔴";
  }
}