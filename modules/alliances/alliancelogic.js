// modules/alliances/alliancelogic.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const alliancesPersistence = require("./alliancesPersistence");
// Reuse the dominant-color extractor from clanlogic instead of duplicating it.
const { getDominantColor } = require("../clantracking/clanlogic");

const flagsDir = path.join(__dirname, "../images/allianceflags");

// Ensure data file and flag directory exist.
function ensureDataFile() {
  try {
    if (!fs.existsSync(flagsDir)) fs.mkdirSync(flagsDir, { recursive: true });
  } catch (err) {
    console.error("[alliancelogic] ensureDataFile error:", err);
  }
}

// Read/write alliances (JSON).
function readAlliances() {
  ensureDataFile();
  return alliancesPersistence.readAlliances();
}

function writeAlliances(data) {
  ensureDataFile();
  alliancesPersistence.writeAlliances(data);
}

/**
 * Turn an alliance name into a filesystem-safe, stable key.
 * Alliances have a display name but no abbreviation, so the slug is both the
 * map key and the flag filename. e.g. "The Iron Pact" -> "the-iron-pact".
 */
function slugify(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve a user-typed alliance reference (name or slug) to its slug key.
 * Returns the slug if an alliance exists for it, otherwise null.
 */
function findAllianceSlug(alliances, input) {
  if (!input) return null;
  const slug = slugify(input);
  if (alliances[slug]) return slug;
  // Fall back to a case-insensitive match on the stored display name.
  const match = Object.keys(alliances).find(
    key => alliances[key]?.name?.toLowerCase() === String(input).toLowerCase()
  );
  return match || null;
}

// Flag file helpers (keyed by alliance slug).
function getFlagPath(slug) {
  if (!slug) return null;
  return path.join(flagsDir, `${slug}.png`);
}

function flagExists(slug) {
  const p = getFlagPath(slug);
  return p && fs.existsSync(p);
}

async function saveFlagFromAttachment(slug, attachment) {
  if (!slug || !attachment || !attachment.url) throw new Error("Missing slug or attachment");
  if (!attachment.name.toLowerCase().endsWith(".png")) throw new Error("Only PNG files are accepted for flags.");
  ensureDataFile();
  const dest = getFlagPath(slug);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(attachment.url, res => {
      if (res.statusCode !== 200) { file.close(); fs.unlink(dest, () => {}); return reject(new Error(`Failed to download flag (${res.statusCode})`)); }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(dest); });
    }).on("error", err => { file.close(); fs.unlink(dest, () => {}); reject(err); });
  });
}

function deleteFlag(slug) {
  const p = getFlagPath(slug);
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (err) { console.error("[alliancelogic] deleteFlag error:", err); }
}

module.exports = {
  readAlliances,
  writeAlliances,
  slugify,
  findAllianceSlug,
  flagsDir,
  getFlagPath,
  flagExists,
  saveFlagFromAttachment,
  deleteFlag,
  getDominantColor,
};
