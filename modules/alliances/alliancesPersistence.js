// modules/alliances/alliancesPersistence.js
// JSON persistence layer for alliances data.
// Modeled on clansPersistence.js but JSON-only (no MySQL sync) — alliances are a
// Discord-bot-only concept and intentionally do not touch the database schema.

const fs = require("fs");
const path = require("path");

const alliancesPath = path.join(__dirname, "../data/alliances.json");

function ensureDataDir() {
  const dir = path.dirname(alliancesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readAlliances() {
  ensureDataDir();
  if (!fs.existsSync(alliancesPath)) {
    fs.writeFileSync(alliancesPath, JSON.stringify({}, null, 2));
    return {};
  }
  try {
    const raw = fs.readFileSync(alliancesPath, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error("[alliancesPersistence] ❌ read alliances.json:", err.message);
    return {};
  }
}

function writeAlliances(obj) {
  ensureDataDir();
  try {
    fs.writeFileSync(alliancesPath, JSON.stringify(obj || {}, null, 2));
  } catch (err) {
    console.error("[alliancesPersistence] ❌ write alliances.json:", err.message);
  }
}

function getAlliancesPath() {
  return alliancesPath;
}

module.exports = {
  readAlliances,
  writeAlliances,
  getAlliancesPath,
};
