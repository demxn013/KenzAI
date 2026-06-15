// Discord Bot/modules/mcbot/monetization/subscriptiondb.js
// JSON-based data layer for subscriptions, bot slots, queue, and audit logs.
// Consistent with the existing JSON file pattern used throughout KenzAI.

"use strict";

const path = require("path");

// Persistence via dual-write MapStores (JSON + MySQL). Call sites keep using
// readJSON(FILES.x) / writeJSON(FILES.x, data); those are routed to the correct
// store by file basename below.
const { stores } = require("../../database/stores");

// Logical handles kept for call-site compatibility (basename is the lookup key).
const FILES = {
  subscriptions:     "subscriptions.json",
  bot_slots:         "bot_slots.json",
  slot_queue:        "slot_queue.json",
  subscription_logs: "subscription_logs.json",
};

const STORE_BY_FILE = {
  "subscriptions.json":     stores.subscriptions,
  "bot_slots.json":         stores.bot_slots,
  "slot_queue.json":        stores.slot_queue,
  "subscription_logs.json": stores.subscription_logs,
};

// ============================================================
// HELPERS
// ============================================================

function storeFor(filePath) {
  return STORE_BY_FILE[path.basename(filePath)] || null;
}

function readJSON(filePath) {
  const store = storeFor(filePath);
  return store ? store.readMap() : {};
}

function writeJSON(filePath, data) {
  const store = storeFor(filePath);
  if (!store) return false;
  store.writeMap(data);
  return true;
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
}

// ============================================================
// SUBSCRIPTIONS (users)
// ============================================================

function getUser(discordId) {
  const data = readJSON(FILES.subscriptions);
  return data[discordId] || null;
}

function getOrCreateUser(discordId) {
  const data = readJSON(FILES.subscriptions);
  if (!data[discordId]) {
    data[discordId] = {
      user_id:           discordId,
      subscription_tier: "none",
      payment_platform:  null,
      payment_id:        null,
      active:            false,
      max_slots_allowed: 0,
      created_at:        new Date().toISOString(),
      updated_at:        new Date().toISOString(),
    };
    writeJSON(FILES.subscriptions, data);
  }
  return data[discordId];
}

function updateUser(discordId, updates) {
  // Ensure the record exists first
  getOrCreateUser(discordId);
  const data = readJSON(FILES.subscriptions);
  Object.assign(data[discordId], updates, { updated_at: new Date().toISOString() });
  return writeJSON(FILES.subscriptions, data);
}

function getAllUsers() {
  return readJSON(FILES.subscriptions);
}

// ============================================================
// BOT SLOTS
// ============================================================

function getAllSlots() {
  return readJSON(FILES.bot_slots);
}

function getSlot(slotId) {
  return readJSON(FILES.bot_slots)[slotId] || null;
}

function getSlotsForUser(discordId) {
  return Object.values(readJSON(FILES.bot_slots)).filter(s => s.owner_id === discordId);
}

function getSlotForUserAccount(discordId, mcUsername) {
  return Object.values(readJSON(FILES.bot_slots)).find(
    s => s.owner_id === discordId &&
         s.mc_username.toLowerCase() === mcUsername.toLowerCase()
  ) || null;
}

function countOccupiedSlotsByTier(tier) {
  return Object.values(readJSON(FILES.bot_slots)).filter(s => s.tier === tier).length;
}

function createSlot(slotData) {
  const data   = readJSON(FILES.bot_slots);
  const slotId = genId("SLT");
  const now    = new Date().toISOString();
  data[slotId] = { slot_id: slotId, ...slotData, start_time: now, last_updated: now };
  writeJSON(FILES.bot_slots, data);
  return data[slotId];
}

function deleteSlot(slotId) {
  const data = readJSON(FILES.bot_slots);
  const slot = data[slotId];
  if (!slot) return null;
  delete data[slotId];
  writeJSON(FILES.bot_slots, data);
  return slot;
}

function clearAllSlots() {
  writeJSON(FILES.bot_slots, {});
}

// ============================================================
// SLOT QUEUE
// ============================================================

function getAllQueue() {
  return readJSON(FILES.slot_queue);
}

function getQueueForUser(discordId) {
  return Object.values(readJSON(FILES.slot_queue)).find(q => q.user_id === discordId) || null;
}

function getAllQueueSorted() {
  const TIER_PRIORITY = { vip: 3, premium: 2, standard: 1, none: 0 };
  return Object.values(readJSON(FILES.slot_queue)).sort((a, b) => {
    const pa = TIER_PRIORITY[a.tier] || 0;
    const pb = TIER_PRIORITY[b.tier] || 0;
    if (pb !== pa) return pb - pa;
    return new Date(a.queued_at) - new Date(b.queued_at);
  });
}

function addToQueue(entryData) {
  const data    = readJSON(FILES.slot_queue);
  const already = Object.values(data).find(q => q.user_id === entryData.user_id);
  if (already) return already;

  const queueId  = genId("Q");
  const position = getAllQueueSorted().length + 1;
  data[queueId]  = {
    queue_id:  queueId,
    ...entryData,
    position,
    queued_at: new Date().toISOString(),
  };
  writeJSON(FILES.slot_queue, data);
  return data[queueId];
}

function removeFromQueue(userId) {
  const data  = readJSON(FILES.slot_queue);
  let removed = null;
  for (const [id, entry] of Object.entries(data)) {
    if (entry.user_id === userId) {
      removed = entry;
      delete data[id];
      break;
    }
  }
  if (removed) writeJSON(FILES.slot_queue, data);
  return removed;
}

function getQueuePosition(userId) {
  const sorted = getAllQueueSorted();
  const idx    = sorted.findIndex(q => q.user_id === userId);
  return idx === -1 ? null : idx + 1;
}

// ============================================================
// SUBSCRIPTION LOGS
// ============================================================

function logSubscriptionAction(discordId, action, tier, platform, extra = {}) {
  const data  = readJSON(FILES.subscription_logs);
  const logId = genId("LOG");
  data[logId] = {
    log_id:    logId,
    user_id:   discordId,
    action,
    tier,
    platform,
    timestamp: new Date().toISOString(),
    ...extra,
  };
  writeJSON(FILES.subscription_logs, data);
  return data[logId];
}

function getLogsForUser(discordId, limit = 20) {
  return Object.values(readJSON(FILES.subscription_logs))
    .filter(l => l.user_id === discordId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

module.exports = {
  // Users
  getUser,
  getOrCreateUser,
  updateUser,
  getAllUsers,
  // Slots
  getAllSlots,
  getSlot,
  getSlotsForUser,
  getSlotForUserAccount,
  countOccupiedSlotsByTier,
  createSlot,
  deleteSlot,
  clearAllSlots,
  // Queue
  getAllQueue,
  getQueueForUser,
  getAllQueueSorted,
  addToQueue,
  removeFromQueue,
  getQueuePosition,
  // Logs
  logSubscriptionAction,
  getLogsForUser,
};