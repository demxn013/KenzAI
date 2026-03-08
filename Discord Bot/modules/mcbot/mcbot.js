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
  getDeviceCodeFromVps,
  clearDeviceCodeOnVps,
} = require("./mcbotlogic");

const { readClans } = require("../clantracking/clanlogic");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Confirmation timeout: 3 minutes
const CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000;

// How long to poll for a Microsoft device code after bot start (ms)
const DEVICE_CODE_POLL_DURATION_MS = 30 * 1000;
const DEVICE_CODE_POLL_INTERVAL_MS = 2000;

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
// DEVICE CODE POLLING
// After /start succeeds, the VPS may need Microsoft auth.
// Poll GET /devicecode/:discordId for up to 30s.
// If a code appears, DM it to the user and clear it from the VPS.
// ============================================================

async function pollAndSendDeviceCode(discordId, ownerUser, dmChannel) {
  const deadline = Date.now() + DEVICE_CODE_POLL_DURATION_MS;
  console.log(`[/mcbot] 🔐 Polling for device code for ${discordId}...`);

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, DEVICE_CODE_POLL_INTERVAL_MS));

    const res = await getDeviceCodeFromVps(discordId).catch(() => null);
    if (!res || !res.ok || !res.data?.pending) continue;

    const { userCode, verificationUri, expiresAt } = res.data;
    const expiresTimestamp = expiresAt
      ? `<t:${Math.floor(expiresAt / 1000)}:R>`
      : "in ~15 minutes";

    console.log(`[/mcbot] 🔐 Device code found for ${discordId}: ${userCode}`);

    // DM the user
    try {
      await dmChannel.send({
        embeds: [new EmbedBuilder()
          .setTitle("🔐 Microsoft Login Required")
          .setDescription(
            "Your Minecraft account needs to be authenticated with Microsoft before the bot can join the server.\n\n" +
            "**This is a one-time setup.** After you log in, your token will be cached and future bot starts will be instant."
          )
          .addFields(
            {
              name: "1️⃣ Go to this URL",
              value: `**[${verificationUri}](${verificationUri})**`,
              inline: false,
            },
            {
              name: "2️⃣ Enter this code",
              value: `\`\`\`${userCode}\`\`\``,
              inline: false,
            },
            {
              name: "⏰ Expires",
              value: expiresTimestamp,
              inline: true,
            },
          )
          .setColor(0x2196f3)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager • Microsoft Auth" })
          .setTimestamp()],
      });
    } catch (err) {
      console.error(`[/mcbot] ❌ Could not DM device code to ${discordId}:`, err.message);
    }

    // Clear from VPS so it doesn't get re-sent
    await clearDeviceCodeOnVps(discordId).catch(() => {});
    return;
  }

  // No code appeared within the window — token was already cached, no auth needed
  console.log(`[/mcbot] ✅ No device code appeared for ${discordId} — cached token used`);
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
            .setName("version")
            .setDescription("Minecraft version (default: 1.20.1)")
            .setRequired(false)
            .addChoices(
              ...SUPPORTED_VERSIONS.map((v) => ({ name: v, value: v }))
            )
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

    // ============================================================
    // ADMIN SUBCOMMANDS
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

      if (pendingConfirmations.has(userId)) {
        return interaction.editReply({
          embeds: [warningEmbed(
            "Confirmation Pending",
            "You already have a pending bot start confirmation in your DMs. Please respond to that first."
          )],
        });
      }

      console.log(`[/mcbot] 🤖 Requesting confirmation: ${minecraftUser} → ${serverAddress} (v${version})`);

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

      const timeoutId = setTimeout(async () => {
        if (!pendingConfirmations.has(userId)) return;
        pendingConfirmations.delete(userId);
        console.log(`[/mcbot] ⏰ Confirmation timed out for ${minecraftUser}`);

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

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle(`${getStatusEmoji(bot.status)} Bot Status — ${bot.minecraftUser}`)
          .addFields(
            { name: "📊 Status", value: `\`${bot.status}\``, inline: true },
            { name: "⏱️ Uptime", value: `\`${uptime}\``, inline: true },
            { name: "🌐 Server", value: `\`${bot.serverHost}:${bot.serverPort}\``, inline: true },
            { name: "🎮 Version", value: `\`${bot.version}\``, inline: true },
            { name: "📅 Started", value: `<t:${Math.floor(new Date(bot.startedAt).getTime() / 1000)}:R>`, inline: true },
          )
          .setColor(getStatusColor(bot.status))
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    }
  },

  // ============================================================
  // BUTTON HANDLER — DM confirm/reject buttons
  // ============================================================
  async buttonHandler(interaction) {
    const { customId, user } = interaction;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/mcbot] 🔘 DM Button: ${customId} from ${user.tag} (${user.id})`);

    const isConfirm = customId.startsWith("mcbot_confirm_");
    const isReject = customId.startsWith("mcbot_reject_");

    if (!isConfirm && !isReject) return;

    const targetUserId = isConfirm
      ? customId.replace("mcbot_confirm_", "")
      : customId.replace("mcbot_reject_", "");

    // Verify the person clicking owns this request
    if (user.id !== targetUserId) {
      return interaction.reply({
        content: "❌ This confirmation is not for your account.",
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
              { name: "📦 Version", value: `\`${pending.version}\``, inline: true },
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
            `If Microsoft auth is needed, you'll receive another DM shortly with a login link.`
          )
          .addFields(
            { name: "🎮 Minecraft User", value: `\`${pending.minecraftUser}\``, inline: true },
            { name: "📦 Version", value: `\`${pending.version}\``, inline: true },
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
    // Run async so we don't block — the user will get a separate DM if auth is needed
    const dmChannelForCode = pending.dmChannel || await user.createDM().catch(() => null);
    if (dmChannelForCode) {
      pollAndSendDeviceCode(targetUserId, user, dmChannelForCode).catch(err => {
        console.error(`[/mcbot] ❌ Device code poll error for ${targetUserId}:`, err);
      });
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },
};