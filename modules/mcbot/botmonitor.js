// Discord Bot/modules/mcbot/botmonitor.js
// Polls the VPS every BOT_MONITOR_INTERVAL_MS and DMs users when their
// Minecraft bots go offline unexpectedly (kicks, errors, disconnects).
// Manual stops (/mcbot stop) are excluded — the VPS does not report those.

"use strict";

const { EmbedBuilder } = require("discord.js");
const { getEndedBotsFromVps } = require("./mcbotlogic");

const POLL_INTERVAL_MS = parseInt(process.env.BOT_MONITOR_INTERVAL_MS || "120000", 10); // 2 min default

let _monitorInterval = null;
let _discordClient = null;

// ============================================================
// EMBED BUILDER
// ============================================================

/**
 * Build a human-readable description for why the bot went offline.
 * @private
 */
function _buildDescription(bot) {
  const { endReason, spawnError, lastKickReason, errorCategory } = bot;

  // DonutSMP verification failure — special friendly message
  if (endReason === "donutsmp_verification_failed" || errorCategory === "donutsmp_verification") {
    return (
      "Your bot was unable to join **DonutSMP** because their security system is requiring account verification.\n\n" +
      "**What to do:**\n" +
      "1. Log into DonutSMP manually using your Minecraft client\n" +
      "2. Complete the security/verification prompt that appears\n" +
      "3. Once verified, run `/mcbot start donutsmp.net` again"
    );
  }

  if (endReason === "kicked" || lastKickReason) {
    const reason = lastKickReason || spawnError || "No reason provided.";
    return (
      `Your bot was **kicked** from the server.\n\n` +
      `**Kick reason:**\n\`\`\`${reason.slice(0, 300)}\`\`\``
    );
  }

  if (endReason === "auth_error" || endReason === "auth_second_code" || errorCategory === "auth_error") {
    return (
      "Your bot's **Microsoft authentication failed**.\n\n" +
      "Run `/mcbot start <server>` again — you'll receive a new Microsoft sign-in code in your DMs."
    );
  }

  if (endReason === "fatal_network_error" || errorCategory === "fatal_network_error") {
    const err = spawnError || "The server address could not be reached.";
    return (
      `Your bot could **not connect** to the server.\n\n` +
      `**Error:**\n\`\`\`${err.slice(0, 300)}\`\`\``
    );
  }

  if (endReason === "spawn_timeout") {
    return (
      "Your bot **timed out** while trying to connect.\n\n" +
      "The server may be offline or temporarily unreachable. Try again in a few minutes."
    );
  }

  if (endReason === "create_error") {
    return (
      "Your bot **failed to start** on the VPS.\n\n" +
      (spawnError ? `**Error:**\n\`\`\`${spawnError.slice(0, 300)}\`\`\`` : "Contact an admin if this keeps happening.")
    );
  }

  if (endReason === "end" || errorCategory === "disconnected") {
    const reason = spawnError || "The server closed the connection.";
    return (
      `Your bot **disconnected** from the server.\n\n` +
      `**Reason:**\n\`\`\`${reason.slice(0, 300)}\`\`\``
    );
  }

  if (spawnError) {
    return (
      `Your bot went offline due to an error.\n\n` +
      `**Details:**\n\`\`\`${spawnError.slice(0, 300)}\`\`\``
    );
  }

  return "Your bot went offline unexpectedly. Use `/mcbot start` to restart it.";
}

/**
 * Build the offline notification embed.
 * @param {object} bot - Ended bot data from VPS
 * @returns {EmbedBuilder}
 */
function buildBotOfflineEmbed(bot) {
  const { minecraftUser, serverHost, serverPort, endReason, version } = bot;

  const TITLE_MAP = {
    kicked:                       "🦵 Bot Kicked from Server",
    auth_error:                   "🔐 Bot Authentication Failed",
    auth_second_code:             "🔐 Bot Authentication Failed",
    fatal_network_error:          "🌐 Bot Connection Failed",
    spawn_timeout:                "⏰ Bot Connection Timed Out",
    error:                        "❌ Bot Encountered an Error",
    end:                          "🔌 Bot Disconnected",
    create_error:                 "❌ Bot Failed to Start",
    donutsmp_verification_failed: "🟠 DonutSMP Verification Required",
  };

  const COLOR_MAP = {
    kicked:                       0xffd600,
    auth_error:                   0xf44336,
    auth_second_code:             0xf44336,
    fatal_network_error:          0xf44336,
    spawn_timeout:                0xff9800,
    error:                        0xf44336,
    end:                          0xff9800,
    create_error:                 0xf44336,
    donutsmp_verification_failed: 0xff9800,
  };

  return new EmbedBuilder()
    .setTitle(TITLE_MAP[endReason] || "🤖 Bot Went Offline")
    .setDescription(_buildDescription(bot))
    .addFields(
      { name: "🎮 Account",  value: `\`${minecraftUser}\``,        inline: true },
      { name: "🌐 Server",   value: `\`${serverHost}:${serverPort}\``, inline: true },
      { name: "📦 Version",  value: `\`${version || "unknown"}\``, inline: true },
    )
    .setColor(COLOR_MAP[endReason] || 0x9e9e9e)
    .setFooter({ text: "Use /mcbot start <server> to restart your bot • Yazanaki Empire" })
    .setTimestamp();
}

// ============================================================
// NOTIFICATION
// ============================================================

/**
 * DM a user that their bot went offline.
 * @param {object} bot - Ended bot data from VPS
 */
async function notifyBotOffline(bot) {
  const { discordId, minecraftUser, endReason } = bot;

  try {
    const user = await _discordClient.users.fetch(discordId);
    const embed = buildBotOfflineEmbed(bot);
    await user.send({ embeds: [embed] });
    console.log(`[botmonitor] 📨 Notified ${discordId} — \`${minecraftUser}\` went offline (${endReason})`);
  } catch (err) {
    // Non-fatal — user may have DMs disabled
    console.log(`[botmonitor] ℹ️ Could not DM ${discordId} about \`${minecraftUser}\`: ${err.message}`);
  }
}

// ============================================================
// POLL LOOP
// ============================================================

async function _runPoll() {
  try {
    const response = await getEndedBotsFromVps();

    if (!response.ok) {
      // VPS unreachable or returned an error — skip silently
      if (response.status !== 0) {
        console.warn(`[botmonitor] ⚠️ VPS /ended returned HTTP ${response.status}`);
      }
      return;
    }

    const endedBots = response.data?.bots || [];

    if (endedBots.length === 0) return;

    console.log(`[botmonitor] 📋 ${endedBots.length} bot(s) ended since last poll — notifying users`);

    for (const bot of endedBots) {
      await notifyBotOffline(bot);
    }
  } catch (err) {
    // Catch-all: never crash the monitor loop
    console.error("[botmonitor] ❌ Poll error:", err.message);
  }
}

// ============================================================
// START / STOP
// ============================================================

/**
 * Start the bot monitor. Call once from the ready event.
 * Silently skips if MCBOT_VPS_URL is not configured.
 * @param {Client} discordClient - Discord.js client
 */
function startBotMonitor(discordClient) {
  if (!process.env.MCBOT_VPS_URL) {
    console.log("[botmonitor] ⏭️ Skipped (MCBOT_VPS_URL not set)");
    return;
  }

  if (_monitorInterval) {
    console.warn("[botmonitor] ⚠️ Already running");
    return;
  }

  _discordClient = discordClient;
  const intervalMin = Math.round(POLL_INTERVAL_MS / 60000);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[botmonitor] 🚀 Bot offline monitor started (interval: ${intervalMin} min)`);
  console.log("[botmonitor] 📡 Users will be DM'd when their bots go offline unexpectedly");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // First poll after 30s (let the bot fully start up first)
  setTimeout(_runPoll, 30000);
  _monitorInterval = setInterval(_runPoll, POLL_INTERVAL_MS);
}

/**
 * Stop the bot monitor (e.g. for graceful shutdown).
 */
function stopBotMonitor() {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
    console.log("[botmonitor] ⏸️ Bot monitor stopped");
  }
}

module.exports = { startBotMonitor, stopBotMonitor };