// modules/database/membersPersistence.js
// Persistence layer for members data.
// JSON is always the source of truth for reads unless DB_READ_MEMBERS=mysql.
// MySQL writes use the flat `members` table from migration 002.

const fs = require("fs");
const path = require("path");
const config = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const userRepository = require("./repositories/userRepository");

const membersPath = path.join(__dirname, "../data/members.json");

/** In-memory map when DB_READ_MEMBERS=mysql (avoids async in readMembers). */
let memoryMembersMap = null;

function ensureDataDir() {
  const dir = path.dirname(membersPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMembersFromDisk() {
  ensureDataDir();
  if (!fs.existsSync(membersPath)) {
    fs.writeFileSync(membersPath, JSON.stringify({}, null, 4));
    return {};
  }
  try {
    const raw = fs.readFileSync(membersPath, "utf8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error("[membersPersistence] ❌ read members.json:", err.message);
    return {};
  }
}

function writeMembersToDisk(obj) {
  ensureDataDir();
  if (config.jsonWritesDisabled) return;
  try {
    if (fs.existsSync(membersPath)) {
      const backupPath = membersPath.replace(".json", ".backup.json");
      fs.copyFileSync(membersPath, backupPath);
    }
    fs.writeFileSync(membersPath, JSON.stringify(obj, null, 4));
    console.log("[membersPersistence] ✅ Saved members.json");
  } catch (err) {
    console.error("[membersPersistence] ❌ write members.json:", err.message);
  }
}

function shouldSyncMysql() {
  const p = mysqlPool.getPool();
  if (!p) return false;
  return (
    config.dualWrite ||
    config.jsonWritesDisabled ||
    config.readMembersSource === "mysql"
  );
}

/**
 * Determine which Discord IDs changed between oldMap and newMap.
 * Returns { added, updated, removed }.
 */
function diffMaps(oldMap, newMap) {
  const oldIds = new Set(Object.keys(oldMap || {}));
  const newIds = new Set(Object.keys(newMap || {}));

  const added   = [...newIds].filter(id => !oldIds.has(id));
  const removed = [...oldIds].filter(id => !newIds.has(id));
  const updated = [...newIds].filter(id => oldIds.has(id));

  return { added, updated, removed };
}

/**
 * Sync only the changed rows to MySQL instead of doing a full replace.
 * Falls back to replaceAllUsers if we have no prior snapshot to diff against.
 */
function scheduleMysqlSync(newMap) {
  if (!shouldSyncMysql()) return;

  const snapshot = JSON.parse(JSON.stringify(newMap));

  setImmediate(async () => {
    try {
      const pool = mysqlPool.getPool();
      if (!pool) return;

      const { added, updated, removed } = diffMaps(memoryMembersMap, snapshot);

      // Upsert new / changed rows
      for (const id of [...added, ...updated]) {
        await userRepository.upsertUser(id, snapshot[id]).catch(err =>
          console.error(`[membersPersistence] ❌ MySQL upsert ${id}:`, err.message)
        );
      }

      // Delete removed rows
      for (const id of removed) {
        await userRepository.deleteUser(id).catch(err =>
          console.error(`[membersPersistence] ❌ MySQL delete ${id}:`, err.message)
        );
      }
    } catch (err) {
      console.error("[membersPersistence] ❌ MySQL sync error:", err.message);
      // Last-resort full replace
      userRepository.replaceAllUsers(snapshot).catch(e =>
        console.error("[membersPersistence] ❌ MySQL replaceAllUsers fallback:", e.message)
      );
    }
  });
}

/**
 * Sync read: json = from disk each time; mysql = hydrated memory (updated on every write).
 */
function readMembers() {
  if (config.readMembersSource === "mysql") {
    if (memoryMembersMap && typeof memoryMembersMap === "object") {
      return memoryMembersMap;
    }
    console.warn("[membersPersistence] ⚠️ MYSQL read mode but cache empty — falling back to disk");
  }
  return readMembersFromDisk();
}

/**
 * Full replace of members map (same semantics as legacy writeMembers everywhere).
 */
function writeMembers(data) {
  if (!data || typeof data !== "object") {
    console.warn("[membersPersistence] ⚠️ writeMembers called with non-object");
    return false;
  }

  const previous = memoryMembersMap;
  memoryMembersMap = JSON.parse(JSON.stringify(data));

  writeMembersToDisk(memoryMembersMap);
  scheduleMysqlSync(memoryMembersMap);
  return true;
}

async function hydrateMembersFromMysql() {
  if (!mysqlPool.getPool()) return false;
  if (config.readMembersSource !== "mysql") return false;
  memoryMembersMap = await userRepository.loadAllUsersAsMap();
  const n = Object.keys(memoryMembersMap || {}).length;
  console.log(`[membersPersistence] ✅ MySQL member cache loaded (${n} rows)`);
  return true;
}

function getMembersPath() {
  return membersPath;
}

module.exports = {
  readMembers,
  writeMembers,
  hydrateMembersFromMysql,
  readMembersFromDisk,
  getMembersPath,
};