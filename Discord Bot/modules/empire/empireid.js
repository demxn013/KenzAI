// modules/empire/empireid.js
// ✅ Empire ID Management System
// Format: ABBR-XXXXXX (e.g., SNU-000014, YZNK-000001)
// - IDs 1-13: RESERVED for special members (YZNK prefix)
// - IDs 14+: Sequential, empire-wide, with clan abbreviation
// - IDs are PERMANENT and stick to the member forever

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const empireIdsPath = path.join(dataDir, "empireids.json");
const membersPath = path.join(dataDir, "members.json");
const clansPath = path.join(dataDir, "clans.json");

// Constants
const EMPIRE_ABBR = "YZNK";
const RESERVED_COUNT = 13;
const ID_LENGTH = 6; // Total digits in the number part (e.g., 000014)

/**
 * Ensure empireids.json exists
 */
function ensureEmpireIdsFile() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(empireIdsPath)) {
      const defaultData = {
        nextNumber: 14, // Next available number (starts at 14, 1-13 reserved)
        ids: {
          // Structure:
          // "YZNK-000001": { discordId: "...", minecraftUser: "...", assignedAt: "...", reserved: true },
          // "SNU-000014": { discordId: "...", minecraftUser: "...", assignedAt: "...", clanAbbr: "SNU" }
        }
      };
      fs.writeFileSync(empireIdsPath, JSON.stringify(defaultData, null, 2));
      console.log("[empireid] ✅ Created empireids.json");
      return defaultData;
    }

    const raw = fs.readFileSync(empireIdsPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[empireid] ❌ Error ensuring empireids.json:", err);
    return { nextNumber: 14, ids: {} };
  }
}

/**
 * Load Empire IDs data
 */
function loadEmpireIds() {
  return ensureEmpireIdsFile();
}

/**
 * Save Empire IDs data
 */
function saveEmpireIds(data) {
  try {
    // Create backup
    if (fs.existsSync(empireIdsPath)) {
      const backupPath = empireIdsPath.replace('.json', '.backup.json');
      fs.copyFileSync(empireIdsPath, backupPath);
    }

    fs.writeFileSync(empireIdsPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error("[empireid] ❌ Failed to save empireids.json:", err);
    return false;
  }
}

/**
 * Load clans.json to get abbreviations
 */
function loadClans() {
  try {
    if (!fs.existsSync(clansPath)) {
      console.warn("[empireid] ⚠️ clans.json not found");
      return {};
    }
    
    const raw = fs.readFileSync(clansPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[empireid] ❌ Error loading clans.json:", err);
    return {};
  }
}

/**
 * Format a number as 6-digit padded string
 * @param {number} num - Number to format
 * @returns {string} Padded string (e.g., 14 -> "000014")
 */
function formatNumber(num) {
  return String(num).padStart(ID_LENGTH, '0');
}

/**
 * Create an Empire ID string
 * @param {string} abbr - Clan abbreviation or "YZNK" for reserved
 * @param {number} num - ID number
 * @returns {string} Empire ID (e.g., "SNU-000014")
 */
function createEmpireId(abbr, num) {
  return `${abbr}-${formatNumber(num)}`;
}

/**
 * Check if a member already has an Empire ID (by Discord ID OR Minecraft username)
 * Returns the existing Empire ID if found, null otherwise
 * @param {string} discordId - Discord user ID
 * @param {string} minecraftUser - Minecraft username
 * @returns {string|null} Existing Empire ID or null
 */
function getExistingEmpireId(discordId, minecraftUser) {
  const data = loadEmpireIds();
  
  // Normalize MC username for comparison
  const mcLower = minecraftUser ? minecraftUser.toLowerCase() : null;
  
  // Search through all assigned IDs
  for (const [empireId, idData] of Object.entries(data.ids)) {
    // Match by Discord ID
    if (idData.discordId === discordId) {
      console.log(`[empireid] 🔍 Found existing ID by Discord: ${empireId}`);
      return empireId;
    }
    
    // Match by Minecraft username (case-insensitive)
    if (mcLower && idData.minecraftUser && 
        idData.minecraftUser.toLowerCase() === mcLower) {
      console.log(`[empireid] 🔍 Found existing ID by MC: ${empireId}`);
      return empireId;
    }
  }
  
  return null;
}

/**
 * Assign a new Empire ID to a member
 * If member already has an ID, returns their existing ID
 * @param {string} discordId - Discord user ID
 * @param {string} minecraftUser - Minecraft username
 * @param {string} clanGuildId - Discord guild ID of the clan they're joining
 * @returns {Object} { success: boolean, empireId: string, isReturning: boolean, reason?: string }
 */
function assignEmpireId(discordId, minecraftUser, clanGuildId) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[empireid] 🎯 Assigning Empire ID`);
  console.log(`  Discord ID: ${discordId}`);
  console.log(`  Minecraft: ${minecraftUser}`);
  console.log(`  Clan Guild: ${clanGuildId}`);

  // Check if member already has an Empire ID
  const existingId = getExistingEmpireId(discordId, minecraftUser);
  
  if (existingId) {
    console.log(`[empireid] ♻️ Member is returning! Restoring ID: ${existingId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return {
      success: true,
      empireId: existingId,
      isReturning: true
    };
  }

  // Get clan abbreviation
  const clans = loadClans();
  const clan = clans[clanGuildId];
  
  if (!clan || !clan.abbr) {
    console.error(`[empireid] ❌ Clan not found for guild ${clanGuildId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return {
      success: false,
      reason: "clan_not_found"
    };
  }

  const clanAbbr = clan.abbr.toUpperCase();
  console.log(`  Clan Abbr: ${clanAbbr}`);

  // Load Empire ID data
  const data = loadEmpireIds();
  
  // Get next available number
  const nextNum = data.nextNumber;
  
  // Create the Empire ID
  const empireId = createEmpireId(clanAbbr, nextNum);
  
  console.log(`[empireid] ✨ Creating NEW Empire ID: ${empireId}`);

  // Store the assignment
  data.ids[empireId] = {
    discordId,
    minecraftUser,
    clanAbbr,
    assignedAt: new Date().toISOString(),
    reserved: false
  };

  // Increment next number
  data.nextNumber = nextNum + 1;

  // Save
  const saved = saveEmpireIds(data);
  
  if (!saved) {
    console.error(`[empireid] ❌ Failed to save Empire ID`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return {
      success: false,
      reason: "save_failed"
    };
  }

  console.log(`[empireid] ✅ Successfully assigned: ${empireId}`);
  console.log(`[empireid] 📊 Next available number: ${data.nextNumber}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return {
    success: true,
    empireId,
    isReturning: false
  };
}

/**
 * Reserve a YZNK Empire ID (for the first 13 special members)
 * @param {number} reservedNum - Number from 1-13
 * @param {string} discordId - Discord user ID (optional, can be assigned later)
 * @param {string} minecraftUser - Minecraft username (optional, can be assigned later)
 * @returns {Object} { success: boolean, empireId: string, reason?: string }
 */
function reserveEmpireId(reservedNum, discordId = null, minecraftUser = null) {
  console.log(`[empireid] 🔒 Reserving YZNK ID: ${reservedNum}`);

  if (reservedNum < 1 || reservedNum > RESERVED_COUNT) {
    console.error(`[empireid] ❌ Invalid reserved number: ${reservedNum} (must be 1-${RESERVED_COUNT})`);
    return {
      success: false,
      reason: "invalid_reserved_number"
    };
  }

  const data = loadEmpireIds();
  const empireId = createEmpireId(EMPIRE_ABBR, reservedNum);

  // Check if already reserved
  if (data.ids[empireId]) {
    console.warn(`[empireid] ⚠️ ${empireId} already reserved`);
    return {
      success: false,
      reason: "already_reserved",
      empireId
    };
  }

  // Reserve the ID
  data.ids[empireId] = {
    discordId,
    minecraftUser,
    clanAbbr: EMPIRE_ABBR,
    assignedAt: new Date().toISOString(),
    reserved: true
  };

  const saved = saveEmpireIds(data);

  if (!saved) {
    return {
      success: false,
      reason: "save_failed"
    };
  }

  console.log(`[empireid] ✅ Reserved: ${empireId}`);
  return {
    success: true,
    empireId
  };
}

/**
 * Update a reserved Empire ID with Discord/MC info
 * @param {string} empireId - Empire ID (e.g., "YZNK-000001")
 * @param {string} discordId - Discord user ID
 * @param {string} minecraftUser - Minecraft username
 * @returns {Object} { success: boolean, reason?: string }
 */
function updateReservedId(empireId, discordId = null, minecraftUser = null) {
  console.log(`[empireid] 🔄 Updating reserved ID: ${empireId}`);

  const data = loadEmpireIds();

  if (!data.ids[empireId]) {
    console.error(`[empireid] ❌ Empire ID not found: ${empireId}`);
    return {
      success: false,
      reason: "id_not_found"
    };
  }

  if (!data.ids[empireId].reserved) {
    console.error(`[empireid] ❌ ${empireId} is not a reserved ID`);
    return {
      success: false,
      reason: "not_reserved"
    };
  }

  // Update the fields
  if (discordId) data.ids[empireId].discordId = discordId;
  if (minecraftUser) data.ids[empireId].minecraftUser = minecraftUser;
  data.ids[empireId].updatedAt = new Date().toISOString();

  const saved = saveEmpireIds(data);

  if (!saved) {
    return {
      success: false,
      reason: "save_failed"
    };
  }

  console.log(`[empireid] ✅ Updated: ${empireId}`);
  return { success: true };
}

/**
 * Get Empire ID by Discord ID or Minecraft username
 * @param {string} discordId - Discord user ID
 * @param {string} minecraftUser - Minecraft username
 * @returns {string|null} Empire ID or null
 */
function getEmpireId(discordId = null, minecraftUser = null) {
  return getExistingEmpireId(discordId, minecraftUser);
}

/**
 * Get all Empire IDs
 * @returns {Object} Empire IDs data
 */
function getAllEmpireIds() {
  return loadEmpireIds();
}

/**
 * Get Empire ID info
 * @param {string} empireId - Empire ID
 * @returns {Object|null} ID data or null
 */
function getEmpireIdInfo(empireId) {
  const data = loadEmpireIds();
  return data.ids[empireId] || null;
}

module.exports = {
  assignEmpireId,
  reserveEmpireId,
  updateReservedId,
  getEmpireId,
  getExistingEmpireId,
  getAllEmpireIds,
  getEmpireIdInfo,
  createEmpireId,
  EMPIRE_ABBR,
  RESERVED_COUNT
};