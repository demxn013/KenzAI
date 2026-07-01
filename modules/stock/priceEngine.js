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
  tick,
};
