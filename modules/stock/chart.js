// modules/stock/chart.js
// Premium dark-theme renderers for a clan stock's price history, in the
// Yazanaki palette (black / red / white). Both styles share a framed layout:
// a header band with the clan emblem, name, live price and a change badge; a
// faint emblem watermark behind the plot; subtle gridlines; and rotated date
// labels.
//   - renderStockChart:      "OHLC bar" style (low->high line + open/close ticks)
//   - renderStockLineChart:  glowing price line with a gradient area fill
// Both are async because they load the clan emblem via loadImage().

const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { formatMoney } = require("../servers/serverembed");

const WIDTH = 900;
const HEIGHT = 480;
const HEADER_H = 76;
const PLOT = { left: 82, right: 28, top: HEADER_H + 26, bottom: 52 };
const MAX_VISIBLE_CANDLES = 60;

// Yazanaki palette — black background, white "up", red "down".
const BG_TOP = "#16161a";
const BG_BOTTOM = "#0a0a0c";
const WHITE = "#ffffff";
const RED = "#ff3b3b";
const RED_DEEP = "#d40000";
const TEXT = "#f5f5f7";
const TEXT_DIM = "rgba(255,255,255,0.45)";
const GRID = "rgba(255,255,255,0.07)";

function formatCandleDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** direction -> accent colors used for the line/marks/badge. */
function accentFor(direction) {
  if (direction === "down") {
    return { stroke: RED, fillTop: "rgba(255,59,59,0.28)", badgeBg: RED_DEEP, badgeText: WHITE };
  }
  return { stroke: WHITE, fillTop: "rgba(255,255,255,0.20)", badgeBg: WHITE, badgeText: "#0a0a0c" };
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

async function loadEmblem(emblemPath) {
  if (!emblemPath) return null;
  try {
    return await loadImage(emblemPath);
  } catch {
    return null;
  }
}

/** Background gradient + a soft red glow bloom in the lower-left. */
function drawBackground(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH * 0.2, HEIGHT * 0.9, 0, WIDTH * 0.2, HEIGHT * 0.9, WIDTH * 0.6);
  glow.addColorStop(0, "rgba(212,0,0,0.16)");
  glow.addColorStop(1, "rgba(212,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

/** Large, very faint emblem centered behind the plot area. */
function drawWatermark(ctx, emblem) {
  if (!emblem) return;
  const size = Math.min(PLOT_W(), PLOT_H()) * 0.85;
  const cx = PLOT.left + PLOT_W() / 2;
  const cy = PLOT.top + PLOT_H() / 2;
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.drawImage(emblem, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

/** Header band: emblem badge, clan name/server, live price + change badge. */
function drawHeader(ctx, opts) {
  const { clanAbbr, serverLabel, currentPrice, priceChange, emblem } = opts;
  const accent = accentFor(priceChange.direction);

  let textX = 28;
  if (emblem) {
    const d = 48, ex = 28, ey = 14;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex + d / 2, ey + d / 2, d / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(emblem, ex, ey, d, d);
    ctx.restore();
    // subtle ring
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ex + d / 2, ey + d / 2, d / 2, 0, Math.PI * 2);
    ctx.stroke();
    textX = ex + d + 16;
  }

  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(`${clanAbbr} Stock`, textX, 38);
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "13px sans-serif";
  ctx.fillText(`${serverLabel} · price per share`, textX, 58);

  // Right side: current price
  const rightX = WIDTH - PLOT.right;
  ctx.textAlign = "right";
  ctx.fillStyle = TEXT;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(formatMoney(currentPrice), rightX, 34);

  // Change badge under the price
  const arrow = priceChange.direction === "down" ? "▼" : priceChange.direction === "up" ? "▲" : "■";
  const sign = priceChange.absolute > 0 ? "+" : "";
  const badgeText = `${arrow} ${sign}${priceChange.percent.toFixed(2)}%`;
  ctx.font = "bold 13px sans-serif";
  const tw = ctx.measureText(badgeText).width;
  const padX = 10, bh = 22, bw = tw + padX * 2;
  const bx = rightX - bw, by = 44;
  ctx.fillStyle = accent.badgeBg;
  roundRectPath(ctx, bx, by, bw, bh, 6);
  ctx.fill();
  ctx.fillStyle = accent.badgeText;
  ctx.textAlign = "center";
  ctx.fillText(badgeText, bx + bw / 2, by + 15);
}

function PLOT_W() { return WIDTH - PLOT.left - PLOT.right; }
function PLOT_H() { return HEIGHT - PLOT.top - PLOT.bottom; }

function drawGrid(ctx, min, max, yFor) {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  const bands = 4;
  for (let i = 0; i <= bands; i++) {
    const value = min + ((max - min) * i) / bands;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(PLOT.left, y);
    ctx.lineTo(WIDTH - PLOT.right, y);
    ctx.stroke();
    ctx.fillText(formatMoney(value), PLOT.left - 8, y + 4);
  }
}

function drawDateLabels(ctx, visible, xFor) {
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  const plotBottom = HEIGHT - PLOT.bottom;
  const labelEvery = Math.max(1, Math.ceil(visible.length / 10));
  visible.forEach((candle, i) => {
    if (i % labelEvery !== 0 && i !== visible.length - 1) return;
    ctx.save();
    ctx.translate(xFor(i), plotBottom + 16);
    ctx.rotate(-Math.PI / 6);
    ctx.fillText(formatCandleDate(candle.t), 0, 0);
    ctx.restore();
  });
}

function drawEmptyState(ctx) {
  ctx.fillStyle = TEXT_DIM;
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("No price history yet — check back after the next update.", WIDTH / 2, PLOT.top + PLOT_H() / 2);
}

function computeRange(visible, valuesFn) {
  let min = Math.min(...visible.map((c) => Math.min(...valuesFn(c))));
  let max = Math.max(...visible.map((c) => Math.max(...valuesFn(c))));
  if (min === max) { min *= 0.95; max *= 1.05; }
  const pad = (max - min) * 0.1;
  return { min: min - pad, max: max + pad };
}

/** Draw the shared frame (bg, watermark, header). Returns nothing. */
function drawFrame(ctx, opts) {
  drawBackground(ctx);
  drawWatermark(ctx, opts.emblem);
  drawHeader(ctx, opts);
}

/**
 * @param {Array<{t,o,h,l,c}>} candles
 * @param {{ clanAbbr, serverLabel, currentPrice, priceChange, emblemPath }} opts
 * @returns {Promise<Buffer>}
 */
async function renderStockChart(candles, opts = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const emblem = await loadEmblem(opts.emblemPath);
  const frameOpts = { ...normalizeOpts(opts), emblem };

  drawFrame(ctx, frameOpts);

  const visible = (candles || []).slice(-MAX_VISIBLE_CANDLES);
  if (!visible.length) { drawEmptyState(ctx); return canvas.toBuffer("image/png"); }

  const { min, max } = computeRange(visible, (c) => [c.l, c.h]);
  const yFor = (v) => (HEIGHT - PLOT.bottom) - ((v - min) / (max - min)) * PLOT_H();
  drawGrid(ctx, min, max, yFor);

  const slotWidth = PLOT_W() / visible.length;
  const xFor = (i) => PLOT.left + slotWidth * (i + 0.5);
  const tickWidth = Math.max(2, Math.min(9, slotWidth * 0.35));

  visible.forEach((candle, i) => {
    const x = xFor(i);
    const up = candle.c >= candle.o;
    ctx.strokeStyle = up ? WHITE : RED;
    ctx.lineWidth = Math.max(1.5, Math.min(3, slotWidth * 0.22));
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, yFor(candle.l)); ctx.lineTo(x, yFor(candle.h)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - tickWidth, yFor(candle.o)); ctx.lineTo(x, yFor(candle.o)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, yFor(candle.c)); ctx.lineTo(x + tickWidth, yFor(candle.c)); ctx.stroke();
  });

  drawDateLabels(ctx, visible, xFor);
  return canvas.toBuffer("image/png");
}

/**
 * @param {Array<{t,o,h,l,c}>} candles
 * @param {{ clanAbbr, serverLabel, currentPrice, priceChange, emblemPath }} opts
 * @returns {Promise<Buffer>}
 */
async function renderStockLineChart(candles, opts = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const emblem = await loadEmblem(opts.emblemPath);
  const norm = normalizeOpts(opts);
  const frameOpts = { ...norm, emblem };

  drawFrame(ctx, frameOpts);

  const visible = (candles || []).slice(-MAX_VISIBLE_CANDLES);
  if (!visible.length) { drawEmptyState(ctx); return canvas.toBuffer("image/png"); }

  const accent = accentFor(norm.priceChange.direction);
  const { min, max } = computeRange(visible, (c) => [c.c]);
  const plotBottom = HEIGHT - PLOT.bottom;
  const yFor = (v) => plotBottom - ((v - min) / (max - min)) * PLOT_H();
  drawGrid(ctx, min, max, yFor);

  const slotWidth = visible.length > 1 ? PLOT_W() / (visible.length - 1) : 0;
  const xFor = (i) => (visible.length > 1 ? PLOT.left + slotWidth * i : PLOT.left + PLOT_W() / 2);

  // Gradient area fill under the line.
  const grad = ctx.createLinearGradient(0, PLOT.top, 0, plotBottom);
  grad.addColorStop(0, accent.fillTop);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.moveTo(xFor(0), yFor(visible[0].c));
  visible.forEach((c, i) => ctx.lineTo(xFor(i), yFor(c.c)));
  ctx.lineTo(xFor(visible.length - 1), plotBottom);
  ctx.lineTo(xFor(0), plotBottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Glowing price line.
  ctx.save();
  ctx.strokeStyle = accent.stroke;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = accent.stroke;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  visible.forEach((c, i) => (i === 0 ? ctx.moveTo(xFor(i), yFor(c.c)) : ctx.lineTo(xFor(i), yFor(c.c))));
  ctx.stroke();
  ctx.restore();

  // Highlight the latest point with a marker + price tag.
  const lastX = xFor(visible.length - 1);
  const lastY = yFor(visible[visible.length - 1].c);
  ctx.fillStyle = accent.stroke;
  ctx.beginPath(); ctx.arc(lastX, lastY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = BG_BOTTOM;
  ctx.beginPath(); ctx.arc(lastX, lastY, 2, 0, Math.PI * 2); ctx.fill();

  drawDateLabels(ctx, visible, xFor);
  return canvas.toBuffer("image/png");
}

/** Fill in defaults so callers can pass a partial opts object. */
function normalizeOpts(opts) {
  return {
    clanAbbr: opts.clanAbbr || "Clan",
    serverLabel: opts.serverLabel || "",
    currentPrice: Number(opts.currentPrice) || 0,
    priceChange: opts.priceChange || { absolute: 0, percent: 0, direction: "flat" },
    emblemPath: opts.emblemPath || null,
  };
}

module.exports = { renderStockChart, renderStockLineChart, WIDTH, HEIGHT, MAX_VISIBLE_CANDLES };
