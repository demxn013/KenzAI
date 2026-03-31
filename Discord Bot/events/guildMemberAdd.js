// Discord Bot/events/guildMemberAdd.js
// Auto-DM new members of the Yazanaki Empire about KenzAI's Minecraft bot feature.
// Only fires in the Yazanaki Empire guild (not clan guilds) to avoid spam.
// Silently ignores failures (user has DMs closed, etc.).

"use strict";

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Configurable delay before sending the DM — gives the user a moment to settle in.
const DM_DELAY_MS = 30 * 1000; // 30 seconds

function getPatreonUrl() {
  return process.env.PATREON_URL || "https://www.patreon.com";
}

module.exports = {
  name: "guildMemberAdd",
  async execute(member) {
    // Only fire in the Yazanaki Empire main guild
    if (member.guild.id !== YAZANAKI_EMPIRE_GUILD_ID) return;
    if (member.user.bot) return;

    // Delay the DM so it doesn't fire the instant they join
    setTimeout(async () => {
      try {
        const patreonUrl = getPatreonUrl();

        const embed = new EmbedBuilder()
          .setTitle("👋 Welcome to the Yazanaki Empire!")
          .setColor(0x000000)
          .setDescription(
            [
              `Welcome, <@${member.id}>! We're glad to have you in the empire.`,
              "",
              "**Did you know?** KenzAI — the empire's Discord bot — can run a **Minecraft AFK bot** for you on the empire's dedicated VPS, directly from Discord.",
              "",
              "No setup. No configuration. Just one command.",
            ].join("\n")
          )
          .addFields(
            {
              name: "🤖 What can the bot do?",
              value: [
                "• Stay online in-game while you're away",
                "• Automatically reconnects if kicked",
                "• Supports DonutSMP, FreshSMP, Hypixel & more",
                "• Auto-eats food so it doesn't starve",
                "• Microsoft account auth — fully secure",
              ].join("\n"),
              inline: false,
            },
            {
              name: "🚀 How to use it",
              value: [
                "1. Apply and get accepted into a clan",
                "2. Link your Minecraft account with `/link main <username>`",
                "3. Subscribe on Patreon to unlock a bot slot",
                "4. Run `/mcbot start <server>` in any clan discord",
              ].join("\n"),
              inline: false,
            },
            {
              name: "🧡 Support the project",
              value: `Subscriptions keep the VPS running and give you bot slots. Check out our Patreon tiers with \`/patreon\` in the discord, or click below.`,
              inline: false,
            }
          )
          .setFooter({ text: "Yazanaki Empire • KenzAI Bot System" })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("View Bot Tiers")
            .setStyle(ButtonStyle.Link)
            .setURL(patreonUrl)
            .setEmoji("🧡"),
        );

        const dm = await member.user.createDM();
        await dm.send({ embeds: [embed], components: [row] });

        console.log(`[guildMemberAdd] 📨 Sent KenzAI welcome DM to ${member.user.tag} (${member.id})`);
      } catch (err) {
        // Silently ignore — user may have DMs closed
        console.log(`[guildMemberAdd] ℹ️ Could not DM ${member.user.tag}: ${err.message}`);
      }
    }, DM_DELAY_MS);
  },
};