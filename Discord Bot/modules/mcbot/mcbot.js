// Discord Bot/modules/mcbot/mcbot.js
// /mcbot — Allows verified Yazanaki Empire members to control Minecraft bots
// on the empire VPS from Discord. Supports multiple simultaneous bots
// (one per linked Minecraft account).
//
// Subcommands:
//   start  <server> [account]  — Start a MC bot on a server (requires DM confirmation)
//   stop   [account]           — Stop a running bot (auto-selects if only one running)
//   status [account]           — Check a bot's current status
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
  getUserBotsFromVps,
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

// How long to poll for bot start outcome.
// Must match the VPS interactive auth timeout (5 min) so the embed
// keeps updating while the user completes Microsoft sign-in.
const BOT_START_POLL_DURATION_MS = 5 * 60 * 1000;

// ============================================================
// SERVER → VERSION MAP
// ============================================================
const SERVER_VERSION_MAP = {
  "donutsmp.net": "auto",
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
  return new EmbedBuilder().setTitle(`❌ ${title}`).setDescription(description).setColor(0xf44336).setTimestamp();
}

function warningEmbed(title, description) {
  return new EmbedBuilder().setTitle(`⚠️ ${title}`).setDescription(description).setColor(0xffd600).setTimestamp();
}

function successEmbed(title, description) {
  return new EmbedBuilder().setTitle(`✅ ${title}`).setDescription(description).setColor(0x00c853).setTimestamp();
}

function infoEmbed(title, description) {
  return new EmbedBuilder().setTitle(`ℹ️ ${title}`).setDescription(description).setColor(0x2196f3).setTimestamp();
}

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
//
// Runs for up to BOT_START_POLL_DURATION_MS (5 min) after /start.
//
// Key behaviour:
//   - Polls for device codes continuously throughout — does NOT
//     stop after the first code. prismarine-auth may generate a new
//     code if its retry loop fires after a stale cache refresh fails.
//     If a new code comes in, we send a follow-up DM with the updated
//     code so the user always has the current, valid one to enter.
//   - Polls bot status until "online" or "error".
// ============================================================

async function pollBotStartOutcome(discordId, minecraftUser, dmChannel, confirmMessage) {
  const deadline = Date.now() + BOT_START_POLL_DURATION_MS;
  const pollInterval = 3000;
  let lastCodeShown = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    // ── Poll device code ───────────────────────────────────────
    try {
      const codeRes = await getDeviceCodeFromVps(discordId, minecraftUser);
      if (codeRes.ok && codeRes.data?.pending) {
        const { userCode, verificationUri } = codeRes.data;

        if (userCode !== lastCodeShown) {
          const isUpdate = lastCodeShown !== null;
          console.log(`[/mcbot] 🔐 ${isUpdate ? "Updated" : "New"} device code for ${discordId}/${minecraftUser}: ${userCode}`);

          try {
            await dmChannel.send({
              embeds: [new EmbedBuilder()
                .setTitle(isUpdate ? "🔄 New Login Code Generated" : "🔐 Microsoft Login Required")
                .setDescription(
                  (isUpdate
                    ? "⚠️ A new login code was generated. **Use this code instead** — the previous code is no longer valid.\n\n"
                    : "Your Minecraft bot needs to authenticate with Microsoft.\n\n") +
                  `**1.** Go to: **${verificationUri}**\n` +
                  `**2.** Enter code: \`${userCode}\`\n\n` +
                  "You have **5 minutes** to sign in. The bot will connect automatically once you log in."
                )
                .setColor(isUpdate ? 0xff9800 : 0x2196f3)
                .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                .setTimestamp()],
            });

            lastCodeShown = userCode;
            // Clear the code from VPS so we can detect a future update
            await clearDeviceCodeOnVps(discordId, minecraftUser);
          } catch (dmErr) {
            console.error(`[/mcbot] ❌ Failed to DM device code to ${discordId}:`, dmErr.message);
          }
        }
      }
    } catch (err) {
      console.error(`[/mcbot] ❌ Device code poll error for ${discordId}/${minecraftUser}:`, err.message);
    }

    // ── Poll bot status ────────────────────────────────────────
    try {
      const statusRes = await getBotStatusFromVps(discordId, minecraftUser);
      if (!statusRes.ok) continue;

      const bot = statusRes.data?.bot;
      if (!bot) continue;

      const status = bot.status;

      if (status === "online") {
        console.log(`[/mcbot] 🟢 Bot online for ${discordId}/${minecraftUser}`);
        try {
          await confirmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("🟢 Bot Online")
              .setDescription(`Your Minecraft bot is now **online** on \`${bot.serverHost}:${bot.serverPort}\`.`)
              .addFields(
                { name: "🎮 Minecraft User", value: `\`${bot.minecraftUser}\``, inline: false },
                { name: "📦 Version", value: `\`${bot.version}\``, inline: false },
                { name: "⏱️ Uptime", value: `\`${formatUptime(bot.uptimeSeconds ?? 0)}\``, inline: false },
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
        console.warn(`[/mcbot] ❌ Bot failed for ${discordId}/${minecraftUser}: ${errMsg}`);
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
      console.error(`[/mcbot] ❌ Status poll error for ${discordId}/${minecraftUser}:`, err.message);
    }
  }

  // 5 minutes passed — bot still connecting
  console.warn(`[/mcbot] ⏰ Outcome poll timed out for ${discordId}/${minecraftUser} — bot may still be connecting`);
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
        .setDescription("Stop a running Minecraft bot")
        .addStringOption((opt) =>
          opt
            .setName("account")
            .setDescription("Which account's bot to stop (required if you have multiple running)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )

    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check the status of a Minecraft bot")
        .addStringOption((opt) =>
          opt
            .setName("account")
            .setDescription("Which account's bot to check (shows all if omitted)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )

    .addSubcommand((sub) =>
      sub.setName("list").setDescription("[Admin] List all active bots on the VPS")
    )

    .addSubcommand((sub) =>
      sub.setName("ping").setDescription("[Admin] Ping the VPS bot server for health checks")
    )

    .addSubcommand((sub) =>
      sub.setName("stopall").setDescription("[Admin] Emergency stop — kill ALL active bots")
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const userId = interaction.user.id;

    let choices = [];
    try {
      const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
      if (main) choices.push({ name: `${main} (main)`, value: main });
      for (const alt of alternateAccounts) {
        choices.push({ name: `${alt} (alt)`, value: alt });
      }
    } catch (err) {
      console.error(`[/mcbot autocomplete] ❌ Error fetching accounts for ${userId}:`, err.message);
    }

    const filtered = choices.filter((c) => c.name.toLowerCase().includes(focused.toLowerCase()));
    await interaction.respond(filtered.slice(0, 25));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/mcbot] 🎯 /${sub} — ${interaction.user.tag} (${userId})`);

    const allowedGuilds = getAllowedGuildIds();
    if (!interaction.guild || !allowedGuilds.has(interaction.guild.id)) {
      return interaction.reply({
        embeds: [errorEmbed("Command Unavailable", "This command can only be used in the **Yazanaki Empire** discord or a registered **clan discord**.")],
        ephemeral: true,
      });
    }

    // ── ADMIN SUBCOMMANDS ─────────────────────────────────────
    if (sub === "ping") {
      await interaction.deferReply({ ephemeral: true });
      const response = await pingVps();
      if (!response.ok) {
        return interaction.editReply({
          embeds: [errorEmbed("VPS Unreachable", `Could not reach the VPS.\n\`\`\`${response.data?.error || "Connection refused"}\`\`\``)],
        });
      }
      return interaction.editReply({
        embeds: [successEmbed("VPS Online", `VPS responded successfully.\n\`\`\`${JSON.stringify(response.data, null, 2)}\`\`\``)],
      });
    }

    if (sub === "list") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ embeds: [errorEmbed("Access Denied", "Only administrators can list all bots.")], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const response = await listAllBotsOnVps();
      if (!response.ok) {
        return interaction.editReply({ embeds: [errorEmbed("List Failed", `\`\`\`${response.data?.error || "Unknown error"}\`\`\``)] });
      }
      const bots = response.data?.bots || [];
      if (bots.length === 0) {
        return interaction.editReply({ embeds: [infoEmbed("No Active Bots", "There are no bots currently running on the VPS.")] });
      }
      const lines = bots.map((b) =>
        `• \`${b.minecraftUser}\` (<@${b.discordId}>) → \`${b.serverHost}:${b.serverPort}\` [${getStatusEmoji(b.status)} ${b.status}] (v${b.version})`
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
        return interaction.reply({ embeds: [errorEmbed("Access Denied", "Only administrators can stop all bots.")], ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const response = await stopAllBotsOnVps();
      if (!response.ok) {
        return interaction.editReply({ embeds: [errorEmbed("Stop All Failed", `\`\`\`${response.data?.error || "Unknown error"}\`\`\``)] });
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

    // ── MEMBER SUBCOMMANDS ────────────────────────────────────
    await interaction.deferReply({ ephemeral: true });

    const validation = validateMember(userId);
    if (!validation.valid) {
      console.warn(`[/mcbot] 🚫 Validation failed for ${userId}: ${validation.reason}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({ embeds: [errorEmbed("Access Denied", validation.message)] });
    }

    const { minecraftUser: mainMinecraftUser, empireId } = validation;
    console.log(`[/mcbot] ✅ Member validated: ${mainMinecraftUser} (${empireId})`);

    // ── start ─────────────────────────────────────────────────
    if (sub === "start") {
      const serverAddress = interaction.options.getString("server").trim();
      const accountOpt = interaction.options.getString("account");

      if (!serverAddress || serverAddress.length < 3) {
        return interaction.editReply({
          embeds: [errorEmbed("Invalid Server Address", "Please provide a valid server address.\nExample: `play.example.net` or `123.45.67.89:25565`")],
        });
      }

      const resolvedVersion = getVersionForServer(serverAddress);

      let chosenAccount = mainMinecraftUser;
      if (accountOpt) {
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find((a) => a.toLowerCase() === accountOpt.toLowerCase());
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed("Account Not Found", `\`${accountOpt}\` is not linked to your Discord account.\nUse \`/link alt <username>\` to add alternate accounts.`)],
          });
        }
        chosenAccount = match;
      }

      if (pendingConfirmations.has(userId)) {
        return interaction.editReply({
          embeds: [warningEmbed("Confirmation Pending", "You already have a pending bot start confirmation in your DMs.\nPlease respond to that first.")],
        });
      }

      // Send DM confirmation
      let dmChannel, dmMessage;
      try {
        dmChannel = await interaction.user.createDM();
        dmMessage = await dmChannel.send({
          embeds: [new EmbedBuilder()
            .setTitle("🤖 Start Minecraft Bot?")
            .setDescription(
              `You requested to start a bot with account **\`${chosenAccount}\`** on server \`${serverAddress}\`.\n\n` +
              "**Confirm** to start the bot, or **Reject** to cancel."
            )
            .addFields(
              { name: "🎮 Account", value: `\`${chosenAccount}\``, inline: false },
              { name: "🌐 Server", value: `\`${serverAddress}\``, inline: false },
            )
            .setColor(0xffd600)
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
            .setTimestamp()],
          components: [buildConfirmRow(userId)],
        });
      } catch (err) {
        console.error(`[/mcbot] ❌ Could not DM ${userId}:`, err.message);
        return interaction.editReply({
          embeds: [errorEmbed("DM Failed", "Could not send you a DM.\nPlease enable DMs from server members and try again.")],
        });
      }

      const timeoutId = setTimeout(async () => {
        pendingConfirmations.delete(userId);
        try {
          await dmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("⏰ Request Timed Out")
              .setDescription("Your bot start request expired after 3 minutes.")
              .addFields({ name: "🌐 Server", value: `\`${serverAddress}\``, inline: false })
              .setColor(0x9e9e9e)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
            components: [buildConfirmRow(userId, true)],
          });
        } catch {}
        try {
          await interaction.editReply({ embeds: [warningEmbed("Request Timed Out", "Your bot start request expired after 3 minutes with no response.")] });
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
          .setDescription("A confirmation request has been sent to your DMs.\nYou have **3 minutes** to accept or reject it.")
          .addFields(
            { name: "🎮 Account", value: `\`${chosenAccount}\``, inline: false },
            { name: "🌐 Server", value: `\`${serverAddress}\``, inline: false },
          )
          .setColor(0xffd600)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    }

    // ── stop ──────────────────────────────────────────────────
    if (sub === "stop") {
      const accountOpt = interaction.options.getString("account");

      // Resolve which account to stop
      let targetAccount = null;

      if (accountOpt) {
        // User explicitly specified an account — validate it belongs to them
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find((a) => a.toLowerCase() === accountOpt.toLowerCase());
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed("Account Not Found", `\`${accountOpt}\` is not linked to your Discord account.`)],
          });
        }
        targetAccount = match;
      } else {
        // No account specified — check how many bots are running for this user
        const userBotsRes = await getUserBotsFromVps(userId);
        if (!userBotsRes.ok) {
          return interaction.editReply({
            embeds: [errorEmbed("VPS Error", `Could not fetch your active bots.\n\`\`\`${userBotsRes.data?.error || "Unknown error"}\`\`\``)],
          });
        }

        const runningBots = userBotsRes.data?.bots || [];

        if (runningBots.length === 0) {
          return interaction.editReply({
            embeds: [warningEmbed("No Bot Running", "You don't have any bots currently running.\nUse `/mcbot start <server>` to launch one.")],
          });
        }

        if (runningBots.length === 1) {
          // Auto-select the only running bot
          targetAccount = runningBots[0].minecraftUser;
        } else {
          // Multiple bots running — ask user to specify
          const lines = runningBots.map((b) =>
            `• \`${b.minecraftUser}\` → \`${b.serverHost}:${b.serverPort}\` [${getStatusEmoji(b.status)} ${b.status}]`
          );
          return interaction.editReply({
            embeds: [warningEmbed(
              "Multiple Bots Running",
              `You have **${runningBots.length}** bots running. Specify which one to stop:\n\n` +
              lines.join("\n") +
              "\n\nUsage: `/mcbot stop account:<username>`"
            )],
          });
        }
      }

      console.log(`[/mcbot] 🛑 Stopping bot for: ${targetAccount} (${userId})`);
      const response = await stopBotOnVps(userId, targetAccount);
      if (!response.ok) {
        if (response.data?.reason === "no_bot_running") {
          return interaction.editReply({
            embeds: [warningEmbed("No Bot Running", `No bot is running for \`${targetAccount}\`.\nUse \`/mcbot start <server>\` to launch one.`)],
          });
        }
        return interaction.editReply({
          embeds: [errorEmbed("Stop Failed", `Failed to stop bot for \`${targetAccount}\`.\n\`\`\`${response.data?.error || "Unknown error"}\`\`\``)],
        });
      }
      console.log(`[/mcbot] ✅ Bot stopped for: ${targetAccount}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      return interaction.editReply({
        embeds: [successEmbed("Bot Stopped", `Your Minecraft bot (\`${targetAccount}\`) has been stopped.`)],
      });
    }

    // ── status ────────────────────────────────────────────────
    if (sub === "status") {
      const accountOpt = interaction.options.getString("account");

      if (accountOpt) {
        // Status for a specific account
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find((a) => a.toLowerCase() === accountOpt.toLowerCase());
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed("Account Not Found", `\`${accountOpt}\` is not linked to your Discord account.`)],
          });
        }

        const response = await getBotStatusFromVps(userId, match);
        if (!response.ok) {
          if (response.data?.reason === "no_bot_running") {
            return interaction.editReply({
              embeds: [infoEmbed("No Bot Running", `No bot is running for \`${match}\`.\nUse \`/mcbot start <server>\` to launch one.`)],
            });
          }
          return interaction.editReply({
            embeds: [errorEmbed("Status Failed", `\`\`\`${response.data?.error || "Unknown error"}\`\`\``)],
          });
        }

        const bot = response.data?.bot;
        return interaction.editReply({ embeds: [buildSingleStatusEmbed(bot)] });

      } else {
        // No account specified — show all running bots for this user
        const userBotsRes = await getUserBotsFromVps(userId);
        if (!userBotsRes.ok) {
          return interaction.editReply({
            embeds: [errorEmbed("VPS Error", `Could not fetch your active bots.\n\`\`\`${userBotsRes.data?.error || "Unknown error"}\`\`\``)],
          });
        }

        const runningBots = userBotsRes.data?.bots || [];

        if (runningBots.length === 0) {
          return interaction.editReply({
            embeds: [infoEmbed("No Bots Running", "You don't have any bots currently running.\nUse `/mcbot start <server>` to launch one.")],
          });
        }

        if (runningBots.length === 1) {
          return interaction.editReply({ embeds: [buildSingleStatusEmbed(runningBots[0])] });
        }

        // Multiple bots — show summary of all
        return interaction.editReply({ embeds: [buildMultiStatusEmbed(runningBots)] });
      }
    }
  },

  // ============================================================
  // BUTTON HANDLER — DM confirmation buttons
  // ============================================================

  async buttonHandler(interaction) {
    const { customId, user } = interaction;
    const userId = user.id;

    const isConfirm = customId.startsWith("mcbot_confirm_");
    const isReject = customId.startsWith("mcbot_reject_");

    if (!isConfirm && !isReject) return;

    const pendingUserId = isConfirm
      ? customId.slice("mcbot_confirm_".length)
      : customId.slice("mcbot_reject_".length);

    if (pendingUserId !== userId) {
      return interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
    }

    const pending = pendingConfirmations.get(userId);
    if (!pending) {
      return interaction.reply({ content: "⚠️ This confirmation has already expired or been handled.", ephemeral: true });
    }

    clearTimeout(pending.timeoutId);
    pendingConfirmations.delete(userId);

    if (isReject) {
      console.log(`[/mcbot] ❌ Bot start rejected by ${userId}`);
      await interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle("❌ Bot Start Cancelled")
          .setDescription("You cancelled the bot start request.")
          .setColor(0x9e9e9e)
          .setTimestamp()],
        components: [],
      });
      try {
        await pending.interaction.editReply({ embeds: [warningEmbed("Request Cancelled", "You cancelled the bot start request.")] });
      } catch {}
      return;
    }

    // ── Confirmed — start the bot ─────────────────────────────
    console.log(`[/mcbot] ✅ Bot start confirmed by ${userId} — starting ${pending.minecraftUser} on ${pending.serverAddress}`);

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle("⏳ Starting Bot...")
        .setDescription(
          `Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\n\n` +
          "If Microsoft authentication is required, you'll receive a sign-in code here shortly."
        )
        .setColor(0x2196f3)
        .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
        .setTimestamp()],
      components: [],
    });

    try {
      await pending.interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("🚀 Bot Starting")
          .setDescription(`Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\nCheck your DMs for updates.`)
          .setColor(0x2196f3)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    } catch {}

    const startResponse = await startBotOnVps(userId, pending.minecraftUser, pending.serverAddress, pending.version);

    if (!startResponse.ok) {
      const reason = startResponse.data?.reason;
      let errMsg = `\`\`\`${startResponse.data?.error || "Unknown error"}\`\`\``;

      if (reason === "already_running") {
        const addr = startResponse.data?.serverAddress || "a server";
        errMsg = `A bot for \`${pending.minecraftUser}\` is already running on \`${addr}\`.\nUse \`/mcbot stop\` first.`;
      } else if (reason === "max_bots_reached") {
        errMsg = `The VPS has reached its maximum bot limit (${startResponse.data?.max ?? "?"}). Try again later.`;
      }

      try {
        await interaction.message.edit({
          embeds: [errorEmbed("Failed to Start Bot", errMsg)],
          components: [],
        });
      } catch {}
      return;
    }

    // Poll for outcome
    await pollBotStartOutcome(userId, pending.minecraftUser, pending.dmChannel, interaction.message);
  },
};

// ============================================================
// STATUS EMBED BUILDERS
// ============================================================

function buildSingleStatusEmbed(bot) {
  const hints = buildStatusHints(bot);
  const hintText = hints.length > 0 ? `\n\n💡 ${hints.join("\n💡 ")}` : "";

  return new EmbedBuilder()
    .setTitle(`${getStatusEmoji(bot.status)} Bot Status — \`${bot.minecraftUser}\``)
    .addFields(
      { name: "🎮 Account", value: `\`${bot.minecraftUser}\``, inline: false },
      { name: "📊 Status", value: `${getStatusEmoji(bot.status)} ${bot.status}`, inline: false },
      { name: "🌐 Server", value: `\`${bot.serverHost}:${bot.serverPort}\``, inline: false },
      { name: "📦 Version", value: `\`${bot.version}\``, inline: false },
      { name: "⏱️ Uptime", value: `\`${formatUptime(bot.uptimeSeconds ?? 0)}\``, inline: false },
      ...(bot.spawnError ? [{ name: "⚠️ Error", value: bot.spawnError + hintText, inline: falsee }] : []),
    )
    .setColor(getStatusColor(bot.status))
    .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
    .setTimestamp();
}

function buildMultiStatusEmbed(bots) {
  const lines = bots.map((b) =>
    `• \`${b.minecraftUser}\` → \`${b.serverHost}:${b.serverPort}\` [${getStatusEmoji(b.status)} ${b.status}] ⏱️ ${formatUptime(b.uptimeSeconds ?? 0)}`
  );

  return new EmbedBuilder()
    .setTitle(`🤖 Your Active Bots (${bots.length})`)
    .setDescription(lines.join("\n") + "\n\nUse `/mcbot status account:<username>` for details on a specific bot.")
    .setColor(0x2196f3)
    .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
    .setTimestamp();
}