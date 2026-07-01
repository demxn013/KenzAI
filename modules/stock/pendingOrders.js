// modules/stock/pendingOrders.js
// Ephemeral, in-memory state machine for the 60-second buy-verification
// window. Deliberately NOT persisted: a bot restart mid-window just means
// the investor is told to retry (see the plan's accepted risk list) rather
// than trying to resurrect a stale poll loop against a possibly-changed
// balance baseline.

const donutsmp = require("../servers/donutsmp");

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5 * 1000;

/** key -> { ign, shares, cost, baselineMoney, expiresAt, pollTimer, timeoutTimer } */
const pending = new Map();

function orderKey(guildId, discordId) {
  return `${guildId}:${discordId}`;
}

function hasPendingBuy(guildId, discordId) {
  return pending.has(orderKey(guildId, discordId));
}

function clear(key) {
  const order = pending.get(key);
  if (!order) return;
  if (order.pollTimer) clearInterval(order.pollTimer);
  if (order.timeoutTimer) clearTimeout(order.timeoutTimer);
  pending.delete(key);
}

/**
 * Start watching an investor's own DonutSMP balance for a drop matching the
 * expected cost, within a 60s window. Calls exactly one of onConfirmed /
 * onTimeout / onError.
 *
 * @param {object} order - { guildId, discordId, ign, shares, cost, baselineMoney }
 * @param {object} callbacks - { onConfirmed(), onTimeout() }
 * @returns {{ success: boolean, reason?: string }}
 */
function startBuyWatch(order, { onConfirmed, onTimeout } = {}) {
  const key = orderKey(order.guildId, order.discordId);
  if (pending.has(key)) return { success: false, reason: "already_pending" };

  const windowMs = DEFAULT_WINDOW_MS;
  const expiresAt = Date.now() + windowMs;

  const entry = {
    ign: order.ign,
    shares: order.shares,
    cost: order.cost,
    baselineMoney: order.baselineMoney,
    expiresAt,
    pollTimer: null,
    timeoutTimer: null,
  };
  pending.set(key, entry);

  const checkOnce = async () => {
    if (!pending.has(key)) return; // already resolved
    const res = await donutsmp.getPlayerStats(order.ign).catch(() => ({ ok: false }));
    if (!res.ok) return;
    const currentMoney = Number(res.stats?.money) || 0;
    const dropped = entry.baselineMoney - currentMoney;
    if (dropped >= entry.cost) {
      clear(key);
      if (onConfirmed) await onConfirmed();
    }
  };

  entry.pollTimer = setInterval(checkOnce, DEFAULT_POLL_INTERVAL_MS);
  entry.timeoutTimer = setTimeout(async () => {
    if (!pending.has(key)) return;
    clear(key);
    if (onTimeout) await onTimeout();
  }, windowMs);

  return { success: true };
}

function getPendingBuy(guildId, discordId) {
  return pending.get(orderKey(guildId, discordId)) || null;
}

function cancelBuyWatch(guildId, discordId) {
  clear(orderKey(guildId, discordId));
}

module.exports = {
  DEFAULT_WINDOW_MS,
  DEFAULT_POLL_INTERVAL_MS,
  hasPendingBuy,
  startBuyWatch,
  getPendingBuy,
  cancelBuyWatch,
};
