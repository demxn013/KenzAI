// modules/empire/draftlogic.js
// ✅ Core draft management logic + button handling
// ✅ NEW: Decrements clan resident count when members leave
// ✅ FIXED: Members who leave empire during draft are properly flagged
// ✅ NEW: Draft deserter system - marks members who abandon their draft

const fs = require("fs");
const path = require("path");
const config = require("./draftconfig");
const {
  createArmyConfirmationEmbed,
  createCitizenConfirmationEmbed,
  createFarewellEmbed
} = require("./draftembed");

// ✅ Import clan resident management
const { decrementClanResidents } = require("../clantracking/clanlogic");

const dataDir = path.join(__dirname, "..", "data");
const membersPath = path.join(dataDir, "members.json");
const archivedPath = path.join(dataDir, "archived_members.json");
const empireIdsPath = path.join(dataDir, "empireids.json");
const clansPath = path.join(dataDir, "clans.json");
const desertersPath = path.join(dataDir, "draft_deserters.json");

// ============================================================
// DATA ACCESS
// ============================================================

function readMembers() {
  try {
    if (!fs.existsSync(membersPath)) return {};
    const raw = fs.readFileSync(membersPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[draftlogic] ❌ Error reading members.json:", err);
    return {};
  }
}

function writeMembers(data) {
  try {
    // Create backup
    if (fs.existsSync(membersPath)) {
      const backupPath = membersPath.replace('.json', '.backup.json');
      fs.copyFileSync(membersPath, backupPath);
    }
    
    fs.writeFileSync(membersPath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error("[draftlogic] ❌ Error writing members.json:", err);
    return false;
  }
}

function readArchived() {
  try {
    if (!fs.existsSync(archivedPath)) {
      fs.writeFileSync(archivedPath, JSON.stringify({}, null, 4));
      return {};
    }
    const raw = fs.readFileSync(archivedPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[draftlogic] ❌ Error reading archived_members.json:", err);
    return {};
  }
}

function writeArchived(data) {
  try {
    fs.writeFileSync(archivedPath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error("[draftlogic] ❌ Error writing archived_members.json:", err);
    return false;
  }
}

function readEmpireIds() {
  try {
    if (!fs.existsSync(empireIdsPath)) return { nextNumber: 14, ids: {} };
    const raw = fs.readFileSync(empireIdsPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[draftlogic] ❌ Error reading empireids.json:", err);
    return { nextNumber: 14, ids: {} };
  }
}

function writeEmpireIds(data) {
  try {
    // Create backup
    if (fs.existsSync(empireIdsPath)) {
      const backupPath = empireIdsPath.replace('.json', '.backup.json');
      fs.copyFileSync(empireIdsPath, backupPath);
    }
    
    fs.writeFileSync(empireIdsPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error("[draftlogic] ❌ Error writing empireids.json:", err);
    return false;
  }
}

/**
 * Read or initialize the draft deserters list
 */
function readDeserters() {
  try {
    if (!fs.existsSync(desertersPath)) {
      fs.writeFileSync(desertersPath, JSON.stringify({}, null, 4));
      return {};
    }
    const raw = fs.readFileSync(desertersPath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[draftlogic] ❌ Error reading draft_deserters.json:", err);
    return {};
  }
}

function writeDeserters(data) {
  try {
    if (fs.existsSync(desertersPath)) {
      const backupPath = desertersPath.replace('.json', '.backup.json');
      fs.copyFileSync(desertersPath, backupPath);
    }
    fs.writeFileSync(desertersPath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error("[draftlogic] ❌ Error writing draft_deserters.json:", err);
    return false;
  }
}

/**
 * ✅ Helper function to get clan guild ID from clan name
 */
function getClanGuildId(clanName) {
  try {
    if (!fs.existsSync(clansPath)) return null;
    
    const raw = fs.readFileSync(clansPath, "utf8");
    const clans = JSON.parse(raw);
    
    // Find clan by name or abbreviation
    const guildId = Object.keys(clans).find(id =>
      clans[id].name === clanName || clans[id].abbr === clanName
    );
    
    return guildId || null;
  } catch (err) {
    console.error("[draftlogic] ❌ Error reading clans.json:", err);
    return null;
  }
}

// ============================================================
// DRAFT STATUS FUNCTIONS
// ============================================================

/**
 * Check if a member has an active draft
 */
function isDraftActive(memberData) {
  if (!memberData || !memberData.draftExpiryDate) return false;
  
  const expiry = new Date(memberData.draftExpiryDate);
  const now = new Date();
  
  // Draft is active if not yet expired and not completed
  return now < expiry && !memberData.draftCompletedDate;
}

/**
 * Get days until draft expiry
 */
function getDaysUntilExpiry(memberData) {
  if (!memberData || !memberData.draftExpiryDate) return null;
  
  const expiry = new Date(memberData.draftExpiryDate);
  const now = new Date();
  const diffMs = expiry - now;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  return Math.ceil(diffDays);
}

/**
 * Get all members with active drafts
 */
function getActiveDrafts() {
  const members = readMembers();
  const activeDrafts = [];
  
  for (const [discordId, memberData] of Object.entries(members)) {
    if (isDraftActive(memberData)) {
      activeDrafts.push({
        discordId,
        ...memberData,
        daysRemaining: getDaysUntilExpiry(memberData)
      });
    }
  }
  
  return activeDrafts;
}

/**
 * Get draft status for a specific member
 */
function getDraftStatus(discordId) {
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) return null;
  
  return {
    isActive: isDraftActive(member),
    daysRemaining: getDaysUntilExpiry(member),
    startDate: member.draftStartDate,
    expiryDate: member.draftExpiryDate,
    reminderSent: member.draftReminderSent,
    notified: member.draftNotified,
    completedDate: member.draftCompletedDate,
    outcome: member.draftOutcome
  };
}

// ============================================================
// DRAFT INITIALIZATION
// ============================================================

/**
 * Start a draft for a new member
 * Called when application is accepted with Draft role
 */
function startDraft(discordId) {
  console.log(`[draftlogic] 🎖️ Starting draft for ${discordId}`);
  
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) {
    console.error(`[draftlogic] ❌ Member ${discordId} not found in members.json`);
    return false;
  }
  
  // Check if already has draft dates
  if (member.draftStartDate && member.draftExpiryDate) {
    console.log(`[draftlogic] ℹ️ Member ${discordId} already has draft dates`);
    return true;
  }
  
  const now = new Date();
  const expiry = new Date(now.getTime() + config.getDraftDuration());
  
  member.draftStartDate = now.toISOString();
  member.draftExpiryDate = expiry.toISOString();
  member.draftReminderSent = false;
  member.draftNotified = false;
  
  const success = writeMembers(members);
  
  if (success) {
    const mode = config.TESTING_MODE ? "TESTING" : "PRODUCTION";
    const duration = config.TESTING_MODE 
      ? `${config.DRAFT_DURATION_MINUTES} minutes`
      : `${config.DRAFT_DURATION_DAYS} days`;
    
    console.log(`[draftlogic] ✅ Draft started for ${discordId} (${mode} mode)`);
    console.log(`[draftlogic] ⏰ Duration: ${duration}`);
    console.log(`[draftlogic] 📅 Expiry: ${expiry.toISOString()}`);
  }
  
  return success;
}

// ============================================================
// DRAFT COMPLETION
// ============================================================

/**
 * Complete draft with chosen outcome
 * @param {string} discordId - Discord user ID
 * @param {string} outcome - "army", "citizen", or "timeout_citizen"
 * @param {Client} client - Discord.js client
 */
async function completeDraft(discordId, outcome, client) {
  console.log(`[draftlogic] 🎯 Completing draft for ${discordId} with outcome: ${outcome}`);
  
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) {
    console.error(`[draftlogic] ❌ Member ${discordId} not found`);
    return { success: false, reason: "member_not_found" };
  }
  
  try {
    const guild = await client.guilds.fetch(config.YAZANAKI_EMPIRE_GUILD_ID);
    const guildMember = await guild.members.fetch(discordId).catch(() => null);
    
    if (!guildMember) {
      console.warn(`[draftlogic] ⚠️ Member ${discordId} not in Yazanaki Empire guild`);
      return { success: false, reason: "not_in_guild" };
    }
    
    // Remove Draft role
    const draftRole = guild.roles.cache.get(config.ROLES.DRAFT);
    if (draftRole && guildMember.roles.cache.has(config.ROLES.DRAFT)) {
      await guildMember.roles.remove(draftRole);
      console.log(`[draftlogic] ✅ Removed Draft role`);
    }
    
    // Apply outcome-specific changes
    if (outcome === "army") {
      // Add Imperial Army role
      const armyRole = guild.roles.cache.get(config.ROLES.IMPERIAL_ARMY);
      if (armyRole) {
        await guildMember.roles.add(armyRole);
        console.log(`[draftlogic] ✅ Added Imperial Army role`);
      }
      
      member.YazanakiRank = "Imperial Army";
      member.Status = "Military";
      member.draftOutcome = "army";
      
    } else if (outcome === "citizen" || outcome === "timeout_citizen") {
      // Add Citizen role (if not already present)
      const citizenRole = guild.roles.cache.get(config.ROLES.CITIZEN);
      if (citizenRole && !guildMember.roles.cache.has(config.ROLES.CITIZEN)) {
        await guildMember.roles.add(citizenRole);
        console.log(`[draftlogic] ✅ Added Citizen role`);
      }
      
      member.YazanakiRank = "Citizen";
      member.Status = "Citizen";
      member.draftOutcome = outcome;
    }
    
    // Mark draft as completed
    member.draftCompletedDate = new Date().toISOString();
    
    const success = writeMembers(members);
    
    if (success) {
      console.log(`[draftlogic] ✅ Draft completed successfully for ${discordId}`);
      console.log(`[draftlogic] 📊 Outcome: ${outcome}`);
      console.log(`[draftlogic] 🎭 New Rank: ${member.YazanakiRank}`);
    }
    
    return { success: true, outcome, newRank: member.YazanakiRank };
    
  } catch (err) {
    console.error(`[draftlogic] ❌ Error completing draft:`, err);
    return { success: false, reason: "error", error: err.message };
  }
}

// ============================================================
// MEMBER ARCHIVAL (LEAVE EMPIRE)
// ============================================================

/**
 * Archive member when they leave Yazanaki Empire
 * Removes all empire-related roles and moves to archived_members.json
 * ✅ FIXED: If member leaves during active draft, marks them as a deserter
 * ✅ NEW: Decrements clan resident count
 */
async function archiveMember(discordId, reason, client) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[draftlogic] 📦 Archiving member ${discordId}`);
  console.log(`[draftlogic] 📋 Reason: ${reason}`);
  
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) {
    console.error(`[draftlogic] ❌ Member ${discordId} not found`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "member_not_found" };
  }

  // ✅ FIXED: Check if they are leaving during an active draft
  const hadActiveDraft = isDraftActive(member);
  if (hadActiveDraft) {
    console.log(`[draftlogic] ⚠️ Member ${discordId} is leaving during an ACTIVE DRAFT — marking as deserter`);
  }
  
  try {
    // 1. Remove all Yazanaki Empire roles
    const rolesRemoved = await removeAllYazanakiRoles(discordId, client);
    console.log(`[draftlogic] 🎭 Roles removed: ${rolesRemoved}`);
    
    // 2. Deactivate Empire ID
    const empireIds = readEmpireIds();
    const empireId = member.EmpireID;
    
    if (empireId && empireIds.ids[empireId]) {
      empireIds.ids[empireId].active = false;
      empireIds.ids[empireId].archivedAt = new Date().toISOString();
      writeEmpireIds(empireIds);
      console.log(`[draftlogic] 🆔 Deactivated Empire ID: ${empireId}`);
    }
    
    // ✅ 2.5: Decrement clan resident count
    const clanName = member.JoinedClan;
    if (clanName) {
      const clanGuildId = getClanGuildId(clanName);
      
      if (clanGuildId) {
        const decremented = decrementClanResidents(clanGuildId);
        if (decremented) {
          console.log(`[draftlogic] 📊 Decremented resident count for clan: ${clanName}`);
        } else {
          console.warn(`[draftlogic] ⚠️ Failed to decrement resident count for clan: ${clanName}`);
        }
      } else {
        console.warn(`[draftlogic] ⚠️ Could not find clan guild ID for: ${clanName}`);
      }
    }
    
    // 3. Move to archived_members.json
    const archived = readArchived();
    const leftAt = new Date().toISOString();
    archived[discordId] = {
      discordId,
      empireId: member.EmpireID,
      discordUser: member.discordUser,
      minecraftUser: member.minecraftUser,
      leftDate: leftAt,
      leftReason: reason,
      // ✅ FIXED: Record if they deserted their draft
      desertedDraft: hadActiveDraft,
      draftDesertedAt: hadActiveDraft ? leftAt : null,
      originalClan: member.JoinedClan,
      originalData: { ...member }
    };
    
    writeArchived(archived);
    console.log(`[draftlogic] 📦 Moved to archived_members.json`);

    // ✅ FIXED: If they deserted their draft, add to deserters list for punishment tracking
    if (hadActiveDraft) {
      const deserters = readDeserters();
      deserters[discordId] = {
        discordId,
        discordUser: member.discordUser,
        minecraftUser: member.minecraftUser,
        empireId: member.EmpireID,
        originalClan: member.JoinedClan,
        draftStartDate: member.draftStartDate,
        draftExpiryDate: member.draftExpiryDate,
        desertedAt: leftAt,
        reason: reason,
        // Punishment fields - to be filled in when punishment is executed
        punishmentServed: false,
        punishmentType: null,
        punishmentServedAt: null
      };
      writeDeserters(deserters);
      console.log(`[draftlogic] ⚠️ Added ${discordId} to draft deserters list`);
    }
    
    // 4. Remove from members.json
    delete members[discordId];
    writeMembers(members);
    console.log(`[draftlogic] 🗑️ Removed from members.json`);
    
    console.log(`[draftlogic] ✅ Successfully archived member ${discordId}`);
    if (hadActiveDraft) {
      console.log(`[draftlogic] ⚔️ Member ${discordId} DESERTED their draft and has been flagged`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    return { success: true, empireId, desertedDraft: hadActiveDraft };
    
  } catch (err) {
    console.error(`[draftlogic] ❌ Error archiving member:`, err);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return { success: false, reason: "error", error: err.message };
  }
}

/**
 * Remove all empire-related roles from a member
 * This includes Draft, Citizen, and all ranks above Citizen
 */
async function removeAllYazanakiRoles(discordId, client) {
  try {
    const guild = await client.guilds.fetch(config.YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    
    if (!member) {
      console.warn(`[draftlogic] ⚠️ Member ${discordId} not in Yazanaki Empire`);
      return 0;
    }
    
    // Load role configuration to get role hierarchy
    const rolesConfigPath = path.join(__dirname, "..", "data", "roles.json");
    let rolesConfig = {};
    
    try {
      const raw = fs.readFileSync(rolesConfigPath, "utf8");
      rolesConfig = JSON.parse(raw);
    } catch (err) {
      console.warn(`[draftlogic] ⚠️ Could not load roles.json:`, err.message);
    }
    
    const yazanakiConfig = rolesConfig.guilds?.[config.YAZANAKI_EMPIRE_GUILD_ID];
    
    let removedCount = 0;
    
    // Remove all rank roles
    if (yazanakiConfig?.rankRoles) {
      for (const roleId of Object.keys(yazanakiConfig.rankRoles)) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(err => console.warn(`[draftlogic] ⚠️ Could not remove rank role:`, err.message));
          removedCount++;
          console.log(`[draftlogic] 🎭 Removed rank role: ${yazanakiConfig.rankRoles[roleId].name}`);
        }
      }
    }
    
    // Remove all status roles
    if (yazanakiConfig?.statusRoles) {
      for (const roleId of Object.keys(yazanakiConfig.statusRoles)) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(err => console.warn(`[draftlogic] ⚠️ Could not remove status role:`, err.message));
          removedCount++;
          console.log(`[draftlogic] 🎭 Removed status role: ${yazanakiConfig.statusRoles[roleId].name}`);
        }
      }
    }
    
    // Remove clan role (yazanakiRoleId for each clan)
    try {
      const clansRaw = fs.readFileSync(clansPath, "utf8");
      const clans = JSON.parse(clansRaw);
      
      for (const clan of Object.values(clans)) {
        if (clan.yazanakiRoleId && member.roles.cache.has(clan.yazanakiRoleId)) {
          await member.roles.remove(clan.yazanakiRoleId).catch(err => console.warn(`[draftlogic] ⚠️ Could not remove clan role:`, err.message));
          removedCount++;
          console.log(`[draftlogic] 🎭 Removed clan role: ${clan.abbr}`);
        }
      }
    } catch (err) {
      console.warn(`[draftlogic] ⚠️ Could not load clans.json:`, err.message);
    }
    
    console.log(`[draftlogic] ✅ Removed ${removedCount} roles from ${discordId}`);
    return removedCount;
    
  } catch (err) {
    console.error(`[draftlogic] ❌ Error removing roles:`, err);
    return 0;
  }
}

// ============================================================
// DRAFT DESERTER MANAGEMENT
// ============================================================

/**
 * Get all draft deserters
 * @returns {Object} Deserters data
 */
function getDeserters() {
  return readDeserters();
}

/**
 * Get deserter info for a specific user
 * @param {string} discordId
 * @returns {Object|null}
 */
function getDeserter(discordId) {
  const deserters = readDeserters();
  return deserters[discordId] || null;
}

/**
 * Mark a deserter's punishment as served
 * @param {string} discordId
 * @param {string} punishmentType - e.g. "ban_from_clan", "extended_cooldown"
 * @returns {boolean}
 */
function markPunishmentServed(discordId, punishmentType) {
  const deserters = readDeserters();
  if (!deserters[discordId]) {
    console.warn(`[draftlogic] ⚠️ No deserter record for ${discordId}`);
    return false;
  }
  deserters[discordId].punishmentServed = true;
  deserters[discordId].punishmentType = punishmentType;
  deserters[discordId].punishmentServedAt = new Date().toISOString();
  return writeDeserters(deserters);
}

/**
 * Check if a user is a draft deserter (left during active draft)
 * @param {string} discordId
 * @returns {boolean}
 */
function isDraftDeserter(discordId) {
  const deserters = readDeserters();
  return !!deserters[discordId];
}

// ============================================================
// DRAFT CANCELLATION (ADMIN)
// ============================================================

/**
 * Cancel a draft and make member a citizen
 * Used by admins
 */
async function cancelDraft(discordId, client) {
  console.log(`[draftlogic] ⚠️ Cancelling draft for ${discordId}`);
  
  const members = readMembers();
  const member = members[discordId];
  
  if (!member) {
    return { success: false, reason: "member_not_found" };
  }
  
  if (!isDraftActive(member)) {
    return { success: false, reason: "no_active_draft" };
  }
  
  // Complete as citizen
  const result = await completeDraft(discordId, "citizen", client);
  
  if (result.success) {
    console.log(`[draftlogic] ✅ Draft cancelled, member promoted to Citizen`);
  }
  
  return result;
}

// ============================================================
// BUTTON INTERACTION HANDLER
// ============================================================

/**
 * Handle draft choice button interactions
 * Called from main bot's interaction handler
 */
async function handleDraftChoice(interaction) {
  const customId = interaction.customId;
  
  // Parse button ID: draft_{choice}_{discordId}
  const parts = customId.split("_");
  
  if (parts.length !== 3 || parts[0] !== "draft") {
    return; // Not a draft button
  }
  
  const choice = parts[1]; // "army", "citizen", or "leave"
  const targetDiscordId = parts[2];
  
  // Verify the person clicking is the target
  if (interaction.user.id !== targetDiscordId) {
    return interaction.reply({
      content: "❌ This choice is not for you!",
      ephemeral: true
    });
  }
  
  await interaction.deferReply({ ephemeral: true });
  
  // Verify member still exists and has active draft
  const members = readMembers();
  const member = members[targetDiscordId];
  
  if (!member) {
    return interaction.editReply({
      content: "❌ Your member data was not found. Please contact an administrator.",
      ephemeral: true
    });
  }
  
  if (member.draftCompletedDate) {
    return interaction.editReply({
      content: "❌ Your draft has already been completed. This choice is no longer valid.",
      ephemeral: true
    });
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[draftlogic] 🎯 Processing choice for ${interaction.user.tag} (${targetDiscordId})`);
  console.log(`[draftlogic] 📊 Choice: ${choice}`);
  
  // ============================================================
  // CHOICE 1: JOIN IMPERIAL ARMY
  // ============================================================
  if (choice === "army") {
    const result = await completeDraft(targetDiscordId, "army", interaction.client);
    
    if (result.success) {
      const embed = createArmyConfirmationEmbed(member);
      await interaction.editReply({ embeds: [embed], ephemeral: true });
      
      // Disable buttons in original message
      try {
        await interaction.message.edit({ components: [] });
      } catch {}
      
      console.log(`[draftlogic] ✅ ${interaction.user.tag} joined Imperial Army`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
    } else {
      console.error(`[draftlogic] ❌ Failed to complete draft:`, result.reason);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
      return interaction.editReply({
        content: `❌ An error occurred: ${result.reason}. Please contact an administrator.`,
        ephemeral: true
      });
    }
  }
  
  // ============================================================
  // CHOICE 2: BECOME CITIZEN
  // ============================================================
  else if (choice === "citizen") {
    const result = await completeDraft(targetDiscordId, "citizen", interaction.client);
    
    if (result.success) {
      const embed = createCitizenConfirmationEmbed(member);
      await interaction.editReply({ embeds: [embed], ephemeral: true });
      
      // Disable buttons in original message
      try {
        await interaction.message.edit({ components: [] });
      } catch {}
      
      console.log(`[draftlogic] ✅ ${interaction.user.tag} became a Citizen`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
    } else {
      console.error(`[draftlogic] ❌ Failed to complete draft:`, result.reason);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
      return interaction.editReply({
        content: `❌ An error occurred: ${result.reason}. Please contact an administrator.`,
        ephemeral: true
      });
    }
  }
  
  // ============================================================
  // CHOICE 3: LEAVE YAZANAKI EMPIRE
  // ============================================================
  else if (choice === "leave") {
    const result = await archiveMember(targetDiscordId, "draft_left_empire", interaction.client);
    
    if (result.success) {
      const { EmbedBuilder } = require("discord.js");

      // ✅ FIXED: Show deserter warning if they left during an active draft
      let farewellEmbed;
      if (result.desertedDraft) {
        farewellEmbed = new EmbedBuilder()
          .setTitle("⚔️ Draft Desertion - Yazanaki Empire")
          .setDescription(
            `You have chosen to leave the Yazanaki Empire **during your active draft period**.\n\n` +
            `**Former Empire ID:** \`${result.empireId}\` *(deactivated)*\n\n` +
            `**⚠️ You have been marked as a Draft Deserter.**\n` +
            `Deserters face a permanent ban from re-joining any Yazanaki clan.\n\n` +
            `All your roles have been removed.\n\n` +
            `If you believe this is a mistake, please contact an Administrator.`
          )
          .setColor(0xFF0000)
          .setFooter({ text: "Yazanaki Empire • Draft Deserter System" });
      } else {
        farewellEmbed = createFarewellEmbed(result.empireId);
      }

      await interaction.editReply({ embeds: [farewellEmbed], ephemeral: true });
      
      // Disable buttons in original message
      try {
        await interaction.message.edit({ components: [] });
      } catch {}
      
      if (result.desertedDraft) {
        console.log(`[draftlogic] ⚔️ ${interaction.user.tag} DESERTED their draft and left the empire`);
      } else {
        console.log(`[draftlogic] ✅ ${interaction.user.tag} left the empire`);
      }
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
    } else {
      console.error(`[draftlogic] ❌ Failed to archive member:`, result.reason);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      
      return interaction.editReply({
        content: `❌ An error occurred: ${result.reason}. Please contact an administrator.`,
        ephemeral: true
      });
    }
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Status checks
  isDraftActive,
  getDaysUntilExpiry,
  getActiveDrafts,
  getDraftStatus,
  
  // Draft lifecycle
  startDraft,
  completeDraft,
  cancelDraft,
  
  // Member management
  archiveMember,
  removeAllYazanakiRoles,
  
  // Deserter management
  getDeserters,
  getDeserter,
  isDraftDeserter,
  markPunishmentServed,
  
  // Button handler
  handleDraftChoice,
  
  // Data access (for scheduler)
  readMembers,
  writeMembers
};