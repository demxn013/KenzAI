/**
 * Applies SQL migrations from modules/database/migrations/
 * Usage (from Discord Bot folder): node scripts/mysql-migrate.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD || process.env.DB_PASS || "";
  const database = process.env.DB_NAME;

  if (!user || !database) {
    console.error("Set DB_USER and DB_NAME (and DB_PASSWORD if needed) in .env");
    process.exit(1);
  }

  const sqlPath = path.join(
    __dirname,
    "..",
    "modules",
    "database",
    "migrations",
    "001_initial.sql"
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    await conn.query(sql);
    console.log("Applied:", sqlPath);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
