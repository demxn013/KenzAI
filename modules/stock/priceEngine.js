// modules/stock/priceEngine.js
// Price movement for clan stocks.
//
// The price ONLY changes when shares are bought or sold (applyTradeImpact) —
// there is no random drift or background fluctuation. The scheduled tick()
// exists purely to roll the chart's candle buckets forward over time at the
// CURRENT (unchanged) price, so the graph keeps a proper time axis and reads
// as a flat line during periods with no trading.

const BAND_MIN_MULT = 0.4;        // price floor: 40% of base price
const BAND_MAX_MULT = 2.5;        // price ceiling: 250% of base price
const TRADE_IMPACT_FACTOR = 1.5;  // scales a trade's size into an immediate price move
// Cap a single trade's instant impact below the 2%+2% round-trip fee (~4.08%
// break-even) so a buyer can never profit by selling into their own price
// bump — buying then immediately selling is always a net loss.
const MAX_TRADE_IMPACT = 0.035;
const DEFAULT_CANDLE_INTERVAL_MINUTES = 60;
const CANDLE_HISTORY_LIMIT = 200;

function getCandleIntervalMs(stock) {
  const minutes = Number(stock.candleIntervalMinutes) > 0
    ? Number(stock.candleIntervalMinutes)
    : DEFAULT_CANDLE_INTERVAL_MINUTES;
  return minutes * 60 * 1000;
}

/** Ensure a stock record has the fields this module expects. */
function ensureShape(stock) {
  if (!stock.candles || !Array.isArray(stock.candles)) stock.candles = [];
  if (!stock.candleIntervalMinutes) stock.candleIntervalMinutes = DEFAULT_CANDLE_INTERVAL_MINUTES;
  return stock;
}

function clampPrice(stock, price) {
  const base = Number(stock.basePricePerShare) || price;
  const floor = base * BAND_MIN_MULT;
  const ceiling = base * BAND_MAX_MULT;
  return Math.min(ceiling, Math.max(floor, price));
}

function openNewCandle(stock, price, atIso) {
  stock.candles.push({ t: atIso, o: price, h: price, l: price, c: price });
  if (stock.candles.length > CANDLE_HISTORY_LIMIT) {
    stock.candles.shift();
  }
}

/**
 * Apply a trade's immediate, bounded market impact — the ONLY thing that moves
 * a stock's price. Buys push the price up, sells push it down, scaled by trade
 * size vs. outstanding shares and capped at MAX_TRADE_IMPACT. Not exploitable
 * for free money — buys cost real in-game currency and sells pay out real
 * currency, and the cap sits below the round-trip fee.
 * @param {object} stock
 * @param {"buy"|"sell"} type
 * @param {number} shares
 * @param {Date} [now]
 * @returns {number} the new currentPrice
 */
function applyTradeImpact(stock, type, shares, now = new Date()) {
  ensureShape(stock);
  const price = Number(stock.currentPrice) > 0
    ? Number(stock.currentPrice)
    : Number(stock.basePricePerShare) || 0;
  if (price <= 0) return price;

  const outstanding = Math.max(1, Number(stock.outstandingShares) || 1);
  const n = Math.max(0, Number(shares) || 0);
  const magnitude = Math.min(MAX_TRADE_IMPACT, (n / outstanding) * TRADE_IMPACT_FACTOR);
  const dir = type === "sell" ? -1 : 1;

  const next = Math.round(clampPrice(stock, price * (1 + dir * magnitude)));
  stock.currentPrice = next;

  // Reflect the move on the chart's current candle (open one if none yet).
  const last = stock.candles[stock.candles.length - 1];
  if (!last) {
    openNewCandle(stock, next, now.toISOString());
  } else {
    last.h = Math.max(last.h, next);
    last.l = Math.min(last.l, next);
    last.c = next;
  }
  return next;
}

/**
 * Roll the chart's candle buckets forward at the current price. Does NOT
 * change the price — a new candle just carries the current price over so the
 * graph shows a flat line while there is no trading.
 * @param {object} stock - clan_stocks record (mutated in place)
 * @param {Date} [now]
 * @returns {object} the same stock record
 */
function tick(stock, now = new Date()) {
  ensureShape(stock);

  const nowIso = now.toISOString();
  const currentPrice = Number(stock.currentPrice) > 0
    ? Number(stock.currentPrice)
    : Number(stock.basePricePerShare) || 0;

  if (currentPrice <= 0) {
    stock.lastTickAt = nowIso;
    return stock;
  }

  const intervalMs = getCandleIntervalMs(stock);
  const last = stock.candles[stock.candles.length - 1];
  const lastOpenAt = last ? new Date(last.t).getTime() : 0;

  if (!last || now.getTime() - lastOpenAt >= intervalMs) {
    openNewCandle(stock, currentPrice, nowIso);
  }

  stock.lastTickAt = nowIso;
  return stock;
}

module.exports = {
  BAND_MIN_MULT,
  BAND_MAX_MULT,
  DEFAULT_CANDLE_INTERVAL_MINUTES,
  CANDLE_HISTORY_LIMIT,
  ensureShape,
  applyTradeImpact,
  tick,
};
