// modules/mcbot/patreon.js
// /patreon — Dedicated Patreon promotion command for KenzAI bot subscriptions.
// Shows tier breakdown, benefits, and a direct link to subscribe.
//
// Placed at modules/mcbot/patreon.js so the command loader (which scans
// modules/<folder>/*.js) picks it up automatically.

"use strict";

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

// Lazy-require monetization modules so this command still loads cleanly
// even if subscriptiondb or slotmanager have a startup error.
function getDb() {
  return require("./monetization/subscriptiondb");
}

function getSlotManager() {
  return require("./monetization/slotmanager");
}

function getPatreonUrl() {
  return process.env.PATREON_URL || "https://www.patreon.com";
}

function tierBadge(tier) {
  const badges = { standard: "🔵 Standard", premium: "🟣 Premium", vip: "👑 VIP", none: "⚫ None" };
  return badges[tier] || tier;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("patreon")
    .setDescription("Support KenzAI on Patreon and get Minecraft bot slots for the Yazanaki Empire VPS"),

  async execute(interaction) {
    const patreonUrl = getPatreonUrl();

    let tierConfig = {};
    let availability = {};
    let userRecord = null;

    try {
      const slotManager = getSlotManager();
      tierConfig = slotManager.getTierConfig();
      availability = slotManager.getSlotAvailability();
    } catch (err) {
      console.error("[/patreon] ❌ Could not load slotmanager:", err.message);
    }

    try {
      const db = getDb();
      userRecord = db.getUser(interaction.user.id);
    } catch (err) {
      console.error("[/patreon] ❌ Could not load subscriptiondb:", err.message);
    }

    const hasSub = userRecord?.active && userRecord?.subscription_tier !== "none";
    const currentTier = hasSub ? userRecord.subscription_tier : null;

    // ── Build tier breakdown fields ─────────────────────────
    const tierFields = Object.entries(tierConfig).map(([tier, config]) => {
      const avail = availability[tier];
      const availText = avail
        ? `${avail.available}/${avail.total} slots available`
        : "slots available";

      const isCurrent = currentTier === tier;
      const label = `${tierBadge(tier)}${isCurrent ? " ✅ (Your tier)" : ""}`;

      return {
        name: label,
        value: [
          `• **${config.maxPerUser}** bot slot${config.maxPerUser > 1 ? "s" : ""} per account`,
          `• Up to **${config.globalLimit}** global slots for this tier`,
          `• 📊 ${availText}`,
        ].join("\n"),
        inline: false,
      };
    });

    // ── Build the embed ──────────────────────────────────────
    const embed = new EmbedBuilder()
      .setTitle("🤖 KenzAI — Minecraft Bot Slots")
      .setColor(hasSub ? 0x00c853 : 0xf96854) // green if subscribed, Patreon orange-red if not
      .setDescription(
        [
          "**KenzAI** lets Yazanaki Empire members run an AFK Minecraft bot on the empire VPS directly from Discord — no setup required.",
          "",
          "Use `/mcbot start <server>` to launch your bot, `/mcbot stop` to shut it down, and `/mcbot status` to check in on it.",
          "",
          hasSub
            ? `✅ **You're already a supporter!** Current tier: ${tierBadge(currentTier)}\nUse \`/mcbot slot status\` to view your active slots.`
            : "**Subscribe on Patreon** to unlock your bot slots and support the project!",
        ].join("\n")
      )
      .setFooter({ text: "KenzAI • Yazanaki Empire Bot System" })
      .setTimestamp();

    if (tierFields.length > 0) {
      embed.addFields(
        { name: "‎", value: "**— Subscription Tiers —**", inline: false },
        ...tierFields,
      );
    }

    embed.addFields(
      { name: "‎", value: "**— How It Works —**", inline: false },
      {
        name: "1️⃣ Subscribe on Patreon",
        value: "Choose a tier and link your Discord account on Patreon.",
        inline: false,
      },
      {
        name: "2️⃣ Your slot activates automatically",
        value: "Within 5 minutes, your KenzAI bot slot will be granted. No action needed.",
        inline: false,
      },
      {
        name: "3️⃣ Use /mcbot start",
        value: "Head to the Yazanaki Empire discord (or any registered clan discord) and run `/mcbot start <server>`.",
        inline: false,
      },
    );

    // ── Action row ───────────────────────────────────────────
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

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
  },

  // Button handler for the "My Slot Status" button on this embed.
  // Routed here from interactionCreate.js via the patreon_slot_status customId.
  async buttonHandler(interaction) {
    if (interaction.customId !== "patreon_slot_status") return;

    const patreonUrl = getPatreonUrl();
    let userRecord = null;
    let slots = [];

    try {
      const db = getDb();
      userRecord = db.getUser(interaction.user.id);
      slots = db.getSlotsForUser(interaction.user.id);
    } catch (err) {
      console.error("[/patreon buttonHandler] ❌ Could not load subscriptiondb:", err.message);
    }

    const hasSub = userRecord?.active && userRecord?.subscription_tier !== "none";

    if (!hasSub) {
      return interaction.reply({
        content: `❌ You don't have an active KenzAI subscription yet.\nSubscribe at: ${patreonUrl}`,
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 Your KenzAI Slot Status")
      .setColor(0x00c853)
      .addFields(
        { name: "📦 Tier",        value: tierBadge(userRecord.subscription_tier), inline: true },
        { name: "🔧 Slots Used",  value: `${slots.length} / ${userRecord.max_slots_allowed}`, inline: true },
      )
      .setFooter({ text: "KenzAI • Bot Slot Manager" })
      .setTimestamp();

    if (slots.length > 0) {
      embed.addFields({
        name: "🤖 Active Bots",
        value: slots.map(s => `• \`${s.mc_username}\``).join("\n"),
        inline: false,
      });
    } else {
      embed.addFields({
        name: "🤖 Active Bots",
        value: "None — use `/mcbot start <server>` to launch one!",
        inline: false,
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};