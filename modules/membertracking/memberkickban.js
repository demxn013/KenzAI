// modules/membertracking/memberkickban.js
// ✅ Member kick and ban system
// Kick: 3-month reapply cooldown
// Ban: Permanent ban from all clans

const fs = require("fs");
const path = require("path");
const { decrementClanResidents } = require("../clantracking/clanlogic");
const { readMembers, writeMembers } = require("../database/membersPersistence");
const { readClans } = require("../database/clansPersistence");
const { appendEvent } = require("../database/repositories/memberEventsRepository");
const { loadEmpireRegistry, saveEmpireRegistry } = require("../database/empireRegistryPersistence");
const { stores } = require("../database/stores");
const { getApplicant } = require("../applications/applicants");

const dataDir = path.join(__dirname, "..", "data");
const kickedMembersPath = path.join(dataDir, "kicked_members.json");
const bannedMembersPath = path.join(dataDir, "banned_members.json");

// Map basename -> dual-write store (JSON + MySQL). Used by readJSON/writeJSON.
const STORE_BY_FILE = {
  "kicked_members.json": stores.kicked_members,
  "banned_members.json": stores.banned_members,
};

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
const KICK_COOLDOWN_DAYS = 90; // 3 months
const REJECTION_COOLDOWN_DAYS = 90; // 3 months — applicants rejected cannot reapply for this long

// "Random" role in Yazanaki Empire — the baseline role every non-member holds.
// It is removed on acceptance and must be restored on kick so the user keeps a
// valid baseline role instead of being left with only @everyone.
const YAZANAKI_RANDOM_ROLE_ID = "1334846750707421194";
const RANDOM_ROLE_NAME = "random";

// ============================================================
// DATA ACCESS
// ============================================================

function readJSON(filePath) {
  const store = STORE_BY_FILE[path.basename(filePath)];
  if (store) return store.readMap();
  // Fallback for any other path (kept for safety).
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`[memberkickban] ❌ Error reading ${path.basename(filePath)}:`, err);
    return {};
  }
}

function writeJSON(filePath, data) {
  const store = STORE_BY_FILE[path.basename(filePath)];
  if (store) {
    store.writeMap(data);
    return true;
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath.replace('.json', '.backup.json'));
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error(`[memberkickban] ❌ Error writing ${path.basename(filePath)}:`, err);
    return false;
  }
}

/**
 * Helper function to get clan entry from clan name
 */
function getClanEntry(clanName) {
  try {
    const clans = readClans();
    const guildId = Object.keys(clans).find(
      (id) => clans[id].name === clanName || clans[id].abbr === clanName
    );
    if (!guildId) return null;
    return { guildId, ...clans[guildId] };
  } catch (err) {
    console.error("[memberkickban] ❌ Error reading clans:", err);
    return null;
  }
}

/**
 * Helper function to get clan guild ID from clan name
 */
function getClanGuildId(clanName) {
  const entry = getClanEntry(clanName);
  return entry ? entry.guildId : null;
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
      rolesConfig = stores.roles_config.readObject();
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load roles config for empire enemy role:`, err.message);
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
 * Remove the "empire enemy" role from a member in the Yazanaki guild (used when un-banning / pardoning).
 */
async function removeEmpireEnemyRole(discordId, client) {
  try {
    let rolesConfig = {};
    try {
      rolesConfig = stores.roles_config.readObject();
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load roles config for empire enemy role:`, err.message);
      return false;
    }
    const roleId = getEmpireEnemyRoleId(rolesConfig);
    if (!roleId) return false;
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return false;
    if (!member.roles.cache.has(roleId)) return true;
    await member.roles.remove(roleId);
    console.log(`[memberkickban] 🎭 Removed empire enemy role from ${discordId}`);
    return true;
  } catch (err) {
    console.error(`[memberkickban] ❌ Error removing empire enemy role:`, err);
    return false;
  }
}

/**
 * Remove all Yazanaki Empire roles from a member
 * @param {string} discordId
 * @param {Client} client
 * @param {Object} [options]
 * @param {string[]} [options.keepRoleIds] - role IDs to leave untouched (e.g. the "Random" baseline role on kick)
 */
async function removeAllYazanakiRoles(discordId, client, options = {}) {
  const keepRoleIds = new Set(options.keepRoleIds || []);
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
      rolesConfig = stores.roles_config.readObject();
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load roles config:`, err.message);
    }

    const yazanakiConfig = rolesConfig.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];

    let removedCount = 0;

    // Remove all rank roles
    if (yazanakiConfig?.rankRoles) {
      for (const roleId of Object.keys(yazanakiConfig.rankRoles)) {
        if (keepRoleIds.has(roleId)) continue;
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(err => console.warn(`[memberkickban] ⚠️ Could not remove rank role ${roleId}:`, err.message));
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed rank role: ${yazanakiConfig.rankRoles[roleId].name}`);
        }
      }
    }
    
    // Remove all status roles
    if (yazanakiConfig?.statusRoles) {
      for (const roleId of Object.keys(yazanakiConfig.statusRoles)) {
        if (keepRoleIds.has(roleId)) continue;
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(err => console.warn(`[memberkickban] ⚠️ Could not remove status role ${roleId}:`, err.message));
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed status role: ${yazanakiConfig.statusRoles[roleId].name}`);
        }
      }
    }
    
    // Remove clan role in Yazanaki discord (yazanakiRoleId)
    try {
      const clans = readClans();
      for (const clan of Object.values(clans)) {
        if (clan.yazanakiRoleId && member.roles.cache.has(clan.yazanakiRoleId)) {
          await member.roles.remove(clan.yazanakiRoleId).catch(err => console.warn(`[memberkickban] ⚠️ Could not remove clan Yazanaki role ${clan.yazanakiRoleId}:`, err.message));
          removedCount++;
          console.log(`[memberkickban] 🎭 Removed clan Yazanaki role: ${clan.abbr}`);
        }
      }
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not load clans:`, err.message);
    }
    
    console.log(`[memberkickban] ✅ Removed ${removedCount} Yazanaki roles from ${discordId}`);
    return removedCount;
    
  } catch (err) {
    console.error(`[memberkickban] ❌ Error removing Yazanaki roles:`, err);
    return 0;
  }
}

/**
 * Remove the member's clan-membership role from their clan discord server.
 *
 * NOTE: roles.json auto-imports *every* role of a clan guild into `rankRoles`,
 * so removing that whole list used to strip ALL of a member's roles (colours,
 * self-assigned/personal roles, etc.). We now remove only the clan membership
 * role (`clanRoleId`) and leave every unrelated role intact.
 */
async function removeAllClanRoles(discordId, clanGuildId, clanData, client) {
  if (!clanGuildId) return 0;

  try {
    const clanGuild = await client.guilds.fetch(clanGuildId).catch(() => null);
    if (!clanGuild) {
      console.warn(`[memberkickban] ⚠️ Could not fetch clan guild ${clanGuildId}`);
      return 0;
    }

    const member = await clanGuild.members.fetch(discordId).catch(() => null);
    if (!member) {
      console.warn(`[memberkickban] ⚠️ Member ${discordId} not in clan guild ${clanGuildId}`);
      return 0;
    }

    let removedCount = 0;

    // Remove only the clan membership role (clanRoleId). All other roles
    // (colour roles, personal roles, anything unrelated to the clan) are kept.
    if (clanData?.clanRoleId && member.roles.cache.has(clanData.clanRoleId)) {
      await member.roles.remove(clanData.clanRoleId).catch(err => console.warn(`[memberkickban] ⚠️ Could not remove clanRoleId:`, err.message));
      removedCount++;
      console.log(`[memberkickban] 🎭 Removed clan member role (clanRoleId) in clan discord`);
    } else {
      console.log(`[memberkickban] ℹ️ No clan membership role to remove in guild ${clanGuildId}`);
    }

    console.log(`[memberkickban] ✅ Removed ${removedCount} clan role(s) from ${discordId} in guild ${clanGuildId} (unrelated roles preserved)`);
    return removedCount;

  } catch (err) {
    console.error(`[memberkickban] ❌ Error removing clan roles for ${discordId} in ${clanGuildId}:`, err);
    return 0;
  }
}

/**
 * Restore the baseline "Random" role to a kicked member.
 * Adds the Yazanaki "Random" role (by ID) and, if present, a clan role literally
 * named "Random" (mirrors what acceptance removes), so a kicked member ends up
 * back in their pre-membership baseline state instead of role-less.
 */
async function restoreRandomRole(discordId, clanGuildId, client) {
  // 1. Yazanaki Empire "Random" role (fixed ID)
  try {
    const guild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member) {
      const randomRole = guild.roles.cache.get(YAZANAKI_RANDOM_ROLE_ID);
      if (randomRole && !member.roles.cache.has(YAZANAKI_RANDOM_ROLE_ID)) {
        await member.roles.add(YAZANAKI_RANDOM_ROLE_ID);
        console.log(`[memberkickban] 🎭 Restored Yazanaki "Random" role to ${discordId}`);
      } else if (!randomRole) {
        console.warn(`[memberkickban] ⚠️ Yazanaki "Random" role (${YAZANAKI_RANDOM_ROLE_ID}) not found in guild`);
      }
    }
  } catch (err) {
    console.warn(`[memberkickban] ⚠️ Could not restore Yazanaki "Random" role:`, err.message);
  }

  // 2. Clan discord "Random" role (matched by name, mirroring acceptance)
  if (clanGuildId) {
    try {
      const clanGuild = await client.guilds.fetch(clanGuildId).catch(() => null);
      if (clanGuild) {
        const member = await clanGuild.members.fetch(discordId).catch(() => null);
        if (member) {
          const randomRole = clanGuild.roles.cache.find(
            (r) => r && r.name && r.name.toLowerCase() === RANDOM_ROLE_NAME
          );
          if (randomRole && !member.roles.cache.has(randomRole.id)) {
            await member.roles.add(randomRole.id);
            console.log(`[memberkickban] 🎭 Restored clan "Random" role in guild ${clanGuildId}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[memberkickban] ⚠️ Could not restore clan "Random" role:`, err.message);
    }
  }
}

// ============================================================
// KICK MEMBER (3-month cooldown)
// ============================================================

/**
 * Kick a member from the Yazanaki Empire
 * - Removes all roles from Yazanaki discord
 * - Removes all roles from clan discord
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
  
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) {
    console.error(`[memberkickban] ❌ Member ${discordId} not found`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "member_not_found" };
  }
  
  try {
    // 1. Remove Yazanaki Empire roles — but KEEP the baseline "Random" role so
    //    we don't strip-then-re-add it, and so unrelated roles stay untouched.
    const yazanakiRolesRemoved = await removeAllYazanakiRoles(discordId, client, {
      keepRoleIds: [YAZANAKI_RANDOM_ROLE_ID],
    });
    console.log(`[memberkickban] 🎭 Yazanaki roles removed: ${yazanakiRolesRemoved}`);

    // 2. Remove the clan membership role from the clan discord (unrelated roles kept)
    const clanName = member.JoinedClan;
    let clanGuildId = null;
    let clanEntry = null;

    if (clanName) {
      clanEntry = getClanEntry(clanName);
      if (clanEntry) {
        clanGuildId = clanEntry.guildId;
        const clanRolesRemoved = await removeAllClanRoles(discordId, clanGuildId, clanEntry, client);
        console.log(`[memberkickban] 🎭 Clan discord roles removed: ${clanRolesRemoved}`);
      } else {
        console.warn(`[memberkickban] ⚠️ Could not find clan entry for: ${clanName}`);
      }
    }

    // 2b. Restore the baseline "Random" role(s) so the kicked member isn't left role-less.
    await restoreRandomRole(discordId, clanGuildId, client);

    // 3. Decrement clan resident count
    if (clanGuildId) {
      const decremented = decrementClanResidents(clanGuildId);
      if (decremented) {
        console.log(`[memberkickban] 📊 Decremented resident count for clan: ${clanName}`);
      }
    }
    
    // 4. Deactivate Empire ID
    const empireIds = loadEmpireRegistry();
    const empireId = member.EmpireID;
    
    if (empireId && empireIds.ids && empireIds.ids[empireId]) {
      empireIds.ids[empireId].active = false;
      empireIds.ids[empireId].kickedAt = new Date().toISOString();
      saveEmpireRegistry(empireIds);
      console.log(`[memberkickban] 🆔 Deactivated Empire ID: ${empireId}`);
    }
    
    // 5. Calculate reapply date (3 months from now)
    const kickedAt = new Date();
    const canReapplyAt = new Date(kickedAt.getTime() + (KICK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000));
    
    console.log(`[memberkickban] ⏰ Kicked at: ${kickedAt.toISOString()}`);
    console.log(`[memberkickban] ⏰ Can reapply: ${canReapplyAt.toISOString()}`);
    
    // 6. Move to kicked_members.json
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
    
    // 7. Remove from members.json
    delete members[discordId];
    writeMembers(members);
    console.log(`[memberkickban] 🗑️ Removed from members.json`);
    
    void appendEvent({
      discordId,
      eventType: "kicked",
      payload: { reason, clan: clanName, empireId },
      actorDiscordId: null,
    }).catch((e) =>
      console.error("[memberkickban] member_events (kicked):", e.message)
    );

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
 * - Removes all roles from Yazanaki discord
 * - Removes all roles from clan discord
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
  
  const members = readMembers();
  const member = members[discordId];
  const isExistingMember = !!member;

  if (!isExistingMember) {
    console.warn(`[memberkickban] ⚠️ Member ${discordId} not found in members.json - banning as NON-MEMBER`);
  }

  try {
    // 1. Remove all Yazanaki Empire roles (if they are in the guild)
    const yazanakiRolesRemoved = await removeAllYazanakiRoles(discordId, client);
    console.log(`[memberkickban] 🎭 Yazanaki roles removed: ${yazanakiRolesRemoved}`);

    // 1b. Add "empire enemy" role in Yazanaki Discord (from roles.json)
    await addEmpireEnemyRole(discordId, client);

    // 2. ✅ NEW: Remove all roles from clan discord (only if they were an existing member)
    let clanName = null;
    let clanGuildId = null;

    if (isExistingMember) {
      clanName = member.JoinedClan;
      if (clanName) {
        const clanEntry = getClanEntry(clanName);
        if (clanEntry) {
          clanGuildId = clanEntry.guildId;
          const clanRolesRemoved = await removeAllClanRoles(discordId, clanGuildId, clanEntry, client);
          console.log(`[memberkickban] 🎭 Clan discord roles removed: ${clanRolesRemoved}`);
        } else {
          console.warn(`[memberkickban] ⚠️ Could not find clan entry for: ${clanName}`);
        }
      }
    }

    // 3. Decrement clan resident count (only if they were an existing member)
    if (isExistingMember && clanGuildId) {
      const decremented = decrementClanResidents(clanGuildId);
      if (decremented) {
        console.log(`[memberkickban] 📊 Decremented resident count for clan: ${clanName}`);
      }
    }
    
    // 4. Deactivate Empire ID (only if they had one)
    let empireId = null;
    if (isExistingMember) {
      const empireIds = loadEmpireRegistry();
      empireId = member.EmpireID;
      
      if (empireId && empireIds.ids && empireIds.ids[empireId]) {
        empireIds.ids[empireId].active = false;
        empireIds.ids[empireId].bannedAt = new Date().toISOString();
        saveEmpireRegistry(empireIds);
        console.log(`[memberkickban] 🆔 Deactivated Empire ID: ${empireId}`);
      }
    }
    
    // 5. Move to banned_members.json (works for both members and non-members)
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

    // 6. Remove from members.json (only if they were an existing member)
    if (isExistingMember) {
      delete members[discordId];
      writeMembers(members);
      console.log(`[memberkickban] 🗑️ Removed from members.json`);
    }

    void appendEvent({
      discordId,
      eventType: "banned",
      payload: {
        reason,
        clan: clanName,
        empireId,
        existingMember: isExistingMember,
      },
      actorDiscordId: null,
    }).catch((e) =>
      console.error("[memberkickban] member_events (banned):", e.message)
    );
    
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
 * Determine whether a user is within the post-rejection cooldown window.
 * A rejection is an applicant record that was closed (`closedAt`) without being
 * accepted. The cooldown lasts REJECTION_COOLDOWN_DAYS from the rejection date.
 * @param {string} discordId
 * @returns {{ onCooldown: boolean, rejectedAt?: string, canReapplyAt?: Date }}
 */
function getRejectionCooldown(discordId) {
  let applicant = null;
  try {
    applicant = getApplicant(discordId);
  } catch (err) {
    console.warn(`[memberkickban] ⚠️ Could not read applicant record for ${discordId}:`, err.message);
    return { onCooldown: false };
  }

  // Only a closed-and-rejected application counts (open or accepted ones don't).
  if (!applicant || applicant.accepted || !applicant.closedAt) {
    return { onCooldown: false };
  }

  const rejectedAt = new Date(applicant.closedAt);
  if (Number.isNaN(rejectedAt.getTime())) return { onCooldown: false };

  const canReapplyAt = new Date(rejectedAt.getTime() + REJECTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  if (new Date() >= canReapplyAt) return { onCooldown: false };

  return { onCooldown: true, rejectedAt: applicant.closedAt, canReapplyAt };
}

/**
 * Check if a user is eligible to apply
 * Returns status: "eligible", "kicked", "banned", or "rejected"
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

  // Check if a previous application was rejected within the cooldown window
  const rejection = getRejectionCooldown(discordId);
  if (rejection.onCooldown) {
    const reapplyTimestamp = Math.floor(rejection.canReapplyAt.getTime() / 1000);

    console.log(`[memberkickban] ⏰ User is on REJECTED-APPLICATION COOLDOWN`);
    console.log(`[memberkickban] 📅 Can reapply: ${rejection.canReapplyAt.toISOString()}`);

    return {
      eligible: false,
      status: "rejected",
      rejectedAt: rejection.rejectedAt,
      canReapplyAt: rejection.canReapplyAt.toISOString(),
      message:
        `❌ **Your previous application was rejected.**\n\n` +
        `You can apply again: <t:${reapplyTimestamp}:F> (<t:${reapplyTimestamp}:R>)`
    };
  }

  // Not kicked, banned, or recently rejected - eligible
  console.log(`[memberkickban] ✅ User is eligible to apply`);
  
  return {
    eligible: true,
    status: "eligible",
    message: "✅ You are eligible to apply"
  };
}

// ============================================================
// PARDON HELPERS (undo punishments)
// ============================================================

/**
 * Lift a member's kick cooldown by removing their kicked_members record.
 * @returns {{ lifted: boolean, kickReason?: string }}
 */
function liftKickCooldown(discordId) {
  const kickedMembers = readJSON(kickedMembersPath);
  if (!kickedMembers[discordId]) return { lifted: false };

  const kickReason = kickedMembers[discordId].kickReason;
  delete kickedMembers[discordId];
  writeJSON(kickedMembersPath, kickedMembers);
  console.log(`[memberkickban] 🕊️ Lifted kick cooldown for ${discordId}`);
  return { lifted: true, kickReason };
}

/**
 * Lift a member's ban: remove their banned_members record and the empire enemy role.
 * @returns {Promise<{ lifted: boolean, banReason?: string }>}
 */
async function liftBan(discordId, client) {
  const bannedMembers = readJSON(bannedMembersPath);
  const banRecord = bannedMembers[discordId];

  // Always attempt to strip the enemy role, even if the record is already gone.
  await removeEmpireEnemyRole(discordId, client);

  if (!banRecord) return { lifted: false };

  const banReason = banRecord.banReason;
  delete bannedMembers[discordId];
  writeJSON(bannedMembersPath, bannedMembers);
  console.log(`[memberkickban] 🕊️ Lifted ban for ${discordId}`);
  return { lifted: true, banReason };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  kickMember,
  banMember,
  checkApplicationEligibility,
  getRejectionCooldown,
  restoreRandomRole,
  removeEmpireEnemyRole,
  liftKickCooldown,
  liftBan,
  KICK_COOLDOWN_DAYS,
  REJECTION_COOLDOWN_DAYS
};