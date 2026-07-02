// Discord Bot/modules/mcbot/mcbot.js
// /mcbot — Allows verified Yazanaki Empire members to control Minecraft bots
// on the empire VPS from Discord. Supports multiple simultaneous bots
// (one per linked Minecraft account).
//
// Bot subcommands:
//   start  <server> [account]  — Start a MC bot (requires DM confirmation)
//   stop   [account]           — Stop a running bot
//   status [account]           — Check bot status
//   ping                       — [Admin] Ping the VPS
//   list                       — [Admin] List all active bots
//   stopall                    — [Admin] Emergency stop all bots
//   info                       — Show bot system info and subscription tiers
//
// Slot subcommands (/mcbot slot ...):
//   slot status                — Show your subscription tier and active slots
//   slot available             — Show global slot availability per tier
//   slot queue                 — Show your queue position
//   slot release [slot_id]     — Release one of your active slots
//   slot grant <user> <tier>   — [Admin] Manually grant a subscription
//   slot revoke <user>         — [Admin] Revoke a subscription + all slots
//   slot info <user>           — [Admin] View a user's full subscription info
//
// ✅ MONETIZATION: Set REQUIRE_SUBSCRIPTION=true in .env to enforce subscription checks.

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
  getFreshSmpSpawnedFromVps,
  sendFreshSmpGamemodeToVps,
} = require("./mcbotlogic");

const { readClans } = require("../clantracking/clanlogic");
const { getAllAccountsForDiscord } = require("../linking/linklogic");

// ============================================================
// ✅ MONETIZATION IMPORTS
// ============================================================
const {
  requestSlot,
  releaseSlotByUser,
  clearAllActiveSlots,
  getSlotAvailability,
  getQueueStats,
  getTierConfig,
  releaseSlot,
  grantSubscription,
  revokeSubscription,
} = require("./monetization/slotmanager");

const db = require("./monetization/subscriptiondb");

const REQUIRE_SUBSCRIPTION = process.env.REQUIRE_SUBSCRIPTION === "true";

// ============================================================
// CONSTANTS
// ============================================================

const YAZANAKI_EMPIRE_GUILD_ID  = "1220847061797179524";
const CONFIRMATION_TIMEOUT_MS   = 3 * 60 * 1000;  // 3 minutes
const BOT_START_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Server address → version hint sent to the VPS.
// "auto" = VPS will try multiple versions until one works.
const SERVER_VERSION_MAP = {
  "donutsmp.net":       "auto",
  "elementalmc.live":   "1.21.11",
  "freshsmp.fun":       "1.21.11",
  "freshsmp.net":       "1.21.11",
};
const DEFAULT_VERSION = "1.21.4";

// ============================================================
// FRESHSMP DETECTION
// ============================================================
const FRESHSMP_HOST_PATTERNS = ["freshsmp.fun", "freshsmp.net", "freshsmp"];

function isFreshSmpServer(serverAddress) {
  if (!serverAddress) return false;
  const lower = serverAddress.toLowerCase();
  return FRESHSMP_HOST_PATTERNS.some(p => lower.includes(p));
}

// ============================================================
// ELEMENTALMC DETECTION
// ElementalMC runs its own dedicated VPS profile (seeded from FreshSMP) but
// shares FreshSMP's post-lobby gamemode/queue flow, so /mcbot drives it the
// same way — only the user-facing labels differ (see serverDisplayName).
// ============================================================
const ELEMENTALMC_HOST_PATTERNS = ["elementalmc.live", "play.elementalmc.live", "elementalmc"];

function isElementalMcServer(serverAddress) {
  if (!serverAddress) return false;
  const lower = serverAddress.toLowerCase();
  return ELEMENTALMC_HOST_PATTERNS.some(p => lower.includes(p));
}

// FreshSMP and ElementalMC both use the post-lobby gamemode/queue selector DM.
function usesGamemodeQueue(serverAddress) {
  return isFreshSmpServer(serverAddress) || isElementalMcServer(serverAddress);
}

// Friendly display name for user-facing messages. ElementalMC is checked before
// FreshSMP since they share the queue flow but are distinct servers.
function serverDisplayName(serverAddress) {
  if (isDonutSmpServer(serverAddress)) return "DonutSMP";
  if (isElementalMcServer(serverAddress)) return "ElementalMC";
  if (isFreshSmpServer(serverAddress)) return "FreshSMP";
  return serverAddress;
}

// Valid gamemodes shown in the FreshSMP / ElementalMC selector DM
const FRESHSMP_GAMEMODES = ["survival", "lifesteal", "skywars"];

// ============================================================
// DONUTSMP DETECTION
// DonutSMP has a security/verification screen on new logins.
// ============================================================
const DONUTSMP_HOST_PATTERNS = ["donutsmp.net", "donutsmp"];

function isDonutSmpServer(serverAddress) {
  if (!serverAddress) return false;
  const lower = serverAddress.toLowerCase();
  return DONUTSMP_HOST_PATTERNS.some(p => lower.includes(p));
}

// How long to consider a DonutSMP bot "pending verification" after first login
const DONUTSMP_VERIFICATION_GRACE_MS = 60 * 1000;

// Pending DM confirmations: userId -> confirmation data
const pendingConfirmations = new Map();

// ============================================================
// HELPERS
// ============================================================

function getPatreonUrl() {
  return process.env.PATREON_URL || "https://www.patreon.com";
}

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
  const cat   = bot?.errorCategory;
  if (cat === "auth_error") {
    hints.push("Authentication required. Start again to receive a Microsoft device-code login DM.");
  }
  if (cat === "server_rejected" || cat === "protocol_mismatch") {
    hints.push("Server rejected the client or there's a protocol mismatch.");
    hints.push("Contact an admin — the server version mapping may need to be updated.");
  }
  if (cat === "donutsmp_verification") {
    hints.push(
      "DonutSMP requires account verification for new logins. " +
      "Please log into DonutSMP manually once and complete the security verification, then try `/mcbot start` again."
    );
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

function buildUpsellEmbed() {
  const patreonUrl = getPatreonUrl();
  const tierConfig = getTierConfig();
  const availability = getSlotAvailability();

  const tierLines = Object.entries(tierConfig).map(([tier, config]) => {
    const avail = availability[tier];
    const availText = avail ? `${avail.available} slot${avail.available !== 1 ? "s" : ""} free` : "";
    const badge = { standard: "🔵", premium: "🟣", vip: "👑" }[tier] || "•";
    return `${badge} **${tier.charAt(0).toUpperCase() + tier.slice(1)}** — ${config.maxPerUser} bot slot${config.maxPerUser > 1 ? "s" : ""}${availText ? ` *(${availText})*` : ""}`;
  });

  return new EmbedBuilder()
    .setTitle("🤖 Unlock Minecraft Bot Slots")
    .setColor(0xf96854)
    .setDescription(
      [
        "**KenzAI bot slots** let you run a Minecraft AFK bot on the empire VPS — stay online in-game without keeping your game open.",
        "",
        "A Patreon subscription unlocks your slot instantly and keeps the VPS running.",
        "",
        "**Available tiers:**",
        ...tierLines,
      ].join("\n")
    )
    .addFields({
      name: "🚀 How to subscribe",
      value: [
        `1. Go to [our Patreon](${patreonUrl})`,
        "2. Choose a tier and **link your Discord** on Patreon",
        "3. Your slot activates within 5 minutes automatically",
        "4. Come back and run \`/mcbot start\` again!",
      ].join("\n"),
      inline: false,
    })
    .setFooter({ text: "Use /patreon for full tier details • KenzAI Bot System" })
    .setTimestamp();
}

function buildUpsellRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Subscribe on Patreon")
      .setStyle(ButtonStyle.Link)
      .setURL(getPatreonUrl())
      .setEmoji("🧡"),
    new ButtonBuilder()
      .setCustomId("mcbot_patreon_info")
      .setLabel("View Tiers")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📊")
  );
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

/**
 * Build the FreshSMP gamemode selector action row sent via DM.
 * customId format: mcbot_freshsmp_gm_<userId>_<gamemode>
 *
 * NOTE: The prefix MUST start with "mcbot_" so that interactionCreate's
 * DM button routing forwards it to this command's buttonHandler.
 */
function buildFreshSmpGamemodeRow(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mcbot_freshsmp_gm_${userId}_survival`)
      .setLabel("⚔️ Survival")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`mcbot_freshsmp_gm_${userId}_lifesteal`)
      .setLabel("❤️ Lifesteal")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`mcbot_freshsmp_gm_${userId}_skywars`)
      .setLabel("🌤️ SkyWars")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

function tierBadge(tier) {
  const badges = { standard: "🔵 Standard", premium: "🟣 Premium", vip: "👑 VIP", none: "⚫ None" };
  return badges[tier] || tier;
}

function formatDate(iso) {
  if (!iso) return "N/A";
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

function progressBar(used, total, length = 10) {
  const filled = Math.round((used / Math.max(total, 1)) * length);
  return "🟦".repeat(filled) + "⬜".repeat(length - filled) + ` ${used}/${total}`;
}

// ============================================================
// COMMAND DEFINITION
// ============================================================

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mcbot")
    .setDescription("Control your Minecraft bot on the Yazanaki Empire VPS.")

    // ── Bot subcommands ────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Start a Minecraft bot on a server")
        .addStringOption(opt =>
          opt.setName("server")
             .setDescription("Server address (e.g. play.freshsmp.fun, play.elementalmc.live or donutsmp.net)")
             .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName("account")
             .setDescription("Minecraft account to use (defaults to your main account)")
             .setRequired(false)
             .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("stop")
        .setDescription("Stop a running Minecraft bot")
        .addStringOption(opt =>
          opt.setName("account")
             .setDescription("Which account's bot to stop (required if you have multiple running)")
             .setRequired(false)
             .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Check the status of a Minecraft bot")
        .addStringOption(opt =>
          opt.setName("account")
             .setDescription("Which account's bot to check (shows all if omitted)")
             .setRequired(false)
             .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("ping").setDescription("[Admin] Ping the VPS bot server for health checks")
    )
    .addSubcommand(sub =>
      sub.setName("list").setDescription("[Admin] List all active bots on the VPS")
    )
    .addSubcommand(sub =>
      sub.setName("stopall").setDescription("[Admin] Emergency stop — kill ALL active bots")
    )
    .addSubcommand(sub =>
      sub.setName("info").setDescription("Show KenzAI bot system info, subscription tiers, and how to get started")
    )

    // ── Slot subcommand group ─────────────────────────────────
    .addSubcommandGroup(group =>
      group
        .setName("slot")
        .setDescription("Manage your KenzAI bot subscription and slots.")

        .addSubcommand(sub =>
          sub.setName("status").setDescription("Show your subscription tier and active bot slots.")
        )
        .addSubcommand(sub =>
          sub.setName("available").setDescription("Show how many bot slots are available globally per tier.")
        )
        .addSubcommand(sub =>
          sub.setName("queue").setDescription("Check your current position in the bot slot queue.")
        )
        .addSubcommand(sub =>
          sub
            .setName("release")
            .setDescription("Release one of your active bot slots.")
            .addStringOption(opt =>
              opt.setName("slot_id")
                 .setDescription("The Slot ID to release (from /mcbot slot status). Omit if you only have one slot.")
                 .setRequired(false)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("grant")
            .setDescription("[Admin] Manually grant a subscription tier to a user.")
            .addUserOption(opt => opt.setName("user").setDescription("Discord user").setRequired(true))
            .addStringOption(opt =>
              opt.setName("tier")
                 .setDescription("Subscription tier to grant")
                 .setRequired(true)
                 .addChoices(
                   { name: "Standard", value: "standard" },
                   { name: "Premium",  value: "premium"  },
                   { name: "VIP",      value: "vip"      }
                 )
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("revoke")
            .setDescription("[Admin] Revoke a user's subscription and release all their slots.")
            .addUserOption(opt => opt.setName("user").setDescription("Discord user").setRequired(true))
        )
        .addSubcommand(sub =>
          sub
            .setName("info")
            .setDescription("[Admin] View a user's full subscription and slot details.")
            .addUserOption(opt => opt.setName("user").setDescription("Discord user").setRequired(true))
        )
    ),

  // ============================================================
  // AUTOCOMPLETE
  // ============================================================

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const userId  = interaction.user.id;

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

    const filtered = choices.filter(c => c.name.toLowerCase().includes(focused.toLowerCase()));
    await interaction.respond(filtered.slice(0, 25));
  },

  // ============================================================
  // EXECUTE
  // ============================================================

  async execute(interaction) {
    const group  = interaction.options.getSubcommandGroup(false);
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/mcbot] 🎯 ${group ? `slot ${sub}` : sub} — ${interaction.user.tag} (${userId})`);

    const allowedGuilds = getAllowedGuildIds();
    if (!interaction.guild || !allowedGuilds.has(interaction.guild.id)) {
      return interaction.reply({
        embeds: [errorEmbed("Command Unavailable", "This command can only be used in the **Yazanaki Empire** discord or a registered **clan discord**.")],
        ephemeral: true,
      });
    }

    // ── Route slot group ──────────────────────────────────────
    if (group === "slot") {
      return _handleSlot(interaction, sub, userId);
    }

    // ── Admin bot subcommands ─────────────────────────────────
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
      const lines = bots.map(b =>
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
      if (REQUIRE_SUBSCRIPTION) clearAllActiveSlots();
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

    // ── /mcbot info ───────────────────────────────────────────
    if (sub === "info") {
      const patreonUrl = getPatreonUrl();
      const tierConfig = getTierConfig();
      const availability = getSlotAvailability();

      const callerRecord = db.getUser(userId);
      const callerActive = callerRecord?.active && callerRecord?.subscription_tier !== "none";
      const callerTier   = callerActive ? callerRecord.subscription_tier : null;

      const tierBadgeMap = { standard: "🔵 Standard", premium: "🟣 Premium", vip: "👑 VIP" };

      const tierLines = Object.entries(tierConfig).map(([tier, config]) => {
        const avail = availability[tier];
        const free  = avail ? avail.available : 0;
        const total = avail ? avail.total : config.globalLimit;
        const isCurrent = callerTier === tier;
        const badge = tierBadgeMap[tier] || tier;
        return (
          `**${badge}**${isCurrent ? " ✅" : ""}\n` +
          `╰ ${config.maxPerUser} bot slot${config.maxPerUser > 1 ? "s" : ""} per user · ` +
          `${free}/${total} slots free`
        );
      });

      const embed = new EmbedBuilder()
        .setTitle("🤖 KenzAI — Minecraft Bot System")
        .setColor(callerActive ? 0x00c853 : 0x2196f3)
        .setDescription(
          callerActive
            ? `You have an active **${tierBadgeMap[callerTier]}** subscription. ` +
              `Use \`/mcbot start <server>\` to launch your bot, or \`/mcbot slot status\` to manage your slots.`
            : "KenzAI lets Yazanaki Empire members run an AFK Minecraft bot on the empire VPS directly from Discord.\n\n" +
              `Subscribe on [Patreon](${patreonUrl}) to unlock your slot.`
        )
        .addFields(
          {
            name: "📋 Bot Commands",
            value: [
              "`/mcbot start <server>` — Launch a bot on any Minecraft server",
              "`/mcbot stop` — Stop your running bot",
              "`/mcbot status` — Check if your bot is online",
              "`/mcbot slot status` — View your subscription and active slots",
              "`/patreon` — See all subscription tiers and benefits",
            ].join("\n"),
            inline: false,
          },
          {
            name: "💎 Subscription Tiers",
            value: tierLines.join("\n\n"),
            inline: false,
          },
          {
            name: "⚡ Features",
            value: [
              "• Supports **FreshSMP**, **DonutSMP**, **ElementalMC**, Hypixel & vanilla servers",
              "• Auto-reconnects if kicked",
              "• Automatically eats food — bot won't starve",
              "• Microsoft account auth — fully secure",
              "• Version auto-detection for most servers",
              "• DM notification when your bot goes offline",
            ].join("\n"),
            inline: false,
          },
          {
            name: "🌐 Supported Servers",
            value: [
              "• `play.freshsmp.fun` — FreshSMP",
              "• `play.elementalmc.live` — ElementalMC",
              "• `donutsmp.net` — DonutSMP",
              "• `hypixel.net` — Hypixel",
              "• Any vanilla Java server",
            ].join("\n"),
            inline: false,
          }
        )
        .setFooter({ text: "KenzAI • Yazanaki Empire Bot System" })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Subscribe on Patreon")
          .setStyle(ButtonStyle.Link)
          .setURL(patreonUrl)
          .setEmoji("🧡"),
        new ButtonBuilder()
          .setCustomId("patreon_slot_status")
          .setLabel("My Slot Status")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("📊"),
      );

      return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
    }

    // ── Member-validated bot subcommands ──────────────────────
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
      const accountOpt    = interaction.options.getString("account");

      if (!serverAddress || serverAddress.length < 3) {
        return interaction.editReply({
          embeds: [errorEmbed("Invalid Server Address", "Please provide a valid server address.\nExample: `play.freshsmp.fun`, `play.elementalmc.live` or `donutsmp.net`")],
        });
      }

      const resolvedVersion = getVersionForServer(serverAddress);

      let chosenAccount = mainMinecraftUser;
      if (accountOpt) {
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find(a => a.toLowerCase() === accountOpt.toLowerCase());
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed("Account Not Found", `\`${accountOpt}\` is not linked to your Discord account.\nUse \`/link alt <username>\` to add alternate accounts.`)],
          });
        }
        chosenAccount = match;
      }

      // ✅ MONETIZATION: Check subscription and pre-assign slot before DM confirmation.
      let preAssignedSlot = null;
      if (REQUIRE_SUBSCRIPTION) {
        const slotResult = requestSlot(userId, chosenAccount, { server_address: serverAddress });

        if (slotResult.status === "error") {
          console.log(`[/mcbot] 💸 No subscription for ${userId} — showing upsell embed`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return interaction.editReply({
            embeds: [buildUpsellEmbed()],
            components: [buildUpsellRow()],
          });
        }

        if (slotResult.status === "queued") {
          console.log(`[/mcbot] ⏳ ${userId} queued at position #${slotResult.position}`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return interaction.editReply({
            embeds: [new EmbedBuilder()
              .setTitle("⏳ Added to Queue")
              .setDescription(slotResult.message)
              .addFields(
                { name: "📦 Tier",     value: `\`${slotResult.queueEntry.tier}\``, inline: true },
                { name: "📍 Position", value: `#${slotResult.position}`,           inline: true },
              )
              .setColor(0xffd600)
              .setFooter({ text: "Yazanaki Empire • Bot Slot Manager" })
              .setTimestamp()],
          });
        }

        preAssignedSlot = slotResult.slot || null;
        console.log(`[/mcbot] 🎫 Slot ${preAssignedSlot?.slot_id || "existing"} for ${userId}/${chosenAccount}`);
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
              { name: "🎮 __Account__", value: `\`${chosenAccount}\``, inline: false },
              { name: "🌐 __Server__",  value: `\`${serverAddress}\``, inline: false },
            )
            .setColor(0xffd600)
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
            .setTimestamp()],
          components: [buildConfirmRow(userId)],
        });
      } catch (err) {
        console.error(`[/mcbot] ❌ Could not DM ${userId}:`, err.message);
        if (REQUIRE_SUBSCRIPTION && preAssignedSlot) releaseSlotByUser(userId, chosenAccount);
        return interaction.editReply({
          embeds: [errorEmbed("DM Failed", "Could not send you a DM.\nPlease enable DMs from server members and try again.")],
        });
      }

      const timeoutId = setTimeout(async () => {
        pendingConfirmations.delete(userId);
        if (REQUIRE_SUBSCRIPTION && preAssignedSlot) releaseSlotByUser(userId, chosenAccount);
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
        version:        resolvedVersion,
        empireId,
        interaction,
        dmMessage,
        dmChannel,
        timeoutId,
        preAssignedSlot,
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("📨 Check Your DMs")
          .setDescription("A confirmation request has been sent to your DMs.\nYou have **3 minutes** to accept or reject it.")
          .setColor(0x2196f3)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    }

    // ── stop ──────────────────────────────────────────────────
    if (sub === "stop") {
      const accountOpt = interaction.options.getString("account");
      let targetAccount;

      if (accountOpt) {
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find(a => a.toLowerCase() === accountOpt.toLowerCase());
        if (!match) {
          return interaction.editReply({
            embeds: [errorEmbed("Account Not Found", `\`${accountOpt}\` is not linked to your Discord account.`)],
          });
        }
        targetAccount = match;
      } else {
        const userBotsRes = await getUserBotsFromVps(userId);
        if (!userBotsRes.ok) {
          return interaction.editReply({
            embeds: [errorEmbed("VPS Error", `Could not fetch your running bots.\n\`\`\`${userBotsRes.data?.error || "Unknown error"}\`\`\``)],
          });
        }
        const runningBots = userBotsRes.data?.bots || [];
        if (runningBots.length === 0) {
          return interaction.editReply({
            embeds: [warningEmbed("No Bot Running", "You don't have any bots currently running.\nUse `/mcbot start <server>` to launch one.")],
          });
        }
        if (runningBots.length === 1) {
          targetAccount = runningBots[0].minecraftUser;
        } else {
          const lines = runningBots.map(b => `• \`${b.minecraftUser}\` → \`${b.serverHost}:${b.serverPort}\``).join("\n");
          return interaction.editReply({
            embeds: [infoEmbed("Specify Which Bot to Stop",
              `You have **${runningBots.length}** bots running. Specify which one to stop:\n\n${lines}\n\nUsage: \`/mcbot stop account:<username>\``
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

      if (REQUIRE_SUBSCRIPTION) {
        const releaseResult = releaseSlotByUser(userId, targetAccount);
        console.log(`[/mcbot] 🎫 Slot released for ${userId}/${targetAccount}: ${releaseResult.message}`);
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
        const { main, alternateAccounts } = getAllAccountsForDiscord(userId);
        const allAccounts = [main, ...alternateAccounts].filter(Boolean);
        const match = allAccounts.find(a => a.toLowerCase() === accountOpt.toLowerCase());
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

        return interaction.editReply({ embeds: [buildSingleStatusEmbed(response.data?.bot)] });

      } else {
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
        return interaction.editReply({ embeds: [buildMultiStatusEmbed(runningBots)] });
      }
    }
  },

  // ============================================================
  // BUTTON HANDLER
  // ============================================================

  async buttonHandler(interaction) {
    const { customId, user } = interaction;
    const userId = user.id;

    if (customId === "mcbot_patreon_info") {
      const patreonCmd = interaction.client.commands.get("patreon");
      if (patreonCmd) {
        return patreonCmd.execute(interaction);
      }
      return interaction.reply({
        content: `🧡 Check out our Patreon for bot slot subscriptions: ${getPatreonUrl()}`,
        ephemeral: true,
      });
    }

    // ── FreshSMP gamemode selection buttons ───────────────────
    // customId: mcbot_freshsmp_gm_<userId>_<gamemode>
    // Parts:    ["mcbot", "freshsmp", "gm", "<userId>", "<gamemode>"]
    //                0         1       2       3              4
    //
    // NOTE: prefix is "mcbot_freshsmp_gm_" (starts with "mcbot_") so that
    // interactionCreate's DM button router forwards it here correctly.
    if (customId.startsWith("mcbot_freshsmp_gm_")) {
      // Strip the known prefix and split the remainder on "_"
      // remainder = "<userId>_<gamemode>" — Discord IDs are numeric (no underscores)
      const remainder = customId.slice("mcbot_freshsmp_gm_".length); // e.g. "811255871472140328_survival"
      const underscoreIdx = remainder.indexOf("_");

      if (underscoreIdx === -1) {
        return interaction.reply({ content: "❌ Malformed gamemode button ID.", ephemeral: true });
      }

      const buttonUserId = remainder.slice(0, underscoreIdx);
      const gamemode     = remainder.slice(underscoreIdx + 1);

      if (buttonUserId !== userId) {
        return interaction.reply({ content: "❌ This button is not for you.", ephemeral: true });
      }

      const pending = pendingFreshSmpGamemode.get(userId);
      if (!pending) {
        return interaction.reply({
          content: "⚠️ This gamemode selector has already been handled or has expired.",
          ephemeral: true,
        });
      }

      // Validate gamemode
      if (!FRESHSMP_GAMEMODES.includes(gamemode)) {
        return interaction.reply({ content: "❌ Unknown gamemode selected.", ephemeral: true });
      }

      // Disable the buttons so the user can't click again
      try {
        await interaction.update({
          embeds: [new EmbedBuilder()
            .setTitle("🟢 Gamemode Selected")
            .setDescription(
              `You selected **${gamemode.charAt(0).toUpperCase() + gamemode.slice(1)}**.\n\n` +
              `Sending your bot to the \`/queue ${gamemode}\` server now...`
            )
            .setColor(0x00c853)
            .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
            .setTimestamp()],
          components: [buildFreshSmpGamemodeRow(userId, true)],
        });
      } catch (err) {
        console.error(`[/mcbot] ❌ Could not update FreshSMP gamemode selector for ${userId}:`, err.message);
      }

      // Send the selection to the VPS
      const { minecraftUser } = pending;
      pendingFreshSmpGamemode.delete(userId);

      console.log(`[/mcbot] 🟢 [FreshSMP] ${userId} selected gamemode: ${gamemode} for ${minecraftUser}`);

      const result = await sendFreshSmpGamemodeToVps(userId, minecraftUser, gamemode);
      if (!result.ok) {
        console.error(`[/mcbot] ❌ [FreshSMP] Failed to send gamemode to VPS for ${userId}/${minecraftUser}:`, result.data);
        try {
          await interaction.followUp({
            content: `⚠️ Could not send gamemode selection to the VPS. The bot may have disconnected.\nUse \`/mcbot status\` to check, or \`/mcbot start play.freshsmp.fun\` to try again.`,
            ephemeral: true,
          });
        } catch {}
      }
      return;
    }

    // ── Confirm / Reject buttons ──────────────────────────────
    const isConfirm = customId.startsWith("mcbot_confirm_");
    const isReject  = customId.startsWith("mcbot_reject_");

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
      if (REQUIRE_SUBSCRIPTION && pending.preAssignedSlot) {
        releaseSlotByUser(userId, pending.minecraftUser);
        console.log(`[/mcbot] 🎫 Pre-assigned slot released for ${userId} (rejected)`);
      }
      await interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle("❌ Bot Start Cancelled")
          .setDescription("You cancelled the bot start request.")
          .setColor(0x9e9e9e)
          .setTimestamp()],
        components: [],
      });
      try { await pending.interaction.editReply({ embeds: [warningEmbed("Request Cancelled", "You cancelled the bot start request.")] }); } catch {}
      return;
    }

    // ── Confirmed — start the bot
    console.log(`[/mcbot] ✅ Bot start confirmed by ${userId} — starting ${pending.minecraftUser} on ${pending.serverAddress}`);

    const isDonutSmp = isDonutSmpServer(pending.serverAddress);
    const usesQueue  = usesGamemodeQueue(pending.serverAddress);
    const serverName = serverDisplayName(pending.serverAddress);

    let startingDesc;
    if (usesQueue) {
      startingDesc =
        `Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\n\n` +
        `🟢 **${serverName} Note:** Once the bot connects to the lobby, you'll receive a DM here asking you to pick a gamemode (Survival / Lifesteal / SkyWars).\n\n` +
        "If Microsoft authentication is required, you'll receive a sign-in code here shortly.";
    } else if (isDonutSmp) {
      startingDesc =
        `Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\n\n` +
        "⚠️ **DonutSMP Note:** Due to DonutSMP's security features, the bot may need to reconnect 1-2 times before fully joining. " +
        "This is normal and automatic — please wait up to 60 seconds.\n\n" +
        "If Microsoft authentication is required, you'll receive a sign-in code here shortly.";
    } else {
      startingDesc =
        `Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\n\n` +
        "If Microsoft authentication is required, you'll receive a sign-in code here shortly.";
    }

    await interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle("⏳ Starting Bot...")
        .setDescription(startingDesc)
        .setColor(0x2196f3)
        .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
        .setTimestamp()],
      components: [],
    });

    try {
      await pending.interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("🚀 Bot Starting")
          .setDescription(
            `Starting bot for \`${pending.minecraftUser}\` on \`${pending.serverAddress}\`.\nCheck your DMs for updates.` +
            (isDonutSmp ? "\n\n⚠️ DonutSMP may require an extra moment to verify — this is automatic." : "") +
            (usesQueue ? `\n\n🟢 ${serverName} will ask you to select a gamemode in your DMs once the bot is in the lobby.` : "")
          )
          .setColor(0x2196f3)
          .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
          .setTimestamp()],
      });
    } catch {}

    const startResponse = await startBotOnVps(userId, pending.minecraftUser, pending.serverAddress, pending.version);

    if (!startResponse.ok) {
      const reason = startResponse.data?.reason;
      let errMsg   = `\`\`\`${startResponse.data?.error || "Unknown error"}\`\`\``;

      if (reason === "already_running") {
        const addr = startResponse.data?.serverAddress || "a server";
        errMsg = `A bot for \`${pending.minecraftUser}\` is already running on \`${addr}\`.\nUse \`/mcbot stop\` first.`;
      } else if (reason === "max_bots_reached") {
        errMsg = `The VPS has reached its maximum bot limit (${startResponse.data?.max ?? "?"}). Try again later.`;
      } else if (reason === "donutsmp_limit_reached") {
        errMsg = `🍩 DonutSMP is at its **${startResponse.data?.max ?? 5}-bot limit** right now. This protects accounts from alt-detection bans — please try again once a slot frees up.`;
      }

      if (REQUIRE_SUBSCRIPTION && pending.preAssignedSlot) {
        releaseSlotByUser(userId, pending.minecraftUser);
        console.log(`[/mcbot] 🎫 Slot released for ${userId} (VPS start failed)`);
      }

      try { await interaction.message.edit({ embeds: [errorEmbed("Failed to Start Bot", errMsg)], components: [] }); } catch {}
      return;
    }

    await pollBotStartOutcome(
      userId,
      pending.minecraftUser,
      pending.serverAddress,
      pending.dmChannel,
      interaction.message,
      usesQueue,
    );
  },
};

// ============================================================
// FRESHSMP PENDING GAMEMODE SELECTOR
// Map<userId, { minecraftUser, selectorMessage }>
// Populated by pollBotStartOutcome when the bot reaches the lobby.
// Consumed by the mcbot_freshsmp_gm_ button handler above.
// ============================================================
const pendingFreshSmpGamemode = new Map();

// ============================================================
// SLOT SUBCOMMAND HANDLER
// ============================================================

async function _handleSlot(interaction, sub, userId) {
  const adminSubs = ["grant", "revoke", "info"];
  if (adminSubs.includes(sub)) {
    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        embeds: [errorEmbed("Access Denied", "Only administrators can use `/mcbot slot grant`, `revoke`, or `info`.")],
        ephemeral: true,
      });
    }
    await interaction.deferReply({ ephemeral: true });
    return _handleSlotAdmin(interaction, sub);
  }

  await interaction.deferReply({ ephemeral: true });

  if (sub === "status")    return _slotStatus(interaction, userId);
  if (sub === "available") return _slotAvailable(interaction);
  if (sub === "queue")     return _slotQueue(interaction, userId);
  if (sub === "release")   return _slotRelease(interaction, userId);
}

async function _slotStatus(interaction, userId) {
  const user  = db.getOrCreateUser(userId);
  const slots = db.getSlotsForUser(userId);
  const queue = db.getQueueForUser(userId);
  const subActive = user.active && user.subscription_tier !== "none";

  const embed = new EmbedBuilder()
    .setTitle("🎫 Your KenzAI Subscription")
    .setColor(subActive ? 0x00c853 : 0x9e9e9e)
    .setFooter({ text: "KenzAI • Bot Slot Manager" })
    .setTimestamp()
    .addFields(
      { name: "📦 Subscription Tier", value: tierBadge(user.subscription_tier), inline: true },
      { name: "📊 Status",            value: subActive ? "🟢 Active" : "🔴 Inactive", inline: true },
      { name: "🔧 Slots Used",        value: `${slots.length} / ${user.max_slots_allowed || 0}`, inline: true },
      { name: "💳 Platform",          value: user.payment_platform ? `\`${user.payment_platform}\`` : "N/A", inline: true },
      { name: "📅 Updated",           value: formatDate(user.updated_at), inline: true },
    );

  if (slots.length > 0) {
    const lines = slots.map(s =>
      `• \`${s.slot_id}\` — \`${s.mc_username}\` (${tierBadge(s.tier)}) started ${formatDate(s.start_time)}`
    );
    embed.addFields({ name: `🤖 Active Slots (${slots.length})`, value: lines.join("\n"), inline: false });
  } else {
    embed.addFields({ name: "🤖 Active Slots", value: "None", inline: false });
  }

  if (queue) {
    const pos = db.getQueuePosition(userId);
    embed.addFields({ name: "⏳ Queue Position", value: `#${pos} (${tierBadge(queue.tier)})`, inline: false });
  }

  if (!subActive) {
    embed.setDescription(
      "You don't have an active KenzAI subscription.\n" +
      `Subscribe on Patreon to get bot slots: [Click here](${process.env.PATREON_URL || "https://www.patreon.com"})\n` +
      "Or use `/patreon` to see all available tiers."
    );
  }

  return interaction.editReply({ embeds: [embed] });
}

async function _slotAvailable(interaction) {
  const avail      = getSlotAvailability();
  const { total: queueTotal } = getQueueStats();

  const embed = new EmbedBuilder()
    .setTitle("🌐 Bot Slot Availability")
    .setColor(0x2196f3)
    .setFooter({ text: "KenzAI • Bot Slot Manager" })
    .setTimestamp();

  for (const [tier, info] of Object.entries(avail)) {
    const bar = progressBar(info.occupied, info.total);
    embed.addFields({
      name:   tierBadge(tier),
      value:  `${bar}\n**${info.available}** / ${info.total} available · ${info.maxPerUser} slot(s) per user`,
      inline: false,
    });
  }

  embed.addFields({ name: "⏳ Queue Length", value: `**${queueTotal}** user(s) waiting`, inline: false });
  return interaction.editReply({ embeds: [embed] });
}

async function _slotQueue(interaction, userId) {
  const entry = db.getQueueForUser(userId);

  if (!entry) {
    return interaction.editReply({
      embeds: [infoEmbed("Not In Queue", "You're not currently in the bot slot queue.\nUse `/mcbot start` to request a slot.")],
    });
  }

  const pos   = db.getQueuePosition(userId);
  const stats = getQueueStats();

  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setTitle("⏳ Your Queue Position")
      .setColor(0xffd600)
      .setFooter({ text: "KenzAI • Bot Slot Manager" })
      .setTimestamp()
      .addFields(
        { name: "📍 Position",    value: `**#${pos}** of ${stats.total}`, inline: true },
        { name: "📦 Tier",        value: tierBadge(entry.tier),           inline: true },
        { name: "🎮 Account",     value: `\`${entry.mc_username}\``,      inline: true },
        { name: "🕐 Queued Since", value: formatDate(entry.queued_at),    inline: false },
      )
      .setDescription("You'll receive a DM when a slot becomes available.")],
  });
}

async function _slotRelease(interaction, userId) {
  const slotIdOpt = interaction.options.getString("slot_id");
  const slots     = db.getSlotsForUser(userId);

  if (slots.length === 0) {
    return interaction.editReply({ embeds: [infoEmbed("No Active Slots", "You have no active bot slots to release.")] });
  }

  let targetSlot;
  if (slotIdOpt) {
    targetSlot = slots.find(s => s.slot_id === slotIdOpt);
    if (!targetSlot) {
      return interaction.editReply({
        embeds: [errorEmbed("Slot Not Found", `\`${slotIdOpt}\` is not one of your active slots.\nUse \`/mcbot slot status\` to see your slots.`)],
      });
    }
  } else if (slots.length === 1) {
    targetSlot = slots[0];
  } else {
    const list = slots.map(s => `• \`${s.slot_id}\` — \`${s.mc_username}\``).join("\n");
    return interaction.editReply({
      embeds: [infoEmbed("Specify a Slot", `You have **${slots.length}** active slots. Use \`/mcbot slot release slot_id:<id>\`:\n\n${list}`)],
    });
  }

  const result = releaseSlot(targetSlot.slot_id, userId);
  if (!result.success) {
    return interaction.editReply({ embeds: [errorEmbed("Release Failed", result.message)] });
  }

  const embed = new EmbedBuilder()
    .setTitle("✅ Slot Released")
    .setDescription(`Slot \`${targetSlot.slot_id}\` (\`${targetSlot.mc_username}\`) has been released.`)
    .setColor(0x00c853)
    .setFooter({ text: "KenzAI • Bot Slot Manager" })
    .setTimestamp();

  if (result.nextUser) {
    embed.addFields({
      name:  "📢 Queue Promoted",
      value: `<@${result.nextUser.user_id}> has been promoted from the queue and assigned this slot.`,
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function _handleSlotAdmin(interaction, sub) {
  const targetUser = interaction.options.getUser("user");
  const tier       = interaction.options.getString("tier");
  const targetId   = targetUser?.id;

  if (sub === "grant") {
    const result = grantSubscription(targetId, tier, "manual");
    if (!result.success) {
      return interaction.editReply({ embeds: [errorEmbed("Grant Failed", result.message)] });
    }
    return interaction.editReply({
      embeds: [successEmbed("Subscription Granted",
        `Granted **${tierBadge(tier)}** subscription to <@${targetId}>.\nThey can now use \`/mcbot slot status\` to check their slots.`
      )],
    });
  }

  if (sub === "revoke") {
    const result = revokeSubscription(targetId, "manual");
    return interaction.editReply({
      embeds: [successEmbed("Subscription Revoked",
        `Revoked subscription for <@${targetId}>.\n**${result.revokedSlots}** slot(s) released.`
      )],
    });
  }

  if (sub === "info") {
    const user  = db.getOrCreateUser(targetId);
    const slots = db.getSlotsForUser(targetId);
    const queue = db.getQueueForUser(targetId);
    const logs  = db.getLogsForUser(targetId, 5);

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Subscription Info — <@${targetId}>`)
      .setColor(0x2196f3)
      .setFooter({ text: "KenzAI • Admin View" })
      .setTimestamp()
      .addFields(
        { name: "📦 Tier",        value: tierBadge(user.subscription_tier), inline: true },
        { name: "📊 Active",      value: user.active ? "🟢 Yes" : "🔴 No",  inline: true },
        { name: "💳 Platform",    value: user.payment_platform || "N/A",    inline: true },
        { name: "🆔 Payment ID",  value: user.payment_id       || "N/A",    inline: true },
        { name: "🔧 Max Slots",   value: String(user.max_slots_allowed),    inline: true },
        { name: "🤖 Active Slots", value: String(slots.length),            inline: true },
      );

    if (slots.length > 0) {
      embed.addFields({ name: "Slots", value: slots.map(s => `\`${s.slot_id}\` ${s.mc_username} (${s.tier})`).join("\n") });
    }
    if (queue) {
      embed.addFields({ name: "Queue", value: `Position #${db.getQueuePosition(targetId)}` });
    }
    if (logs.length > 0) {
      embed.addFields({ name: "Recent Log", value: logs.map(l => `\`${l.action}\` (${l.tier}) ${formatDate(l.timestamp)}`).join("\n") });
    }

    return interaction.editReply({ embeds: [embed] });
  }
}

// ============================================================
// BOT START OUTCOME POLLING
//
// For FreshSMP: once the bot reaches "online", we check the VPS
// for the freshsmp/spawned notification, then DM the user a
// gamemode selector. The bot stays connected while the user picks.
//
// For DonutSMP: the bot may go online → reconnecting several times
// during the verification grace period.
// ============================================================

const STABLE_ONLINE_THRESHOLD_MS = 10 * 1000; // bot must stay online 10s to be "confirmed"

async function pollBotStartOutcome(discordId, minecraftUser, serverAddress, dmChannel, confirmMessage, usesQueue = false) {
  const deadline     = Date.now() + BOT_START_POLL_DURATION_MS;
  const pollInterval = 3000;
  let lastCodeShown  = null;
  const isDonutSmp   = isDonutSmpServer(serverAddress);

  // Re-derive in case caller didn't pass it (backwards safety). usesQueue is true
  // for FreshSMP and ElementalMC (both use the post-lobby gamemode/queue flow).
  if (!usesQueue) usesQueue = usesGamemodeQueue(serverAddress);
  const serverName = serverDisplayName(serverAddress);

  let firstOnlineAt           = null;
  let shownVerifyingMsg       = false;
  let freshSmpGamemodeAsked   = false; // have we sent the gamemode selector DM?
  const verificationGraceEnd  = isDonutSmp ? Date.now() + DONUTSMP_VERIFICATION_GRACE_MS : 0;

  let consecutiveMisses = 0;
  const MAX_CONSECUTIVE_MISSES = 4; // ~12 seconds of no bot on VPS

  console.log(`[/mcbot poll] 🔄 Starting poll for ${discordId}/${minecraftUser} — DonutSMP: ${isDonutSmp} Queue(${serverName}): ${usesQueue}`);

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    // ── Device code polling ────────────────────────────────────
    try {
      const codeRes = await getDeviceCodeFromVps(discordId, minecraftUser);
      if (codeRes.ok && codeRes.data?.pending) {
        const { userCode, verificationUri } = codeRes.data;
        if (userCode !== lastCodeShown) {
          const isUpdate = lastCodeShown !== null;
          console.log(`[/mcbot poll] 🔐 ${isUpdate ? "Updated" : "New"} device code for ${discordId}/${minecraftUser}: ${userCode}`);
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
            await clearDeviceCodeOnVps(discordId, minecraftUser);
          } catch (dmErr) {
            console.error(`[/mcbot poll] ❌ Failed to DM device code to ${discordId}:`, dmErr.message);
          }
        }
      }
    } catch (err) {
      console.error(`[/mcbot poll] ❌ Device code poll error for ${discordId}/${minecraftUser}:`, err.message);
    }

    // ── FreshSMP: check for spawned notification ───────────────
    // Once the VPS fires onFreshSmpSpawned we get a consume-once
    // response here. We send the gamemode selector DM and register
    // the pending entry so the button handler can forward the choice.
    if (usesQueue && !freshSmpGamemodeAsked) {
      try {
        const spawnedRes = await getFreshSmpSpawnedFromVps(discordId, minecraftUser);
        if (spawnedRes.ok && spawnedRes.data?.pending) {
          freshSmpGamemodeAsked = true;
          console.log(`[/mcbot poll] 🟢 [${serverName}] Bot in lobby — sending gamemode selector DM to ${discordId}`);

          // Register pending entry BEFORE sending the DM so the button
          // handler never has a window where it can't find the entry.
          pendingFreshSmpGamemode.set(discordId, { minecraftUser });

          try {
            const selectorMsg = await dmChannel.send({
              embeds: [new EmbedBuilder()
                .setTitle(`🟢 ${serverName} — Choose Your Gamemode`)
                .setDescription(
                  `Your bot (\`${minecraftUser}\`) has joined the **${serverName}** lobby!\n\n` +
                  "Pick a gamemode below and the bot will queue up automatically."
                )
                .addFields(
                  { name: "⚔️ Survival",  value: "Classic survival SMP",    inline: true },
                  { name: "❤️ Lifesteal", value: "Hearts at stake PvP SMP", inline: true },
                  { name: "🌤️ SkyWars",  value: "Competitive SkyWars",      inline: true },
                )
                .setColor(0x00c853)
                .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                .setTimestamp()],
              components: [buildFreshSmpGamemodeRow(discordId)],
            });

            // Store the selector message ref so we can update it later if needed
            pendingFreshSmpGamemode.set(discordId, { minecraftUser, selectorMessage: selectorMsg });

            // Update the confirm DM to reflect that the bot is online & waiting
            try {
              await confirmMessage.edit({
                embeds: [new EmbedBuilder()
                  .setTitle("🟢 Bot Online — Waiting for Gamemode")
                  .setDescription(
                    `Your bot (\`${minecraftUser}\`) is in the **${serverName}** lobby.\n\n` +
                    "Check your DMs — you've been sent a gamemode selector."
                  )
                  .setColor(0x00c853)
                  .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                  .setTimestamp()],
              });
            } catch {}

          } catch (dmErr) {
            console.error(`[/mcbot poll] ❌ Failed to send FreshSMP gamemode selector DM to ${discordId}:`, dmErr.message);
            // Clean up the pending entry if we failed to send the DM
            pendingFreshSmpGamemode.delete(discordId);
          }

          // For FreshSMP, once we've sent the gamemode selector we're done
          // with the poll loop — the bot is online, user picks via button.
          return;
        }
      } catch (err) {
        console.error(`[/mcbot poll] ❌ FreshSMP spawned poll error for ${discordId}/${minecraftUser}:`, err.message);
      }
    }

    // ── Status polling ─────────────────────────────────────────
    try {
      const statusRes = await getBotStatusFromVps(discordId, minecraftUser);

      if (!statusRes.ok) {
        consecutiveMisses++;
        console.log(`[/mcbot poll] ⚠️ Bot not found on VPS (miss ${consecutiveMisses}/${MAX_CONSECUTIVE_MISSES}) for ${discordId}/${minecraftUser}`);

        const effectiveMaxMisses = isDonutSmp
          ? MAX_CONSECUTIVE_MISSES * 3
          : usesQueue
            ? MAX_CONSECUTIVE_MISSES * 2 // FreshSMP/ElementalMC may briefly vanish during login
            : MAX_CONSECUTIVE_MISSES;

        if (consecutiveMisses >= effectiveMaxMisses) {
          console.warn(`[/mcbot poll] ❌ Bot gone from VPS after ${consecutiveMisses} consecutive misses — reporting error`);
          try {
            await confirmMessage.edit({
              embeds: [new EmbedBuilder()
                .setTitle("❌ Bot Failed to Start")
                .setDescription(
                  isDonutSmp
                    ? "The bot was unable to join DonutSMP.\n\n" +
                      "DonutSMP's security system may be requiring account verification. " +
                      "Please log into DonutSMP manually once to complete the verification, then try `/mcbot start` again.\n\n" +
                      "💡 If you have never logged into DonutSMP from this Minecraft account before, you need to do so first."
                    : usesQueue
                      ? `The bot failed to connect to ${serverName} or was disconnected before reaching the lobby.\n\n` +
                        `This can happen if the server is restarting or your account had a network blip. Use \`/mcbot start ${serverAddress}\` to try again.`
                      : "The bot failed to start or was disconnected before fully connecting.\n\n" +
                        "Use `/mcbot start` to try again. If this keeps happening, contact an admin."
                )
                .setColor(0xf44336)
                .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                .setTimestamp()],
            });
          } catch {}
          return;
        }

        if (isDonutSmp && !shownVerifyingMsg && consecutiveMisses === 1) {
          shownVerifyingMsg = true;
          try {
            await confirmMessage.edit({
              embeds: [new EmbedBuilder()
                .setTitle("🟠 DonutSMP: Passing Security Check...")
                .setDescription(
                  `The bot is working through DonutSMP's security verification screen.\n\n` +
                  `**Account:** \`${minecraftUser}\`\n` +
                  `**Server:** \`donutsmp.net\`\n\n` +
                  "This is automatic and may take up to 60 seconds. Please wait."
                )
                .setColor(0xff9800)
                .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                .setTimestamp()],
            });
          } catch {}
        }

        continue;
      }

      // Bot found — reset miss counter
      consecutiveMisses = 0;

      const bot    = statusRes.data?.bot;
      if (!bot) continue;
      const status = bot.status;

      // ── DonutSMP: treat "reconnecting" during grace period as pending ──
      if (isDonutSmp && status === "reconnecting" && Date.now() < verificationGraceEnd) {
        console.log(`[/mcbot poll] 🟠 DonutSMP reconnecting during grace period for ${minecraftUser} — waiting...`);
        if (!shownVerifyingMsg) {
          shownVerifyingMsg = true;
          try {
            await confirmMessage.edit({
              embeds: [new EmbedBuilder()
                .setTitle("🟠 DonutSMP: Passing Security Check...")
                .setDescription(
                  `The bot connected to DonutSMP and is working through the security verification screen.\n\n` +
                  `**Account:** \`${bot.minecraftUser}\`\n` +
                  `**Server:** \`${bot.serverHost}\`\n\n` +
                  "This is automatic and may take up to 60 seconds. Please wait."
                )
                .setColor(0xff9800)
                .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
                .setTimestamp()],
            });
          } catch {}
        }
        continue;
      }

      // ── Bot is online — apply stability check ─────────────────
      if (status === "online") {
        if (!firstOnlineAt) {
          firstOnlineAt = Date.now();
          console.log(`[/mcbot poll] 🟢 Bot online for ${discordId}/${minecraftUser} — waiting ${STABLE_ONLINE_THRESHOLD_MS}ms to confirm stability`);
          continue;
        }

        const onlineDuration = Date.now() - firstOnlineAt;
        if (onlineDuration < STABLE_ONLINE_THRESHOLD_MS) {
          continue;
        }

        // FreshSMP/ElementalMC: if the bot is online but we haven't got the
        // spawned notification yet, keep polling rather than declaring success —
        // the spawned check at the top of the loop will handle it.
        if (usesQueue && !freshSmpGamemodeAsked) {
          continue;
        }

        // Confirmed stable online (no queue flow, or queue already handled)
        console.log(`[/mcbot poll] ✅ Bot confirmed stable online for ${discordId}/${minecraftUser}`);
        try {
          await confirmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("🟢 Bot Online")
              .setDescription(`Your Minecraft bot is now **online** on \`${bot.serverHost}:${bot.serverPort}\`.`)
              .addFields(
                { name: "🎮 __Minecraft User__", value: `\`${bot.minecraftUser}\``,                   inline: false },
                { name: "📦 __Version__",        value: `\`${bot.version}\``,                         inline: false },
                { name: "⏱️ __Uptime__",          value: `\`${formatUptime(bot.uptimeSeconds ?? 0)}\``, inline: false },
              )
              .setColor(0x00c853)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
          });
        } catch {}
        return;
      }

      // ── Reset stability counter if bot drops from online ──────
      if (status !== "online" && firstOnlineAt) {
        console.log(`[/mcbot poll] ⚠️ Bot dropped from online to ${status} for ${discordId}/${minecraftUser}`);
        firstOnlineAt = null;
      }

      // ── Error state ────────────────────────────────────────────
      if (status === "error") {
        console.log(`[/mcbot poll] 🔴 Bot error for ${discordId}/${minecraftUser}`);
        const hints    = buildStatusHints(bot);
        const hintText = hints.length > 0 ? `\n\n💡 ${hints.join("\n💡 ")}` : "";
        try {
          await confirmMessage.edit({
            embeds: [new EmbedBuilder()
              .setTitle("🔴 Bot Failed to Start")
              .setDescription(`The bot encountered an error.\n\`\`\`${bot.spawnError || "Unknown error"}\`\`\`` + hintText)
              .setColor(0xf44336)
              .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
              .setTimestamp()],
          });
        } catch {}
        return;
      }

    } catch (err) {
      console.error(`[/mcbot poll] ❌ Status poll error for ${discordId}/${minecraftUser}:`, err.message);
    }
  }

  console.warn(`[/mcbot poll] ⏰ Poll timed out for ${discordId}/${minecraftUser}`);
  try {
    await confirmMessage.edit({
      embeds: [warningEmbed("Timed Out", "The bot start timed out. Use `/mcbot status` to check if the bot is running.")],
    });
  } catch {}
}

// ============================================================
// STATUS EMBED BUILDERS
// ============================================================

function buildSingleStatusEmbed(bot) {
  const hints    = buildStatusHints(bot);
  const hintText = hints.length > 0 ? `\n\n💡 ${hints.join("\n💡 ")}` : "";

  const fields = [
    { name: "🎮 __Account__", value: `> \`${bot.minecraftUser}\``,                        inline: false },
    { name: "📊 __Status__",  value: `> ${getStatusEmoji(bot.status)} \`${bot.status}\``, inline: false },
    { name: "🌐 __Server__",  value: `> \`${bot.serverHost}\``,                           inline: false },
    { name: "⏱️ __Uptime__",  value: `> \`${formatUptime(bot.uptimeSeconds ?? 0)}\``,     inline: false },
  ];

  // FreshSMP / ElementalMC: show chosen gamemode if available (VPS reports the
  // profile id; both share the freshSmpGamemode field).
  if (["freshsmp", "elementalmc"].includes(bot.profile) && bot.freshSmpGamemode) {
    fields.push({
      name:  "🎮 __Gamemode__",
      value: `> \`${bot.freshSmpGamemode}\`${bot.freshSmpQueueSent ? " (queued)" : " (pending)"}`,
      inline: false,
    });
  }

  if (bot.spawnError) {
    fields.push({ name: "⚠️ Error", value: bot.spawnError + hintText, inline: false });
  }

  return new EmbedBuilder()
    .setTitle(`${getStatusEmoji(bot.status)} Bot Status — ${bot.minecraftUser}`)
    .addFields(...fields)
    .setColor(getStatusColor(bot.status))
    .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
    .setTimestamp();
}

function buildMultiStatusEmbed(bots) {
  const lines = bots.map(b => {
    const gmSuffix = ["freshsmp", "elementalmc"].includes(b.profile) && b.freshSmpGamemode ? ` [${b.freshSmpGamemode}]` : "";
    return `• \`${b.minecraftUser}\` → \`${b.serverHost}\` [${getStatusEmoji(b.status)}] ⏱️ ${formatUptime(b.uptimeSeconds ?? 0)}${gmSuffix}`;
  });
  return new EmbedBuilder()
    .setTitle(`🤖 Your Active Bots (${bots.length})`)
    .setDescription(lines.join("\n") + "\n\n*Use `/mcbot status account:<username>` for details on a specific bot.*")
    .setColor(0x2196f3)
    .setFooter({ text: "Yazanaki Empire • VPS Bot Manager" })
    .setTimestamp();
}