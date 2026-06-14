/**
 * Compare row counts: JSON on disk vs MySQL (quick sanity check).
 * Usage: node scripts/mysql-parity-compare.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

process.env.MYSQL_ENABLED = "true";

const mysqlPoolMod = require("../modules/database/mysqlPool");
const userRepo = require("../modules/database/repositories/userRepository");
const clanRepo = require("../modules/database/repositories/clanRepository");

const dataDir = path.join(__dirname, "..", "modules", "data");

function readJson(rel) {
  const fp = path.join(dataDir, rel);
  if (!fs.existsSync(fp)) return {};
  const raw = fs.readFileSync(fp, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

async function main() {
  const members = readJson("members.json");
  const clans = readJson("clans.json");

  await mysqlPoolMod.createPool();
  const [uSql, cSql] = await Promise.all([
    userRepo.loadAllUsersAsMap(),
    clanRepo.loadAllClansAsMap(),
  ]);

  console.log("JSON members keys:", Object.keys(members).length);
  console.log("SQL  users   rows:", Object.keys(uSql).length);
  console.log("JSON clans   keys:", Object.keys(clans).length);
  console.log("SQL  clans   rows:", Object.keys(cSql).length);

  await mysqlPoolMod.closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
