// Discord Bot/modules/mcbot/mcbot.js
// /mcbot — Allows verified Yazanaki Empire members to control a Minecraft bot
// on the empire VPS from Discord.
//
// Subcommands:
//   start  <server> [account]  — Start your MC bot on a server (requires DM confirmation)
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
  pingVps,
  startBotOnVps,
  stopBotOnVps,
  getBotStatusFromVps,
  listAllBotsOnVps,
  stopAllBotsOnVps,
  getDeviceCodeFromVps,
  clearDeviceCodeOnVps,
} = require("./mcbotlogic");

const { readClans } = require("../clantracking/clanlogic");
const { getAllAccountsForDiscord } = require("../linking/linklogic");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Confirmation timeout: 3 minutes
const CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000;

// How long to poll for bot start outcome (device code + online status).
// Must be at least as long as the VPS spawn timeout for interactive auth (5 min)
// so the Discord embed keeps updating while the user completes Microsoft sign-in.
const BOT_START_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// SERVER → VERSION MAP
// Maps partial server address strings (lowercase) to the
// Minecraft version mineflayer should use for that server.
// Add entries here whenever a new server is registered.
// First matching key wins; falls back to DEFAULT_VERSION.
// Version is resolved internally — users never set this.
// ============================================================
const SERVER_VERSION_MAP = {
  "donutsmp.net": "auto",
  // "hypixel.net": "1.21.1",
  // "example.net":  "1.20",
};

const DEFAULT_VERSION = "1.21.4";

// Pending DM confirmations: userId -> confirmation data
const pendingConfirmations = new Map();

// ============================================================
// HELPERS
// ============================================================

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

/**
 * Resolves the correct Minecraft version for a given server address.
 * Checks SERVER_VERSION_MAP keys (case-insensitive substring match).
 * Falls back to DEFAULT_VERSION if no match is found.
 * This is purely internal — version is never exposed as a user option.
 */
function getVersionForServer(serverAddress) {
  if (!serverAddress) return DEFAULT_VERSION;
  const lower = serverAddress.toLowerCase();
  for (const [pattern, version] of Object.entries(SERVER_VERSION_MAP)) {
    if (lower.includes(pattern)) return version;
  }
  return DEFAULT_VERSION;
}

function buildStatusHints(bot) {
  const hints = [];
  const cat = bot?.errorCategory;

  if (cat === "auth_error") {
    hints.push("Authentication required. Start again to receive a Microsoft device-code login DM.");
  }

  if (cat === "server_rejected" || cat === "protocol_mismatch") {
    hints.push("Server rejected the client or there's a protocol mismatch.");
    hints.push("Contact an admin — the server version mapping may need to be updated.");
  }

  return hints;
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
// BOT START OUTCOME POLLING
// After /start succeeds, runs async for up to BOT_START_POLL_DURATION_MS to:
//   1. Check for a Microsoft device code and DM it if found
//   2. Poll /status/:discordId until the bot is "online" or "error"
//   3. Update the DM confirmation embed with final outcome
// ============================================================

async function pollBotStartOutcome(discordId, user, dmChannel, confirmMessage) {
  const deadline = Date.now() + BOT_START_POLL_DURATION_MS;
  let deviceCodeDmSent = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    // ── Check for Microsoft device code ──────────────────────
    if (!deviceCodeDmSent) {
      try {
        const codeRes = await getDeviceCodeFromVps(discordId);
        if (codeRes.ok && codeRes.data?.pending) {
          const { userCode, verificationUri } = codeRes.data;
          await dmChannel.send({
            embeds: [new EmbedBuilder()
              .setTitle("🔐 Microsoft Login Required")
              .setDescription(
                "Your Minecraft bot needs to authenticate with Microsoft.\n\n" +
                `**1.** Go to: **${verificationUri}**\n` +
                `**2.** Enter code: \`${userCode}\`\n\n` +
                "You have **5 minutes** to sign in. The bot will connect automatically once you log in.\n" +
                "This message will update when the bot comes online."
              )
              .setColor(0x2196f3)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
          });
          await clearDeviceCodeOnVps(discordId);
          deviceCodeDmSent = true;
        }
      } catch (err) {
        console.error(`[/mcbot] ❌ Device code poll error for ${discordId}:`, err.message);
      }
    }

    // ── Poll bot status ────────────────────────────────────────
    try {
      const statusRes = await getBotStatusFromVps(discordId);
      if (!statusRes.ok) continue;

      const bot = statusRes.data?.bot;
      if (!bot) continue;

      const status = bot.status;

      if (status === "online") {
        console.log(`[/mcbot] 🟢 Bot online for ${discordId}`);
        try {
          await confirmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("🟢 Bot Online")
              .setDescription(`Your Minecraft bot is now **online** on \`${bot.serverHost}:${bot.serverPort}\`.`)
              .addFields(
                { name: "🎮 Minecraft User", value: `\`${bot.minecraftUser}\``, inline: true },
                { name: "📦 Version", value: `\`${bot.version}\``, inline: true },
                { name: "⏱️ Uptime", value: `\`${formatUptime(bot.uptimeSeconds ?? 0)}\``, inline: true },
              )
              .setColor(0x00c853)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
            components: [],
          });
        } catch {}
        return;
      }

      if (status === "error") {
        const errMsg = bot.spawnError || bot.errorMessage || "Unknown error";
        console.warn(`[/mcbot] ❌ Bot failed for ${discordId}: ${errMsg}`);
        try {
          await confirmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("❌ Bot Failed to Connect")
              .setDescription(
                `Your bot could not connect to the server.\n\n` +
                `**Reason:** ${errMsg}\n\n` +
                `Common causes:\n` +
                `• Microsoft sign-in was not completed in time\n` +
                `• Server is offline or unreachable\n` +
                `• Server requires authentication or whitelisting\n` +
                `• Contact an admin if the issue persists`
              )
              .setColor(0xf44336)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
            components: [],
          });
        } catch {}
        return;
      }
    } catch (err) {
      console.error(`[/mcbot] ❌ Status poll error for ${discordId}:`, err.message);
    }
  }

  // 5 minutes passed — bot still connecting
  console.warn(`[/mcbot] ⏰ Outcome poll timed out for ${discordId} — bot may still be connecting`);
  try {
    await confirmMessage.edit({
      embeds: [new EmbedBuilder()
        .setTitle("⏳ Still Connecting...")
        .setDescription(
          "The bot is taking longer than expected to connect.\n" +
          "Use `/mcbot status` to check if it comes online, or `/mcbot stop` to cancel."
        )
        .setColor(0xff9800)
        .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
        .setTimestamp()],
      components: [],
    });
  } catch {}
}

// ============================================================
// MODULE EXPORT
// ============================================================

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mcbot")
    .setDescription("Control your Minecraft bot on the Yazanaki VPS")

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
            .setName("account")
            .setDescription("Minecraft account to use (defaults to your main account)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Stop your currently running Minecraft bot")
    )

    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check the status of your Minecraft bot")
    )

    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("[Admin] List all active bots on the VPS")
    )

    .addSubcommand((sub) =>
      sub
        .setName("ping")
        .setDescription("[Admin] Ping the VPS bot server for health checks")
    )

    .addSubcommand((sub) =>
      sub
        .setName("stopall")
        .setDescription("[Admin] Emergency stop — kill ALL active bots")
    ),

  // ============================================================
  // AUTOCOMPLETE
  // Provides the account dropdown list for /mcbot start account:
  // Populated from linking.json via getAllAccountsForDiscord.
  // ============================================================
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const userId = interaction.user.id;

    let choices = [];
    try {
      const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
      if (main) {
        choices.push({ name: `${main} (main)`, value: main });
      }
      for (const alt of alternateAccounts) {
        choices.push({ name: `${alt} (alt)`, value: alt });
      }
    } catch (err) {
      console.error(`[/mcbot autocomplete] ❌ Error fetching accounts for ${userId}:`, err.message);
    }

    // Filter by what the user has typed so far (case-insensitive)
    const filtered = choices.filter((c) =>
      c.name.toLowerCase().includes(focused.toLowerCase())
    );

    await interaction.respond(filtered.slice(0, 25));
  },

  // ============================================================
  // EXECUTE
  // ============================================================
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/mcbot] 🎯 /${sub} — ${interaction.user.tag} (${userId})`);

    // ── GUILD LOCK ────────────────────────────────────────────
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

    // ── ADMIN SUBCOMMANDS (no defer, no member check) ─────────
    if (sub === "ping") {
      await interaction.deferReply({ ephemeral: true });
      const response = await pingVps();
      if (!response.ok) {
        return interaction.editReply({
          embeds: [errorEmbed(
            "VPS Unreachable",
            `Could not reach the VPS.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``
          )],
        });
      }
      return interaction.editReply({
        embeds: [successEmbed("VPS Online", `VPS responded successfully.\n\`\`\`${JSON.stringify(response.data, null, 2)}\`\`\``)],
      });
    }

    if (sub === "list") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          embeds: [errorEmbed("Access Denied", "Only administrators can list all bots.")],
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const response = await listAllBotsOnVps();
      if (!response.ok) {
        return interaction.editReply({
          embeds: [errorEmbed("List Failed", `\`\`\`${response.data?.error || "Unknown error"}\`\`\``)],
        });
      }
      const bots = response.data?.bots || [];
      if (bots.length === 0) {
        return interaction.editReply({
          embeds: [infoEmbed("No Active Bots", "There are no bots currently running on the VPS.")],
        });
      }
      const lines = bots.map((b) =>
        `• \`${b.minecraftUser}\` → \`${b.serverHost}:${b.serverPort}\` [${getStatusEmoji(b.status)} ${b.status}] (v${b.version})`
      );
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle(`🤖 Active Bots (${bots.length})`)
          .setDescription(lines.join("\n"))
          .setColor(0x2196f3)
          .setTimestamp()
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })],
      });
    }

    if (sub === "stopall") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          embeds: [errorEmbed("Access Denied", "Only administrators can stop all bots.")],
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      const response = await stopAllBotsOnVps();
      if (!response.ok) {
        return interaction.editReply({
          embeds: [errorEmbed("Stop All Failed", `\`\`\`${response.data?.error || "Unknown error"}\`\`\``)],
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

    // ============================================================
    // MEMBER SUBCOMMANDS
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

    const { minecraftUser: mainMinecraftUser, empireId } = validation;
    console.log(`[/mcbot] ✅ Member validated: ${mainMinecraftUser} (${empireId})`);

    // ── start ─────────────────────────────────────────────────
    if (sub === "start") {
      const serverAddress = interaction.options.getString("server").trim();
      const accountOpt = interaction.options.getString("account");

      if (!serverAddress || serverAddress.length < 3) {
        return interaction.editReply({
          embeds: [errorEmbed(
            "Invalid Server Address",
            "Please provide a valid server address.\nExample: `play.example.net` or `123.45.67.89:25565`"
          )],
        });
      }

      // ── Resolve version internally from server address map ───
      const resolvedVersion = getVersionForServer(serverAddress);

      // ── Resolve Minecraft account to use ────────────────────
      let chosenAccount = mainMinecraftUser;
      if (accountOpt) {
        // Validate the chosen account belongs to this user
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find(
          (a) => a.toLowerCase() === accountOpt.toLowerCase()
        );
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed(
              "Account Not Found",
              `\`${accountOpt}\` is not linked to your Discord account.\nUse \`/link alt <username>\` to add alternate accounts.`
            )],
          });
        }
        chosenAccount = match;
      }

      if (pendingConfirmations.has(userId)) {
        return interaction.editReply({
          embeds: [warningEmbed(
            "Confirmation Pending",
            "You already have a pending bot start confirmation in your DMs.\nPlease respond to that first."
          )],
        });
      }

      console.log(`[/mcbot] 🤖 Requesting confirmation: ${chosenAccount} → ${serverAddress} (v${resolvedVersion})`);

      let dmMessage;
      let dmChannel;
      try {
        dmChannel = await interaction.user.createDM();
        const confirmEmbed = new EmbedBuilder()
          .setTitle("🤖 Bot Start Confirmation")
          .setDescription(
            "A request was made to start your Minecraft bot.\n" +
            "Please confirm or reject this request within **3 minutes**."
          )
          .addFields(
            { name: "🎮 Minecraft User", value: `\`${chosenAccount}\``, inline: true },
            { name: "🆔 Empire ID", value: `\`${empireId}\``, inline: true },
            { name: "🌐 Target Server", value: `\`${serverAddress}\``, inline: false },
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

      const timeoutId = setTimeout(async () => {
        if (!pendingConfirmations.has(userId)) return;
        pendingConfirmations.delete(userId);
        console.log(`[/mcbot] ⏰ Confirmation timed out for ${chosenAccount}`);

        try {
          await dmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("⏰ Confirmation Timed Out")
              .setDescription("Your bot start request has **expired** after 3 minutes and was automatically rejected.")
              .addFields(
                { name: "🌐 Server", value: `\`${serverAddress}\``, inline: true },
              )
              .setColor(0x9e9e9e)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
            components: [buildConfirmRow(userId, true)],
          });
        } catch {}

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
        minecraftUser: chosenAccount,
        serverAddress,
        version: resolvedVersion,
        empireId,
        interaction,
        dmMessage,
        dmChannel,
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
          )
          .setColor(0xffd600)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    }

    // ── stop ──────────────────────────────────────────────────
    if (sub === "stop") {
      console.log(`[/mcbot] 🛑 Stopping bot for: ${mainMinecraftUser}`);

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
        return interaction.editReply({
          embeds: [errorEmbed(
            "Stop Failed",
            `Failed to stop your bot.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
          )],
        });
      }

      console.log(`[/mcbot] ✅ Bot stopped for: ${mainMinecraftUser}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({
        embeds: [successEmbed(
          "Bot Stopped",
          `Your Minecraft bot (\`${mainMinecraftUser}\`) has been stopped.`
        )],
      });
    }

    // ── status ────────────────────────────────────────────────
    if (sub === "status") {
      const response = await getBotStatusFromVps(userId);

      if (!response.ok) {
        if (response.data?.reason === "no_bot_running") {
          return interaction.editReply({
            embeds: [infoEmbed(
              "No Bot Running",
              "You don't have a bot currently running.\nUse `/mcbot start <server>` to launch one."
            )],
          });
        }
        return interaction.editReply({
          embeds: [errorEmbed(
            "Status Check Failed",
            `Could not retrieve your bot status.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
          )],
        });
      }

      const bot = response.data?.bot;
      if (!bot) {
        return interaction.editReply({
          embeds: [infoEmbed(
            "No Bot Running",
            "You don't have a bot currently running.\nUse `/mcbot start <server>` to launch one."
          )],
        });
      }

      const hints = buildStatusHints(bot);
      const uptime = bot.uptimeSeconds ? formatUptime(bot.uptimeSeconds) : "Unknown";
      const embed = new EmbedBuilder()
        .setTitle(`${getStatusEmoji(bot.status)} Bot Status — ${bot.status}`)
        .addFields(
          { name: "🎮 Minecraft User", value: `\`${bot.minecraftUser}\``, inline: true },
          { name: "📦 Version", value: `\`${bot.version}\``, inline: true },
          { name: "🌐 Server", value: `\`${bot.serverHost}:${bot.serverPort}\``, inline: false },
          { name: "⏱️ Uptime", value: `\`${uptime}\``, inline: true },
          { name: "📅 Started", value: `<t:${Math.floor(new Date(bot.startedAt).getTime() / 1000)}:R>`, inline: true },
        )
        .setColor(getStatusColor(bot.status))
        .setTimestamp()
        .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" });

      if (hints.length > 0) {
        embed.addFields({ name: "💡 Hints", value: hints.join("\n"), inline: false });
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({ embeds: [embed] });
    }
  },

  // ============================================================
  // BUTTON HANDLER
  // Handles mcbot_confirm_<userId> and mcbot_reject_<userId>
  // buttons sent via DM.
  // ============================================================
  async buttonHandler(interaction) {
    const customId = interaction.customId;
    const isConfirm = customId.startsWith("mcbot_confirm_");
    const isReject = customId.startsWith("mcbot_reject_");

    if (!isConfirm && !isReject) return;

    const targetUserId = customId.replace("mcbot_confirm_", "").replace("mcbot_reject_", "");
    const user = interaction.user;

    if (user.id !== targetUserId) {
      return interaction.reply({
        content: "❌ This confirmation belongs to another user.",
        ephemeral: true,
      });
    }

    const pending = pendingConfirmations.get(targetUserId);

    if (!pending) {
      await interaction.deferUpdate();
      try {
        await interaction.message.edit({
          embeds: [warningEmbed(
            "Request Expired",
            "This bot start request has already expired or been handled."
          )],
          components: [buildConfirmRow(targetUserId, true)],
        });
      } catch {}
      return;
    }

    // Clear pending + cancel timeout
    pendingConfirmations.delete(targetUserId);
    clearTimeout(pending.timeoutId);

    await interaction.deferUpdate();

    // ── REJECTED ──────────────────────────────────────────────
    if (isReject) {
      console.log(`[/mcbot] ❌ Rejected by ${user.tag}`);

      try {
        await interaction.message.edit({
          embeds: [new EmbedBuilder()
            .setTitle("❌ Bot Start Rejected")
            .setDescription("You rejected the bot start request.")
            .addFields(
              { name: "🌐 Server", value: `\`${pending.serverAddress}\``, inline: true },
            )
            .setColor(0xf44336)
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
            .setTimestamp()],
          components: [buildConfirmRow(targetUserId, true)],
        });
      } catch {}

      try {
        await pending.interaction.editReply({
          embeds: [warningEmbed("Request Rejected", "You rejected the bot start request.")],
        });
      } catch {}

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return;
    }

    // ── CONFIRMED ─────────────────────────────────────────────
    console.log(`[/mcbot] ✅ Confirmed: ${pending.minecraftUser} → ${pending.serverAddress} (v${pending.version})`);

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
          `The VPS has reached its bot limit (\`${response.data.max}\`).`
        );
      } else if (response.status === 0) {
        errEmbed = errorEmbed(
          "VPS Unreachable",
          `Could not reach the VPS.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``
        );
      } else {
        errEmbed = errorEmbed(
          "Start Failed",
          `Failed to start the bot.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``
        );
      }

      try {
        await interaction.message.edit({
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

    // ── VPS accepted the start — update DM with connecting state
    try {
      await interaction.message.edit({
        embeds: [new EmbedBuilder()
          .setTitle("🔵 Bot Connecting...")
          .setDescription(
            `Your bot is connecting to **\`${pending.serverAddress}\`**.\n` +
            `If Microsoft auth is needed, you'll receive another DM shortly with a login link.\n` +
            `This message will update automatically (up to 5 minutes).`
          )
          .addFields(
            { name: "🎮 Minecraft User", value: `\`${pending.minecraftUser}\``, inline: true },
          )
          .setColor(0x2196f3)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
        components: [buildConfirmRow(targetUserId, true)],
      });
    } catch {}

    // Update the slash command reply
    try {
      await pending.interaction.editReply({
        embeds: [successEmbed(
          "Bot Starting",
          `Your Minecraft bot (\`${pending.minecraftUser}\`) is connecting to \`${pending.serverAddress}\`.`
        )],
      });
    } catch {}

    // ── Poll for Microsoft device code (needed on first run / expired token) ──
    // Also polls bot status to update the DM embed when the bot goes online or fails.
    // Run async so we don't block the button handler.
    const dmChannelForCode = pending.dmChannel || await user.createDM().catch(() => null);
    if (dmChannelForCode) {
      pollBotStartOutcome(targetUserId, user, dmChannelForCode, interaction.message).catch(err => {
        console.error(`[/mcbot] ❌ Start outcome poll error for ${targetUserId}:`, err);
      });
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },
};