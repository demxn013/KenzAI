// modules/stock/chart.js
// Renders a clan stock's price history in two styles, both using the
// Yazanaki brand palette (black, red, white — no green):
//   - renderStockChart:      "OHLC bar" style — a vertical low->high line per
//                             candle with a horizontal open tick (left) and
//                             close tick (right). Candlesticks, but a line
//                             instead of a filled body.
//   - renderStockLineChart:  a simple price-over-time line with a dot marker
//                             per candle's close, colored per-segment by
//                             direction (red = down, black = up/flat).

const { createCanvas } = require("@napi-rs/canvas");
const { formatMoney } = require("../servers/serverembed");

const WIDTH = 800;
const HEIGHT = 400;
const PADDING = { top: 56, right: 30, bottom: 50, left: 90 };
const MAX_VISIBLE_CANDLES = 60;

// Yazanaki brand palette — black, red, white. No green anywhere.
const BG_COLOR = "#ffffff";
const TEXT_COLOR = "#111111";
const GRID_COLOR = "#e0e0e0";
const UP_COLOR = "#111111";   // black — upward / flat movement
const DOWN_COLOR = "#d40000"; // red — downward movement

function formatCandleDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function drawTitle(ctx, title, subtitle) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(title, PADDING.left, 28);
  if (subtitle) {
    ctx.font = "14px sans-serif";
    ctx.fillText(subtitle, PADDING.left, 48);
  }
}

function drawEmptyState(ctx, plotLeft, plotTop, plotHeight) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "16px sans-serif";
  ctx.fillText("No price history yet — check back after the next update.", plotLeft, plotTop + plotHeight / 2);
}

function computePlotArea() {
  const plotLeft = PADDING.left;
  const plotRight = WIDTH - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = HEIGHT - PADDING.bottom;
  return { plotLeft, plotRight, plotTop, plotBottom, plotWidth: plotRight - plotLeft, plotHeight: plotBottom - plotTop };
}

function computeRange(visible, valuesFn) {
  let min = Math.min(...visible.map((c) => Math.min(...valuesFn(c))));
  let max = Math.max(...visible.map((c) => Math.max(...valuesFn(c))));
  if (min === max) {
    min *= 0.95;
    max *= 1.05;
  }
  const rangePad = (max - min) * 0.08;
  return { min: min - rangePad, max: max + rangePad };
}

function drawGrid(ctx, { min, max }, yFor, plotLeft, plotRight) {
  ctx.strokeStyle = GRID_COLOR;
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "12px sans-serif";
  const bands = 4;
  for (let i = 0; i <= bands; i++) {
    const value = min + ((max - min) * i) / bands;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    ctx.fillText(formatMoney(value), 4, y + 4);
  }
}

function drawDateLabels(ctx, visible, xFor, plotBottom) {
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "11px sans-serif";
  const labelEvery = Math.max(1, Math.ceil(visible.length / 10));
  visible.forEach((candle, i) => {
    if (i % labelEvery !== 0 && i !== visible.length - 1) return;
    ctx.save();
    ctx.translate(xFor(i), plotBottom + 14);
    ctx.rotate(-Math.PI / 6);
    ctx.fillText(formatCandleDate(candle.t), 0, 0);
    ctx.restore();
  });
}

/**
 * OHLC-bar chart: vertical low->high line per candle, open tick (left),
 * close tick (right). Red if the candle closed down, black if up/flat.
 * @param {Array<{t:string,o:number,h:number,l:number,c:number}>} candles
 * @param {{ title?: string, subtitle?: string }} [opts]
 * @returns {Buffer} PNG buffer
 */
function renderStockChart(candles, opts = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawTitle(ctx, opts.title || "Stock Price History", opts.subtitle);

  const { plotLeft, plotRight, plotTop, plotBottom, plotWidth, plotHeight } = computePlotArea();
  const visible = (candles || []).slice(-MAX_VISIBLE_CANDLES);

  if (!visible.length) {
    drawEmptyState(ctx, plotLeft, plotTop, plotHeight);
    return canvas.toBuffer("image/png");
  }

  const { min, max } = computeRange(visible, (c) => [c.l, c.h]);
  const yFor = (value) => plotBottom - ((value - min) / (max - min)) * plotHeight;

  drawGrid(ctx, { min, max }, yFor, plotLeft, plotRight);

  const slotWidth = plotWidth / visible.length;
  const tickWidth = Math.max(2, Math.min(10, slotWidth * 0.35));

  visible.forEach((candle, i) => {
    const x = plotLeft + slotWidth * (i + 0.5);
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? UP_COLOR : DOWN_COLOR;
    ctx.lineWidth = Math.max(1, Math.min(3, slotWidth * 0.2));

    ctx.beginPath();
    ctx.moveTo(x, yFor(candle.l));
    ctx.lineTo(x, yFor(candle.h));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - tickWidth, yFor(candle.o));
    ctx.lineTo(x, yFor(candle.o));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, yFor(candle.c));
    ctx.lineTo(x + tickWidth, yFor(candle.c));
    ctx.stroke();
  });

  drawDateLabels(ctx, visible, (i) => plotLeft + slotWidth * (i + 0.5), plotBottom);

  return canvas.toBuffer("image/png");
}

/**
 * Simple price-over-time line chart: one point per candle's close, with a
 * dot marker. Each segment/dot is colored red if that step closed down
 * from the previous one, black otherwise.
 * @param {Array<{t:string,o:number,h:number,l:number,c:number}>} candles
 * @param {{ title?: string, subtitle?: string }} [opts]
 * @returns {Buffer} PNG buffer
 */
function renderStockLineChart(candles, opts = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawTitle(ctx, opts.title || "Stock Price History", opts.subtitle);

  const { plotLeft, plotRight, plotTop, plotBottom, plotWidth, plotHeight } = computePlotArea();
  const visible = (candles || []).slice(-MAX_VISIBLE_CANDLES);

  if (!visible.length) {
    drawEmptyState(ctx, plotLeft, plotTop, plotHeight);
    return canvas.toBuffer("image/png");
  }

  const { min, max } = computeRange(visible, (c) => [c.c]);
  const yFor = (value) => plotBottom - ((value - min) / (max - min)) * plotHeight;

  drawGrid(ctx, { min, max }, yFor, plotLeft, plotRight);

  const slotWidth = visible.length > 1 ? plotWidth / (visible.length - 1) : 0;
  const xFor = (i) => (visible.length > 1 ? plotLeft + slotWidth * i : plotLeft + plotWidth / 2);
  const dotRadius = Math.max(2, Math.min(4, plotWidth / visible.length / 6));

  visible.forEach((candle, i) => {
    if (i === 0) return;
    const prev = visible[i - 1];
    const up = candle.c >= prev.c;
    ctx.strokeStyle = up ? UP_COLOR : DOWN_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xFor(i - 1), yFor(prev.c));
    ctx.lineTo(xFor(i), yFor(candle.c));
    ctx.stroke();
  });

  visible.forEach((candle, i) => {
    const up = i === 0 || candle.c >= visible[i - 1].c;
    ctx.fillStyle = up ? UP_COLOR : DOWN_COLOR;
    ctx.beginPath();
    ctx.arc(xFor(i), yFor(candle.c), dotRadius, 0, Math.PI * 2);
    ctx.fill();
  });

  drawDateLabels(ctx, visible, xFor, plotBottom);

  return canvas.toBuffer("image/png");
}

module.exports = { renderStockChart, renderStockLineChart, WIDTH, HEIGHT, UP_COLOR, DOWN_COLOR, MAX_VISIBLE_CANDLES };
