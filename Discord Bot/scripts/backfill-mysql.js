/**
 * Idempotent JSON → MySQL backfill (users, clans, empire registry) + console report.
 * Usage (from Discord Bot folder): node scripts/backfill-mysql.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

process.env.MYSQL_ENABLED = "true";

const mysqlPoolMod = require("../modules/database/mysqlPool");
const userRepo = require("../modules/database/repositories/userRepository");
const clanRepo = require("../modules/database/repositories/clanRepository");
const empireRepo = require("../modules/database/repositories/empireRegistryRepository");

const dataDir = path.join(__dirname, "..", "modules", "data");

function readJsonSafe(rel) {
  const fp = path.join(dataDir, rel);
  if (!fs.existsSync(fp)) return {};
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn("[backfill] ⚠️ Failed to read", rel, e.message);
    return {};
  }
}

function buildUnifiedUsers(members, linking, applicants) {
  const map = { ...members };

  const addLightweight = (discordId, mcName) => {
    const id = String(discordId);
    if (map[id]) return;
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

function reconciliationReport(usersMap, empireIds) {
  const seenEmpire = new Map();
  const dupEmpire = [];
  for (const [, profile] of Object.entries(usersMap)) {
    const eid = profile && profile.EmpireID ? String(profile.EmpireID).trim() : "";
    if (!eid) continue;
    if (seenEmpire.has(eid)) dupEmpire.push(eid);
    else seenEmpire.set(eid, true);
  }

  console.log("\n────────── Backfill reconciliation ──────────");
  console.log("Member-like user rows:", Object.keys(usersMap).length);
  console.log(
    "Unique non-empty EmpireID in profiles:",
    [...seenEmpire.keys()].length
  );
  if (dupEmpire.length)
    console.warn("⚠️ Duplicate EmpireID values across profiles:", [
      ...new Set(dupEmpire),
    ]);
  console.log(
    "empireids.json registrations:",
    Object.keys((empireIds && empireIds.ids) || {}).length
  );
  console.log("──────────────────────────────────────────────\n");
}

async function main() {
  const members = readJsonSafe("members.json");
  const clans = readJsonSafe("clans.json");
  const empireIds = readJsonSafe("empireids.json");
  const linking = readJsonSafe("linking.json");
  const applicants = readJsonSafe("applicants.json");

  const usersMap = buildUnifiedUsers(members, linking, applicants);
  reconciliationReport(usersMap, empireIds);

  await mysqlPoolMod.createPool();
  const ping = await mysqlPoolMod.ping();
  if (!ping.ok) {
    console.error("MySQL unreachable:", ping.reason);
    process.exit(1);
  }

  console.log("[backfill] Writing users...");
  await userRepo.replaceAllUsers(usersMap);

  console.log("[backfill] Writing clans...");
  await clanRepo.replaceAllClans(clans);

  if (empireIds && typeof empireIds.ids === "object") {
    console.log("[backfill] Writing empire registry...");
    await empireRepo.saveRegistryState({
      nextNumber:
        typeof empireIds.nextNumber === "number" ? empireIds.nextNumber : 14,
      ids: empireIds.ids,
    });
  }

  console.log("[backfill] ✅ Done.");

  await mysqlPoolMod.closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
