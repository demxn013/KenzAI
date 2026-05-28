// modules/database/empireRegistryPersistence.js
// Persistence layer for empire IDs.
// JSON is always the source of truth for reads unless DB_READ_EMPIRE_REGISTRY=mysql.
// MySQL writes use the flat `empire_ids` + `empire_id_counters` tables from migration 002.

const fs = require("fs");
const path = require("path");
const config = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const empireRegistryRepository = require("./repositories/empireRegistryRepository");

const empireIdsPath = path.join(__dirname, "../data/empireids.json");
const dataDir = path.dirname(empireIdsPath);

/** Live registry copy when reads come from MySQL. */
let memoryRegistry = null;

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(empireIdsPath)) {
    const defaultData = { nextNumber: 14, ids: {} };
    fs.writeFileSync(empireIdsPath, JSON.stringify(defaultData, null, 2));
    console.log("[empireRegistryPersistence] ✅ Created empireids.json");
    return defaultData;
  }

  const raw = fs.readFileSync(empireIdsPath, "utf8");
  return JSON.parse(raw);
}

function readEmpireRegistryFromDisk() {
  try {
    return ensureFile();
  } catch (err) {
    console.error("[empireRegistryPersistence] ❌ read empireids:", err.message);
    return { nextNumber: 14, ids: {} };
  }
}

function writeEmpireRegistryToDisk(data) {
  if (config.jsonWritesDisabled) return true;
  try {
    if (fs.existsSync(empireIdsPath)) {
      const backupPath = empireIdsPath.replace(".json", ".backup.json");
      fs.copyFileSync(empireIdsPath, backupPath);
    }
    fs.writeFileSync(empireIdsPath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error("[empireRegistryPersistence] ❌ write empireids:", err.message);
    return false;
  }
}

function shouldSyncMysql() {
  const p = mysqlPool.getPool();
  if (!p) return false;
  return (
    config.dualWriteEmpireRegistry ||
    config.jsonWritesDisabled ||
    config.readEmpireRegistrySource === "mysql"
  );
}

function scheduleMysqlSave(data) {
  if (!shouldSyncMysql()) return;
  empireRegistryRepository
    .saveRegistryState(JSON.parse(JSON.stringify(data)))
    .catch((err) =>
      console.error("[empireRegistryPersistence] ❌ MySQL saveRegistryState:", err.message)
    );
}

function loadEmpireRegistry() {
  if (config.readEmpireRegistrySource === "mysql") {
    if (memoryRegistry && typeof memoryRegistry === "object") {
      return memoryRegistry;
    }
    console.warn(
      "[empireRegistryPersistence] ⚠️ MySQL empire registry read requested but cache empty — disk fallback"
    );
  }
  return readEmpireRegistryFromDisk();
}

function saveEmpireRegistry(data) {
  memoryRegistry = JSON.parse(JSON.stringify(data));
  const ok = writeEmpireRegistryToDisk(memoryRegistry);
  scheduleMysqlSave(memoryRegistry);
  return ok;
}

async function hydrateEmpireRegistryFromMysql() {
  if (!mysqlPool.getPool()) return false;
  if (config.readEmpireRegistrySource !== "mysql") return false;
  memoryRegistry = await empireRegistryRepository.loadRegistryState();
  if (!memoryRegistry || typeof memoryRegistry !== "object") {
    memoryRegistry = { nextNumber: 14, ids: {} };
  }
  if (typeof memoryRegistry.nextNumber !== "number") memoryRegistry.nextNumber = 14;
  if (!memoryRegistry.ids || typeof memoryRegistry.ids !== "object") memoryRegistry.ids = {};
  console.log(
    `[empireRegistryPersistence] ✅ MySQL empire registry loaded (next=${memoryRegistry.nextNumber}, ids=${Object.keys(memoryRegistry.ids).length})`
  );
  return true;
}

module.exports = {
  loadEmpireRegistry,
  saveEmpireRegistry,
  hydrateEmpireRegistryFromMysql,
  readEmpireRegistryFromDisk,
  getEmpireIdsPath: () => empireIdsPath,
};