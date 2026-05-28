// modules/database/adminTasks.js
// Admin-only DB tasks: migrate (001 legacy or 002 flat schema), backfill, parity.

const fs = require("fs");
const path = require("path");

const dbConfig = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const userRepo = require("./repositories/userRepository");
const clanRepo = require("./repositories/clanRepository");
const empireRepo = require("./repositories/empireRegistryRepository");

const migrationsDir = path.join(__dirname, "migrations");
const dataDir = path.join(__dirname, "..", "data");

function assertMysqlEnabled() {
  if (!dbConfig.mysqlEnabled) {
    throw new Error("MYSQL_ENABLED is false. Set MYSQL_ENABLED=true and DB_* creds in .env.");
  }
  if (!dbConfig.user || !dbConfig.database) {
    throw new Error("Missing DB_USER or DB_NAME in .env.");
  }
}

function readJsonSafe(rel) {
  const fp = path.join(dataDir, rel);
  if (!fs.existsSync(fp)) return {};
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("[db-admin] ⚠️ Failed to read", rel, e.message);
    return {};
  }
}

/**
 * Merge members.json + linking.json + applicants.json into a unified users map.
 * Linking / applicant entries that have no members.json counterpart get a
 * lightweight stub so that their discord↔MC link is preserved.
 */
function buildUnifiedUsers(members, linking, applicants) {
  const map = { ...(members && typeof members === "object" ? members : {}) };

  const addLightweight = (discordId, mcName) => {
    const id = String(discordId);
    if (map[id]) return; // don't overwrite real member data
    map[id] = {
      discordId: id,
      minecraftUser: mcName || "",
      EmpireID: "",
      JoinedClan: "",
    };
  };

  if (linking && typeof linking === "object") {
    for (const [discordId, row] of Object.entries(linking)) {
      if (!row || typeof row !== "object") continue;
      const mc = row.main || row.minecraftUser || "";
      if (mc) addLightweight(discordId, mc);
    }
  }

  if (applicants && typeof applicants === "object") {
    for (const [discordId, row] of Object.entries(applicants)) {
      if (!row || typeof row !== "object") continue;
      const mc = row.minecraftUser || row.minecraftName || "";
      addLightweight(discordId, mc);
    }
  }

  return map;
}

async function ensurePoolReady() {
  assertMysqlEnabled();

  try {
    await mysqlPool.createPool();
  } catch (e) {
    if (String(e?.message || "").includes("Cannot find module 'mysql2'")) {
      throw new Error("mysql2 dependency missing. Run: npm install mysql2");
    }
    throw e;
  }

  const ping = await mysqlPool.ping();
  if (!ping.ok) throw new Error(`MySQL unreachable (${ping.reason || "unknown"})`);
}

// ---------------------------------------------------------------------------
// MIGRATE — runs the latest migration file (002_flat_schema.sql preferred,
//            falls back to 001_initial.sql if 002 is not present)
// ---------------------------------------------------------------------------
async function runMigrations() {
  assertMysqlEnabled();
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("mysql2 dependency missing. Run: npm install mysql2");
  }

  // Prefer 002, fall back to 001
  const candidates = ["002_flat_schema.sql", "001_initial.sql"];
  let sqlPath = null;
  for (const name of candidates) {
    const p = path.join(migrationsDir, name);
    if (fs.existsSync(p)) { sqlPath = p; break; }
  }
  if (!sqlPath) throw new Error("No migration file found in migrations/");

  const sql = fs.readFileSync(sqlPath, "utf8");
  const conn = await mysql.createConnection({
    host:               dbConfig.host,
    port:               dbConfig.port,
    user:               dbConfig.user,
    password:           dbConfig.password,
    database:           dbConfig.database,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    return { ok: true, applied: [path.basename(sqlPath)] };
  } finally {
    await conn.end();
  }
}

// ---------------------------------------------------------------------------
// BACKFILL — populate MySQL from all JSON files
// ---------------------------------------------------------------------------
async function runBackfill() {
  await ensurePoolReady();

  const members    = readJsonSafe("members.json");
  const clans      = readJsonSafe("clans.json");
  const empireIds  = readJsonSafe("empireids.json");
  const linking    = readJsonSafe("linking.json");
  const applicants = readJsonSafe("applicants.json");

  const usersMap = buildUnifiedUsers(members, linking, applicants);

  // --- members / users ---
  await userRepo.replaceAllUsers(usersMap);
  console.log(`[db-admin] ✅ Backfilled ${Object.keys(usersMap).length} members`);

  // --- clans ---
  await clanRepo.replaceAllClans(clans);
  console.log(`[db-admin] ✅ Backfilled ${Object.keys(clans).length} clans`);

  // --- empire registry ---
  if (empireIds && typeof empireIds.ids === "object") {
    await empireRepo.saveRegistryState({
      nextNumber: typeof empireIds.nextNumber === "number" ? empireIds.nextNumber : 14,
      ids: empireIds.ids,
    });
    console.log(`[db-admin] ✅ Backfilled ${Object.keys(empireIds.ids).length} empire IDs`);
  }

  return {
    ok: true,
    users:     Object.keys(usersMap).length,
    clans:     Object.keys(clans || {}).length,
    empireIds: Object.keys((empireIds && empireIds.ids) || {}).length,
  };
}

// ---------------------------------------------------------------------------
// PARITY — quick sanity check between JSON and MySQL counts
// ---------------------------------------------------------------------------
async function parityCounts() {
  await ensurePoolReady();

  const [uSql, cSql] = await Promise.all([
    userRepo.loadAllUsersAsMap(),
    clanRepo.loadAllClansAsMap(),
  ]);

  const members = readJsonSafe("members.json");
  const clans   = readJsonSafe("clans.json");

  return {
    ok:          true,
    jsonMembers: Object.keys(members || {}).length,
    sqlUsers:    Object.keys(uSql    || {}).length,
    jsonClans:   Object.keys(clans   || {}).length,
    sqlClans:    Object.keys(cSql    || {}).length,
  };
}

module.exports = {
  runMigrations,
  runBackfill,
  parityCounts,
};