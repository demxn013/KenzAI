// modules/database/bootstrap.js
// Initialises MySQL (optional) before schedulers/commands rely on hydrated caches.

const mysqlPool = require("./mysqlPool");
const config = require("./dbConfig");

async function initDatabase() {
  if (!config.mysqlEnabled) {
    console.log("[mysql] MYSQL_ENABLED not set — using JSON persistence only.");
    return { ok: true, mysql: false };
  }

  if (!config.user || !config.database) {
    console.error(
      "[mysql] ❌ MYSQL_ENABLED=true but DB_USER or DB_NAME is missing — set env vars or disable MYSQL_ENABLED."
    );
    process.exit(1);
  }

  // Check mysql2 is installed before trying to connect
  try {
    require("mysql2/promise");
  } catch {
    console.error(
      "[mysql] ❌ mysql2 package not found. Install it with: npm install mysql2"
    );
    process.exit(1);
  }

  try {
    await mysqlPool.createPool();
  } catch (e) {
    console.error("[mysql] ❌ Failed to create connection pool:", e.message);
    process.exit(1);
  }

  try {
    const ping = await mysqlPool.ping();
    if (!ping.ok) throw new Error(ping.reason || "ping_failed");
    console.log(
      `[mysql] ✅ Connected to ${config.host}:${config.port}/${config.database}`
    );
    console.log(
      `[mysql] Rollout: READ_MEMBERS=${config.readMembersSource} ` +
      `READ_CLANS=${config.readClansSource} ` +
      `READ_EMPIRE=${config.readEmpireRegistrySource} ` +
      `DUAL_WRITE=${config.dualWrite} ` +
      `JSON_WRITES_DISABLED=${config.jsonWritesDisabled}`
    );
  } catch (e) {
    console.error("[mysql] ❌ Connection failed:", e.message);
    console.error("[mysql] ❌ Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME in .env");
    process.exit(1);
  }

  await require("./hydrateCaches")();

  return { ok: true, mysql: true };
}

module.exports = { initDatabase };