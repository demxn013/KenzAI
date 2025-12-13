// modules/linking/linklogic.js
const fs = require("fs");
const path = require("path");

// applicants module (needed for autolinking support)
const applicants = require("../applications/applicants");

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'linking.json');

function ensureDataFile() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
      return {};
    }

    const raw = fs.readFileSync(dataFile, "utf8");
    if (!raw || !raw.trim()) {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
      return {};
    }

    return JSON.parse(raw);

  } catch (err) {
    console.error("linklogic.ensureDataFile error:", err);

    try {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
    } catch (e) {}

    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("linklogic.saveData error:", err);
  }
}

/**
 * Link a Discord account to a Minecraft username.
 * - discordId: Discord user ID
 * - mcName: Minecraft username (original casing preserved)
 */
function linkMember(discordId, mcName, opts = {}) {
  const data = ensureDataFile();

  if (!discordId) {
    return { success: false, reason: "invalid_arguments" };
  }

  // Pull from applicants if mcName not provided
  if (!mcName) {
    const app = applicants.getApplicant(discordId);
    if (app && app.minecraftName) {
      mcName = app.minecraftName; // preserve original case
    } else {
      return { success: false, reason: "no_mcname_provided" };
    }
  }

  const mcKey = mcName.toLowerCase();

  // Check if Discord already linked
  const existingDiscord = data[discordId];
  if (existingDiscord) {
    return {
      success: false,
      reason: "already_linked",
      details: { discordId, minecraftUser: existingDiscord.minecraftUser }
    };
  }

  // Check if Minecraft username already linked by scanning all entries
  const usernameTaken = Object.values(data).some(
    (v) => v.minecraftUser.toLowerCase() === mcKey
  );
  if (usernameTaken) {
    return {
      success: false,
      reason: "username_used",
      details: { minecraftUser: mcName }
    };
  }

  // Save only **one entry keyed by Discord ID**
  data[discordId] = { discordId, minecraftUser: mcName };

  saveData(data);

  return { success: true, discordId, minecraftUser: mcName };
}

// Lookup helpers
function getMCFromDiscord(discordId) {
  const data = ensureDataFile();
  return data[discordId]?.minecraftUser || null;
}

function getDiscordFromMC(mcName) {
  if (!mcName) return null;
  const data = ensureDataFile();
  const mcKey = mcName.toLowerCase();

  // Find Discord ID by scanning all entries
  const entry = Object.values(data).find(
    (v) => v.minecraftUser.toLowerCase() === mcKey
  );

  return entry?.discordId || null;
}

module.exports = {
  linkMember,
  getMCFromDiscord,
  getDiscordFromMC,
  _ensureDataFile: ensureDataFile,
  _saveData: saveData
};
