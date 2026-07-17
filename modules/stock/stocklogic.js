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

// Price per share is a fixed business rule per Minecraft server, not an
// editable config value — currently only DonutSMP clans are live (ONF).
const SERVER_PRICE_PER_SHARE = {
  donutsmp: 100000,
};

// A flat transaction fee kept by the empire owner (DEMXN13) on every trade:
// buys cost this much extra, sells pay out this much less. It gives the owner
// a margin on both sides so payouts are easier to cover.
const TAX_RATE = 0.02;

// Minimum time a member must hold shares after their most recent buy before
// they can sell — blocks buying and immediately flipping for a profit.
// Override with STOCK_SELL_COOLDOWN_MINUTES (default 1 hour).
const SELL_COOLDOWN_MS = (() => {
  const min = parseFloat(process.env.STOCK_SELL_COOLDOWN_MINUTES);
  return Number.isFinite(min) && min >= 0 ? min * 60 * 1000 : 60 * 60 * 1000;
})();

/** Buy cost breakdown: base share value + fee the investor pays on top. */
function computeBuyCost(shares, pricePerShare) {
  const base = shares * pricePerShare;
  const tax = Math.round(base * TAX_RATE);
  return { base, tax, total: base + tax };
}

/** Sell payout breakdown: base share value − fee withheld from the payout. */
function computeSellPayout(shares, pricePerShare) {
  const base = shares * pricePerShare;
  const tax = Math.round(base * TAX_RATE);
  return { base, tax, net: base - tax };
}

function genTxId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
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

  const basePricePerShare = SERVER_PRICE_PER_SHARE[serverId] || 0;
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
      createdAt: new Date().toISOString(),
      lastTickAt: null,
    };
  }

  if (isNew) {
    console.log(`[stocklogic] 🆕 Created stock record for ${clan.abbr} (${guildId}) on ${serverId} @ ${basePricePerShare}/share`);
  }

  const before = Number(stock.treasuryShares) || 0;
  reconcileResidents(stock, clan);
  const added = (Number(stock.treasuryShares) || 0) - before;
  if (added > 0) {
    console.log(`[stocklogic] 📈 Reconciled ${clan.abbr}: +${added} treasury shares (now ${stock.treasuryShares}, outstanding ${stock.outstandingShares})`);
  }

  saveStockRecord(guildId, stock);

  return { success: true, stock, clan, isNew };
}

/** Explicit hook called right after a member is accepted into a clan. */
function onResidentAdded(guildId) {
  console.log(`[stocklogic] 👤 Resident added to clan ${guildId} — issuing ${SHARES_PER_MEMBER} shares to treasury`);
  const result = getOrCreateStockRecord(guildId);
  if (!result.success) {
    console.warn(`[stocklogic] ⚠️ Could not issue shares for ${guildId}: ${result.reason}`);
  }
  return result.success;
}

// ---- Positions ---------------------------------------------------------
// Every buy is its own POSITION (a lot): its own shares, the price it was
// bought at, the total paid (cost basis, incl. the buy fee), and when it was
// opened. Positions are shown and sold individually — closing one pays out
// that position's shares at the current market price, with its own P&L. A
// position is "open" until a sell is initiated, then "pending" until the
// owner confirms payment, then it's removed. Stored in the stock_holdings
// store keyed by a unique positionId.

function genPositionId() {
  return `pos-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function getPosition(positionId) {
  const all = stores.stock_holdings.readMap();
  return all[positionId] || null;
}

/** All of a member's positions (open + pending) across every clan. */
function getRawUserPositions(discordId) {
  const all = stores.stock_holdings.readMap();
  return Object.values(all).filter(
    (p) => p && p.discordId === discordId && p.positionId && Number(p.shares) > 0
  );
}

/** Positions still on the books for a member in one clan (any status). */
function getOpenPositionCount(guildId, discordId) {
  return getRawUserPositions(discordId).filter((p) => p.guildId === guildId).length;
}

/** Milliseconds left before a position may be sold (0 = sellable now). */
function getPositionCooldownRemaining(position) {
  if (!position || !position.openedAt) return 0;
  const elapsed = Date.now() - new Date(position.openedAt).getTime();
  return Math.max(0, SELL_COOLDOWN_MS - elapsed);
}

/** Add live valuation + P&L figures to a position for display. */
function enrichPosition(p) {
  const shares = Number(p.shares) || 0;
  const buyCost = Number(p.buyCost) || 0;
  const stock = getStockRecord(p.guildId);
  const currentPrice = stock ? Number(stock.currentPrice) || 0 : 0;
  const currentValue = shares * currentPrice;
  const netIfSold = computeSellPayout(shares, currentPrice).net; // payout after fee
  const pnl = netIfSold - buyCost;
  const pnlPercent = buyCost > 0 ? (pnl / buyCost) * 100 : 0;
  return {
    positionId: p.positionId,
    guildId: p.guildId,
    discordId: p.discordId,
    ign: p.ign,
    shares,
    buyPricePerShare: Number(p.buyPricePerShare) || 0,
    buyCost,
    openedAt: p.openedAt,
    status: p.status || "open",
    currentPrice,
    currentValue,
    netIfSold,
    pnl,
    pnlPercent,
    cooldownMs: getPositionCooldownRemaining(p),
  };
}

/** A member's positions across all clans, enriched for display. */
function getUserPositions(discordId) {
  return getRawUserPositions(discordId).map(enrichPosition);
}

/** A member's positions in a single clan, enriched for display. */
function getUserPositionsInClan(guildId, discordId) {
  return getUserPositions(discordId).filter((p) => p.guildId === guildId);
}

/** Persist a new open position. */
function createPosition({ guildId, discordId, ign, shares, buyPricePerShare, buyCost }) {
  const all = stores.stock_holdings.readMap();
  const positionId = genPositionId();
  all[positionId] = {
    positionId,
    guildId,
    discordId,
    ign: ign || null,
    shares,
    buyPricePerShare: Math.round(buyPricePerShare),
    buyCost: Math.max(0, Math.round(buyCost)),
    openedAt: new Date().toISOString(),
    status: "open",
  };
  stores.stock_holdings.writeMap(all);
  return positionId;
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
    console.log(`[stocklogic] 🚫 Reserve rejected for ${guildId}: wanted ${shares}, only ${stock.treasuryShares} in treasury`);
    return { success: false, reason: "insufficient_treasury" };
  }
  stock.treasuryShares -= shares;
  saveStockRecord(guildId, stock);
  console.log(`[stocklogic] 🔒 Reserved ${shares} share(s) for ${guildId} (treasury now ${stock.treasuryShares})`);
  return { success: true };
}

function refundTreasuryShares(guildId, shares) {
  const stock = getStockRecord(guildId);
  if (!stock) return false;
  stock.treasuryShares = (Number(stock.treasuryShares) || 0) + shares;
  saveStockRecord(guildId, stock);
  console.log(`[stocklogic] 🔓 Refunded ${shares} reserved share(s) to ${guildId} treasury (now ${stock.treasuryShares})`);
  return true;
}

/**
 * Finalize a confirmed buy: shares already reserved out of treasury. Creates
 * a NEW position for this buy. `paid` is the actual amount the investor sent
 * (base + 2% fee) and becomes the position's cost basis.
 */
function completeBuy({ guildId, discordId, ign, shares, pricePerShare, paid }) {
  const buyCost = Number(paid) > 0 ? Number(paid) : computeBuyCost(shares, pricePerShare).total;
  const positionId = createPosition({ guildId, discordId, ign, shares, buyPricePerShare: pricePerShare, buyCost });

  const stock = getStockRecord(guildId);
  if (stock) {
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "buy", shares);
    saveStockRecord(guildId, stock);
    console.log(`[stocklogic] 💹 BUY impact: ${guildId} price ${before} → ${after}`);
  }

  const { base, tax } = computeBuyCost(shares, pricePerShare);
  const txId = logTransaction({
    guildId, discordId, ign, positionId,
    type: "buy", shares, pricePerShare, base, tax, total: buyCost, status: "confirmed",
  });
  console.log(`[stocklogic] ✅ BUY confirmed: ${discordId} (${ign}) opened position ${positionId} — ${shares} share(s) of ${guildId} @ ${pricePerShare} (paid ${buyCost}) [tx ${txId}]`);
  return positionId;
}

/**
 * Initiate the sale of an ENTIRE position at the current market price. Marks
 * the position pending and creates a durable pending-sell awaiting owner
 * payment. Payout = position shares × current price − 2% fee.
 */
function createPendingSellForPosition(positionId, discordId) {
  const position = getPosition(positionId);
  if (!position || position.discordId !== discordId || !position.positionId) {
    return { success: false, reason: "not_found" };
  }
  if (position.status === "pending") {
    return { success: false, reason: "already_pending" };
  }

  const cooldown = getPositionCooldownRemaining(position);
  if (cooldown > 0) {
    return { success: false, reason: "cooldown", cooldownMs: cooldown };
  }

  const stock = getStockRecord(position.guildId);
  if (!stock) return { success: false, reason: "no_stock_record" };
  const pricePerShare = Number(stock.currentPrice) || 0;
  const shares = Number(position.shares) || 0;
  const { base, tax, net } = computeSellPayout(shares, pricePerShare);

  // Mark the position pending so it can't be double-sold.
  const holdings = stores.stock_holdings.readMap();
  const txId = genTxId();
  if (holdings[positionId]) {
    holdings[positionId].status = "pending";
    holdings[positionId].pendingTxId = txId;
    stores.stock_holdings.writeMap(holdings);
  }

  const all = stores.stock_pending_sells.readMap();
  all[txId] = {
    txId,
    positionId,
    guildId: position.guildId,
    discordId,
    ign: position.ign,
    shares,
    pricePerShare,
    buyCost: Number(position.buyCost) || 0,
    grossPayout: base,
    tax,
    payout: net,
    status: "pending_payment",
    createdAt: new Date().toISOString(),
  };
  stores.stock_pending_sells.writeMap(all);
  console.log(`[stocklogic] 📉 SELL pending: ${discordId} (${position.ign}) closing position ${positionId} — ${shares} share(s) of ${position.guildId}, net payout ${net} (gross ${base} − tax ${tax}) [tx ${txId}]`);
  return { success: true, txId, shares, payout: net, grossPayout: base, tax, guildId: position.guildId, buyCost: Number(position.buyCost) || 0 };
}

function getPendingSell(txId) {
  const all = stores.stock_pending_sells.readMap();
  return all[txId] || null;
}

/** Owner has paid the investor in-game — finalize the sell and close the position. */
function markSellPaid(txId) {
  const all = stores.stock_pending_sells.readMap();
  const pending = all[txId];
  if (!pending || pending.status !== "pending_payment") {
    console.warn(`[stocklogic] ⚠️ markSellPaid: tx ${txId} not found or already confirmed`);
    return { success: false, reason: "not_found" };
  }

  const holdings = stores.stock_holdings.readMap();
  const position = pending.positionId ? holdings[pending.positionId] : null;
  const shares = position ? Number(position.shares) || 0 : Number(pending.shares) || 0;

  // Close (remove) the position.
  if (position) {
    delete holdings[pending.positionId];
    stores.stock_holdings.writeMap(holdings);
  }

  const stock = getStockRecord(pending.guildId);
  if (stock) {
    stock.treasuryShares = (Number(stock.treasuryShares) || 0) + shares;
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "sell", shares);
    saveStockRecord(pending.guildId, stock);
    console.log(`[stocklogic] 💹 SELL impact: ${pending.guildId} price ${before} → ${after}`);
  }

  pending.status = "confirmed";
  stores.stock_pending_sells.writeMap(all);

  logTransaction({
    guildId: pending.guildId,
    discordId: pending.discordId,
    ign: pending.ign,
    positionId: pending.positionId,
    type: "sell",
    shares,
    pricePerShare: pending.pricePerShare,
    total: pending.payout,
    status: "confirmed",
  });

  const remainingPositions = getOpenPositionCount(pending.guildId, pending.discordId);
  console.log(`[stocklogic] ✅ SELL paid: ${pending.discordId} (${pending.ign}) closed position ${pending.positionId} — ${shares} share(s) of ${pending.guildId} for ${pending.payout} [tx ${txId}] — ${remainingPositions} position(s) left`);
  return { success: true, remainingPositions, shares, payout: pending.payout, guildId: pending.guildId, discordId: pending.discordId };
}

/**
 * One-time migration: convert any legacy aggregate holdings (keyed by
 * guildId:discordId, with `invested`) into individual positions, and drop
 * legacy pending sells that predate position tracking. Safe to run repeatedly.
 */
function migrateLegacyHoldings() {
  const all = stores.stock_holdings.readMap();
  let migrated = 0;
  for (const key of Object.keys(all)) {
    const v = all[key];
    if (!v || v.positionId) continue; // already a position
    if (typeof v.invested === "undefined") continue; // not a legacy holding
    const shares = Number(v.shares) || 0;
    if (shares <= 0) { delete all[key]; continue; }
    const buyCost = Number(v.invested) || 0;
    // Recover the pre-fee market price from the fee-inclusive cost basis.
    const buyPricePerShare = Math.round(buyCost / (shares * (1 + TAX_RATE)));
    const positionId = genPositionId();
    all[positionId] = {
      positionId,
      guildId: v.guildId,
      discordId: v.discordId,
      ign: v.ign || null,
      shares,
      buyPricePerShare,
      buyCost,
      openedAt: v.lastBuyAt || v.updatedAt || new Date().toISOString(),
      status: "open",
    };
    delete all[key];
    migrated++;
  }
  if (migrated > 0) {
    stores.stock_holdings.writeMap(all);
    console.log(`[stocklogic] 🔀 Migrated ${migrated} legacy holding(s) into positions`);
  }

  // Legacy pending sells (no positionId) can't map to a position — drop them
  // so nothing is stuck; the seller can re-initiate from their portfolio.
  const pend = stores.stock_pending_sells.readMap();
  let droppedPend = 0;
  for (const k of Object.keys(pend)) {
    if (pend[k] && !pend[k].positionId && pend[k].status === "pending_payment") {
      delete pend[k];
      droppedPend++;
    }
  }
  if (droppedPend > 0) {
    stores.stock_pending_sells.writeMap(pend);
    console.log(`[stocklogic] 🔀 Dropped ${droppedPend} legacy pending sell(s)`);
  }
  return { migrated, droppedPend };
}

/**
 * Compare the first visible candle's open to the latest close, over
 * whatever window is currently charted (up to the last MAX_VISIBLE_CANDLES).
 * @param {Array<{o:number,c:number}>} candles
 * @returns {{ absolute: number, percent: number, direction: "up"|"down"|"flat" }}
 */
function computePriceChange(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { absolute: 0, percent: 0, direction: "flat" };
  }
  const first = candles[0].o;
  const last = candles[candles.length - 1].c;
  const absolute = last - first;
  const percent = first > 0 ? (absolute / first) * 100 : 0;
  const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  return { absolute, percent, direction };
}

module.exports = {
  SHARES_PER_MEMBER,
  TAX_RATE,
  SELL_COOLDOWN_MS,
  computeBuyCost,
  computeSellPayout,
  computePriceChange,
  getClanServerId,
  getStockRecord,
  saveStockRecord,
  getOrCreateStockRecord,
  onResidentAdded,
  getPosition,
  getUserPositions,
  getUserPositionsInClan,
  getOpenPositionCount,
  getPositionCooldownRemaining,
  createPosition,
  logTransaction,
  reserveTreasuryShares,
  refundTreasuryShares,
  completeBuy,
  createPendingSellForPosition,
  getPendingSell,
  markSellPaid,
  migrateLegacyHoldings,
};
