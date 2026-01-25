// modules/empire/draftscheduler.js
// ✅ Background scheduler for draft system

const config = require("./draftconfig");
const { readMembers, writeMembers, completeDraft } = require("./draftlogic");
const {
  createReminderEmbed,
  createExpiryEmbed,
  createAutoCitizenEmbed
} = require("./draftembed");

let schedulerInterval = null;
let client = null;

// ============================================================
// DM SENDING FUNCTIONS
// ============================================================

/**
 * Send reminder DM (2 weeks before expiry)
 */
async function sendReminderDM(discordId, memberData) {
  try {
    const user = await client.users.fetch(discordId).catch(() => null);
    
    if (!user) {
      console.warn(`[scheduler] ⚠️ Could not fetch user ${discordId}`);
      return false;
    }
    
    const embed = createReminderEmbed(memberData);
    await user.send({ embeds: [embed] });
    
    console.log(`[scheduler] ✅ Sent reminder DM to ${user.tag}`);
    return true;
    
  } catch (err) {
    console.error(`[scheduler] ❌ Failed to send reminder DM to ${discordId}:`, err.message);
    return false;
  }
}

/**
 * Send draft expiry DM with choice buttons
 */
async function sendExpiryDM(discordId, memberData) {
  try {
    const user = await client.users.fetch(discordId).catch(() => null);
    
    if (!user) {
      console.warn(`[scheduler] ⚠️ Could not fetch user ${discordId}`);
      return false;
    }
    
    const { embed, buttons } = createExpiryEmbed(discordId, memberData);
    await user.send({ embeds: [embed], components: [buttons] });
    
    console.log(`[scheduler] ✅ Sent expiry DM to ${user.tag}`);
    return true;
    
  } catch (err) {
    console.error(`[scheduler] ❌ Failed to send expiry DM to ${discordId}:`, err.message);
    return false;
  }
}

/**
 * Send auto-citizen notification DM
 */
async function sendAutoCitizenDM(discordId, memberData) {
  try {
    const user = await client.users.fetch(discordId).catch(() => null);
    
    if (!user) {
      console.warn(`[scheduler] ⚠️ Could not fetch user ${discordId}`);
      return false;
    }
    
    const embed = createAutoCitizenEmbed(memberData);
    await user.send({ embeds: [embed] });
    
    console.log(`[scheduler] ✅ Sent auto-citizen notification to ${user.tag}`);
    return true;
    
  } catch (err) {
    console.error(`[scheduler] ❌ Failed to send auto-citizen DM to ${discordId}:`, err.message);
    return false;
  }
}

// ============================================================
// DRAFT CHECKING LOGIC
// ============================================================

/**
 * Check all drafts for reminders, expiries, and auto-defaults
 */
async function checkDrafts() {
  if (!client) {
    console.warn("[scheduler] ⚠️ Client not initialized, skipping draft check");
    return;
  }
  
  const members = readMembers();
  const now = new Date();
  let changesNeeded = false;
  
  for (const [discordId, member] of Object.entries(members)) {
    // Skip if no draft expiry date
    if (!member.draftExpiryDate) continue;
    
    // Skip if draft already completed
    if (member.draftCompletedDate) continue;
    
    const expiry = new Date(member.draftExpiryDate);
    const timeUntilExpiry = expiry - now;
    const reminderThreshold = config.getReminderTime();
    const autoCitizenTimeout = config.getAutoCitizenTimeout();
    
    // ============================================================
    // CHECK 1: Send reminder (2 weeks before expiry)
    // ============================================================
    if (timeUntilExpiry > 0 && timeUntilExpiry <= reminderThreshold && !member.draftReminderSent) {
      console.log(`[scheduler] 📧 Sending reminder to ${discordId}`);
      
      const sent = await sendReminderDM(discordId, member);
      
      if (sent || !sent) { // Mark as sent regardless (avoid spam)
        member.draftReminderSent = true;
        changesNeeded = true;
      }
    }
    
    // ============================================================
    // CHECK 2: Draft expired - send choice DM
    // ============================================================
    if (now >= expiry && !member.draftNotified) {
      console.log(`[scheduler] ⏰ Draft expired for ${discordId}`);
      
      const sent = await sendExpiryDM(discordId, member);
      
      if (sent || !sent) { // Mark as notified regardless
        member.draftNotified = true;
        member.draftNotifiedAt = now.toISOString();
        changesNeeded = true;
      }
    }
    
    // ============================================================
    // CHECK 3: Auto-default to Citizen (24 hours after notification)
    // ============================================================
    if (member.draftNotified && member.draftNotifiedAt) {
      const notifiedAt = new Date(member.draftNotifiedAt);
      const timeSinceNotified = now - notifiedAt;
      
      if (timeSinceNotified >= autoCitizenTimeout) {
        console.log(`[scheduler] ⚠️ Auto-defaulting ${discordId} to Citizen (no response)`);
        
        // Complete draft as timeout_citizen
        const result = await completeDraft(discordId, "timeout_citizen", client);
        
        if (result.success) {
          // Send notification
          await sendAutoCitizenDM(discordId, member);
          
          // Changes already written by completeDraft()
          console.log(`[scheduler] ✅ Auto-defaulted ${discordId} to Citizen`);
        }
      }
    }
  }
  
  // Write changes if any were made
  if (changesNeeded) {
    writeMembers(members);
  }
}

// ============================================================
// SCHEDULER CONTROL
// ============================================================

/**
 * Start the draft scheduler
 */
function startScheduler(discordClient) {
  if (schedulerInterval) {
    console.log("[scheduler] ⚠️ Scheduler already running");
    return;
  }
  
  client = discordClient;
  
  const interval = config.getCheckInterval();
  const mode = config.TESTING_MODE ? "TESTING" : "PRODUCTION";
  const intervalMinutes = Math.floor(interval / 1000 / 60);
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[scheduler] 🚀 Starting draft scheduler (${mode} mode)`);
  console.log(`[scheduler] ⏰ Check interval: ${intervalMinutes} minute(s)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  // Run immediately on start
  checkDrafts();
  
  // Then run on interval
  schedulerInterval = setInterval(checkDrafts, interval);
}

/**
 * Stop the draft scheduler
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[scheduler] ⏸️ Draft scheduler stopped");
  }
}

/**
 * Restart the scheduler (useful for config changes)
 */
function restartScheduler(discordClient) {
  stopScheduler();
  startScheduler(discordClient);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  startScheduler,
  stopScheduler,
  restartScheduler,
  checkDrafts // For manual testing
};