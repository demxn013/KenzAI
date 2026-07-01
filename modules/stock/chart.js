// modules/stock/chart.js
// Renders a clan stock's price history as an "OHLC bar" chart: for each
// candle, a vertical line spans low->high, with a short horizontal tick on
// the left at the open price and one on the right at the close price
// (green if the candle closed up, red if down) — candlesticks, but with a
// line instead of a filled body.

const { createCanvas } = require("@napi-rs/canvas");
const { formatMoney } = require("../servers/serverembed");

const WIDTH = 800;
const HEIGHT = 400;
const PADDING = { top: 40, right: 30, bottom: 30, left: 90 };
const MAX_VISIBLE_CANDLES = 60;
const UP_COLOR = "#3ba55d";
const DOWN_COLOR = "#ed4245";
const BG_COLOR = "#2b2d31";
const GRID_COLOR = "#40444b";
const TEXT_COLOR = "#dcddde";

/**
 * @param {Array<{t:string,o:number,h:number,l:number,c:number}>} candles
 * @param {{ title?: string }} [opts]
 * @returns {Buffer} PNG buffer
 */
function renderStockChart(candles, opts = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const title = opts.title || "Stock Price History";
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(title, PADDING.left, 26);

  const visible = (candles || []).slice(-MAX_VISIBLE_CANDLES);

  const plotLeft = PADDING.left;
  const plotRight = WIDTH - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = HEIGHT - PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  if (!visible.length) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "16px sans-serif";
    ctx.fillText("No price history yet — check back after the next update.", plotLeft, plotTop + plotHeight / 2);
    return canvas.toBuffer("image/png");
  }

  let min = Math.min(...visible.map((c) => c.l));
  let max = Math.max(...visible.map((c) => c.h));
  if (min === max) {
    min *= 0.95;
    max *= 1.05;
  }
  const rangePad = (max - min) * 0.08;
  min -= rangePad;
  max += rangePad;

  const yFor = (value) => plotBottom - ((value - min) / (max - min)) * plotHeight;

  // Gridlines + axis labels (4 horizontal bands).
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

  const slotWidth = plotWidth / visible.length;
  const tickWidth = Math.max(2, Math.min(10, slotWidth * 0.35));

  visible.forEach((candle, i) => {
    const x = plotLeft + slotWidth * (i + 0.5);
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? UP_COLOR : DOWN_COLOR;
    ctx.lineWidth = Math.max(1, Math.min(3, slotWidth * 0.2));

    // Low -> high vertical line.
    ctx.beginPath();
    ctx.moveTo(x, yFor(candle.l));
    ctx.lineTo(x, yFor(candle.h));
    ctx.stroke();

    // Open tick (left).
    ctx.beginPath();
    ctx.moveTo(x - tickWidth, yFor(candle.o));
    ctx.lineTo(x, yFor(candle.o));
    ctx.stroke();

    // Close tick (right).
    ctx.beginPath();
    ctx.moveTo(x, yFor(candle.c));
    ctx.lineTo(x + tickWidth, yFor(candle.c));
    ctx.stroke();
  });

  return canvas.toBuffer("image/png");
}

module.exports = { renderStockChart, WIDTH, HEIGHT };
