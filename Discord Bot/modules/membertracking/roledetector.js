// modules/membertracking/roledetector.js
// ✅ FIXED: Single source of truth for role detection
// Removed duplicate, added better logging, error handling, and caching

const fs = require("fs");
const path = require("path");

const rolesConfigPath = path.join(__dirname, "roles.json");

// Cache to avoid repeated file reads
let rolesConfigCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Load roles configuration with caching
 */
function loadRolesConfig(forceReload = false) {
  const now = Date.now();
  
  // Return cached config if valid
  if (!forceReload && rolesConfigCache && (now - cacheTimestamp) < CACHE_TTL) {
    return rolesConfigCache;
  }

  try {
    if (!fs.existsSync(rolesConfigPath)) {
      console.error("[roledetector] ❌ roles.json not found!");
      return null;
    }

    const raw = fs.readFileSync(rolesConfigPath, "utf8");
    rolesConfigCache = JSON.parse(raw);
    cacheTimestamp = now;
    
    console.log(`[roledetector] ✅ Loaded roles config (Empire: ${rolesConfigCache.yazanakiEmpireId})`);
    return rolesConfigCache;
    
  } catch (err) {
    console.error("[roledetector] ❌ Error loading roles.json:", err);
    return null;
  }
}

/**
 * ✅ Detect Yazanaki rank and status from Discord roles
 * 
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client
 * @returns {Promise<{rank: string, status: string, error?: string}>}
 */
async function detectRolesFromDiscord(discordId, client) {
  // Validate inputs
  if (!discordId) {
    console.warn("[roledetector] ⚠️ No discordId provided");
    return { rank: "n/d", status: "n/d", error: "no_discord_id" };
  }

  if (!client) {
    console.warn("[roledetector] ⚠️ No client provided - cannot detect roles");
    return { rank: "n/d", status: "n/d", error: "no_client" };
  }

  const config = loadRolesConfig();
  
  if (!config) {
    console.warn("[roledetector] ⚠️ roles.json not loaded");
    return { rank: "n/d", status: "n/d", error: "no_config" };
  }

  try {
    // Fetch Yazanaki Empire guild
    console.log(`[roledetector] 🔍 Fetching guild: ${config.yazanakiEmpireId}`);
    const guild = await client.guilds.fetch(config.yazanakiEmpireId).catch(() => null);
    
    if (!guild) {
      console.warn(`[roledetector] ⚠️ Could not fetch Yazanaki Empire guild (${config.yazanakiEmpireId})`);
      return { rank: "n/d", status: "n/d", error: "guild_not_found" };
    }

    // Fetch member from guild
    console.log(`[roledetector] 🔍 Fetching member: ${discordId} from guild: ${guild.name}`);
    const member = await guild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.log(`[roledetector] ℹ️ User ${discordId} not in Yazanaki Empire`);
      return { rank: "n/d", status: "n/d", error: "not_in_guild" };
    }

    console.log(`[roledetector] ✅ Found member: ${member.user.tag} (${discordId})`);

    // Get user's role IDs
    const userRoleIds = member.roles.cache.map(role => role.id);
    const roleNames = member.roles.cache.map(role => role.name).join(", ");
    console.log(`[roledetector] 🎭 Member has ${userRoleIds.length} roles: ${roleNames}`);

    // ============================================================
    // DETECT STATUS (first matching role)
    // ============================================================
    let status = "n/d";
    
    for (const roleId of userRoleIds) {
      if (config.statusRoles[roleId]) {
        status = config.statusRoles[roleId];
        console.log(`[roledetector] ✅ Status detected: ${status} (role: ${roleId})`);
        break;
      }
    }

    if (status === "n/d") {
      console.log(`[roledetector] ℹ️ No status role found for ${discordId}`);
    }

    // ============================================================
    // DETECT RANK (highest priority role)
    // ============================================================
    let rank = "n/d";
    let highestPriority = 0;
    let rankRoleId = null;
    
    for (const roleId of userRoleIds) {
      if (config.rankRoles[roleId]) {
        const roleData = config.rankRoles[roleId];
        if (roleData.priority > highestPriority) {
          highestPriority = roleData.priority;
          rank = roleData.name;
          rankRoleId = roleId;
        }
      }
    }

    if (rank !== "n/d") {
      console.log(`[roledetector] ✅ Rank detected: ${rank} (priority: ${highestPriority}, role: ${rankRoleId})`);
    } else {
      console.log(`[roledetector] ℹ️ No rank role found for ${discordId}`);
    }

    // ============================================================
    // RETURN RESULTS
    // ============================================================
    const result = { rank, status };
    console.log(`[roledetector] 📊 Final result for ${discordId}:`, result);
    
    return result;

  } catch (err) {
    console.error(`[roledetector] ❌ Error detecting roles for ${discordId}:`, err.message);
    return { rank: "n/d", status: "n/d", error: err.message };
  }
}

/**
 * ✅ Batch detect roles for multiple users
 * Useful for background sync operations
 */
async function batchDetectRoles(discordIds, client) {
  console.log(`[roledetector] 🔄 Batch detecting roles for ${discordIds.length} users...`);
  
  const results = {};
  let successCount = 0;
  let errorCount = 0;

  for (const discordId of discordIds) {
    try {
      const result = await detectRolesFromDiscord(discordId, client);
      results[discordId] = result;
      
      if (!result.error) {
        successCount++;
      } else {
        errorCount++;
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (err) {
      console.error(`[roledetector] ❌ Failed to detect roles for ${discordId}:`, err);
      results[discordId] = { rank: "n/d", status: "n/d", error: err.message };
      errorCount++;
    }
  }

  console.log(`[roledetector] ✅ Batch complete: ${successCount} success, ${errorCount} errors`);
  return results;
}

module.exports = {
  detectRolesFromDiscord,
  batchDetectRoles,
  loadRolesConfig
};