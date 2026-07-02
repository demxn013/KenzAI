// modules/stock/priceEngine.js
// Bounded random-walk + demand-pressure price movement for clan stocks.
//
// Called on a schedule (modules/stock/stockScheduler.js). Each tick nudges
// currentPrice by a small random step plus a "demand pressure" term derived
// from recent buy/sell volume, then folds the result into the open candle
// for candleIntervalMinutes-sized buckets (default hourly). Price is always
// clamped to a band around the clan's server-anchored base price so it can
// never drift away entirely, no matter how long the bot stays up.

const MAX_STEP_PCT = 0.015;       // ±1.5% bounded random walk per tick
const PRESSURE_FACTOR = 2.0;      // scales net buy/sell volume into a price nudge
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
  if (!stock.recentVolume || typeof stock.recentVolume !== "object") {
    stock.recentVolume = { buys: 0, sells: 0, windowStart: new Date().toISOString() };
  }
  if (!stock.candleIntervalMinutes) stock.candleIntervalMinutes = DEFAULT_CANDLE_INTERVAL_MINUTES;
  return stock;
}

/** Record a buy/sell so the next tick's demand pressure reflects it. */
function recordVolume(stock, type, shares) {
  ensureShape(stock);
  const n = Math.max(0, Number(shares) || 0);
  if (type === "buy") stock.recentVolume.buys += n;
  else if (type === "sell") stock.recentVolume.sells += n;
  return stock;
}

/**
 * Apply a trade's immediate, bounded market impact so the price (and the
 * live candle the chart draws) reflect an investment right away instead of
 * waiting for the next scheduler tick. Buys push the price up, sells push it
 * down, scaled by trade size vs. outstanding shares and capped at
 * MAX_TRADE_IMPACT. Not exploitable for free money — buys cost real in-game
 * currency and sells pay out real currency.
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
 * Advance a clan's stock record by one tick.
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

  const randomStep = (Math.random() * 2 - 1) * MAX_STEP_PCT;

  const outstanding = Math.max(1, Number(stock.outstandingShares) || 1);
  const { buys = 0, sells = 0 } = stock.recentVolume;
  const netPressure = ((buys - sells) / outstanding) * PRESSURE_FACTOR;

  let nextPrice = currentPrice * (1 + randomStep + netPressure);
  nextPrice = clampPrice(stock, nextPrice);
  nextPrice = Math.round(nextPrice);

  stock.currentPrice = nextPrice;

  const intervalMs = getCandleIntervalMs(stock);
  const last = stock.candles[stock.candles.length - 1];
  const lastOpenAt = last ? new Date(last.t).getTime() : 0;

  if (!last || now.getTime() - lastOpenAt >= intervalMs) {
    openNewCandle(stock, nextPrice, nowIso);
    // Reset the rolling volume window at each new candle so pressure only
    // reflects trading since the last close.
    stock.recentVolume = { buys: 0, sells: 0, windowStart: nowIso };
  } else {
    last.h = Math.max(last.h, nextPrice);
    last.l = Math.min(last.l, nextPrice);
    last.c = nextPrice;
  }

  stock.lastTickAt = nowIso;
  return stock;
}

module.exports = {
  MAX_STEP_PCT,
  PRESSURE_FACTOR,
  BAND_MIN_MULT,
  BAND_MAX_MULT,
  DEFAULT_CANDLE_INTERVAL_MINUTES,
  CANDLE_HISTORY_LIMIT,
  ensureShape,
  recordVolume,
  applyTradeImpact,
  tick,
};
