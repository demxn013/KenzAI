// index.js
// ✅ Auto-deploys commands with DETAILED DEBUG LOGGING

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
// ✅ AUTO-DEPLOY COMMANDS FUNCTION (WITH DEBUG LOGGING)
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
        const jsonData = command.data.toJSON();
        commands.push(jsonData);
        console.log(`✅ Loaded command: ${command.data.name}`);
        
        // ✅ DEBUG: Show full structure of clan command
        if (command.data.name === 'clan') {
          console.log('\n🔍 DEBUG: Full clan command structure:');
          console.log(JSON.stringify(jsonData, null, 2));
          console.log('\n🔍 Checking setrole subcommand...');
          const setrole = jsonData.options?.find(opt => opt.name === 'setrole');
          if (setrole) {
            console.log('✅ Found setrole subcommand');
            console.log('📋 Setrole options:', JSON.stringify(setrole.options, null, 2));
            const typeOption = setrole.options?.find(opt => opt.name === 'type');
            if (typeOption) {
              console.log('✅ TYPE OPTION FOUND:', JSON.stringify(typeOption, null, 2));
            } else {
              console.log('❌ TYPE OPTION MISSING FROM SETROLE!');
            }
          } else {
            console.log('❌ setrole subcommand not found!');
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
      }
    }
  }

  // Deploy to Discord with FORCE REFRESH
  try {
    const rest = new REST().setToken(process.env.TOKEN);
    
    console.log(`\n🔄 Clearing old commands...`);
    
    // ✅ STEP 1: DELETE ALL EXISTING COMMANDS (force refresh)
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );
    
    console.log(`✅ Old commands cleared!`);
    
    // ✅ STEP 2: DEPLOY NEW COMMANDS
    console.log(`\n🔄 Deploying ${commands.length} new commands...`);
    
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log(`✅ Successfully deployed ${data.length} commands!`);
    console.log('\n📋 Registered commands:');
    data.forEach(cmd => {
      console.log(`   - /${cmd.name}`);
      
      // ✅ DEBUG: Verify clan command in Discord's response
      if (cmd.name === 'clan') {
        console.log('\n🔍 DEBUG: Discord\'s response for clan command:');
        console.log(JSON.stringify(cmd, null, 2));
        const setrole = cmd.options?.find(opt => opt.name === 'setrole');
        if (setrole) {
          console.log('\n🔍 Setrole in Discord response:', JSON.stringify(setrole.options, null, 2));
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      }
    });
    console.log('\n⚠️ Commands may take 1-5 minutes to update in Discord');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
    console.error('Full error:', error.message);
    if (error.rawError) {
      console.error('Raw error:', JSON.stringify(error.rawError, null, 2));
    }
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
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🤖 YAZANAKI EMPIRE BOT STARTING...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📁 Directory:', __dirname);
console.log('🔑 Token:', process.env.TOKEN ? `Loaded (${process.env.TOKEN.length} chars)` : '❌ NOT FOUND');
console.log('🆔 Client ID:', process.env.CLIENT_ID ? `Loaded (${process.env.CLIENT_ID})` : '❌ NOT FOUND');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!process.env.TOKEN) {
  console.error('❌ TOKEN not found in environment variables!');
  console.error('Make sure .env file exists with TOKEN=your_bot_token');
  process.exit(1);
}

if (!process.env.CLIENT_ID) {
  console.error('❌ CLIENT_ID not found in environment variables!');
  console.error('Add CLIENT_ID=your_application_id to your .env file');
  console.error('Find it at: Discord Developer Portal → Your App → General Information → Application ID');
  process.exit(1);
}

client.login(process.env.TOKEN).catch(error => {
  console.error('❌ Failed to login:', error);
  process.exit(1);
});