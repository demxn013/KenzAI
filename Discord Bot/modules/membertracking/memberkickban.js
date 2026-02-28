// modules/membertracking/memberkickban.js
// ✅ Member kick and ban system
// Kick: 3-month reapply cooldown
// Ban: Permanent ban from all clans

const fs = require("fs");
const path = require("path");
const { decrementClanResidents } = require("../clantracking/clanlogic");

const dataDir = path.join(__dirname, "..", "data");
const membersPath = path.join(dataDir, "members.json");
const kickedMembersPath = path.join(dataDir, "kicked_members.json");
const bannedMembersPath = path.join(dataDir, "banned_members.json");
const empireIdsPath = path.join(dataDir, "empireids.json");
const clansPath = path.join(dataDir, "clans.json");
const rolesConfigPath = path.join(dataDir, "roles.json");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
const KICK_COOLDOWN_DAYS = 90; // 3 months

// ============================================================
// DATA ACCESS
// ============================================================

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({}, null, 4));
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`[memberkickban] ❌ Error reading ${path.basename(filePath)}:`, err);
    return {};
  }
}

function writeJSON(filePath, data) {
  try {
    // Create backup
    if (fs.existsSync(filePath)) {
      const backupPath = filePath.replace('.json', '.backup.json');
      fs.copyFileSync(filePath, backupPath);
    }
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error(`[memberkickban] ❌ Error writing ${path.basename(filePath)}:`, err);
    return false;
  }
}

/**
 * Helper function to get clan guild ID from clan name
 */
function getClanGuildId(clanName) {
  try {
    if (!fs.existsSync(clansPath)) return null;
    
    const raw = fs.readFileSync(clansPath, "utf8");
    const clans = JSON.parse(raw);
    
    const guildId = Object.keys(clans).find(id =>
      clans[id].name === clanName || clans[id].abbr === clanName
    );
    
    return guildId || null;
  } catch (err) {
    console.error("[memberkickban] ❌ Error reading clans.json:", err);
    return null;
  }
}

/**
 * Get the "empire enemy" role ID from roles.json (for bans).
 * Uses empireEnemyRoleId if set, otherwise finds status role by name "empire enemy" or "Enemy".
 */
function getEmpireEnemyRoleId(rolesConfig) {
  const guildConfig = rolesConfig?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];
  if (!guildConfig) return null;
  if (guildConfig.empireEnemyRoleId) return guildConfig.empireEnemyRoleId;
  const statusRoles = guildConfig.statusRoles || {};
  for (const [roleId, data] of Object.entries(statusRoles)) {
    const name = (data?.name || "").toLowerCase();
    if (name === "empire enemy" || name === "enemy") return roleId;
  }
  return null;
}

/**
 * Add the "empire enemy" role to a member in the Yazanaki guild (used when banning).
 */
async function addEmpireEnemyRole(discordId, client) {
  try {
    let rolesConfig = {};
    try {
      const raw = fs.readFileSync(rolesConfigPath, "utf8");
      rolesConfig = JSON.parse(raw);
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load roles.json for empire enemy role:`, err.message);
      return false;
    }
    const roleId = getEmpireEnemyRoleId(rolesConfig);
    if (!roleId) {
      console.warn(`[memberkickban] ⚠️ No empire enemy role configured in roles.json (empireEnemyRoleId or status role "Enemy"/"empire enemy")`);
      return false;
    }
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) {
      console.warn(`[memberkickban] ⚠️ Member ${discordId} not in Yazanaki Empire - cannot add empire enemy role`);
      return false;
    }
    if (member.roles.cache.has(roleId)) {
      console.log(`[memberkickban] 🎭 User already has empire enemy role`);
      return true;
    }
    await member.roles.add(roleId);
    console.log(`[memberkickban] 🎭 Added empire enemy role to ${discordId}`);
    return true;
  } catch (err) {
    console.error(`[memberkickban] ❌ Error adding empire enemy role:`, err);
    return false;
  }
}

/**
 * Remove all Yazanaki Empire roles from a member
 */
async function removeAllYazanakiRoles(discordId, client) {
  try {
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.warn(`[memberkickban] ⚠️ Member ${discordId} not in Yazanaki Empire`);
      return 0;
    }
    
    // Load role configuration
    let rolesConfig = {};
    
    try {
      const raw = fs.readFileSync(rolesConfigPath, "utf8");
      rolesConfig = JSON.parse(raw);
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load roles.json:`, err.message);
    }
    
    const yazanakiConfig = rolesConfig.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];
    
    let removedCount = 0;
    
    // Remove all rank roles
    if (yazanakiConfig?.rankRoles) {
      for (const roleId of Object.keys(yazanakiConfig.rankRoles)) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed rank role: ${yazanakiConfig.rankRoles[roleId].name}`);
        }
      }
    }
    
    // Remove all status roles
    if (yazanakiConfig?.statusRoles) {
      for (const roleId of Object.keys(yazanakiConfig.statusRoles)) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed status role: ${yazanakiConfig.statusRoles[roleId].name}`);
        }
      }
    }
    
    // Remove clan role
    try {
      const clansRaw = fs.readFileSync(clansPath, "utf8");
      const clans = JSON.parse(clansRaw);
      
      for (const clan of Object.values(clans)) {
        if (clan.yazanakiRoleId && member.roles.cache.has(clan.yazanakiRoleId)) {
          await member.roles.remove(clan.yazanakiRoleId);
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed clan role: ${clan.abbr}`);
        }
      }
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load clans.json:`, err.message);
    }
    
    console.log(`[memberkickban] ✅ Removed ${removedCount} roles from ${discordId}`);
    return removedCount;
    
  } catch (err) {
    console.error(`[memberkickban] ❌ Error removing roles:`, err);
    return 0;
  }
}

// ============================================================
// KICK MEMBER (3-month cooldown)
// ============================================================

/**
 * Kick a member from the Yazanaki Empire
 * - Removes all roles
 * - Decrements clan resident count
 * - Deactivates Empire ID
 * - Adds 3-month reapply cooldown
 * @param {string} discordId - Discord user ID
 * @param {string} reason - Kick reason
 * @param {Client} client - Discord.js client
 * @returns {Object} Result object
 */
async function kickMember(discordId, reason, client) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[memberkickban] 🚨 Kicking member ${discordId}`);
  console.log(`[memberkickban] 📋 Reason: ${reason}`);
  
  const members = readJSON(membersPath);
  const member = members[discordId];
  
  if (!member) {
    console.error(`[memberkickban] ❌ Member ${discordId} not found`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "member_not_found" };
  }
  
  try {
    // 1. Remove all Yazanaki Empire roles
    const rolesRemoved = await removeAllYazanakiRoles(discordId, client);
    console.log(`[memberkickban] 🎭 Roles removed: ${rolesRemoved}`);
    
    // 2. Decrement clan resident count
    const clanName = member.JoinedClan;
    if (clanName) {
      const clanGuildId = getClanGuildId(clanName);
      
      if (clanGuildId) {
        const decremented = decrementClanResidents(clanGuildId);
        if (decremented) {
          console.log(`[memberkickban] 📊 Decremented resident count for clan: ${clanName}`);
        }
      }
    }
    
    // 3. Deactivate Empire ID
    const empireIds = readJSON(empireIdsPath);
    const empireId = member.EmpireID;
    
    if (empireId && empireIds.ids && empireIds.ids[empireId]) {
      empireIds.ids[empireId].active = false;
      empireIds.ids[empireId].kickedAt = new Date().toISOString();
      writeJSON(empireIdsPath, empireIds);
      console.log(`[memberkickban] 🆔 Deactivated Empire ID: ${empireId}`);
    }
    
    // 4. Calculate reapply date (3 months from now)
    const kickedAt = new Date();
    const canReapplyAt = new Date(kickedAt.getTime() + (KICK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
    
    console.log(`[memberkickban] ⏰ Kicked at: ${kickedAt.toISOString()}`);
    console.log(`[memberkickban] ⏰ Can reapply: ${canReapplyAt.toISOString()}`);
    
    // 5. Move to kicked_members.json
    const kickedMembers = readJSON(kickedMembersPath);
    kickedMembers[discordId] = {
      discordId,
      empireId: member.EmpireID,
      discordUser: member.discordUser,
      minecraftUser: member.minecraftUser,
      kickedAt: kickedAt.toISOString(),
      canReapplyAt: canReapplyAt.toISOString(),
      kickReason: reason,
      originalClan: member.JoinedClan,
      originalData: { ...member }
    };
    
    writeJSON(kickedMembersPath, kickedMembers);
    console.log(`[memberkickban] 📦 Moved to kicked_members.json`);
    
    // 6. Remove from members.json
    delete members[discordId];
    writeJSON(membersPath, members);
    console.log(`[memberkickban] 🗑️ Removed from members.json`);
    
    console.log(`[memberkickban] ✅ Successfully kicked member ${discordId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    return { 
      success: true, 
      empireId,
      clan: clanName,
      canReapplyAt: canReapplyAt.toISOString()
    };
    
  } catch (err) {
    console.error(`[memberkickban] ❌ Error kicking member:`, err);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "error", error: err.message };
  }
}

// ============================================================
// BAN MEMBER (Permanent)
// ============================================================

/**
 * Permanently ban a member from all Yazanaki clans
 * - Removes all roles
 * - Decrements clan resident count
 * - Deactivates Empire ID
 * - Permanent ban from reapplying
 * @param {string} discordId - Discord user ID
 * @param {string} reason - Ban reason
 * @param {Client} client - Discord.js client
 * @returns {Object} Result object
 */
async function banMember(discordId, reason, client) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[memberkickban] 🔨 Banning member ${discordId}`);
  console.log(`[memberkickban] 📋 Reason: ${reason}`);
  
  const members = readJSON(membersPath);
  const member = members[discordId];
  const isExistingMember = !!member;

  if (!isExistingMember) {
    console.warn(`[memberkickban] ⚠️ Member ${discordId} not found in members.json - banning as NON-MEMBER`);
  }

  try {
    // 1. Remove all Yazanaki Empire roles (if they are in the guild)
    const rolesRemoved = await removeAllYazanakiRoles(discordId, client);
    console.log(`[memberkickban] 🎭 Roles removed: ${rolesRemoved}`);

    // 1b. Add "empire enemy" role in Yazanaki Discord (from roles.json)
    await addEmpireEnemyRole(discordId, client);

    // 2. Decrement clan resident count (only if they were an existing member)
    let clanName = null;
    if (isExistingMember) {
      clanName = member.JoinedClan;
      if (clanName) {
        const clanGuildId = getClanGuildId(clanName);
        
        if (clanGuildId) {
          const decremented = decrementClanResidents(clanGuildId);
          if (decremented) {
            console.log(`[memberkickban] 📊 Decremented resident count for clan: ${clanName}`);
          }
        }
      }
    }
    
    // 3. Deactivate Empire ID (only if they had one)
    let empireId = null;
    if (isExistingMember) {
      const empireIds = readJSON(empireIdsPath);
      empireId = member.EmpireID;
      
      if (empireId && empireIds.ids && empireIds.ids[empireId]) {
        empireIds.ids[empireId].active = false;
        empireIds.ids[empireId].bannedAt = new Date().toISOString();
        writeJSON(empireIdsPath, empireIds);
        console.log(`[memberkickban] 🆔 Deactivated Empire ID: ${empireId}`);
      }
    }
    
    // 4. Move to banned_members.json (works for both members and non-members)
    const bannedMembers = readJSON(bannedMembersPath);
    const bannedAt = new Date();

    // Try to get a display tag for non-members if not stored
    let discordUserDisplay = member?.discordUser || null;
    if (!discordUserDisplay) {
      try {
        const user = await client.users.fetch(discordId);
        discordUserDisplay = user.tag;
      } catch (err) {
        console.warn(`[memberkickban] ⚠️ Could not fetch Discord user for ${discordId}:`, err.message);
      }
    }

    bannedMembers[discordId] = {
      discordId,
      empireId: empireId || null,
      discordUser: discordUserDisplay,
      minecraftUser: member?.minecraftUser || null,
      bannedAt: bannedAt.toISOString(),
      banReason: reason,
      originalClan: clanName,
      originalData: isExistingMember ? { ...member } : null,
      neverJoinedYazanaki: !isExistingMember
    };
    
    writeJSON(bannedMembersPath, bannedMembers);
    console.log(`[memberkickban] 📦 Moved to banned_members.json`);
    console.log(`[memberkickban] ⛔ PERMANENT BAN - Cannot reapply`);

    // 5. Remove from members.json (only if they were an existing member)
    if (isExistingMember) {
      delete members[discordId];
      writeJSON(membersPath, members);
      console.log(`[memberkickban] 🗑️ Removed from members.json`);
    }
    
    console.log(`[memberkickban] ✅ Successfully banned member ${discordId} (${isExistingMember ? 'existing member' : 'non-member'})`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    return { 
      success: true, 
      empireId,
      clan: clanName,
      bannedAt: bannedAt.toISOString()
    };
    
  } catch (err) {
    console.error(`[memberkickban] ❌ Error banning member:`, err);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "error", error: err.message };
  }
}

// ============================================================
// CHECK APPLICATION ELIGIBILITY
// ============================================================

/**
 * Check if a user is eligible to apply
 * Returns status: "eligible", "kicked", or "banned"
 * @param {string} discordId - Discord user ID
 * @returns {Object} Eligibility status
 */
function checkApplicationEligibility(discordId) {
  console.log(`[memberkickban] 🔍 Checking eligibility for ${discordId}`);
  
  // Check if banned
  const bannedMembers = readJSON(bannedMembersPath);
  if (bannedMembers[discordId]) {
    const banData = bannedMembers[discordId];
    console.log(`[memberkickban] ⛔ User is BANNED`);
    console.log(`[memberkickban] 📋 Ban reason: ${banData.banReason}`);
    console.log(`[memberkickban] 📅 Banned at: ${banData.bannedAt}`);
    
    return {
      eligible: false,
      status: "banned",
      reason: banData.banReason,
      bannedAt: banData.bannedAt,
      message: `⛔ **You are permanently banned from all Yazanaki clans.**\n\nReason: ${banData.banReason}\nBanned: <t:${Math.floor(new Date(banData.bannedAt).getTime() / 1000)}:F>`
    };
  }
  
  // Check if kicked with cooldown
  const kickedMembers = readJSON(kickedMembersPath);
  if (kickedMembers[discordId]) {
    const kickData = kickedMembers[discordId];
    const canReapplyAt = new Date(kickData.canReapplyAt);
    const now = new Date();
    
    if (now < canReapplyAt) {
      // Still on cooldown
      const reapplyTimestamp = Math.floor(canReapplyAt.getTime() / 1000);
      
      console.log(`[memberkickban] ⏰ User is on KICK COOLDOWN`);
      console.log(`[memberkickban] 📋 Kick reason: ${kickData.kickReason}`);
      console.log(`[memberkickban] 📅 Can reapply: ${kickData.canReapplyAt}`);
      
      return {
        eligible: false,
        status: "kicked",
        reason: kickData.kickReason,
        kickedAt: kickData.kickedAt,
        canReapplyAt: kickData.canReapplyAt,
        message: `❌ **You were kicked from the Yazanaki Empire.**\n\nReason: ${kickData.kickReason}\n\nYou can reapply: <t:${reapplyTimestamp}:F> (<t:${reapplyTimestamp}:R>)`
      };
    } else {
      // Cooldown expired - they can apply
      console.log(`[memberkickban] ✅ Kick cooldown expired - user can reapply`);
      
      return {
        eligible: true,
        status: "eligible_after_kick",
        message: "✅ You are eligible to apply (previous kick cooldown has expired)"
      };
    }
  }
  
  // Not kicked or banned - eligible
  console.log(`[memberkickban] ✅ User is eligible to apply`);
  
  return {
    eligible: true,
    status: "eligible",
    message: "✅ You are eligible to apply"
  };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  kickMember,
  banMember,
  checkApplicationEligibility,
  KICK_COOLDOWN_DAYS
};