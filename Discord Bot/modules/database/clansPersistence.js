// modules/database/clansPersistence.js
// Persistence layer for clans data.
// JSON is always the source of truth for reads unless DB_READ_CLANS=mysql.
// MySQL writes use the flat `clans` table from migration 002.

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

/**
 * Diff old vs new clans map and sync only changed rows.
 */
function scheduleMysqlSync(newMap) {
  if (!shouldSyncMysql()) return;

  const snapshot = JSON.parse(JSON.stringify(newMap || {}));

  setImmediate(async () => {
    try {
      const pool = mysqlPool.getPool();
      if (!pool) return;

      const oldIds = new Set(Object.keys(memoryClansMap || {}));
      const newIds = new Set(Object.keys(snapshot));

      // Upsert new / changed clans
      for (const id of newIds) {
        await clanRepository.upsertClan(id, snapshot[id]).catch(err =>
          console.error(`[clansPersistence] ❌ MySQL upsert clan ${id}:`, err.message)
        );
      }

      // Remove deleted clans
      const removed = [...oldIds].filter(id => !newIds.has(id));
      if (removed.length > 0) {
        const pool2 = mysqlPool.getPool();
        if (pool2) {
          const ph = removed.map(() => "?").join(", ");
          await pool2.execute(
            `DELETE FROM clans WHERE guild_id IN (${ph})`,
            removed
          ).catch(err =>
            console.error(`[clansPersistence] ❌ MySQL delete clans:`, err.message)
          );
        }
      }
    } catch (err) {
      console.error("[clansPersistence] ❌ MySQL sync error:", err.message);
      // Last-resort full replace
      clanRepository.replaceAllClans(snapshot).catch(e =>
        console.error("[clansPersistence] ❌ MySQL replaceAllClans fallback:", e.message)
      );
    }
  });
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
  scheduleMysqlSync(memoryClansMap);
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