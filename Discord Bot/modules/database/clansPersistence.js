const fs = require("fs");
const path = require("path");
const config = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const clanRepository = require("./repositories/clanRepository");

const clansPath = path.join(__dirname, "../data/clans.json");

let memoryClansMap = null;

function ensureDataDir() {
  const dir = path.dirname(clansPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readClansFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(clansPath)) {
    fs.writeFileSync(clansPath, JSON.stringify({}, null, 2));
    return {};
  }
  try {
    const raw = fs.readFileSync(clansPath, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error("[clansPersistence] ❌ read clans.json:", err.message);
    return {};
  }
}

function writeClansToDisk(obj) {
  ensureDataDir();
  if (config.jsonWritesDisabled) return;
  try {
    fs.writeFileSync(clansPath, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error("[clansPersistence] ❌ write clans.json:", err.message);
  }
}

function shouldSyncMysql() {
  const p = mysqlPool.getPool();
  if (!p) return false;
  return (
    config.dualWrite ||
    config.jsonWritesDisabled ||
    config.readClansSource === "mysql"
  );
}

function scheduleMysqlClans(map) {
  if (!shouldSyncMysql()) return;
  const snapshot = JSON.parse(JSON.stringify(map));
  clanRepository
    .replaceAllClans(snapshot)
    .catch((err) => console.error("[clansPersistence] ❌ MySQL replaceAllClans:", err.message));
}

function readClans() {
  if (config.readClansSource === "mysql") {
    if (memoryClansMap && typeof memoryClansMap === "object") {
      return memoryClansMap;
    }
    console.warn("[clansPersistence] ⚠️ MYSQL read mode but cache empty — falling back to disk");
  }
  return readClansFromDisk();
}

function writeClans(data) {
  memoryClansMap = JSON.parse(JSON.stringify(data || {}));
  writeClansToDisk(memoryClansMap);
  scheduleMysqlClans(memoryClansMap);
}

async function hydrateClansFromMysql() {
  if (!mysqlPool.getPool()) return false;
  if (config.readClansSource !== "mysql") return false;
  memoryClansMap = await clanRepository.loadAllClansAsMap();
  const n = Object.keys(memoryClansMap || {}).length;
  console.log(`[clansPersistence] ✅ MySQL clan cache loaded (${n} rows)`);
  return true;
}

function getClansPath() {
  return clansPath;
}

module.exports = {
  readClans,
  writeClans,
  hydrateClansFromMysql,
  readClansFromDisk,
  getClansPath,
};
