// modules/yazanaki/yazanakilogic.js
const { readMembers } = require("../database/membersPersistence");
const { readClans } = require("../database/clansPersistence");
const { stores } = require("../database/stores");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";


/**
 * Read roles config (JSON + MySQL via the dual-write store).
 */
function readRoles() {
  try {
    return stores.roles_config.readObject();
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error reading roles config:", err);
    return {};
  }
}

/**
 * Get emperor and empress mentions from cached members
 * ✅ FIXED: Now accepts pre-fetched members collection to avoid rate limits
 * @param {Collection} members - Pre-fetched members collection
 * @returns {Object} { emperor: string, empress: string }
 */
function getEmpireLeadersFromMembers(members) {
  console.log("[yazanakilogic] 👑 Finding empire leaders from cached members...");
  
  try {
    // Load roles.json to get Emperor and Empress role IDs
    const rolesConfig = readRoles();
    
    if (!rolesConfig.guilds || !rolesConfig.guilds[YAZANAKI_EMPIRE_GUILD_ID]) {
      console.warn("[yazanakilogic] ⚠️ Yazanaki Empire not found in roles.json");
      return { emperor: "``n/d``", empress: "``n/d``" };
    }
    
    const yazanakiRoles = rolesConfig.guilds[YAZANAKI_EMPIRE_GUILD_ID].rankRoles;
    
    let emperorMention = "``n/d``";
    let empressMention = "``n/d``";
    
    // Find Emperor role ID from roles.json
    let emperorRoleId = null;
    let empressRoleId = null;
    
    for (const [roleId, roleData] of Object.entries(yazanakiRoles)) {
      if (roleData.name.toLowerCase() === "emperor") {
        emperorRoleId = roleId;
        console.log(`[yazanakilogic] 👑 Found Emperor role ID: ${roleId}`);
      }
      if (roleData.name.toLowerCase() === "empress") {
        empressRoleId = roleId;
        console.log(`[yazanakilogic] 👑 Found Empress role ID: ${roleId}`);
      }
    }
    
    // Get members with Emperor role
    if (emperorRoleId) {
      const emperors = members.filter(member => 
        member.roles.cache.has(emperorRoleId)
      );
      
      if (emperors.size > 0) {
        // Get all emperor mentions
        const emperorMentions = emperors.map(member => `<@${member.id}>`);
        emperorMention = emperorMentions.join(", ");
        console.log(`[yazanakilogic] ✅ Found ${emperors.size} Emperor(s): ${emperors.map(m => m.user.tag).join(", ")}`);
      } else {
        console.warn("[yazanakilogic] ⚠️ No members with Emperor role");
      }
    } else {
      console.warn("[yazanakilogic] ⚠️ Emperor role ID not found in roles.json");
    }
    
    // Get members with Empress role
    if (empressRoleId) {
      const empresses = members.filter(member => 
        member.roles.cache.has(empressRoleId)
      );
      
      if (empresses.size > 0) {
        // Get all empress mentions
        const empressMentions = empresses.map(member => `<@${member.id}>`);
        empressMention = empressMentions.join(", ");
        console.log(`[yazanakilogic] ✅ Found ${empresses.size} Empress(es): ${empresses.map(m => m.user.tag).join(", ")}`);
      } else {
        console.warn("[yazanakilogic] ⚠️ No members with Empress role");
      }
    } else {
      console.warn("[yazanakilogic] ⚠️ Empress role ID not found in roles.json");
    }
    
    return { emperor: emperorMention, empress: empressMention };
    
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error finding leaders:", err);
    return { emperor: "``n/d``", empress: "``n/d``" };
  }
}

/**
 * Get empire-wide statistics AND leaders in one call
 * ✅ FIXED: Now returns both stats and leaders to avoid double-fetching
 * @param {Client} client - Discord.js client
 * @returns {Promise<Object>} Empire statistics and leaders
 */
async function getEmpireStatsAndLeaders(client) {
  console.log("[yazanakilogic] 📊 Calculating empire statistics and finding leaders...");
  
  const clans = readClans();
  
  // Set to track unique Discord user IDs across all guilds
  const uniqueDiscordIds = new Set();
  
  // Track total residents from clans.json (this is the count from members.json)
  let totalResidents = 0;
  
  // Cache Yazanaki members for leader detection
  let yazanakiMembers = null;
  let emperorMention = "``n/d``";
  let empressMention = "``n/d``";
  
  // ============================================================
  // STEP 1: Fetch members from Yazanaki Empire discord
  // ============================================================
  try {
    console.log(`[yazanakilogic] 📡 Fetching members from Yazanaki Empire...`);
    
    const yazanakiGuild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    
    if (yazanakiGuild) {
      yazanakiMembers = await yazanakiGuild.members.fetch().catch(() => null);
      
      if (yazanakiMembers) {
        // Add all non-bot members to the unique set
        yazanakiMembers.forEach(member => {
          if (!member.user.bot) {
            uniqueDiscordIds.add(member.id);
          }
        });
        
        console.log(`[yazanakilogic] ✅ Yazanaki Empire: ${uniqueDiscordIds.size} unique members`);
        
        // ✅ FIND EMPEROR AND EMPRESS FROM CACHED MEMBERS
        const leaders = getEmpireLeadersFromMembers(yazanakiMembers);
        emperorMention = leaders.emperor;
        empressMention = leaders.empress;
        
      } else {
        console.warn(`[yazanakilogic] ⚠️ Could not fetch Yazanaki Empire members`);
      }
    } else {
      console.warn(`[yazanakilogic] ⚠️ Could not fetch Yazanaki Empire guild`);
    }
  } catch (err) {
    console.error(`[yazanakilogic] ❌ Error fetching Yazanaki Empire members:`, err.message);
  }
  
  // ============================================================
  // STEP 2: Fetch members from all clan discords
  // ============================================================
  for (const [guildId, clan] of Object.entries(clans)) {
    try {
      console.log(`[yazanakilogic] 📡 Fetching members from ${clan.abbr}...`);
      
      const clanGuild = await client.guilds.fetch(guildId).catch(() => null);
      
      if (!clanGuild) {
        console.warn(`[yazanakilogic] ⚠️ Could not fetch clan guild: ${clan.abbr}`);
        continue;
      }
      
      const clanMembers = await clanGuild.members.fetch().catch(() => null);
      
      if (!clanMembers) {
        console.warn(`[yazanakilogic] ⚠️ Could not fetch members from ${clan.abbr}`);
        continue;
      }
      
      // Add all non-bot members to the unique set
      let newMembers = 0;
      clanMembers.forEach(member => {
        if (!member.user.bot && !uniqueDiscordIds.has(member.id)) {
          uniqueDiscordIds.add(member.id);
          newMembers++;
        }
      });
      
      console.log(`[yazanakilogic] ✅ ${clan.abbr}: ${clanMembers.size} total, ${newMembers} new unique`);
      
      // Add residents count from clans.json
      totalResidents += (clan.residents || 0);
      
    } catch (err) {
      console.error(`[yazanakilogic] ❌ Error fetching ${clan.abbr} members:`, err.message);
    }
  }
  
  // ============================================================
  // STEP 3: Return statistics AND leaders
  // ============================================================
  const totalUniquePeople = uniqueDiscordIds.size;
  
  console.log(`[yazanakilogic] 📊 Final Statistics:`);
  console.log(`[yazanakilogic] 👥 Total Unique Discord Members: ${totalUniquePeople}`);
  console.log(`[yazanakilogic] 🏠 Total Residents (from clans.json): ${totalResidents}`);
  console.log(`[yazanakilogic] 👑 Emperor: ${emperorMention}`);
  console.log(`[yazanakilogic] 👑 Empress: ${empressMention}`);
  
  return {
    totalUniquePeople,
    totalResidents,
    emperor: emperorMention,
    empress: empressMention
  };
}

/**
 * @deprecated Use getEmpireStatsAndLeaders instead to avoid rate limits
 */
async function getEmpireStats(client) {
  const result = await getEmpireStatsAndLeaders(client);
  return {
    totalUniquePeople: result.totalUniquePeople,
    totalResidents: result.totalResidents
  };
}

/**
 * @deprecated Use getEmpireStatsAndLeaders instead to avoid rate limits
 */
async function getEmpireLeaders(guild) {
  console.warn("[yazanakilogic] ⚠️ getEmpireLeaders is deprecated - use getEmpireStatsAndLeaders instead");
  
  try {
    const members = await guild.members.fetch();
    return getEmpireLeadersFromMembers(members);
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error finding leaders:", err);
    return { emperor: "``n/d``", empress: "``n/d``" };
  }
}

module.exports = {
  getEmpireStats,
  getEmpireLeaders,
  getEmpireStatsAndLeaders, // ✅ NEW: Combined function to avoid double-fetching
  readMembers,
  readClans
};