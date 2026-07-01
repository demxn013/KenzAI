// modules/stock/stocklogic.js
// Core domain logic for the clan stock market: treasury/holdings math,
// lazy stock-record creation, resident-driven share issuance, and the
// buy/sell/transaction ledger. Mirrors modules/points/pointslogic.js's
// style (plain functions over a JSON-backed store, returning
// { success, reason } result objects).

const crypto = require("crypto");
const { stores } = require("../database/stores");
const { readClans } = require("../database/clansPersistence");
const priceEngine = require("./priceEngine");

const SHARES_PER_MEMBER = 1000;

function holdingKey(guildId, discordId) {
  return `${guildId}:${discordId}`;
}

function genTxId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function getServerConfig(serverId) {
  const all = stores.servers.readMap();
  return all && all[serverId] && typeof all[serverId] === "object" ? all[serverId] : null;
}

/** Which server key a clan is linked to. Only "donutsmp" exists today. */
function getClanServerId(clan) {
  if (clan && clan.donutsmpTeamName) return "donutsmp";
  return null;
}

/** Raw read — does NOT create a record if one doesn't exist. */
function getStockRecord(guildId) {
  const all = stores.clan_stocks.readMap();
  return all[guildId] || null;
}

function saveStockRecord(guildId, stock) {
  const all = stores.clan_stocks.readMap();
  all[guildId] = stock;
  stores.clan_stocks.writeMap(all);
  return stock;
}

/**
 * Top up treasury/outstanding shares to match the clan's current resident
 * count (1000 shares per accepted member). Safe to call repeatedly — it
 * only applies the delta since the last time it was reconciled, so shares
 * already sold to investors are never touched.
 */
function reconcileResidents(stock, clan) {
  const residents = Number(clan?.residents) || 0;
  const lastSeen = Number(stock.lastResidentsSeen) || 0;
  const delta = residents - lastSeen;
  if (delta > 0) {
    const newShares = delta * SHARES_PER_MEMBER;
    stock.treasuryShares = (Number(stock.treasuryShares) || 0) + newShares;
    stock.outstandingShares = (Number(stock.outstandingShares) || 0) + newShares;
  }
  stock.lastResidentsSeen = residents;
  return stock;
}

/**
 * Get a clan's stock record, lazily creating it (and reconciling resident
 * growth) on first access. Returns { success:false, reason } if the guild
 * isn't a registered clan or isn't linked to a supported Minecraft server.
 */
function getOrCreateStockRecord(guildId) {
  const clans = readClans();
  const clan = clans[guildId];
  if (!clan) return { success: false, reason: "clan_not_registered" };

  const serverId = getClanServerId(clan);
  if (!serverId) return { success: false, reason: "no_server_linked" };

  const serverConfig = getServerConfig(serverId);
  const basePricePerShare = Number(serverConfig?.pricePerShare) || 0;
  if (basePricePerShare <= 0) return { success: false, reason: "no_server_price_configured" };

  let stock = getStockRecord(guildId);
  const isNew = !stock;

  if (isNew) {
    stock = {
      guildId,
      server: serverId,
      basePricePerShare,
      currentPrice: basePricePerShare,
      treasuryShares: 0,
      outstandingShares: 0,
      lastResidentsSeen: 0,
      candleIntervalMinutes: priceEngine.DEFAULT_CANDLE_INTERVAL_MINUTES,
      candles: [],
      recentVolume: { buys: 0, sells: 0, windowStart: new Date().toISOString() },
      createdAt: new Date().toISOString(),
      lastTickAt: null,
    };
  }

  reconcileResidents(stock, clan);
  saveStockRecord(guildId, stock);

  return { success: true, stock, clan, isNew };
}

/** Explicit hook called right after a member is accepted into a clan. */
function onResidentAdded(guildId) {
  const result = getOrCreateStockRecord(guildId);
  return result.success;
}

// ---- Holdings ----------------------------------------------------------

function getHolding(guildId, discordId) {
  const all = stores.stock_holdings.readMap();
  const entry = all[holdingKey(guildId, discordId)];
  return entry ? Number(entry.shares) || 0 : 0;
}

function getPortfolio(discordId) {
  const all = stores.stock_holdings.readMap();
  return Object.values(all).filter(
    (h) => h && h.discordId === discordId && Number(h.shares) > 0
  );
}

function setHolding(guildId, discordId, shares, ign) {
  const all = stores.stock_holdings.readMap();
  const key = holdingKey(guildId, discordId);
  if (shares <= 0) {
    delete all[key];
  } else {
    all[key] = {
      guildId,
      discordId,
      ign: ign || all[key]?.ign || null,
      shares,
      updatedAt: new Date().toISOString(),
    };
  }
  stores.stock_holdings.writeMap(all);
}

/** Shares already committed to unresolved pending sells for this holder. */
function getReservedSellShares(guildId, discordId) {
  const all = stores.stock_pending_sells.readMap();
  return Object.values(all)
    .filter((p) => p && p.guildId === guildId && p.discordId === discordId && p.status === "pending_payment")
    .reduce((sum, p) => sum + (Number(p.shares) || 0), 0);
}

function logTransaction(entry) {
  const all = stores.stock_transactions.readMap();
  const txId = genTxId();
  all[txId] = { txId, createdAt: new Date().toISOString(), ...entry };
  stores.stock_transactions.writeMap(all);
  return txId;
}

/**
 * Reserve treasury shares for a pending buy order (optimistic — prevents two
 * concurrent buys from both passing an availability check). Refund with
 * refundTreasuryShares() on timeout/failure.
 */
function reserveTreasuryShares(guildId, shares) {
  const stock = getStockRecord(guildId);
  if (!stock) return { success: false, reason: "no_stock_record" };
  if ((Number(stock.treasuryShares) || 0) < shares) {
    return { success: false, reason: "insufficient_treasury" };
  }
  stock.treasuryShares -= shares;
  saveStockRecord(guildId, stock);
  return { success: true };
}

function refundTreasuryShares(guildId, shares) {
  const stock = getStockRecord(guildId);
  if (!stock) return false;
  stock.treasuryShares = (Number(stock.treasuryShares) || 0) + shares;
  saveStockRecord(guildId, stock);
  return true;
}

/** Finalize a confirmed buy: shares already reserved out of treasury. */
function completeBuy({ guildId, discordId, ign, shares, pricePerShare }) {
  const held = getHolding(guildId, discordId);
  setHolding(guildId, discordId, held + shares, ign);

  const stock = getStockRecord(guildId);
  if (stock) {
    priceEngine.recordVolume(stock, "buy", shares);
    saveStockRecord(guildId, stock);
  }

  return logTransaction({
    guildId,
    discordId,
    ign,
    type: "buy",
    shares,
    pricePerShare,
    total: shares * pricePerShare,
    status: "confirmed",
  });
}

/** Create a durable pending sell awaiting owner confirmation. Does NOT move shares yet. */
function createPendingSell({ guildId, discordId, ign, shares, pricePerShare }) {
  const held = getHolding(guildId, discordId);
  const reserved = getReservedSellShares(guildId, discordId);
  if (held - reserved < shares) {
    return { success: false, reason: "insufficient_holdings" };
  }

  const all = stores.stock_pending_sells.readMap();
  const txId = genTxId();
  all[txId] = {
    txId,
    guildId,
    discordId,
    ign,
    shares,
    pricePerShare,
    payout: shares * pricePerShare,
    status: "pending_payment",
    createdAt: new Date().toISOString(),
  };
  stores.stock_pending_sells.writeMap(all);
  return { success: true, txId, payout: shares * pricePerShare };
}

function getPendingSell(txId) {
  const all = stores.stock_pending_sells.readMap();
  return all[txId] || null;
}

/** Owner has paid the investor in-game — finalize the sell. */
function markSellPaid(txId) {
  const all = stores.stock_pending_sells.readMap();
  const pending = all[txId];
  if (!pending || pending.status !== "pending_payment") {
    return { success: false, reason: "not_found" };
  }

  const held = getHolding(pending.guildId, pending.discordId);
  const debited = Math.min(held, pending.shares);
  setHolding(pending.guildId, pending.discordId, held - debited, pending.ign);

  const stock = getStockRecord(pending.guildId);
  if (stock) {
    stock.treasuryShares = (Number(stock.treasuryShares) || 0) + debited;
    priceEngine.recordVolume(stock, "sell", debited);
    saveStockRecord(pending.guildId, stock);
  }

  pending.status = "confirmed";
  stores.stock_pending_sells.writeMap(all);

  logTransaction({
    guildId: pending.guildId,
    discordId: pending.discordId,
    ign: pending.ign,
    type: "sell",
    shares: debited,
    pricePerShare: pending.pricePerShare,
    total: pending.payout,
    status: "confirmed",
  });

  return { success: true, remainingHoldings: held - debited };
}

module.exports = {
  SHARES_PER_MEMBER,
  getClanServerId,
  getStockRecord,
  saveStockRecord,
  getOrCreateStockRecord,
  onResidentAdded,
  getHolding,
  getPortfolio,
  setHolding,
  getReservedSellShares,
  logTransaction,
  reserveTreasuryShares,
  refundTreasuryShares,
  completeBuy,
  createPendingSell,
  getPendingSell,
  markSellPaid,
};
