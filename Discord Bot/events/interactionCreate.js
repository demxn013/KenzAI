// Discord Bot/events/interactionCreate.js
// ✅ Single authoritative handler for ALL Discord interactions.
// Loaded by the event loader in index.js — do NOT also add
// client.on('interactionCreate', ...) in index.js or anywhere else.

const { handleDraftChoice } = require("../modules/empire/draftlogic");

// ============================================================
// HELPERS
// ============================================================

async function safeErrorReply(interaction, message = "❌ An error occurred. Please try again or contact staff.") {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  } catch (err) {
    console.error("[interactionCreate] safeErrorReply failed:", err.message);
  }
}

async function commandNotLoadedReply(interaction, commandName) {
  console.error(`[interactionCreate] ❌ Command "${commandName}" not loaded — cannot handle "${interaction.customId}"`);
  await safeErrorReply(interaction, `❌ This button is temporarily unavailable (\`${commandName}\` module failed to load). Please contact staff.`);
}

// ============================================================
// MAIN HANDLER
// ============================================================

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    const client = interaction.client;

    // ----------------------------------------------------------
    // DM BUTTONS — mcbot confirm/reject (must be first)
    // These arrive from DMs where interaction.guild is null.
    // ----------------------------------------------------------
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith("mcbot_confirm_") ||
        interaction.customId.startsWith("mcbot_reject_"))
    ) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[interactionCreate] 📬 DM button: ${interaction.customId} from ${interaction.user.tag}`);
      const mcbotCommand = client.commands.get("mcbot");
      if (mcbotCommand?.buttonHandler) {
        try {
          await mcbotCommand.buttonHandler(interaction);
        } catch (err) {
          console.error("[interactionCreate] ❌ mcbot DM buttonHandler error:", err);
        }
      }
      return;
    }

    // ----------------------------------------------------------
    // AUTOCOMPLETE
    // ----------------------------------------------------------
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          console.error(`[interactionCreate] ❌ Autocomplete error in /${interaction.commandName}:`, err);
        }
      }
      return;
    }

    // ----------------------------------------------------------
    // BUTTONS
    // ----------------------------------------------------------
    if (interaction.isButton()) {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[interactionCreate] 🔘 Button: ${interaction.customId} from ${interaction.user.tag} (${interaction.user.id})`);

      try {

        // Draft choice buttons
        if (interaction.customId.startsWith("draft_")) {
          return await handleDraftChoice(interaction);
        }

        // Court request buttons
        if (
          interaction.customId === "start_court_request" ||
          interaction.customId === "close_court_request" ||
          interaction.customId.startsWith("escalate_court_request_") ||
          interaction.customId.startsWith("dismiss_court_request_")
        ) {
          const cmd = client.commands.get("courtrequest");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "courtrequest");
          return await cmd.buttonHandler(interaction);
        }

        // Application system buttons
        if (
          interaction.customId === "start_application" ||
          interaction.customId === "close_ticket" ||
          interaction.customId.startsWith("accept_application_") ||
          interaction.customId.startsWith("reject_application_")
        ) {
          const cmd = client.commands.get("application");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "application");
          return await cmd.buttonHandler(interaction);
        }

        // Points shop / redeem buttons
        if (
          interaction.customId.startsWith("points_shop_") ||
          interaction.customId.startsWith("points_redeem_")
        ) {
          const cmd = client.commands.get("points");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "points");
          return await cmd.buttonHandler(interaction);
        }

        // Server module buttons
        if (
          interaction.customId.startsWith("server_") ||
          interaction.customId.startsWith("clan_server_") ||
          interaction.customId.startsWith("member_server_")
        ) {
          console.log(`[interactionCreate] 🔁 Routing to servers module for ${interaction.customId}`);
          const cmd = client.commands.get("server");
          if (!cmd?.buttonHandler) return commandNotLoadedReply(interaction, "server");
          return await cmd.buttonHandler(interaction);
        }

        console.warn(`[interactionCreate] ⚠️ Unhandled button ID: ${interaction.customId}`);

      } catch (err) {
        console.error(`[interactionCreate] ❌ Button handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }

      return;
    }

    // ----------------------------------------------------------
    // STRING SELECT MENUS
    // ----------------------------------------------------------
    if (interaction.isStringSelectMenu()) {
      try {
        if (interaction.customId === "points_select_reward") {
          const cmd = client.commands.get("points");
          if (!cmd?.selectMenuHandler) return commandNotLoadedReply(interaction, "points");
          return await cmd.selectMenuHandler(interaction);
        }
        console.warn(`[interactionCreate] ⚠️ Unhandled select menu ID: ${interaction.customId}`);
      } catch (err) {
        console.error(`[interactionCreate] ❌ Select menu handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }
      return;
    }

    // ----------------------------------------------------------
    // MODAL SUBMISSIONS
    // ----------------------------------------------------------
    if (interaction.isModalSubmit()) {
      console.log(`[interactionCreate] 📝 Modal: ${interaction.customId} from ${interaction.user.tag}`);

      try {

        // Court request modals
        if (
          interaction.customId.startsWith("court_request_modal_") ||
          interaction.customId.startsWith("close_court_request_modal_")
        ) {
          const cmd = client.commands.get("courtrequest");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "courtrequest");
          return await cmd.modalHandler(interaction);
        }

        // Application modals
        if (
          interaction.customId.startsWith("application_modal_") ||
          interaction.customId.startsWith("close_reason_modal_")
        ) {
          const cmd = client.commands.get("application");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "application");
          return await cmd.modalHandler(interaction);
        }

        // Points modals
        if (
          interaction.customId.startsWith("points_customrole_modal_") ||
          interaction.customId.startsWith("points_nickname_modal_") ||
          interaction.customId.startsWith("points_clan_build_modal_")
        ) {
          const cmd = client.commands.get("points");
          if (!cmd?.modalHandler) return commandNotLoadedReply(interaction, "points");
          return await cmd.modalHandler(interaction);
        }

        console.warn(`[interactionCreate] ⚠️ Unhandled modal ID: ${interaction.customId}`);

      } catch (err) {
        console.error(`[interactionCreate] ❌ Modal handler threw for "${interaction.customId}":`, err);
        await safeErrorReply(interaction);
      }

      return;
    }

    // ----------------------------------------------------------
    // SLASH COMMANDS
    // ----------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        console.warn(`[interactionCreate] ⚠️ No command found: ${interaction.commandName}`);
        return interaction.reply({ content: "❌ Command not found!", ephemeral: true });
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[interactionCreate] ❌ Error executing /${interaction.commandName}:`, error);
        const errorMessage = { content: "❌ An error occurred while executing this command.", ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage).catch(() => {});
        } else {
          await interaction.reply(errorMessage).catch(() => {});
        }
      }
    }
  },
};