// modules/yazanaki/yazanakilogic.js
const fs = require("fs");
const path = require("path");

const membersPath = path.join(__dirname, "../data/members.json");
const clansPath = path.join(__dirname, "../data/clans.json");
const rolesPath = path.join(__dirname, "../data/roles.json");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

/**
 * Read members.json
 */
function readMembers() {
  try {
    if (!fs.existsSync(membersPath)) {
      console.warn("[yazanakilogic] ⚠️ members.json not found");
      return {};
    }
    
    const raw = fs.readFileSync(membersPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error reading members.json:", err);
    return {};
  }
}

/**
 * Read clans.json
 */
function readClans() {
  try {
    if (!fs.existsSync(clansPath)) {
      console.warn("[yazanakilogic] ⚠️ clans.json not found");
      return {};
    }
    
    const raw = fs.readFileSync(clansPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error reading clans.json:", err);
    return {};
  }
}

/**
 * Read roles.json
 */
function readRoles() {
  try {
    if (!fs.existsSync(rolesPath)) {
      console.warn("[yazanakilogic] ⚠️ roles.json not found");
      return {};
    }
    
    const raw = fs.readFileSync(rolesPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[yazanakilogic] ❌ Error reading roles.json:", err);
    return {};
  }
}

/**
 * Get empire-wide statistics
 * ✅ FIXED: Now properly counts unique Discord members across all guilds
 * @param {Client} client - Discord.js client
 * @returns {Promise<Object>} Empire statistics
 */
async function getEmpireStats(client) {
  console.log("[yazanakilogic] 📊 Calculating empire statistics...");
  
  const clans = readClans();
  
  // Set to track unique Discord user IDs across all guilds
  const uniqueDiscordIds = new Set();
  
  // Track total residents from clans.json (this is the count from members.json)
  let totalResidents = 0;
  
  // ============================================================
  // STEP 1: Fetch members from Yazanaki Empire discord
  // ============================================================
  try {
    console.log(`[yazanakilogic] 📡 Fetching members from Yazanaki Empire...`);
    
    const yazanakiGuild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    
    if (yazanakiGuild) {
      const yazanakiMembers = await yazanakiGuild.members.fetch().catch(() => null);
      
      if (yazanakiMembers) {
        // Add all non-bot members to the unique set
        yazanakiMembers.forEach(member => {
          if (!member.user.bot) {
            uniqueDiscordIds.add(member.id);
          }
        });
        
        console.log(`[yazanakilogic] ✅ Yazanaki Empire: ${uniqueDiscordIds.size} unique members`);
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
  // STEP 3: Return statistics
  // ============================================================
  const totalUniquePeople = uniqueDiscordIds.size;
  
  console.log(`[yazanakilogic] 📊 Final Statistics:`);
  console.log(`[yazanakilogic] 👥 Total Unique Discord Members: ${totalUniquePeople}`);
  console.log(`[yazanakilogic] 🏠 Total Residents (from clans.json): ${totalResidents}`);
  
  return {
    totalUniquePeople,
    totalResidents
  };
}

/**
 * Get emperor and empress mentions using role IDs from roles.json
 * ✅ FIXED: Now uses role IDs from roles.json instead of searching by name
 * @param {Guild} guild - Yazanaki Empire Discord guild
 * @returns {Promise<Object>} { emperor: string, empress: string }
 */
async function getEmpireLeaders(guild) {
  console.log("[yazanakilogic] 👑 Finding empire leaders...");
  
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
    
    // Fetch all members from the guild
    const members = await guild.members.fetch();
    
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

module.exports = {
  getEmpireStats,
  getEmpireLeaders,
  readMembers,
  readClans
};