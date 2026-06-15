/**
 * Compare row counts: JSON on disk vs MySQL (quick sanity check) for every
 * store. Delegates to the /db parity code path.
 * Usage: node scripts/mysql-parity-compare.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
process.env.MYSQL_ENABLED = "true";

const tasks = require("../modules/database/adminTasks");
const mysqlPoolMod = require("../modules/database/mysqlPool");

function mark(a, b) {
  return a === b ? "✅" : "⚠️";
}

async function main() {
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    console.error("Set DB_USER and DB_NAME (and DB_PASSWORD if needed) in .env");
    process.exit(1);
  }

  const res = await tasks.parityCounts();

  console.log(`${mark(res.jsonMembers, res.sqlUsers)} members  JSON: ${res.jsonMembers}  MySQL: ${res.sqlUsers}`);
  console.log(`${mark(res.jsonClans, res.sqlClans)} clans    JSON: ${res.jsonClans}  MySQL: ${res.sqlClans}`);
  for (const e of res.extras || []) {
    console.log(`${mark(e.json, e.sql)} ${String(e.name).padEnd(18)} JSON: ${e.json}  MySQL: ${e.sql}`);
  }

  await mysqlPoolMod.closePool();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
