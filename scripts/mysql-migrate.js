/**
 * Applies all SQL migrations in modules/database/migrations/ (tracked so each
 * file runs once). Delegates to the same code path as the /db migrate command.
 * Usage (from KenzAI folder): node scripts/mysql-migrate.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
process.env.MYSQL_ENABLED = "true";

const tasks = require("../modules/database/adminTasks");

async function main() {
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    console.error("Set DB_USER and DB_NAME (and DB_PASSWORD if needed) in .env");
    process.exit(1);
  }
  const res = await tasks.runMigrations();
  console.log("Applied migrations:", res.applied.join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
