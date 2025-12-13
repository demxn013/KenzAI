require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits, REST, Routes } = require("discord.js");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// Recursive loader for modules
function loadModuleFiles(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files = files.concat(loadModuleFiles(fullPath));
    } else if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Load modules
const modulesPath = path.join(__dirname, "modules");
const moduleFiles = loadModuleFiles(modulesPath);

const commands = [];
for (const file of moduleFiles) {
  const command = require(file);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    commands.push(command.data.toJSON());
  }
}

// Load events
const eventsPath = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith(".js"))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

// Deploy guild commands for every server the bot is in
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    for (const guild of client.guilds.cache.values()) {
      console.log(`🔄 Registering commands in guild: ${guild.name} (${guild.id})`);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
        { body: commands }
      );
      console.log(`✅ Commands registered in guild: ${guild.name}`);
    }

    console.log("🎉 All guild commands refreshed!");
  } catch (error) {
    console.error("❌ Error reloading commands:", error);
  }
});

client.login(process.env.TOKEN);
