// modules/yazanaki/yazanakilogic.js
const fs = require("fs");
const path = require("path");

const membersPath = path.join(__dirname, "../data/members.json");
const clansPath = path.join(__dirname, "../data/clans.json");

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
 * Get emperor and empress mentions
 * @param {Guild} guild - Yazanaki Empire Discord guild
 * @returns {Object} { emperor: string, empress: string }
 */
async function getEmpireLeaders(guild) {
  console.log("[yazanakilogic] 👑 Finding empire leaders...");
  
  try {
    // Fetch all roles
    const roles = await guild.roles.fetch();
    
    // Find Emperor and Empress roles (case-insensitive)
    const emperorRole = roles.find(role => 
      role.name.toLowerCase() === "emperor"
    );
    
    const empressRole = roles.find(role => 
      role.name.toLowerCase() === "empress"
    );
    
    let emperorMention = "``n/d``";
    let empressMention = "``n/d``";
    
    // Get members with Emperor role
    if (emperorRole) {
      const members = await guild.members.fetch();
      const emperors = members.filter(member => 
        member.roles.cache.has(emperorRole.id)
      );
      
      if (emperors.size > 0) {
        // Get all emperor mentions
        const emperorMentions = emperors.map(member => `<@${member.id}>`);
        emperorMention = emperorMentions.join(", ");
        console.log(`[yazanakilogic] 👑 Found ${emperors.size} Emperor(s)`);
      }
    } else {
      console.warn("[yazanakilogic] ⚠️ Emperor role not found");
    }
    
    // Get members with Empress role
    if (empressRole) {
      const members = await guild.members.fetch();
      const empresses = members.filter(member => 
        member.roles.cache.has(empressRole.id)
      );
      
      if (empresses.size > 0) {
        // Get all empress mentions
        const empressMentions = empresses.map(member => `<@${member.id}>`);
        empressMention = empressMentions.join(", ");
        console.log(`[yazanakilogic] 👑 Found ${empresses.size} Empress(es)`);
      }
    } else {
      console.warn("[yazanakilogic] ⚠️ Empress role not found");
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
};5