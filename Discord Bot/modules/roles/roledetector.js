// modules/membertracking/roledetector.js
const fs = require("fs");
const path = require("path");

const rolesConfigPath = path.join(__dirname, "../data/roles.json");

// Draft system config (for Draft role ID)
const draftConfig = require("../empire/draftconfig");

// Yazanaki Empire Guild ID (hardcoded for now)
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Load roles configuration
function loadRolesConfig() {
  try {
    if (!fs.existsSync(rolesConfigPath)) {
      console.error("roles.json not found!");
      return null;
    }

    const raw = fs.readFileSync(rolesConfigPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error loading roles.json:", err);
    return null;
  }
}

// Save roles configuration
function saveRolesConfig(config) {
  try {
    const dir = path.dirname(rolesConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(rolesConfigPath, JSON.stringify(config, null, 2));
    console.log("[roledetector] Saved roles.json");
  } catch (err) {
    console.error("Error saving roles.json:", err);
  }
}

/**
 * Add a guild's roles to roles.json
 * Automatically imports all roles from the guild with position-based priority
 * 
 * @param {string} guildId - Discord guild ID
 * @param {string} guildName - Guild name
 * @param {Guild} guild - Discord.js Guild object
 * @returns {boolean} Success status
 */
async function addGuildRoles(guildId, guildName, guild) {
  try {
    let config = loadRolesConfig();
    
    if (!config) {
      // Create new config structure
      config = { guilds: {} };
    }

    if (!config.guilds) {
      config.guilds = {};
    }

    // Fetch all roles from guild
    const roles = guild.roles.cache;
    
    console.log(`[roledetector] Importing roles for ${guildName} (${roles.size} roles)`);

    // Initialize guild entry
    config.guilds[guildId] = {
      name: guildName,
      statusRoles: {},
      rankRoles: {}
    };

    // Import all roles (excluding @everyone)
    roles.forEach(role => {
      if (role.name === "@everyone") return;

      const roleData = {
        name: role.name,
        priority: role.position,
        position: role.position
      };

      // Add to both status and rank roles
      // (You can manually edit roles.json later to organize them properly)
      config.guilds[guildId].rankRoles[role.id] = roleData;
      
      console.log(`[roledetector] Imported: ${role.name} (position: ${role.position})`);
    });

    // Save updated config
    saveRolesConfig(config);

    console.log(`[roledetector] ✅ Successfully imported ${roles.size - 1} roles for ${guildName}`);
    console.log(`[roledetector] ⚠️ Edit modules/data/roles.json to organize status vs rank roles`);

    return true;

  } catch (err) {
    console.error(`[roledetector] Error adding guild roles:`, err);
    return false;
  }
}

/**
 * Remove a guild from roles.json
 */
function removeGuildRoles(guildId) {
  try {
    const config = loadRolesConfig();
    
    if (!config || !config.guilds || !config.guilds[guildId]) {
      console.warn(`[roledetector] Guild ${guildId} not found in roles.json`);
      return false;
    }

    const guildName = config.guilds[guildId].name;
    delete config.guilds[guildId];
    
    saveRolesConfig(config);
    
    console.log(`[roledetector] Removed guild: ${guildName}`);
    return true;

  } catch (err) {
    console.error(`[roledetector] Error removing guild roles:`, err);
    return false;
  }
}

/**
 * Detect Yazanaki rank and status from Discord roles
 * ✅ ONLY checks Yazanaki Empire guild (hardcoded)
 * Other guilds are stored in roles.json for future features
 * 
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client
 * @returns {Promise<{rank: string, status: string}>}
 */
async function detectRolesFromDiscord(discordId, client) {
  const config = loadRolesConfig();
  
  if (!config || !config.guilds) {
    console.warn("[roledetector] No guilds configured in roles.json");
    return { rank: "n/d", status: "n/d" };
  }

  // ✅ ONLY CHECK YAZANAKI EMPIRE
  const yazanakiData = config.guilds[YAZANAKI_EMPIRE_GUILD_ID];
  
  if (!yazanakiData) {
    console.warn("[roledetector] Yazanaki Empire not configured in roles.json");
    return { rank: "n/d", status: "n/d" };
  }

  try {
    console.log(`[roledetector] Checking Yazanaki Empire only (${YAZANAKI_EMPIRE_GUILD_ID})`);

    // Fetch Yazanaki Empire guild
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    
    if (!guild) {
      console.warn(`[roledetector] Could not fetch Yazanaki Empire guild`);
      return { rank: "n/d", status: "n/d" };
    }

    // Fetch member from guild
    const member = await guild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.log(`[roledetector] User ${discordId} not in Yazanaki Empire`);
      return { rank: "n/d", status: "n/d" };
    }

    console.log(`[roledetector] User ${discordId} found in Yazanaki Empire`);

    // Get user's role IDs
    const userRoleIds = member.roles.cache.map(role => role.id);
    console.log(`[roledetector] User has ${userRoleIds.length} roles`);

    // Special-case: track if the user currently has the Draft role
    const DRAFT_ROLE_ID = draftConfig?.ROLES?.DRAFT || null;
    const hasDraftRole = DRAFT_ROLE_ID ? userRoleIds.includes(DRAFT_ROLE_ID) : false;

    let bestRank = "n/d";
    let bestStatus = "n/d";
    let highestRankPriority = 0;
    let highestStatusPriority = 0;

    // ============================================================
    // DETECT STATUS (highest priority)
    // ============================================================
    if (yazanakiData.statusRoles) {
      for (const roleId of userRoleIds) {
        if (yazanakiData.statusRoles[roleId]) {
          const roleData = yazanakiData.statusRoles[roleId];
          const priority = roleData.priority || 0;
          
          if (priority > highestStatusPriority) {
            highestStatusPriority = priority;
            bestStatus = roleData.name;
            console.log(`[roledetector] Status: ${bestStatus} (priority: ${priority})`);
          }
        }
      }
    }

    // If the member is currently in Draft (has the Draft role), we want
    // the public Status to show "Draft" instead of "Military".
    if (hasDraftRole) {
      bestStatus = "Draft";
      console.log("[roledetector] 🎖️ Overriding status to Draft due to active Draft role");
    }

    // ============================================================
    // DETECT RANK (highest priority)
    // ============================================================
    if (yazanakiData.rankRoles) {
      for (const roleId of userRoleIds) {
        if (yazanakiData.rankRoles[roleId]) {
          const roleData = yazanakiData.rankRoles[roleId];
          const priority = roleData.priority || 0;
          
          if (priority > highestRankPriority) {
            highestRankPriority = priority;
            bestRank = roleData.name;
            console.log(`[roledetector] Rank: ${bestRank} (priority: ${priority})`);
          }
        }
      }
    }

    console.log(`[roledetector] Final - Rank: ${bestRank}, Status: ${bestStatus}`);
    return { rank: bestRank, status: bestStatus };

  } catch (err) {
    console.error(`[roledetector] Error detecting roles:`, err);
    return { rank: "n/d", status: "n/d" };
  }
}

module.exports = {
  detectRolesFromDiscord,
  loadRolesConfig,
  saveRolesConfig,
  addGuildRoles,
  removeGuildRoles
};