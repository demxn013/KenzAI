// Discord Bot/events/interactionCreate.js
// ✅ UPDATED: Added mcbot DM button routing before guild guard
// ✅ UPDATED: Full routing to match index.js button/modal/select handlers
// ✅ UPDATED: Added autocomplete routing for commands that support it

const { handleDraftChoice } = require("../modules/empire/draftlogic");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    const client = interaction.client;

    // ============================================================
    // ✅ DM BUTTON — mcbot confirm/reject (MUST be first)
    // These arrive from DMs where interaction.guild is null.
    // Without this early check, DM button clicks are silently dropped.
    // ============================================================
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith("mcbot_confirm_") ||
        interaction.customId.startsWith("mcbot_reject_"))
    ) {
      const mcbotCommand = client.commands.get("mcbot");
      if (mcbotCommand?.buttonHandler) {
        await mcbotCommand.buttonHandler(interaction).catch(err => {
          console.error("[interactionCreate] ❌ mcbot DM buttonHandler error:", err);
        });
      }
      return;
    }

    // ============================================================
    // AUTOCOMPLETE INTERACTIONS
    // ============================================================
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        await command.autocomplete(interaction).catch(err => {
          console.error(`[interactionCreate] ❌ Autocomplete error in /${interaction.commandName}:`, err);
        });
      }
      return;
    }

    // ============================================================
    // BUTTON INTERACTIONS
    // ============================================================
    if (interaction.isButton()) {
      // Draft choice buttons
      if (interaction.customId.startsWith("draft_")) {
        return handleDraftChoice(interaction);
      }

      // Court request buttons
      if (
        interaction.customId === "start_court_request" ||
        interaction.customId === "close_court_request" ||
        interaction.customId.startsWith("escalate_court_request_") ||
        interaction.customId.startsWith("dismiss_court_request_")
      ) {
        const courtrequestCommand = client.commands.get("courtrequest");
        if (courtrequestCommand?.buttonHandler) {
          return courtrequestCommand.buttonHandler(interaction);
        }
      }

      // Application system buttons
      if (
        interaction.customId === "start_application" ||
        interaction.customId === "close_ticket" ||
        interaction.customId.startsWith("accept_application_") ||
        interaction.customId.startsWith("reject_application_")
      ) {
        const applicationCommand = client.commands.get("application");
        if (applicationCommand?.buttonHandler) {
          return applicationCommand.buttonHandler(interaction);
        }
      }

      // Points shop / redeem buttons
      if (
        interaction.customId.startsWith("points_shop_") ||
        interaction.customId.startsWith("points_redeem_")
      ) {
        const pointsCommand = client.commands.get("points");
        if (pointsCommand?.buttonHandler) {
          return pointsCommand.buttonHandler(interaction);
        }
      }

      // Server module buttons
      if (
        interaction.customId.startsWith("server_") ||
        interaction.customId.startsWith("clan_server_") ||
        interaction.customId.startsWith("member_server_")
      ) {
        const serverCommand = client.commands.get("server");
        if (serverCommand?.buttonHandler) {
          return serverCommand.buttonHandler(interaction);
        }
      }

      return;
    }

    // ============================================================
    // STRING SELECT MENUS
    // ============================================================
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "points_select_reward") {
        const pointsCommand = client.commands.get("points");
        if (pointsCommand?.selectMenuHandler) {
          return pointsCommand.selectMenuHandler(interaction);
        }
      }
      return;
    }

    // ============================================================
    // MODAL SUBMISSIONS
    // ============================================================
    if (interaction.isModalSubmit()) {
      // Court request modals
      if (
        interaction.customId.startsWith("court_request_modal_") ||
        interaction.customId.startsWith("close_court_request_modal_")
      ) {
        const courtrequestCommand = client.commands.get("courtrequest");
        if (courtrequestCommand?.modalHandler) {
          return courtrequestCommand.modalHandler(interaction);
        }
      }

      // Application modals
      if (
        interaction.customId.startsWith("application_modal_") ||
        interaction.customId.startsWith("close_reason_modal_")
      ) {
        const applicationCommand = client.commands.get("application");
        if (applicationCommand?.modalHandler) {
          return applicationCommand.modalHandler(interaction);
        }
      }

      // Points modals
      if (
        interaction.customId.startsWith("points_customrole_modal_") ||
        interaction.customId.startsWith("points_nickname_modal_") ||
        interaction.customId.startsWith("points_clan_build_modal_")
      ) {
        const pointsCommand = client.commands.get("points");
        if (pointsCommand?.modalHandler) {
          return pointsCommand.modalHandler(interaction);
        }
      }

      return;
    }

    // ============================================================
    // SLASH COMMANDS
    // ============================================================
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[interactionCreate] ❌ Error in /${interaction.commandName}:`, error);
        const errorMessage = { content: "❌ Error executing this command.", flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    }
  },
};