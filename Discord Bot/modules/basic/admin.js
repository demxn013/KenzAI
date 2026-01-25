// modules/basic/admin-command.js
// ✅ Admin command to fix duplicate commands

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Bot administration commands")
    .addSubcommand(sub =>
      sub
        .setName("list-commands")
        .setDescription("List all registered commands")
    )
    .addSubcommand(sub =>
      sub
        .setName("clear-commands")
        .setDescription("⚠️ DELETE ALL registered commands")
    )
    .addSubcommand(sub =>
      sub
        .setName("redeploy-commands")
        .setDescription("Force redeploy all commands (fixes duplicates)")
    ),

  async execute(interaction) {
    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "❌ You need **Administrator** permission.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();
    const rest = new REST().setToken(process.env.TOKEN);

    // ============================================================
    // LIST COMMANDS
    // ============================================================
    if (sub === "list-commands") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const commands = await rest.get(
          Routes.applicationCommands(process.env.CLIENT_ID)
        );

        if (commands.length === 0) {
          return interaction.editReply({
            content: "📋 No commands registered.",
            ephemeral: true
          });
        }

        const embed = new EmbedBuilder()
          .setTitle("📋 Registered Commands")
          .setDescription(`Total: **${commands.length}** command(s)`)
          .setColor(0x000000);

        // Count duplicates
        const commandCounts = {};
        commands.forEach(cmd => {
          commandCounts[cmd.name] = (commandCounts[cmd.name] || 0) + 1;
        });

        let commandList = '';
        for (const [name, count] of Object.entries(commandCounts)) {
          if (count > 1) {
            commandList += `⚠️ \`/${name}\` **(${count} duplicates!)**\n`;
          } else {
            commandList += `✅ \`/${name}\`\n`;
          }
        }

        embed.addFields({ name: "Commands", value: commandList, inline: false });

        const hasDuplicates = Object.values(commandCounts).some(count => count > 1);
        if (hasDuplicates) {
          embed.addFields({
            name: "⚠️ Duplicates Found!",
            value: "Use `/admin redeploy-commands` to fix",
            inline: false
          });
        }

        return interaction.editReply({ embeds: [embed], ephemeral: true });

      } catch (error) {
        console.error("[admin] List error:", error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      }
    }

    // ============================================================
    // CLEAR COMMANDS
    // ============================================================
    if (sub === "clear-commands") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const commands = await rest.get(
          Routes.applicationCommands(process.env.CLIENT_ID)
        );

        if (commands.length === 0) {
          return interaction.editReply({
            content: "✅ No commands to clear!",
            ephemeral: true
          });
        }

        await rest.put(
          Routes.applicationCommands(process.env.CLIENT_ID),
          { body: [] }
        );

        const embed = new EmbedBuilder()
          .setTitle("🗑️ Commands Cleared")
          .setDescription(
            `Deleted **${commands.length}** command(s).\n\n` +
            `**Next:** Use \`/admin redeploy-commands\` or restart bot`
          )
          .setColor(0xFF0000);

        return interaction.editReply({ embeds: [embed], ephemeral: true });

      } catch (error) {
        console.error("[admin] Clear error:", error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      }
    }

    // ============================================================
    // REDEPLOY COMMANDS
    // ============================================================
    if (sub === "redeploy-commands") {
      await interaction.deferReply({ ephemeral: true });

      try {
        // Load all command files
        const commands = [];
        const commandFolders = fs.readdirSync('./modules');

        for (const folder of commandFolders) {
          const folderPath = path.join('./modules', folder);
          
          if (!fs.statSync(folderPath).isDirectory()) continue;
          
          const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
          
          for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            
            try {
              // Clear cache
              delete require.cache[require.resolve(`../../${filePath}`)];
              
              const command = require(`../../${filePath}`);
              
              if ('data' in command && 'execute' in command) {
                commands.push(command.data.toJSON());
              }
            } catch (err) {
              console.error(`Failed to load ${folder}/${file}:`, err.message);
            }
          }
        }

        if (commands.length === 0) {
          return interaction.editReply({
            content: "❌ No commands found!",
            ephemeral: true
          });
        }

        // Deploy
        const data = await rest.put(
          Routes.applicationCommands(process.env.CLIENT_ID),
          { body: commands }
        );

        const embed = new EmbedBuilder()
          .setTitle("✅ Commands Redeployed")
          .setDescription(`Deployed **${data.length}** command(s).\n\nDuplicates removed!`)
          .setColor(0x00AA00);

        const commandList = data.map(cmd => `✅ \`/${cmd.name}\``).join('\n');
        embed.addFields({ name: "Commands", value: commandList, inline: false });

        return interaction.editReply({ embeds: [embed], ephemeral: true });

      } catch (error) {
        console.error("[admin] Redeploy error:", error);
        return interaction.editReply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      }
    }
  }
};