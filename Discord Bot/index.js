// index.js or bot.js
// ✅ Example main bot file with SIMPLIFIED draft system integration

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
// ✅ DRAFT SYSTEM IMPORTS (SIMPLIFIED - Only 2 imports!)
// ============================================================
const { startScheduler } = require('./modules/empire/draftscheduler');
const { handleDraftChoice } = require('./modules/empire/draftlogic');

// ============================================================
// CLIENT SETUP
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// ============================================================
// LOAD COMMANDS
// ============================================================
const commandFolders = fs.readdirSync('./modules');

for (const folder of commandFolders) {
  const folderPath = path.join('./modules', folder);
  
  if (!fs.statSync(folderPath).isDirectory()) continue;
  
  const commandFiles = fs.readdirSync(folderPath).filter(file => 
    file.endsWith('.js') && 
    (file.endsWith('-command.js') || file === 'ping.js' || file === 'member.js' || file === 'application.js' || file === 'clan.js' || file === 'link.js' || file === 'roles.js')
  );
  
  for (const file of commandFiles) {
    const filePath = path.join(folderPath, file);
    const command = require(filePath);
    
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`✅ Loaded command: ${command.data.name}`);
    }
  }
}

// ============================================================
// READY EVENT
// ============================================================
client.on('ready', () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log(`🌐 Serving ${client.guilds.cache.size} guilds`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // ============================================================
  // ✅ START DRAFT SCHEDULER
  // ============================================================
  console.log("🎖️ Starting draft system...");
  startScheduler(client);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
});

// ============================================================
// INTERACTION HANDLER
// ============================================================
client.on('interactionCreate', async (interaction) => {
  
  // ============================================================
  // BUTTON INTERACTIONS
  // ============================================================
  if (interaction.isButton()) {
    
    // ✅ DRAFT CHOICE BUTTONS (Now handled in draftlogic.js!)
    if (interaction.customId.startsWith('draft_')) {
      return handleDraftChoice(interaction);
    }
    
    // Application system buttons
    if (interaction.customId === 'start_application' ||
        interaction.customId === 'close_ticket' ||
        interaction.customId.startsWith('accept_application_') ||
        interaction.customId.startsWith('reject_application_')) {
      
      const applicationCommand = client.commands.get('application');
      if (applicationCommand && applicationCommand.buttonHandler) {
        return applicationCommand.buttonHandler(interaction);
      }
    }
  }
  
  // ============================================================
  // MODAL SUBMISSIONS
  // ============================================================
  if (interaction.isModalSubmit()) {
    
    // Application modals
    if (interaction.customId.startsWith('application_modal_') ||
        interaction.customId.startsWith('close_reason_modal_')) {
      
      const applicationCommand = client.commands.get('application');
      if (applicationCommand && applicationCommand.modalHandler) {
        return applicationCommand.modalHandler(interaction);
      }
    }
  }
  
  // ============================================================
  // SLASH COMMANDS
  // ============================================================
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    
    if (!command) {
      console.warn(`⚠️ No command found: ${interaction.commandName}`);
      return interaction.reply({
        content: '❌ Command not found!',
        ephemeral: true
      });
    }
    
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`❌ Error executing ${interaction.commandName}:`, error);
      
      const errorMessage = {
        content: '❌ An error occurred while executing this command.',
        ephemeral: true
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================
client.on('error', error => {
  console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled promise rejection:', error);
});

// ============================================================
// LOGIN
// ============================================================
const token = process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE';

client.login(token).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});