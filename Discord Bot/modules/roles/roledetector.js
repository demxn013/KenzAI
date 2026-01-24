// modules/roles/roledetector.js
// ✅ Multi-guild role detection with priority-based selection
// Detects highest priority rank and status from ANY guild the user is in

const { loadRolesConfig, getAllGuildRoles } = require("./rolesconfig");

/**
 * ✅ Detect Yazanaki rank and status from ALL guilds with role configs
 * 
 * Priority system:
 * - For RANK: Selects the role with the HIGHEST priority across all guilds
 * - For STATUS: Selects the role with the HIGHEST priority across all guilds
 * 
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client
 * @returns {Promise<{rank: string, status: string, error?: string, guilds?: Object}>}
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

  const allGuildConfigs = getAllGuildRoles();
  
  if (!allGuildConfigs || Object.keys(allGuildConfigs).length === 0) {
    console.warn("[roledetector] ⚠️ No guild role configs found in roles.json");
    return { rank: "n/d", status: "n/d", error: "no_guild_configs" };
  }

  console.log(`[roledetector] 🔍 Checking ${Object.keys(allGuildConfigs).length} guilds for user ${discordId}`);

  // Track highest priority role found across ALL guilds
  let highestRank = { name: "n/d", priority: -1, guildId: null };
  let highestStatus = { name: "n/d", priority: -1, guildId: null };
  
  const guildsChecked = {};

  // Check each guild in the config
  for (const [guildId, guildConfig] of Object.entries(allGuildConfigs)) {
    try {
      console.log(`[roledetector] 🔍 Checking guild: ${guildConfig.name} (${guildId})`);
      
      // Fetch guild
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      
      if (!guild) {
        console.warn(`[roledetector] ⚠️ Could not fetch guild ${guildId}`);
        guildsChecked[guildId] = { error: "guild_not_found" };
        continue;
      }

      // Fetch member from guild
      const member = await guild.members.fetch(discordId).catch(() => null);
      
      if (!member) {
        console.log(`[roledetector] ℹ️ User ${discordId} not in guild ${guildConfig.name}`);
        guildsChecked[guildId] = { error: "not_in_guild" };
        continue;
      }

      console.log(`[roledetector] ✅ Found member in ${guildConfig.name}`);

      // Get user's role IDs
      const userRoleIds = member.roles.cache.map(role => role.id);
      const roleNames = member.roles.cache.map(role => role.name).join(", ");
      console.log(`[roledetector] 🎭 Member has ${userRoleIds.length} roles: ${roleNames}`);

      guildsChecked[guildId] = {
        guild: guildConfig.name,
        roles: roleNames,
        rank: null,
        status: null
      };

      // ============================================================
      // CHECK STATUS ROLES (highest priority wins)
      // ============================================================
      if (guildConfig.statusRoles) {
        for (const roleId of userRoleIds) {
          const statusRole = guildConfig.statusRoles[roleId];
          
          if (statusRole) {
            const priority = statusRole.priority || 0;
            
            console.log(`[roledetector] 🎯 Found status role: ${statusRole.name} (Priority: ${priority})`);
            
            // Update if this is higher priority than current highest
            if (priority > highestStatus.priority) {
              highestStatus = {
                name: statusRole.name,
                priority: priority,
                guildId: guildId,
                roleId: roleId
              };
              guildsChecked[guildId].status = statusRole.name;
              console.log(`[roledetector] ⬆️ New highest status: ${statusRole.name}`);
            }
          }
        }
      }

      // ============================================================
      // CHECK RANK ROLES (highest priority wins)
      // ============================================================
      if (guildConfig.rankRoles) {
        for (const roleId of userRoleIds) {
          const rankRole = guildConfig.rankRoles[roleId];
          
          if (rankRole) {
            const priority = rankRole.priority || 0;
            
            console.log(`[roledetector] 🎯 Found rank role: ${rankRole.name} (Priority: ${priority})`);
            
            // Update if this is higher priority than current highest
            if (priority > highestRank.priority) {
              highestRank = {
                name: rankRole.name,
                priority: priority,
                guildId: guildId,
                roleId: roleId
              };
              guildsChecked[guildId].rank = rankRole.name;
              console.log(`[roledetector] ⬆️ New highest rank: ${rankRole.name}`);
            }
          }
        }
      }

    } catch (err) {
      console.error(`[roledetector] ❌ Error checking guild ${guildId}:`, err.message);
      guildsChecked[guildId] = { error: err.message };
    }
  }

  // ============================================================
  // RETURN HIGHEST PRIORITY ROLES FOUND
  // ============================================================
  const result = {
    rank: highestRank.name,
    status: highestStatus.name,
    guilds: guildsChecked
  };

  if (highestRank.guildId) {
    console.log(`[roledetector] ✅ Final rank: ${highestRank.name} (Priority: ${highestRank.priority}, Guild: ${allGuildConfigs[highestRank.guildId]?.name})`);
  } else {
    console.log(`[roledetector] ℹ️ No rank role found for ${discordId}`);
  }

  if (highestStatus.guildId) {
    console.log(`[roledetector] ✅ Final status: ${highestStatus.name} (Priority: ${highestStatus.priority}, Guild: ${allGuildConfigs[highestStatus.guildId]?.name})`);
  } else {
    console.log(`[roledetector] ℹ️ No status role found for ${discordId}`);
  }

  console.log(`[roledetector] 📊 Final result for ${discordId}:`, result);
  
  return result;
}

/**
 * ✅ Detect roles from a specific guild only
 * @param {string} discordId - Discord user ID
 * @param {string} guildId - Discord guild ID
 * @param {Client} client - Discord.js client
 * @returns {Promise<{rank: string, status: string, error?: string}>}
 */
async function detectRolesFromGuild(discordId, guildId, client) {
  if (!discordId || !guildId || !client) {
    console.warn("[roledetector] ⚠️ Missing required parameters");
    return { rank: "n/d", status: "n/d", error: "missing_parameters" };
  }

  const config = loadRolesConfig();
  
  if (!config || !config.guilds || !config.guilds[guildId]) {
    console.warn(`[roledetector] ⚠️ No config for guild ${guildId}`);
    return { rank: "n/d", status: "n/d", error: "guild_not_configured" };
  }

  try {
    const guildConfig = config.guilds[guildId];
    
    // Fetch guild
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    
    if (!guild) {
      console.warn(`[roledetector] ⚠️ Could not fetch guild ${guildId}`);
      return { rank: "n/d", status: "n/d", error: "guild_not_found" };
    }

    // Fetch member
    const member = await guild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.log(`[roledetector] ℹ️ User ${discordId} not in guild ${guildConfig.name}`);
      return { rank: "n/d", status: "n/d", error: "not_in_guild" };
    }

    console.log(`[roledetector] ✅ Found member in ${guildConfig.name}`);

    const userRoleIds = member.roles.cache.map(role => role.id);
    
    // Find highest priority status
    let status = "n/d";
    let highestStatusPriority = -1;
    
    for (const roleId of userRoleIds) {
      if (guildConfig.statusRoles[roleId]) {
        const roleData = guildConfig.statusRoles[roleId];
        const priority = roleData.priority || 0;
        
        if (priority > highestStatusPriority) {
          highestStatusPriority = priority;
          status = roleData.name;
        }
      }
    }

    // Find highest priority rank
    let rank = "n/d";
    let highestRankPriority = -1;
    
    for (const roleId of userRoleIds) {
      if (guildConfig.rankRoles[roleId]) {
        const roleData = guildConfig.rankRoles[roleId];
        const priority = roleData.priority || 0;
        
        if (priority > highestRankPriority) {
          highestRankPriority = priority;
          rank = roleData.name;
        }
      }
    }

    console.log(`[roledetector] 📊 Result for ${discordId} in ${guildConfig.name}: Rank=${rank}, Status=${status}`);
    
    return { rank, status };

  } catch (err) {
    console.error(`[roledetector] ❌ Error detecting roles:`, err);
    return { rank: "n/d", status: "n/d", error: err.message };
  }
}

/**
 * ✅ Batch detect roles for multiple users (from all guilds)
 * Useful for background sync operations
 * @param {Array<string>} discordIds - Array of Discord user IDs
 * @param {Client} client - Discord.js client
 * @returns {Promise<Object>} Map of discordId -> role data
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
  detectRolesFromGuild,
  batchDetectRoles
};