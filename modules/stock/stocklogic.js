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

function holdingKey(guildId, discordId) {
  return `${guildId}:${discordId}`;
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
      recentVolume: { buys: 0, sells: 0, windowStart: new Date().toISOString() },
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

// ---- Holdings ----------------------------------------------------------
// A holding tracks share count AND `invested` — the total in-game money paid
// for the shares currently held (cost basis). Buys add their cost; sells
// remove the weighted-average cost of the shares sold. This lets the
// portfolio show average buy price and profit/loss vs. the live price.

function getHoldingRecord(guildId, discordId) {
  const all = stores.stock_holdings.readMap();
  return all[holdingKey(guildId, discordId)] || null;
}

function getHolding(guildId, discordId) {
  const entry = getHoldingRecord(guildId, discordId);
  return entry ? Number(entry.shares) || 0 : 0;
}

/**
 * A member's holdings across all clans, enriched with cost-basis and live
 * valuation figures for display.
 * @returns {Array<{guildId,ign,shares,invested,avgBuyPrice,currentPrice,currentValue,profit,profitPercent}>}
 */
function getPortfolio(discordId) {
  const all = stores.stock_holdings.readMap();
  return Object.values(all)
    .filter((h) => h && h.discordId === discordId && Number(h.shares) > 0)
    .map((h) => {
      const shares = Number(h.shares) || 0;
      const invested = Number(h.invested) || 0;
      const stock = getStockRecord(h.guildId);
      const currentPrice = stock ? Number(stock.currentPrice) || 0 : 0;
      const avgBuyPrice = shares > 0 ? invested / shares : 0;
      const currentValue = shares * currentPrice;
      const profit = currentValue - invested;
      const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;
      return { guildId: h.guildId, ign: h.ign, shares, invested, avgBuyPrice, currentPrice, currentValue, profit, profitPercent };
    });
}

/** Low-level holding write. `invested` is the cost basis of the held shares. */
function writeHolding(guildId, discordId, shares, invested, ign) {
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
      invested: Math.max(0, Math.round(invested)),
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

/** Finalize a confirmed buy: shares already reserved out of treasury. */
function completeBuy({ guildId, discordId, ign, shares, pricePerShare }) {
  const existing = getHoldingRecord(guildId, discordId);
  const prevShares = existing ? Number(existing.shares) || 0 : 0;
  const prevInvested = existing ? Number(existing.invested) || 0 : 0;
  writeHolding(guildId, discordId, prevShares + shares, prevInvested + shares * pricePerShare, ign);

  const stock = getStockRecord(guildId);
  if (stock) {
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "buy", shares);
    saveStockRecord(guildId, stock);
    console.log(`[stocklogic] 💹 BUY impact: ${guildId} price ${before} → ${after}`);
  }

  const txId = logTransaction({
    guildId,
    discordId,
    ign,
    type: "buy",
    shares,
    pricePerShare,
    total: shares * pricePerShare,
    status: "confirmed",
  });
  console.log(`[stocklogic] ✅ BUY confirmed: ${discordId} (${ign}) bought ${shares} share(s) of ${guildId} @ ${pricePerShare} = ${shares * pricePerShare} [tx ${txId}]`);
  return txId;
}

/** Create a durable pending sell awaiting owner confirmation. Does NOT move shares yet. */
function createPendingSell({ guildId, discordId, ign, shares, pricePerShare }) {
  const held = getHolding(guildId, discordId);
  const reserved = getReservedSellShares(guildId, discordId);
  if (held - reserved < shares) {
    console.log(`[stocklogic] 🚫 Sell rejected for ${discordId} on ${guildId}: wanted ${shares}, only ${held - reserved} sellable (held ${held}, reserved ${reserved})`);
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
  console.log(`[stocklogic] 📉 SELL pending: ${discordId} (${ign}) selling ${shares} share(s) of ${guildId}, payout ${shares * pricePerShare} [tx ${txId}] — awaiting owner payment`);
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
    console.warn(`[stocklogic] ⚠️ markSellPaid: tx ${txId} not found or already confirmed`);
    return { success: false, reason: "not_found" };
  }

  const existing = getHoldingRecord(pending.guildId, pending.discordId);
  const held = existing ? Number(existing.shares) || 0 : 0;
  const heldInvested = existing ? Number(existing.invested) || 0 : 0;
  const debited = Math.min(held, pending.shares);
  // Remove the sold shares' weighted-average cost basis from `invested`.
  const avgCost = held > 0 ? heldInvested / held : 0;
  const remainingShares = held - debited;
  const remainingInvested = remainingShares > 0 ? heldInvested - avgCost * debited : 0;
  writeHolding(pending.guildId, pending.discordId, remainingShares, remainingInvested, pending.ign);

  const stock = getStockRecord(pending.guildId);
  if (stock) {
    stock.treasuryShares = (Number(stock.treasuryShares) || 0) + debited;
    const before = stock.currentPrice;
    const after = priceEngine.applyTradeImpact(stock, "sell", debited);
    saveStockRecord(pending.guildId, stock);
    console.log(`[stocklogic] 💹 SELL impact: ${pending.guildId} price ${before} → ${after}`);
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

  console.log(`[stocklogic] ✅ SELL paid: ${pending.discordId} (${pending.ign}) sold ${debited} share(s) of ${pending.guildId} for ${pending.payout} [tx ${txId}] — ${held - debited} share(s) remaining`);
  return { success: true, remainingHoldings: held - debited };
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
  computePriceChange,
  getClanServerId,
  getStockRecord,
  saveStockRecord,
  getOrCreateStockRecord,
  onResidentAdded,
  getHolding,
  getHoldingRecord,
  getPortfolio,
  getReservedSellShares,
  logTransaction,
  reserveTreasuryShares,
  refundTreasuryShares,
  completeBuy,
  createPendingSell,
  getPendingSell,
  markSellPaid,
};
