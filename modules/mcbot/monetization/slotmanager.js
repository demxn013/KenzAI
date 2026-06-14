// Discord Bot/modules/mcbot/monetization/slotmanager.js
// Core slot allocation, preemption, queue promotion, and subscription management.

"use strict";

const db = require("./subscriptiondb");

// ============================================================
// TIER CONFIGURATION
// globalLimit  — max occupied slots across ALL users for this tier
// maxPerUser   — max slots a single user of this tier can hold
// priority     — higher = can preempt lower-priority tiers
//
// Override via .env:
//   TIER_STANDARD_LIMIT, TIER_PREMIUM_LIMIT, TIER_VIP_LIMIT
//   TIER_STANDARD_PER_USER, TIER_PREMIUM_PER_USER, TIER_VIP_PER_USER
// ============================================================

function getTierConfig() {
  return {
    standard: {
      globalLimit: parseInt(process.env.TIER_STANDARD_LIMIT    || "10", 10),
      maxPerUser:  parseInt(process.env.TIER_STANDARD_PER_USER || "1",  10),
      priority:    1,
    },
    premium: {
      globalLimit: parseInt(process.env.TIER_PREMIUM_LIMIT    || "20", 10),
      maxPerUser:  parseInt(process.env.TIER_PREMIUM_PER_USER || "2",  10),
      priority:    2,
    },
    vip: {
      globalLimit: parseInt(process.env.TIER_VIP_LIMIT    || "5", 10),
      maxPerUser:  parseInt(process.env.TIER_VIP_PER_USER || "3", 10),
      priority:    3,
    },
  };
}

// ============================================================
// SUBSCRIPTION CHECK
// ============================================================

/**
 * Check if a user has an active, valid subscription.
 * @returns {{ valid: boolean, user: object, tier: string|null, reason: string|null }}
 */
function checkSubscription(discordId) {
  const user = db.getOrCreateUser(discordId);

  if (!user.active || user.subscription_tier === "none") {
    return { valid: false, user, tier: null, reason: "no_subscription" };
  }

  const tierConfig = getTierConfig();
  if (!tierConfig[user.subscription_tier]) {
    return { valid: false, user, tier: null, reason: "invalid_tier" };
  }

  return { valid: true, user, tier: user.subscription_tier, reason: null };
}

// ============================================================
// SLOT REQUEST
// ============================================================

/**
 * Request a slot for a user + Minecraft account combo.
 * @returns {{ status: "assigned"|"queued"|"already_assigned"|"error", slot?, queueEntry?, position?, displaced?, message: string }}
 */
function requestSlot(discordId, mcUsername, extra = {}) {
  const subCheck = checkSubscription(discordId);

  if (!subCheck.valid) {
    const msgs = {
      no_subscription: "❌ You need an active **KenzAI subscription** to use the bot system.\nUse `/mcbot slot status` to see your subscription info.",
      invalid_tier:    "❌ Your subscription tier is invalid. Please contact an admin.",
    };
    return { status: "error", message: msgs[subCheck.reason] || "Subscription check failed." };
  }

  const { tier }   = subCheck;
  const tierConfig = getTierConfig();
  const config     = tierConfig[tier];

  // Already assigned this exact account?
  const existingSlot = db.getSlotForUserAccount(discordId, mcUsername);
  if (existingSlot) {
    return { status: "already_assigned", slot: existingSlot, message: "✅ Slot already active for this account." };
  }

  // User slot cap
  const userSlots = db.getSlotsForUser(discordId);
  if (userSlots.length >= config.maxPerUser) {
    return {
      status:  "error",
      message: `❌ You've reached your slot limit (**${config.maxPerUser}**) for the **${tier}** tier.\nRelease a slot with \`/mcbot slot release\` before starting another bot.`,
    };
  }

  // Global tier cap — try to assign directly
  const occupied = db.countOccupiedSlotsByTier(tier);
  if (occupied < config.globalLimit) {
    const slot = db.createSlot({ tier, owner_id: discordId, mc_username: mcUsername, priority: config.priority, ...extra });
    return { status: "assigned", slot, message: "✅ Slot assigned." };
  }

  // Preemption for Premium / VIP
  if (config.priority > 1) {
    const preemptResult = _attemptPreemption(discordId, mcUsername, tier, config, extra);
    if (preemptResult) return preemptResult;
  }

  // Queue
  const alreadyQueued = db.getQueueForUser(discordId);
  if (alreadyQueued) {
    const pos = db.getQueuePosition(discordId);
    return {
      status:     "queued",
      queueEntry: alreadyQueued,
      position:   pos,
      message:    `⏳ You're already in the queue at position **#${pos}**.\nWe'll notify you when a slot opens up.`,
    };
  }

  const queueEntry = db.addToQueue({ user_id: discordId, tier, mc_username: mcUsername, ...extra });
  const position   = db.getQueuePosition(discordId);
  return {
    status:     "queued",
    queueEntry,
    position,
    message:    `⏳ All **${tier}** slots are currently full. You've been added to the queue at position **#${position}**.`,
  };
}

/**
 * Internal: try to preempt the lowest-priority, oldest slot from a lower tier.
 * @private
 */
function _attemptPreemption(discordId, mcUsername, tier, config, extra) {
  const tierConfig = getTierConfig();
  const lowerTiers = Object.entries(tierConfig)
    .filter(([, c]) => c.priority < config.priority)
    .sort((a, b) => a[1].priority - b[1].priority)
    .map(([t]) => t);

  const allSlots = db.getAllSlots();

  for (const lowerTier of lowerTiers) {
    const candidates = Object.values(allSlots)
      .filter(s => s.tier === lowerTier)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    if (candidates.length === 0) continue;

    const target   = candidates[0];
    const displaced = db.deleteSlot(target.slot_id);
    if (!displaced) continue;

    if (!db.getQueueForUser(displaced.owner_id)) {
      db.addToQueue({
        user_id:      displaced.owner_id,
        tier:         displaced.tier,
        mc_username:  displaced.mc_username,
        displaced_by: discordId,
      });
    }

    const slot = db.createSlot({
      tier,
      owner_id:       discordId,
      mc_username:    mcUsername,
      priority:       config.priority,
      preempted_from: displaced.owner_id,
      ...extra,
    });

    console.log(`[slotmanager] ⚡ ${discordId} (${tier}) preempted slot from ${displaced.owner_id} (${lowerTier})`);
    return {
      status:   "assigned",
      slot,
      displaced,
      message:  "✅ Slot assigned. (A lower-tier user was preempted and placed back in the queue.)",
    };
  }

  return null;
}

// ============================================================
// SLOT RELEASE
// ============================================================

/**
 * Release a slot by slot ID. Validates ownership unless isAdmin = true.
 * Automatically promotes the next queued user.
 */
function releaseSlot(slotId, requestingUserId, isAdmin = false) {
  const slot = db.getSlot(slotId);
  if (!slot)                                           return { success: false, message: "❌ Slot not found." };
  if (!isAdmin && slot.owner_id !== requestingUserId)  return { success: false, message: "❌ You don't own this slot." };

  const released = db.deleteSlot(slotId);
  if (!released) return { success: false, message: "❌ Failed to release slot." };

  const nextUser = _promoteFromQueue();
  return { success: true, slot: released, nextUser, message: "✅ Slot released." };
}

/**
 * Release the slot for a specific Discord user + MC account combo.
 */
function releaseSlotByUser(discordId, mcUsername) {
  const slot = db.getSlotForUserAccount(discordId, mcUsername);
  if (!slot) return { success: false, message: "No active slot found for this account." };
  return releaseSlot(slot.slot_id, discordId);
}

/**
 * Revoke ALL slots for a user (subscription cancelled or admin action).
 */
function revokeAllSlotsForUser(discordId) {
  const slots     = db.getSlotsForUser(discordId);
  const nextUsers = [];
  for (const slot of slots) {
    const result = releaseSlot(slot.slot_id, discordId, true);
    if (result.success && result.nextUser) nextUsers.push(result.nextUser);
  }
  db.removeFromQueue(discordId);
  return { revokedSlots: slots.length, nextUsers };
}

/**
 * Emergency: clear every active slot.
 */
function clearAllActiveSlots() {
  const allSlots = db.getAllSlots();
  db.clearAllSlots();
  console.log(`[slotmanager] 🚨 All ${Object.keys(allSlots).length} active slots cleared (emergency stopall)`);
}

// ============================================================
// QUEUE PROMOTION
// ============================================================

/**
 * After any slot release, assign to the highest-priority queued user who fits.
 * @private
 */
function _promoteFromQueue() {
  const tierConfig = getTierConfig();
  const sorted     = db.getAllQueueSorted();

  for (const entry of sorted) {
    const config = tierConfig[entry.tier];
    if (!config) continue;

    const occupied = db.countOccupiedSlotsByTier(entry.tier);
    if (occupied >= config.globalLimit) continue;

    db.removeFromQueue(entry.user_id);
    const slot = db.createSlot({
      tier:        entry.tier,
      owner_id:    entry.user_id,
      mc_username: entry.mc_username,
      priority:    config.priority,
    });

    console.log(`[slotmanager] ✅ Promoted ${entry.user_id} from queue → slot ${slot.slot_id}`);
    return { ...entry, slot };
  }

  return null;
}

// ============================================================
// SUBSCRIPTION MANAGEMENT
// ============================================================

function grantSubscription(discordId, tier, platform, paymentId = null) {
  const tierConfig = getTierConfig();
  const config     = tierConfig[tier];
  if (!config) return { success: false, message: `Invalid tier: ${tier}` };

  db.updateUser(discordId, {
    subscription_tier: tier,
    payment_platform:  platform,
    payment_id:        paymentId,
    active:            true,
    max_slots_allowed: config.maxPerUser,
  });

  db.logSubscriptionAction(discordId, "subscribed", tier, platform, { payment_id: paymentId });
  console.log(`[slotmanager] ✅ Granted ${tier} to ${discordId} via ${platform}`);
  return { success: true };
}

function revokeSubscription(discordId, platform = null) {
  const user     = db.getUser(discordId);
  const prevTier = user?.subscription_tier || "none";

  db.updateUser(discordId, { subscription_tier: "none", active: false, max_slots_allowed: 0 });

  const { revokedSlots } = revokeAllSlotsForUser(discordId);
  db.logSubscriptionAction(discordId, "canceled", prevTier, platform || user?.payment_platform || "manual");

  console.log(`[slotmanager] ❌ Revoked subscription for ${discordId} (was ${prevTier})`);
  return { success: true, revokedSlots };
}

function updateSubscriptionTier(discordId, newTier, platform = null) {
  const tierConfig = getTierConfig();
  const config     = tierConfig[newTier];
  if (!config) return { success: false, message: `Invalid tier: ${newTier}` };

  const user     = db.getUser(discordId);
  const prevTier = user?.subscription_tier;

  db.updateUser(discordId, {
    subscription_tier: newTier,
    active:            true,
    max_slots_allowed: config.maxPerUser,
    payment_platform:  platform || user?.payment_platform,
  });

  // On downgrade: release excess slots
  const userSlots = db.getSlotsForUser(discordId);
  if (userSlots.length > config.maxPerUser) {
    for (const s of userSlots.slice(config.maxPerUser)) releaseSlot(s.slot_id, discordId, true);
  }

  db.logSubscriptionAction(discordId, "tier_updated", newTier, platform || user?.payment_platform, { prev_tier: prevTier });
  console.log(`[slotmanager] 🔄 Updated ${discordId}: ${prevTier} → ${newTier}`);
  return { success: true };
}

// ============================================================
// STATUS / QUERY HELPERS
// ============================================================

function getSlotAvailability() {
  const tierConfig = getTierConfig();
  const result     = {};
  for (const [tier, config] of Object.entries(tierConfig)) {
    const occupied = db.countOccupiedSlotsByTier(tier);
    result[tier]   = {
      total:      config.globalLimit,
      occupied,
      available:  Math.max(0, config.globalLimit - occupied),
      maxPerUser: config.maxPerUser,
    };
  }
  return result;
}

function getQueueStats() {
  const entries = db.getAllQueueSorted();
  return { total: entries.length, entries };
}

module.exports = {
  checkSubscription,
  getSlotAvailability,
  getQueueStats,
  getTierConfig,
  requestSlot,
  releaseSlot,
  releaseSlotByUser,
  revokeAllSlotsForUser,
  clearAllActiveSlots,
  grantSubscription,
  revokeSubscription,
  updateSubscriptionTier,
};