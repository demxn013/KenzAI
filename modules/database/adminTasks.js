// modules/database/adminTasks.js
// Admin-only DB tasks: migrate (run-once tracked), backfill, parity.

const fs = require("fs");
const path = require("path");

const dbConfig = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const userRepo = require("./repositories/userRepository");
const clanRepo = require("./repositories/clanRepository");
const empireRepo = require("./repositories/empireRegistryRepository");
const { stores } = require("./stores");

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
// MIGRATE — applies every migrations/NNN_*.sql in order, tracked in the
//           `schema_migrations` table so each file runs exactly once.
//           The schema is idempotent (data-bearing tables use CREATE IF NOT
//           EXISTS; only empty/obsolete tables are dropped), so even a re-run
//           against live data is safe.
// ---------------------------------------------------------------------------
async function runMigrations() {
  assertMysqlEnabled();
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch {
    throw new Error("mysql2 dependency missing. Run: npm install mysql2");
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/i.test(f))
    .sort();
  if (files.length === 0) throw new Error("No migration files found in migrations/");

  const conn = await mysql.createConnection({
    host:               dbConfig.host,
    port:               dbConfig.port,
    user:               dbConfig.user,
    password:           dbConfig.password,
    database:           dbConfig.database,
    multipleStatements: true,
  });

  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   VARCHAR(191) NOT NULL,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (filename)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    const [appliedRows] = await conn.query("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.filename));

    const newlyApplied = [];
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, f), "utf8");
      await conn.query(sql);
      await conn.query("INSERT IGNORE INTO schema_migrations (filename) VALUES (?)", [f]);
      newlyApplied.push(f);
    }

    return { ok: true, applied: newlyApplied.length ? newlyApplied : ["(none — already up to date)"] };
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

  // --- members (accepted empire members ONLY — clean separation from
  //     applications + linking, which now have their own tables) ---
  await userRepo.replaceAllUsers(members);
  console.log(`[db-admin] ✅ Backfilled ${Object.keys(members).length} members`);

  // --- clans ---
  await clanRepo.replaceAllClans(clans);
  console.log(`[db-admin] ✅ Backfilled ${Object.keys(clans).length} clans`);

  // --- empire registry ---
  let empireCount = 0;
  if (empireIds && typeof empireIds.ids === "object") {
    await empireRepo.saveRegistryState({
      nextNumber: typeof empireIds.nextNumber === "number" ? empireIds.nextNumber : 14,
      ids: empireIds.ids,
    });
    empireCount = Object.keys(empireIds.ids).length;
    console.log(`[db-admin] ✅ Backfilled ${empireCount} empire IDs`);
  }

  // --- extra stores (applicants, linking, kicked/banned, subscriptions,
  //     bot slots/queue, servers, archived, deserters, court, roles, channels) ---
  const extras = {};
  for (const [key, store] of Object.entries(stores)) {
    try {
      extras[key] = await store.backfillFromDisk();
      console.log(`[db-admin] ✅ Backfilled ${extras[key]} ${key}`);
    } catch (e) {
      console.error(`[db-admin] ❌ backfill ${key}:`, e.message);
      extras[key] = `err`;
    }
  }

  return {
    ok: true,
    users:     Object.keys(members).length,
    clans:     Object.keys(clans || {}).length,
    empireIds: empireCount,
    extras,
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

  // Per-store JSON vs MySQL row counts.
  const extras = [];
  for (const store of Object.values(stores)) {
    try {
      extras.push(await store.parity());
    } catch (e) {
      extras.push({ name: store.name, table: store.table, json: "?", sql: `err` });
    }
  }

  return {
    ok:          true,
    jsonMembers: Object.keys(members || {}).length,
    sqlUsers:    Object.keys(uSql    || {}).length,
    jsonClans:   Object.keys(clans   || {}).length,
    sqlClans:    Object.keys(cSql    || {}).length,
    extras,
  };
}

module.exports = {
  runMigrations,
  runBackfill,
  parityCounts,
};