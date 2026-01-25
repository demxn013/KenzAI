// index.js
// ✅ Auto-deploys commands on startup

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
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
// ✅ AUTO-DEPLOY COMMANDS FUNCTION
// ============================================================
async function deployCommands() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 AUTO-DEPLOYING COMMANDS TO DISCORD...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const commands = [];
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
      const command = require(`./${filePath}`);
      
      if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded command: ${command.data.name}`);
      }
    }
  }

  // Deploy to Discord
  try {
    const rest = new REST().setToken(process.env.TOKEN);
    
    console.log(`\n🔄 Pushing ${commands.length} commands to Discord...`);
    
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log(`✅ Successfully deployed ${data.length} commands!`);
    console.log('\n📋 Registered commands:');
    data.forEach(cmd => {
      console.log(`   - /${cmd.name}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
  }
}

// ============================================================
// READY EVENT
// ============================================================
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  // ✅ AUTO-DEPLOY COMMANDS ON STARTUP
  await deployCommands();
  
  // ============================================================
  // ✅ START DRAFT SCHEDULER
  // ============================================================
  console.log("🎖️ Starting draft system...");
  startScheduler(client);
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
console.log('🔐 Attempting to login...');
console.log('📁 Current directory:', __dirname);
console.log('🔑 Token loaded:', process.env.TOKEN ? `Yes (${process.env.TOKEN.length} chars)` : 'NO - TOKEN NOT FOUND');
console.log('🆔 Client ID loaded:', process.env.CLIENT_ID ? 'Yes' : 'No');

if (!process.env.TOKEN) {
  console.error('❌ TOKEN not found in environment variables!');
  console.error('Make sure .env file exists in:', __dirname);
  process.exit(1);
}

if (!process.env.CLIENT_ID) {
  console.error('❌ CLIENT_ID not found in environment variables!');
  console.error('Add CLIENT_ID to your .env file');
  process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});