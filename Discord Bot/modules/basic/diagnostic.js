// modules/basic/diagnostic.js
// ✅ Simple test to see if commands are loading

const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("diagnostic")
    .setDescription("Test if new commands are loading"),
    
  async execute(interaction) {
    await interaction.reply({
      content: "✅ Diagnostic command is working! This means new commands CAN be loaded.",
      ephemeral: true
    });
  },
};