// modules/linking/link.js
// Slash command: /link main|alt <username>

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const linklogic = require("./linklogic");
const { addAlternateAccount } = require("../membertracking/memberlogic");
const msauth = require("./msauth");

// How long we will poll the internal verification helper before giving up
const LINK_VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LINK_VERIFICATION_POLL_INTERVAL_MS = 2500;

// In-memory map to prevent multiple concurrent verifications per user
// Map<discordId, { type, mcName }>
const pendingLinks = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to your Minecraft account.")
    .addSubcommand((sub) =>
      sub
        .setName("main")
        .setDescription("Link your main Minecraft account.")
        .addStringOption((option) =>
          option
            .setName("username")
            .setDescription("Your main Minecraft username")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("alt")
        .setDescription("Link an alternate Minecraft account to your profile.")
        .addStringOption((option) =>
          option
            .setName("username")
            .setDescription("Your alternate Minecraft username")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const mcName = interaction.options.getString("username");
    const discordId = interaction.user.id;

    console.log(
      `[/link] 🔗 Linking attempt (${sub}) by ${interaction.user.tag} (${discordId})`
    );
    console.log(`[/link] 🎮 MC Username provided: ${mcName}`);

    if (pendingLinks.has(discordId)) {
      return interaction.reply({
        content:
          "⏳ You already have a pending link verification. Please wait for it to finish or try again later.",
        ephemeral: true,
      });
    }

    // First, validate using dryRun (no write yet)
    let validationResult;
    if (sub === "main") {
      validationResult = linklogic.linkMainAccount(discordId, mcName, {
        dryRun: true,
      });
    } else if (sub === "alt") {
      validationResult = linklogic.linkAltAccount(discordId, mcName, {
        dryRun: true,
      });
    } else {
      return interaction.reply({
        content: "⚠️ Unknown subcommand.",
        ephemeral: true,
      });
    }

    console.log(`[/link] 📊 Validation result:`, validationResult);

    // Handle validation errors before starting verification
    const result = validationResult;

    if (!result.success) {
      if (result.reason === "already_linked") {
        console.log(
          `[/link] ❌ User already linked to: ${result.details?.minecraftUser}`
        );
        return interaction.reply({
          content: `❌ You are already linked to Minecraft account: \`${result.details?.minecraftUser}\``,
          ephemeral: true,
        });
      }

      if (result.reason === "username_used") {
        console.log(`[/link] ❌ MC username already in use: ${mcName}`);
        return interaction.reply({
          content:
            "❌ That Minecraft username is already linked to another Discord user.",
          ephemeral: true,
        });
      }

      if (result.reason === "invalid_arguments") {
        console.log(`[/link] ❌ Invalid arguments`);
        return interaction.reply({
          content:
            "⚠️ Invalid arguments. Please provide a valid Minecraft username.",
          ephemeral: true,
        });
      }

      if (result.reason === "no_mcname_provided") {
        console.log(`[/link] ❌ No MC name provided`);
        return interaction.reply({
          content: "⚠️ Please provide a Minecraft username.",
          ephemeral: true,
        });
      }

      if (result.reason === "no_main_linked" && sub === "alt") {
        console.log(`[/link] ❌ No main account linked yet for alt linking`);
        return interaction.reply({
          content:
            "⚠️ You need to link a **main** account first: use `/link main <minecraft_username>`.",
          ephemeral: true,
        });
      }

      if (result.reason === "already_linked_alt" && sub === "alt") {
        console.log(
          `[/link] ❌ Alt already linked for this user: ${result.details?.minecraftUser}`
        );
        return interaction.reply({
          content: `❌ That alternate Minecraft account is already linked to you: \`${result.details?.minecraftUser}\`.`,
          ephemeral: true,
        });
      }

      console.error(`[/link] ⚠️ Unexpected error during validation:`, result);
      return interaction.reply({
        content:
          "⚠️ An unexpected error occurred while validating your link request.",
        ephemeral: true,
      });
    }

    // Start pseudo Microsoft-style verification
    let device;
    try {
      device = msauth.requestDeviceCode(discordId, mcName, sub);
    } catch (err) {
      console.error("[/link] ❌ Failed to start verification:", err);
      return interaction.reply({
        content:
          "❌ Failed to start verification. Please try again later or contact an admin.",
        ephemeral: true,
      });
    }

    pendingLinks.set(discordId, { type: sub, mcName });

    const expiresTimestamp = Math.floor(device.expiresAt / 1000);

    const embed = new EmbedBuilder()
      .setTitle("🔐 Account Verification Required")
      .setDescription(
        "Before linking, please complete a quick verification step.\n\n" +
          "Use the code below on the Microsoft device login page. This mimics the Microsoft sign-in flow used by the mcbot system."
      )
      .addFields(
        {
          name: "1️⃣ Open this page",
          value: `[${device.verificationUri}](${device.verificationUri})`,
          inline: false,
        },
        {
          name: "2️⃣ Enter this code",
          value: "```" + device.userCode + "```",
          inline: false,
        },
        {
          name: "⏰ Expires",
          value: `<t:${expiresTimestamp}:R>`,
          inline: true,
        },
        {
          name: "Minecraft username",
          value: "`" + mcName + "`",
          inline: true,
        }
      )
      .setColor(0x2196f3)
      .setFooter({
        text: "Yazanaki Empire • Account Linking Verification",
      })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });

    // Background poll (non-blocking for user)
    (async () => {
      const start = Date.now();
      let finalResult = null;

      try {
        while (Date.now() - start < LINK_VERIFICATION_TIMEOUT_MS) {
          // eslint-disable-next-line no-await-in-loop
          const res = await msauth.pollForVerification(device.token);
          if (res && res.success) {
            finalResult = res;
            break;
          }

          if (res && res.reason === "expired") {
            break;
          }

          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) =>
            setTimeout(resolve, LINK_VERIFICATION_POLL_INTERVAL_MS)
          );
        }
      } catch (err) {
        console.error("[/link] ❌ Error while polling verification:", err);
      }

      const pending = pendingLinks.get(discordId);
      pendingLinks.delete(discordId);

      if (!pending || pending.mcName !== mcName || pending.type !== sub) {
        return;
      }

      if (!finalResult || !finalResult.success) {
        try {
          await interaction.followUp({
            content:
              "❌ Link verification expired or failed. Please run the command again.",
            ephemeral: true,
          });
        } catch (err) {
          console.error("[/link] ❌ Failed to send failure follow-up:", err);
        }
        return;
      }

      // Re-run link with actual write to disk
      let linkResult;
      if (sub === "main") {
        linkResult = linklogic.linkMainAccount(discordId, mcName, {
          dryRun: false,
        });
      } else {
        linkResult = linklogic.linkAltAccount(discordId, mcName, {
          dryRun: false,
        });
      }

      console.log(`[/link] 📊 Final link result after verification:`, linkResult);

      if (!linkResult.success) {
        try {
          await interaction.followUp({
            content:
              "❌ Verification succeeded, but linking failed due to a conflict (username already in use or state changed). Please try again.",
            ephemeral: true,
          });
        } catch (err) {
          console.error("[/link] ❌ Failed to send conflict follow-up:", err);
        }
        return;
      }

      if (sub === "alt") {
        try {
          addAlternateAccount(discordId, linkResult.minecraftUser);
        } catch (err) {
          console.error(
            "[/link] ⚠️ Failed to persist alt into members.json:",
            err
          );
        }
      }

      try {
        if (sub === "main") {
          await interaction.followUp({
            content:
              "✅ **Main account linked successfully after verification!**\n" +
              `**Discord:** ${interaction.user.tag}\n` +
              `**Minecraft (main):** \`${linkResult.minecraftUser}\``,
            ephemeral: false,
          });
        } else {
          await interaction.followUp({
            content:
              "✅ **Alternate account linked successfully after verification!**\n" +
              `**Discord:** ${interaction.user.tag}\n` +
              `**Minecraft (alt):** \`${linkResult.minecraftUser}\``,
            ephemeral: false,
          });
        }
      } catch (err) {
        console.error("[/link] ❌ Failed to send success follow-up:", err);
      }
    })();
  },
};