// Discord Bot/modules/mcbot/mcbot.js
// /mcbot — Allows verified Yazanaki Empire members to control a Minecraft bot
// on the empire VPS from Discord.
//
// Subcommands:
//   start  <server> [version]  — Start your MC bot on a server (requires DM confirmation)
//   stop                       — Stop your running bot
//   status                     — Check your bot's current status
//   list                       — [Admin] List all active bots
//   stopall                    — [Admin] Emergency stop all bots

"use strict";

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  validateMember,
  startBotOnVps,
  stopBotOnVps,
  getBotStatusFromVps,
  listAllBotsOnVps,
  stopAllBotsOnVps,
} = require("./mcbotlogic");

const { readClans } = require("../clantracking/clanlogic");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Confirmation timeout: 3 minutes
const CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000;

// Supported Minecraft versions
const SUPPORTED_VERSIONS = [
  "1.21.4", "1.21.1", "1.21", "1.20.4", "1.20.2", "1.20.1",
  "1.19.4", "1.19.2", "1.18.2", "1.17.1", "1.16.5", "1.12.2",
];

// Pending DM confirmations: userId -> confirmation data
const pendingConfirmations = new Map();

// ============================================================
// HELPERS
// ============================================================

/**
 * Returns a Set of all allowed guild IDs (Yazanaki Empire + all clan guilds).
 * Reads dynamically from clans.json so new clans are automatically included.
 */
function getAllowedGuildIds() {
  try {
    const clans = readClans();
    return new Set([YAZANAKI_EMPIRE_GUILD_ID, ...Object.keys(clans)]);
  } catch {
    return new Set([YAZANAKI_EMPIRE_GUILD_ID]);
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getStatusEmoji(status) {
  const map = { online: "🟢", reconnecting: "🟡", connecting: "🔵", error: "🔴" };
  return map[status] ?? "⚪";
}

function getStatusColor(status) {
  const map = { online: 0x00c853, reconnecting: 0xffd600, connecting: 0x2196f3, error: 0xf44336 };
  return map[status] ?? 0x000000;
}

// ============================================================
// EMBED BUILDERS
// ============================================================

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xf44336)
    .setTimestamp();
}

function warningEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`⚠️ ${title}`)
    .setDescription(description)
    .setColor(0xffd600)
    .setTimestamp();
}

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x00c853)
    .setTimestamp();
}

function infoEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setColor(0x2196f3)
    .setTimestamp();
}

// ============================================================
// CONFIRMATION BUTTON ROW
// ============================================================

function buildConfirmRow(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mcbot_confirm_${userId}`)
      .setLabel("✅ Confirm — Start Bot")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`mcbot_reject_${userId}`)
      .setLabel("❌ Reject — Cancel")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

// ============================================================
// MODULE EXPORT
// ============================================================

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

    // ── GUILD LOCK: Yazanaki Empire + all clan discords ───────
    const allowedGuilds = getAllowedGuildIds();
    if (!interaction.guild || !allowedGuilds.has(interaction.guild.id)) {
      return interaction.reply({
        embeds: [errorEmbed(
          "Command Unavailable",
          "This command can only be used in the **Yazanaki Empire** discord or a registered **clan discord**."
        )],
        ephemeral: true,
      });
    }

    // ============================================================
    // ADMIN SUBCOMMANDS (require KickMembers permission)
    // ============================================================

    if (sub === "list" || sub === "stopall") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          embeds: [errorEmbed(
            "Missing Permission",
            "You need the **Kick Members** permission to use this command."
          )],
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // ── list ─────────────────────────────────────────────
      if (sub === "list") {
        const response = await listAllBotsOnVps();

        if (!response.ok) {
          return interaction.editReply({
            embeds: [errorEmbed(
              "VPS Unreachable",
              `Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
            )],
          });
        }

        const bots = response.data.bots || [];

        if (bots.length === 0) {
          return interaction.editReply({
            embeds: [infoEmbed("No Active Bots", "There are no bots currently running on the VPS.")],
          });
        }

        const embed = new EmbedBuilder()
          .setTitle(`🤖 Active Bots (${bots.length})`)
          .setColor(0x000000)
          .setTimestamp()
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" });

        for (const bot of bots) {
          const uptime = bot.uptimeSeconds ? formatUptime(bot.uptimeSeconds) : "Unknown";
          embed.addFields({
            name: `${getStatusEmoji(bot.status)} ${bot.minecraftUser} — ${bot.status}`,
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
            embeds: [errorEmbed(
              "VPS Unreachable",
              `Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
            )],
          });
        }

        const stopped = response.data?.stopped ?? "?";
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("🚨 Emergency Stop Executed")
            .setDescription(`Successfully stopped **${stopped}** bot(s).`)
            .setColor(0xf44336)
            .setTimestamp()
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })],
        });
      }
    }

    // ============================================================
    // MEMBER SUBCOMMANDS (require active empire membership)
    // ============================================================

    await interaction.deferReply({ ephemeral: true });

    const validation = validateMember(userId);

    if (!validation.valid) {
      console.warn(`[/mcbot] 🚫 Validation failed for ${userId}: ${validation.reason}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({
        embeds: [errorEmbed("Access Denied", validation.message)],
      });
    }

    const { minecraftUser, empireId } = validation;
    console.log(`[/mcbot] ✅ Member validated: ${minecraftUser} (${empireId})`);

    // ── start ─────────────────────────────────────────────────
    if (sub === "start") {
      const serverAddress = interaction.options.getString("server").trim();
      const version = interaction.options.getString("version") || "1.20.1";

      if (!serverAddress || serverAddress.length < 3) {
        return interaction.editReply({
          embeds: [errorEmbed(
            "Invalid Server Address",
            "Please provide a valid server address.\nExample: `play.example.net` or `123.45.67.89:25565`"
          )],
        });
      }

      // Check if there's already a pending confirmation for this user
      if (pendingConfirmations.has(userId)) {
        return interaction.editReply({
          embeds: [warningEmbed(
            "Confirmation Pending",
            "You already have a pending bot start confirmation in your DMs. Please respond to that first."
          )],
        });
      }

      console.log(`[/mcbot] 🤖 Requesting confirmation: ${minecraftUser} → ${serverAddress} (v${version})`);

      // Try to DM the user
      let dmMessage;
      try {
        const dmChannel = await interaction.user.createDM();
        const confirmEmbed = new EmbedBuilder()
          .setTitle("🤖 Bot Start Confirmation")
          .setDescription(
            "A request was made to start your Minecraft bot.\n" +
            "Please confirm or reject this request within **3 minutes**."
          )
          .addFields(
            { name: "🎮 Minecraft User", value: `\`${minecraftUser}\``, inline: true },
            { name: "🆔 Empire ID", value: `\`${empireId}\``, inline: true },
            { name: "🌐 Target Server", value: `\`${serverAddress}\``, inline: false },
            { name: "📦 Version", value: `\`${version}\``, inline: true },
            { name: "⏰ Expires", value: `<t:${Math.floor((Date.now() + CONFIRMATION_TIMEOUT_MS) / 1000)}:R>`, inline: true },
          )
          .setColor(0xffd600)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp();

        dmMessage = await dmChannel.send({
          embeds: [confirmEmbed],
          components: [buildConfirmRow(userId)],
        });
      } catch (err) {
        console.error(`[/mcbot] ❌ Could not DM ${interaction.user.tag}:`, err.message);
        return interaction.editReply({
          embeds: [errorEmbed(
            "DMs Disabled",
            "Could not send you a confirmation DM.\nPlease enable DMs from server members and try again.\n*(User Settings → Privacy & Safety → Allow DMs from server members)*"
          )],
        });
      }

      // Store pending confirmation with timeout
      const timeoutId = setTimeout(async () => {
        if (!pendingConfirmations.has(userId)) return;
        pendingConfirmations.delete(userId);
        console.log(`[/mcbot] ⏰ Confirmation timed out for ${minecraftUser}`);

        // Disable buttons on DM
        try {
          await dmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("⏰ Confirmation Timed Out")
              .setDescription("Your bot start request has **expired** after 3 minutes and was automatically rejected.")
              .addFields(
                { name: "🌐 Server", value: `\`${serverAddress}\``, inline: true },
                { name: "📦 Version", value: `\`${version}\``, inline: true },
              )
              .setColor(0x9e9e9e)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
            components: [buildConfirmRow(userId, true)],
          });
        } catch {}

        // Try to update the original interaction reply
        try {
          await interaction.editReply({
            embeds: [warningEmbed(
              "Request Timed Out",
              "Your bot start request expired after 3 minutes with no response."
            )],
          });
        } catch {}
      }, CONFIRMATION_TIMEOUT_MS);

      pendingConfirmations.set(userId, {
        userId,
        minecraftUser,
        serverAddress,
        version,
        empireId,
        interaction,
        dmMessage,
        timeoutId,
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("📨 Check Your DMs")
          .setDescription(
            "A confirmation request has been sent to your DMs.\n" +
            "You have **3 minutes** to accept or reject it."
          )
          .addFields(
            { name: "🌐 Server", value: `\`${serverAddress}\``, inline: true },
            { name: "📦 Version", value: `\`${version}\``, inline: true },
          )
          .setColor(0xffd600)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    }

    // ── stop ──────────────────────────────────────────────────
    if (sub === "stop") {
      console.log(`[/mcbot] 🛑 Stopping bot for: ${minecraftUser}`);

      const response = await stopBotOnVps(userId);

      if (!response.ok) {
        if (response.data?.reason === "no_bot_running") {
          return interaction.editReply({
            embeds: [warningEmbed(
              "No Bot Running",
              "You don't have a bot currently running.\nUse `/mcbot start <server>` to launch one."
            )],
          });
        }
        if (response.status === 0) {
          return interaction.editReply({
            embeds: [errorEmbed(
              "VPS Unreachable",
              `Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``
            )],
          });
        }
        return interaction.editReply({
          embeds: [errorEmbed(
            "Stop Failed",
            `Failed to stop your bot.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
          )],
        });
      }

      return interaction.editReply({
        embeds: [successEmbed(
          "Bot Stopped",
          `Your Minecraft bot (\`${minecraftUser}\`) has been disconnected from the server.`
        )],
      });
    }

    // ── status ────────────────────────────────────────────────
    if (sub === "status") {
      console.log(`[/mcbot] 📊 Status check for: ${minecraftUser}`);

      const response = await getBotStatusFromVps(userId);

      if (!response.ok) {
        if (response.status === 404) {
          return interaction.editReply({
            embeds: [infoEmbed(
              "No Bot Running",
              "You have no bot currently running.\nUse `/mcbot start <server>` to launch one."
            )],
          });
        }
        if (response.status === 0) {
          return interaction.editReply({
            embeds: [errorEmbed(
              "VPS Unreachable",
              `Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``
            )],
          });
        }
        return interaction.editReply({
          embeds: [errorEmbed(
            "Status Unavailable",
            `Could not fetch your bot status.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
          )],
        });
      }

      const bot = response.data.bot;
      const uptime = bot.uptimeSeconds ? formatUptime(bot.uptimeSeconds) : "Unknown";

      const embed = new EmbedBuilder()
        .setTitle(`${getStatusEmoji(bot.status)} Bot Status — ${bot.status.toUpperCase()}`)
        .setColor(getStatusColor(bot.status))
        .addFields(
          { name: "🎮 Minecraft User", value: `\`${bot.minecraftUser}\``, inline: true },
          { name: "🆔 Empire ID", value: `\`${empireId}\``, inline: true },
          { name: "🌐 Server", value: `\`${bot.serverHost}:${bot.serverPort}\``, inline: false },
          { name: "📦 Version", value: `\`${bot.version}\``, inline: true },
          { name: "⏱️ Uptime", value: `\`${uptime}\``, inline: true },
          { name: "📅 Started", value: `<t:${Math.floor(new Date(bot.startedAt).getTime() / 1000)}:R>`, inline: false },
        )
        .setFooter({ text: "Use /mcbot stop to disconnect your bot • Yazanaki Empire" })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },

  // ============================================================
  // BUTTON HANDLER — DM Confirmations
  // ============================================================
  async buttonHandler(interaction) {
    const { customId } = interaction;

    if (!customId.startsWith("mcbot_confirm_") && !customId.startsWith("mcbot_reject_")) return;

    const isConfirm = customId.startsWith("mcbot_confirm_");
    const targetUserId = isConfirm
      ? customId.replace("mcbot_confirm_", "")
      : customId.replace("mcbot_reject_", "");

    // Only the correct user can respond
    if (interaction.user.id !== targetUserId) {
      return interaction.reply({
        embeds: [errorEmbed("Not Your Request", "This confirmation is not for you.")],
        ephemeral: true,
      });
    }

    const pending = pendingConfirmations.get(targetUserId);

    if (!pending) {
      // Already handled (timed out or duplicate press)
      return interaction.reply({
        embeds: [warningEmbed(
          "Request Expired",
          "This confirmation has already been handled or has expired."
        )],
        ephemeral: true,
      });
    }

    // Clear the timeout and remove from pending
    clearTimeout(pending.timeoutId);
    pendingConfirmations.delete(targetUserId);

    // Disable buttons on the DM immediately
    try {
      await interaction.update({ components: [buildConfirmRow(targetUserId, true)] });
    } catch {
      await interaction.deferUpdate().catch(() => {});
    }

    // ── REJECTED ─────────────────────────────────────────────
    if (!isConfirm) {
      console.log(`[/mcbot] ❌ Bot start rejected by ${pending.minecraftUser}`);

      // Update DM
      try {
        await pending.dmMessage.edit({
          embeds: [new EmbedBuilder()
            .setTitle("❌ Bot Start Rejected")
            .setDescription("You rejected the bot start request.")
            .addFields(
              { name: "🌐 Server", value: `\`${pending.serverAddress}\``, inline: true },
              { name: "📦 Version", value: `\`${pending.version}\``, inline: true },
            )
            .setColor(0xf44336)
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
            .setTimestamp()],
          components: [buildConfirmRow(targetUserId, true)],
        });
      } catch {}

      // Update original interaction
      try {
        await pending.interaction.editReply({
          embeds: [warningEmbed("Request Rejected", "You rejected the bot start request.")],
        });
      } catch {}

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return;
    }

    // ── CONFIRMED — actually start the bot ───────────────────
    console.log(`[/mcbot] ✅ Bot start confirmed by ${pending.minecraftUser} → ${pending.serverAddress} (v${pending.version})`);

    const response = await startBotOnVps(
      targetUserId,
      pending.minecraftUser,
      pending.serverAddress,
      pending.version
    );

    if (!response.ok) {
      let errEmbed;

      if (response.data?.reason === "already_running") {
        errEmbed = warningEmbed(
          "Already Running",
          `You already have a bot running on \`${response.data.serverAddress || "a server"}\`.\nUse \`/mcbot stop\` first.`
        );
      } else if (response.data?.reason === "max_bots_reached") {
        errEmbed = warningEmbed(
          "Bot Limit Reached",
          `The VPS has reached its bot limit (\`${response.data.max}\`). Try again later.`
        );
      } else if (response.status === 0) {
        errEmbed = errorEmbed(
          "VPS Unreachable",
          `Could not reach the VPS bot server.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``
        );
      } else {
        errEmbed = errorEmbed(
          "Start Failed",
          `Failed to start your bot.\n\`\`\`${response.data?.error || response.data?.reason || "Unknown error"}\`\`\``
        );
      }

      try {
        await pending.dmMessage.edit({
          embeds: [errEmbed],
          components: [buildConfirmRow(targetUserId, true)],
        });
      } catch {}

      try {
        await pending.interaction.editReply({ embeds: [errEmbed] });
      } catch {}

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return;
    }

    // Success
    const successEmbedMsg = new EmbedBuilder()
      .setTitle("🤖 Bot Started")
      .setDescription(`Your Minecraft bot is now connecting to **${pending.serverAddress}**`)
      .addFields(
        { name: "🎮 Minecraft User", value: `\`${pending.minecraftUser}\``, inline: true },
        { name: "🆔 Empire ID", value: `\`${pending.empireId}\``, inline: true },
        { name: "🌐 Server", value: `\`${pending.serverAddress}\``, inline: false },
        { name: "📦 Version", value: `\`${pending.version}\``, inline: true },
      )
      .setColor(0x00c853)
      .setFooter({ text: "Use /mcbot stop to disconnect your bot • Yazanaki Empire" })
      .setTimestamp();

    try {
      await pending.dmMessage.edit({
        embeds: [successEmbedMsg],
        components: [buildConfirmRow(targetUserId, true)],
      });
    } catch {}

    try {
      await pending.interaction.editReply({ embeds: [successEmbedMsg] });
    } catch {}

    console.log(`[/mcbot] 🚀 Bot successfully started: ${pending.minecraftUser}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },
};