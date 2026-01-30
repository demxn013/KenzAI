// modules/yazanaki/yazanakilogic.js
const fs = require("fs");
const path = require("path");

const membersPath = path.join(__dirname, "../data/members.json");
const clansPath = path.join(__dirname, "../data/clans.json");

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
 * @returns {Object} Empire statistics
 */
function getEmpireStats() {
  console.log("[yazanakilogic] 📊 Calculating empire statistics...");
  
  const members = readMembers();
  const clans = readClans();
  
  // Count unique members (people in members.json)
  const totalUniquePeople = Object.keys(members).length;
  console.log(`[yazanakilogic] 👥 Unique members: ${totalUniquePeople}`);
  
  // Sum residents across all clans
  let totalResidents = 0;
  
  for (const [guildId, clan] of Object.entries(clans)) {
    const residents = clan.residents || 0;
    totalResidents += residents;
    console.log(`[yazanakilogic] 🏠 ${clan.abbr}: ${residents} residents`);
  }
  
  console.log(`[yazanakilogic] 🏠 Total residents: ${totalResidents}`);
  
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
};