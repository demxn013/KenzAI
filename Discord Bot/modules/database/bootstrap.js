/**
 * Initializes MySQL (optional) before schedulers/commands rely on hydrated caches.
 */

const mysqlPool = require("./mysqlPool");
const config = require("./dbConfig");

async function initDatabase() {
  if (!config.mysqlEnabled) {
    console.log("[mysql] MYSQL_ENABLED not set — using JSON persistence only.");
    return { ok: true, mysql: false };
  }

  if (!config.user || !config.database) {
    console.error(
      "[mysql] ❌ MYSQL_ENABLED but DB_USER or DB_NAME is missing — set env or disable MYSQL_ENABLED."
    );
    process.exit(1);
  }

  await mysqlPool.createPool();
  try {
    const ping = await mysqlPool.ping();
    if (!ping.ok) throw new Error(ping.reason || "ping_failed");
    console.log(
      `[mysql] ✅ Connected to ${config.host}:${config.port}/${config.database}`
    );
    console.log(
      `[mysql] Rollout: DB_READ_MEMBERS=${config.readMembersSource} DB_READ_CLANS=${config.readClansSource} DB_DUAL_WRITE=${config.dualWrite} DB_JSON_WRITES_DISABLED=${config.jsonWritesDisabled}`
    );
  } catch (e) {
    console.error("[mysql] ❌ Connection failed:", e.message);
    process.exit(1);
  }

  await require("./hydrateCaches")();

  return { ok: true, mysql: true };
}

module.exports = { initDatabase };
