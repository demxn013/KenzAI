/**
 * Idempotent JSON -> MySQL backfill for every store (members, clans, empire
 * registry + all extra stores). Delegates to the /db backfill code path so the
 * CLI and the Discord command stay in lockstep.
 * Usage (from KenzAI folder): node scripts/backfill-mysql.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
process.env.MYSQL_ENABLED = "true";

const tasks = require("../modules/database/adminTasks");
const mysqlPoolMod = require("../modules/database/mysqlPool");

async function main() {
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    console.error("Set DB_USER and DB_NAME (and DB_PASSWORD if needed) in .env");
    process.exit(1);
  }

  const res = await tasks.runBackfill();

  console.log("\n────────── Backfill complete ──────────");
  console.log("  members:  ", res.users);
  console.log("  clans:    ", res.clans);
  console.log("  empireIds:", res.empireIds);
  for (const [k, v] of Object.entries(res.extras || {})) {
    console.log(`  ${k}:`.padEnd(22), v);
  }
  console.log("───────────────────────────────────────\n");

  await mysqlPoolMod.closePool();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
