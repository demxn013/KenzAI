// modules/membertracking/roledetector.js

// Persistence via dual-write MapStore (JSON + MySQL `roles_config`).
const { stores } = require("../database/stores");

// Yazanaki Empire Guild ID (hardcoded for now)
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Load roles configuration
function loadRolesConfig() {
  try {
    return stores.roles_config.readObject();
  } catch (err) {
    console.error("Error loading roles config:", err);
    return null;
  }
}

// Save roles configuration
function saveRolesConfig(config) {
  try {
    stores.roles_config.writeObject(config);
    console.log("[roledetector] Saved roles config");
  } catch (err) {
    console.error("Error saving roles config:", err);
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

    let bestRank = "n/d";
    let bestStatus = "n/d";
    let highestRankPriority = 0;

    // ============================================================
    // DETECT STATUS (explicit precedence, highest authority first)
    // ============================================================
    // Status is decided by which Yazanaki Empire status role the member holds.
    // A member normally has just one, but if several are present the higher one
    // in this list wins:
    //   Royalty > Council > Military > Draft > Citizen   (then Ally > Enemy)
    // "Military" outranks "Draft": Draft is the provisional 3-month state, so
    // once a member has committed to the military the Military status wins even
    // if a stale Draft role lingers. The draft scheduler (draftconfig.js) swaps
    // Draft → Military or Citizen when the 3-month period ends. "Citizen" is the
    // ordinary-member status that only applies when none of the deciding roles
    // are present. Role IDs are resolved live from roles.json by name, so
    // re-categorising a role in config is enough to change detection.
    const STATUS_PRECEDENCE = ["Royalty", "Council", "Military", "Draft", "Citizen", "Ally", "Enemy"];

    const statusRoleIdByName = {};
    if (yazanakiData.statusRoles) {
      for (const [roleId, roleData] of Object.entries(yazanakiData.statusRoles)) {
        if (roleData?.name) statusRoleIdByName[roleData.name] = roleId;
      }
    }

    const userRoleIdSet = new Set(userRoleIds);
    for (const statusName of STATUS_PRECEDENCE) {
      const roleId = statusRoleIdByName[statusName];
      if (roleId && userRoleIdSet.has(roleId)) {
        bestStatus = statusName;
        console.log(`[roledetector] Status: ${bestStatus} (precedence match)`);
        break;
      }
    }

    // Fallback: if the member has some other configured status role not covered
    // by the precedence list above, keep the legacy highest-priority behaviour
    // so future/unknown status roles still resolve to something.
    if (bestStatus === "n/d" && yazanakiData.statusRoles) {
      let highestStatusPriority = 0;
      for (const roleId of userRoleIds) {
        const roleData = yazanakiData.statusRoles[roleId];
        if (roleData && (roleData.priority || 0) > highestStatusPriority) {
          highestStatusPriority = roleData.priority || 0;
          bestStatus = roleData.name;
          console.log(`[roledetector] Status (fallback): ${bestStatus}`);
        }
      }
    }

    // Active draft always presents as "Draft", even though Military outranks
    // Draft in the role precedence above: draftees are enrolled in the military
    // for their 3-month draft period, so they hold the Military role too. We key
    // this off the draft *record* (draftExpiryDate / draftCompletedDate via
    // draftlogic.isDraftActive) rather than the Draft role, so a stale Draft role
    // can't pin someone to Draft forever — once the draft expires/completes they
    // fall back to Military. Lazy require keeps roledetector free of any
    // load-order cycle with the draft module.
    try {
      const { getDraftStatus } = require("../empire/draftlogic");
      const draft = getDraftStatus(discordId);
      if (draft?.isActive) {
        bestStatus = "Draft";
        console.log("[roledetector] 🎖️ Active draft → status forced to Draft");
      }
    } catch (err) {
      console.warn("[roledetector] ⚠️ Could not check active draft:", err.message);
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