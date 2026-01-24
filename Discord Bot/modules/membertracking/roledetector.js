// modules/membertracking/roledetector.js
const fs = require("fs");
const path = require("path");

const rolesConfigPath = path.join(__dirname, "roles.json");

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

/**
 * Detect Yazanaki rank and status from Discord roles
 * 
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client
 * @returns {Promise<{rank: string, status: string}>}
 */
async function detectRolesFromDiscord(discordId, client) {
  const config = loadRolesConfig();
  
  if (!config) {
    return { rank: "n/d", status: "n/d" };
  }

  try {
    // Fetch Yazanaki Empire guild
    const guild = await client.guilds.fetch(config.yazanakiEmpireId).catch(() => null);
    
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
    console.log(`[roledetector] User roles:`, userRoleIds);

    // ============================================================
    // DETECT STATUS (first matching role)
    // ============================================================
    let status = "n/d";
    
    for (const roleId of userRoleIds) {
      if (config.statusRoles[roleId]) {
        status = config.statusRoles[roleId];
        console.log(`[roledetector] Status detected: ${status}`);
        break;
      }
    }

    // ============================================================
    // DETECT RANK (highest priority role)
    // ============================================================
    let rank = "n/d";
    let highestPriority = 0;
    
    for (const roleId of userRoleIds) {
      if (config.rankRoles[roleId]) {
        const roleData = config.rankRoles[roleId];
        if (roleData.priority > highestPriority) {
          highestPriority = roleData.priority;
          rank = roleData.name;
        }
      }
    }

    if (rank !== "n/d") {
      console.log(`[roledetector] Rank detected: ${rank} (priority: ${highestPriority})`);
    }

    return { rank, status };

  } catch (err) {
    console.error(`[roledetector] Error detecting roles:`, err);
    return { rank: "n/d", status: "n/d" };
  }
}

module.exports = {
  detectRolesFromDiscord,
  loadRolesConfig
};