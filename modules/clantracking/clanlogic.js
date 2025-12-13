// modules/clantracking/clanlogic.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const Jimp = require("jimp");

const dataPath = path.join(__dirname, "../data/clans.json");
const flagsDir = path.join(__dirname, "../images/clanflags");

// Ensure data file and directories exist
function ensureDataFile() {
  try {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify({}, null, 2));
    if (!fs.existsSync(flagsDir)) fs.mkdirSync(flagsDir, { recursive: true });
  } catch (err) {
    console.error("ensureDataFile error:", err);
  }
}

// Read/write clans.json
function readClans() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    if (!raw || !raw.trim()) {
      fs.writeFileSync(dataPath, JSON.stringify({}, null, 2));
      return {};
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading clans.json:", err);
    try { fs.writeFileSync(dataPath, JSON.stringify({}, null, 2)); } catch {}
    return {};
  }
}

function writeClans(data) {
  ensureDataFile();
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error writing clans.json:", err);
  }
}

// Flag file helpers
function getFlagPath(abbr) {
  if (!abbr) return null;
  const file = `${abbr.toUpperCase()}.png`;
  return path.join(flagsDir, file);
}

function flagExists(abbr) {
  const p = getFlagPath(abbr);
  return p && fs.existsSync(p);
}

async function saveFlagFromAttachment(abbr, attachment) {
  if (!abbr || !attachment || !attachment.url) throw new Error("Missing abbr or attachment");
  if (!attachment.name.toLowerCase().endsWith(".png")) throw new Error("Only PNG files are accepted for flags.");
  ensureDataFile();
  const dest = getFlagPath(abbr);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(attachment.url, res => {
      if (res.statusCode !== 200) { file.close(); fs.unlink(dest, () => {}); return reject(new Error(`Failed to download flag (${res.statusCode})`)); }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(dest); });
    }).on("error", err => { file.close(); fs.unlink(dest, () => {}); reject(err); });
  });
}

function deleteFlag(abbr) {
  const p = getFlagPath(abbr);
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (err) { console.error("deleteFlag error:", err); }
}

async function getDominantColor(source) {
  try {
    const image = await Jimp.read(source);
    const maxDim = 128;
    if (image.bitmap.width > maxDim || image.bitmap.height > maxDim) image.resize(maxDim, Jimp.AUTO);
    const colorCount = {};
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const key = `${r},${g},${b}`;
      colorCount[key] = (colorCount[key] || 0) + 1;
    });
    const entries = Object.entries(colorCount);
    if (!entries.length) return 0x000000;
    entries.sort((a, b) => b[1] - a[1]);
    const [r, g, b] = entries[0][0].split(",").map(Number);
    return (r << 16) + (g << 8) + b;
  } catch (err) {
    console.error("getDominantColor error:", err?.message || err);
    return 0x000000;
  }
}

/**
 * Downloads the guild banner if it exists and is new.
 * Saves to images/clanflags/<ABBR>.png and updates clans.json bannerURL.
 * Returns the path to the downloaded banner file if successful, else null.
 */
async function updateBannerIfNew(guild, abbr) {
  if (!guild || !abbr) return null;
  const clans = readClans();
  const clanEntry = Object.values(clans).find(c => c.abbr.toUpperCase() === abbr.toUpperCase());
  if (!clanEntry) return null;
  const bannerURL = guild.bannerURL({ size: 1024, extension: "png" });
  if (!bannerURL) return null;

  // Skip download if URL matches existing
  if (clanEntry.bannerURL === bannerURL && flagExists(abbr)) return getFlagPath(abbr);

  const dest = getFlagPath(abbr);
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(bannerURL, res => {
      if (res.statusCode !== 200) { file.close(); fs.unlink(dest, () => {}); return reject(new Error(`Failed to download banner (${res.statusCode})`)); }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(dest); });
    }).on("error", err => { file.close(); fs.unlink(dest, () => {}); reject(err); });
  });

  clanEntry.bannerURL = bannerURL;
  writeClans(clans);
  return dest;
}

module.exports = {
  readClans,
  writeClans,
  flagsDir,
  getFlagPath,
  flagExists,
  saveFlagFromAttachment,
  deleteFlag,
  getDominantColor,
  updateBannerIfNew,
};
