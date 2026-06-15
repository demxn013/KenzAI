// modules/roles/rolesconfig.js
// ✅ Centralized role configuration management for all guilds
// Supports multi-guild role detection with priority-based selection

// Persistence via dual-write MapStore (JSON + MySQL `roles_config`).
// roles.json is { guilds: { [guildId]: cfg } }; the store keeps one row per guild.
const { stores } = require("../database/stores");

// Cache to avoid repeated reads
let rolesConfigCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Ensure the roles config exists with proper structure (store creates defaults).
 */
function ensureRolesConfig() {
  try {
    stores.roles_config.readObject();
  } catch (err) {
    console.error("[rolesconfig] ❌ Error ensuring roles config:", err);
  }
}

/**
 * Load roles configuration with caching
 * @param {boolean} forceReload - Force reload from the store
 * @returns {Object|null} Roles configuration
 */
function loadRolesConfig(forceReload = false) {
  const now = Date.now();

  // Return cached config if valid
  if (!forceReload && rolesConfigCache && (now - cacheTimestamp) < CACHE_TTL) {
    return rolesConfigCache;
  }

  try {
    rolesConfigCache = stores.roles_config.readObject();
    cacheTimestamp = now;

    console.log(`[rolesconfig] ✅ Loaded roles config for ${Object.keys(rolesConfigCache.guilds || {}).length} guilds`);
    return rolesConfigCache;

  } catch (err) {
    console.error("[rolesconfig] ❌ Error loading roles config:", err);
    return null;
  }
}

/**
 * Save roles configuration (JSON + MySQL).
 * @param {Object} config - Roles configuration
 * @returns {boolean} Success status
 */
function saveRolesConfig(config) {
  try {
    stores.roles_config.writeObject(config);

    // Invalidate cache
    rolesConfigCache = null;
    cacheTimestamp = 0;

    console.log("[rolesconfig] ✅ Saved roles config");
    return true;
  } catch (err) {
    console.error("[rolesconfig] ❌ Failed to save roles config:", err);
    return false;
  }
}

/**
 * Get guild role configuration
 * @param {string} guildId - Discord guild ID
 * @returns {Object|null} Guild role config or null if not found
 */
function getGuildRoles(guildId) {
  const config = loadRolesConfig();
  if (!config || !config.guilds) return null;
  
  return config.guilds[guildId] || null;
}

/**
 * ✅ Add a new guild to roles configuration
 * Automatically detects all roles from the guild and assigns priorities
 * @param {string} guildId - Discord guild ID
 * @param {string} guildName - Guild name
 * @param {Guild} guild - Discord.js Guild object
 * @returns {Promise<boolean>} Success status
 */
async function addGuildRoles(guildId, guildName, guild) {
  try {
    console.log(`[rolesconfig] 🔄 Adding guild roles for ${guildName} (${guildId})`);
    
    const config = loadRolesConfig(true);
    if (!config.guilds) config.guilds = {};

    // Fetch all roles from the guild
    const roles = await guild.roles.fetch().catch(() => null);
    
    if (!roles) {
      console.warn(`[rolesconfig] ⚠️ Could not fetch roles for guild ${guildId}`);
      return false;
    }

    // Sort roles by position (higher position = higher priority)
    const sortedRoles = Array.from(roles.cache.values())
      .filter(role => role.name !== "@everyone") // Exclude @everyone
      .sort((a, b) => b.position - a.position); // Highest position first

    console.log(`[rolesconfig] 📊 Found ${sortedRoles.length} roles in ${guildName}`);

    // Initialize guild config
    config.guilds[guildId] = {
      name: guildName,
      statusRoles: {},
      rankRoles: {}
    };

    // Assign priorities based on position (highest position = highest priority)
    sortedRoles.forEach((role, index) => {
      const priority = sortedRoles.length - index; // Reverse priority
      
      // Add to rankRoles by default (admin can later categorize as status)
      config.guilds[guildId].rankRoles[role.id] = {
        name: role.name,
        priority: priority,
        position: role.position
      };
      
      console.log(`[rolesconfig] 🎭 Added role: ${role.name} (Priority: ${priority})`);
    });

    const success = saveRolesConfig(config);
    
    if (success) {
      console.log(`[rolesconfig] ✅ Successfully added ${sortedRoles.length} roles for ${guildName}`);
    }
    
    return success;
    
  } catch (err) {
    console.error(`[rolesconfig] ❌ Error adding guild roles:`, err);
    return false;
  }
}

/**
 * ✅ Update guild roles (refresh from Discord)
 * Useful when roles are added/removed/reordered in Discord
 * @param {string} guildId - Discord guild ID
 * @param {Guild} guild - Discord.js Guild object
 * @returns {Promise<boolean>} Success status
 */
async function updateGuildRoles(guildId, guild) {
  try {
    console.log(`[rolesconfig] 🔄 Updating roles for guild ${guildId}`);
    
    const config = loadRolesConfig(true);
    if (!config.guilds || !config.guilds[guildId]) {
      console.warn(`[rolesconfig] ⚠️ Guild ${guildId} not in config, adding...`);
      return await addGuildRoles(guildId, guild.name, guild);
    }

    const existingConfig = config.guilds[guildId];
    
    // Fetch current roles from Discord
    const roles = await guild.roles.fetch().catch(() => null);
    
    if (!roles) {
      console.warn(`[rolesconfig] ⚠️ Could not fetch roles for guild ${guildId}`);
      return false;
    }

    // Sort by position
    const sortedRoles = Array.from(roles.cache.values())
      .filter(role => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position);

    // Preserve existing categorization (rank vs status)
    const newRankRoles = {};
    const newStatusRoles = {};

    sortedRoles.forEach((role, index) => {
      const priority = sortedRoles.length - index;
      
      // Check if role was previously in statusRoles
      const wasStatus = Object.keys(existingConfig.statusRoles || {}).includes(role.id);
      
      if (wasStatus) {
        // Keep as status role, update priority
        newStatusRoles[role.id] = {
          name: role.name,
          priority: priority,
          position: role.position
        };
      } else {
        // Keep as rank role, update priority
        newRankRoles[role.id] = {
          name: role.name,
          priority: priority,
          position: role.position
        };
      }
    });

    config.guilds[guildId].rankRoles = newRankRoles;
    config.guilds[guildId].statusRoles = newStatusRoles;

    const success = saveRolesConfig(config);
    
    if (success) {
      console.log(`[rolesconfig] ✅ Updated roles for ${existingConfig.name}`);
    }
    
    return success;
    
  } catch (err) {
    console.error(`[rolesconfig] ❌ Error updating guild roles:`, err);
    return false;
  }
}

/**
 * Remove a guild from roles configuration
 * @param {string} guildId - Discord guild ID
 * @returns {boolean} Success status
 */
function removeGuildRoles(guildId) {
  try {
    const config = loadRolesConfig(true);
    
    if (!config.guilds || !config.guilds[guildId]) {
      console.warn(`[rolesconfig] ⚠️ Guild ${guildId} not in config`);
      return false;
    }

    const guildName = config.guilds[guildId].name;
    delete config.guilds[guildId];

    const success = saveRolesConfig(config);
    
    if (success) {
      console.log(`[rolesconfig] ✅ Removed guild ${guildName} (${guildId})`);
    }
    
    return success;
    
  } catch (err) {
    console.error(`[rolesconfig] ❌ Error removing guild roles:`, err);
    return false;
  }
}

/**
 * Get all guilds in role configuration
 * @returns {Object} Map of guildId -> guild config
 */
function getAllGuildRoles() {
  const config = loadRolesConfig();
  return config?.guilds || {};
}

/**
 * ✅ Manually categorize a role as "status" or "rank"
 * @param {string} guildId - Discord guild ID
 * @param {string} roleId - Role ID
 * @param {string} type - "status" or "rank"
 * @returns {boolean} Success status
 */
function categorizeRole(guildId, roleId, type) {
  try {
    const config = loadRolesConfig(true);
    
    if (!config.guilds || !config.guilds[guildId]) {
      console.warn(`[rolesconfig] ⚠️ Guild ${guildId} not in config`);
      return false;
    }

    const guildConfig = config.guilds[guildId];
    
    // Find role in either rankRoles or statusRoles
    let roleData = guildConfig.rankRoles[roleId] || guildConfig.statusRoles[roleId];
    
    if (!roleData) {
      console.warn(`[rolesconfig] ⚠️ Role ${roleId} not found in guild ${guildId}`);
      return false;
    }

    // Move role to correct category
    if (type === "status") {
      // Move from rank to status
      if (guildConfig.rankRoles[roleId]) {
        guildConfig.statusRoles[roleId] = guildConfig.rankRoles[roleId];
        delete guildConfig.rankRoles[roleId];
      }
    } else if (type === "rank") {
      // Move from status to rank
      if (guildConfig.statusRoles[roleId]) {
        guildConfig.rankRoles[roleId] = guildConfig.statusRoles[roleId];
        delete guildConfig.statusRoles[roleId];
      }
    }

    const success = saveRolesConfig(config);
    
    if (success) {
      console.log(`[rolesconfig] ✅ Categorized role ${roleData.name} as ${type}`);
    }
    
    return success;
    
  } catch (err) {
    console.error(`[rolesconfig] ❌ Error categorizing role:`, err);
    return false;
  }
}

module.exports = {
  loadRolesConfig,
  saveRolesConfig,
  getGuildRoles,
  addGuildRoles,
  updateGuildRoles,
  removeGuildRoles,
  getAllGuildRoles,
  categorizeRole,
  ensureRolesConfig
};