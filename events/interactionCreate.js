module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    const client = interaction.client;

    // --- Slash Commands ---
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "❌ Error executing this command.", flags: 64 });
        } else {
          await interaction.reply({ content: "❌ Error executing this command.", flags: 64 });
        }
      }
      return;
    }

    // --- Buttons ---
    if (interaction.isButton()) {
      const command = client.commands.get("application"); // our application module
      if (command?.buttonHandler) {
        try {
          await command.buttonHandler(interaction);
        } catch (err) {
          console.error("Button handler error:", err);
        }
      }
      return;
    }

    // --- Modal Submissions ---
    if (interaction.isModalSubmit()) {
      const command = client.commands.get("application"); // our application module
      if (command?.modalHandler) {
        try {
          await command.modalHandler(interaction);
        } catch (err) {
          console.error("Modal handler error:", err);
        }
      }
      return;
    }
  },
};
