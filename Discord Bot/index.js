// index.js
// ✅ FIXED: Smart command deployment - only deploys when needed

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// ✅ DRAFT SYSTEM IMPORTS
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
// ✅ AUTO-CLEAR MODE (Set to true ONCE to clear duplicates)
// ============================================================
const AUTO_CLEAR_COMMANDS = true; // ✅ SET TO TRUE, restart bot, then SET BACK TO FALSE

// ============================================================
// ✅ FORCE DEPLOY COMMANDS (Set to true ONCE to force deploy commands)
// ============================================================
const FORCE_DEPLOY = true; 

// ============================================================
// COMMAND DEPLOYMENT MODE
// ============================================================
// Set to 'all-guilds' to deploy to every server (instant updates)
// Set to 'global' for global commands (1-hour propagation)
const DEPLOYMENT_MODE = 'all-guilds'; // ✅ DEPLOY TO ALL GUILDS

// ============================================================
// ✅ SMART COMMAND DEPLOYMENT (prevents duplicates)
// ============================================================
async function deployCommands(force = false) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 LOADING COMMANDS...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const commands = [];
  const commandFolders = fs.readdirSync('./modules');

  // Load all commands
  for (const folder of commandFolders) {
    const folderPath = path.join('./modules', folder);
    
    if (!fs.statSync(folderPath).isDirectory()) continue;
    
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      
      try {
        // Clear cache to get latest version
        delete require.cache[require.resolve(`./${filePath}`)];
        
        const command = require(`./${filePath}`);
        
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          commands.push(command.data.toJSON());
          console.log(`✅ Loaded: /${command.data.name} (from ${folder}/${file})`);
        }
      } catch (err) {
        console.warn(`⚠️ Failed to load ${folder}/${file}:`, err.message);
      }
    }
  }

  if (commands.length === 0) {
    console.error('❌ No commands loaded!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }

  // ============================================================
  // CHECK IF DEPLOYMENT IS NEEDED
  // ============================================================
  const commandsHash = crypto
    .createHash('md5')
    .update(JSON.stringify(commands))
    .digest('hex');

  const hashFile = path.join(__dirname, '.commands-hash');
  let lastHash = '';
  
  if (fs.existsSync(hashFile)) {
    lastHash = fs.readFileSync(hashFile, 'utf8').trim();
  }

  // ✅ Check if deployment should be skipped (unless forced)
  if (!force && !FORCE_DEPLOY && commandsHash === lastHash) {
    console.log('✅ Commands unchanged - skipping deployment');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return;
  }
  
  if (FORCE_DEPLOY && !force) {
    console.log('⚡ FORCE_DEPLOY enabled - deploying regardless of changes\n');
  }

  // ============================================================
  // DEPLOY TO DISCORD
  // ============================================================
  try {
    const rest = new REST().setToken(process.env.TOKEN);
    
    console.log(`\n🔄 Deploying ${commands.length} commands in ${DEPLOYMENT_MODE.toUpperCase()} mode...`);
    
    if (DEPLOYMENT_MODE === 'all-guilds') {
      // ✅ GET FRESH GUILD LIST
      console.log('📡 Fetching latest guild list from Discord...');
      
      const fetchedGuilds = await client.guilds.fetch();
      console.log(`📍 Target: ${fetchedGuilds.size} guild(s)`);
      console.log(`⚡ Updates: INSTANT\n`);
      
      if (fetchedGuilds.size === 0) {
        console.error('❌ Bot is not in any guilds!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
      }
      
      let successCount = 0;
      let failCount = 0;
      
      for (const [guildId, partialGuild] of fetchedGuilds) {
        try {
          // Fetch full guild data
          const guild = await client.guilds.fetch(guildId);
          
          await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: commands },
          );
          
          console.log(`   ✅ ${guild.name} (${guildId})`);
          successCount++;
          
        } catch (error) {
          console.error(`   ❌ ${partialGuild.name || guildId}: ${error.message}`);
          failCount++;
        }
      }
      
      console.log(`\n📊 Deployment Summary:`);
      console.log(`   ✅ Success: ${successCount}`);
      if (failCount > 0) console.log(`   ❌ Failed: ${failCount}`);
      
    } else {
      // GLOBAL MODE (1 hour propagation)
      console.log(`🌍 Target: All guilds (global)`);
      console.log(`⏰ Propagation time: Up to 1 hour`);
      
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );
      
      console.log(`✅ Deployed ${data.length} commands globally!`);
    }

    // Save hash to prevent unnecessary deployments
    fs.writeFileSync(hashFile, commandsHash);

    console.log(`\n📋 Registered ${commands.length} commands:`);
    commands.forEach(cmd => {
      console.log(`   - /${cmd.name}`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
    console.error('Full error:', error.message);
  }
}

// ============================================================
// ✅ COMMAND TO CLEAR DUPLICATES
// ============================================================
async function clearDuplicateCommands() {
  console.log('🧹 Clearing duplicate commands...\n');
  
  const rest = new REST().setToken(process.env.TOKEN);
  
  try {
    // Clear global commands first (in case you had any)
    console.log('🌍 Clearing global commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );
    console.log('✅ Global commands cleared\n');
    
    // Clear guild commands from all guilds
    if (DEPLOYMENT_MODE === 'all-guilds') {
      // ✅ FETCH FRESH GUILD LIST
      console.log('📡 Fetching all guilds from Discord...');
      
      const fetchedGuilds = await client.guilds.fetch();
      console.log(`📍 Clearing commands from ${fetchedGuilds.size} guild(s)...\n`);
      
      for (const [guildId, partialGuild] of fetchedGuilds) {
        try {
          const guild = await client.guilds.fetch(guildId);
          
          await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
            { body: [] }
          );
          console.log(`   ✅ Cleared: ${guild.name}`);
        } catch (error) {
          console.error(`   ❌ Failed: ${partialGuild.name || guildId} - ${error.message}`);
        }
      }
      
      console.log('\n✅ All guild commands cleared!\n');
    }
    
  } catch (error) {
    console.error('❌ Error clearing commands:', error);
  }
}

// ============================================================
// READY EVENT
// ============================================================
client.on('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  
  // ✅ FORCE FETCH ALL GUILDS FIRST
  console.log('\n📡 Scanning all guilds bot is in...');
  
  try {
    // Fetch fresh guild list from Discord API
    const fetchedGuilds = await client.guilds.fetch();
    console.log(`✅ Found ${fetchedGuilds.size} guild(s):\n`);
    
    // List all guilds
    for (const [id, guild] of fetchedGuilds) {
      const fullGuild = await client.guilds.fetch(id);
      console.log(`   - ${fullGuild.name} (${id})`);
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Failed to fetch guilds:', error.message);
  }
  
  // Wait a bit more to ensure everything is cached
  console.log('⏳ Waiting 3 seconds for cache to stabilize...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // ✅ AUTO-CLEAR MODE - ONLY CLEARS, DOES NOT DEPLOY
  if (AUTO_CLEAR_COMMANDS) {
    console.log('⚠️⚠️⚠️ AUTO-CLEAR MODE ENABLED ⚠️⚠️⚠️');
    console.log('This will DELETE ALL COMMANDS\n');
    await clearDuplicateCommands();
    console.log('\n✅ COMMANDS CLEARED!');
    console.log('⚠️ Set AUTO_CLEAR_COMMANDS = false and restart to deploy commands\n');
  } else {
    // ✅ NORMAL MODE - DEPLOYS COMMANDS
    await deployCommands();
  }
  
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
    
    // ✅ DRAFT CHOICE BUTTONS
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