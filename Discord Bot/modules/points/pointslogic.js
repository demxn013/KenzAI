// modules/points/pointslogic.js
// Points balance stored on each member in members.json (points, lastDailyCheckin, lastWeeklyCheckin)

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const membersPath = path.join(dataDir, "members.json");

function readMembers() {
  try {
    if (!fs.existsSync(membersPath)) return {};
    const raw = fs.readFileSync(membersPath, "utf8");
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("[pointslogic] Error reading members.json:", err);
    return {};
  }
}

function writeMembers(data) {
  try {
    if (fs.existsSync(membersPath)) {
      const backupPath = membersPath.replace(".json", ".backup.json");
      fs.copyFileSync(membersPath, backupPath);
    }
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(membersPath, JSON.stringify(data, null, 4));
    return true;
  } catch (err) {
    console.error("[pointslogic] Error writing members.json:", err);
    return false;
  }
}

/**
 * Get current points balance for a member. Returns 0 if not in members.json.
 */
function getBalance(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return null;
  return typeof m.points === "number" ? m.points : 0;
}

/**
 * Check if user is a Yazanaki member (in members.json).
 */
function isMember(discordId) {
  const members = readMembers();
  return !!members[discordId];
}

/**
 * Add points to a member. Only works if user exists in members.json.
 * @param {string} discordId
 * @param {number} amount
 * @param {string} source - e.g. "checkin_daily", "checkin_weekly", "message", "voice", "staff"
 * @returns {{ success: boolean, newBalance?: number, reason?: string }}
 */
function addPoints(discordId, amount, source = "staff") {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };
  const current = typeof m.points === "number" ? m.points : 0;
  const newBalance = current + amount;
  m.points = newBalance;
  writeMembers(members);
  return { success: true, newBalance };
}

/**
 * Spend points (deduct). Only works if user exists and has sufficient balance.
 * @returns {{ success: boolean, newBalance?: number, reason?: string }}
 */
function spendPoints(discordId, amount) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };
  const current = typeof m.points === "number" ? m.points : 0;
  if (current < amount) return { success: false, reason: "insufficient_balance" };
  m.points = current - amount;
  writeMembers(members);
  return { success: true, newBalance: m.points };
}

/** Daily check-in: can claim if 24h since lastDailyCheckin. Returns { canClaim, nextAt, lastAt }. */
function getDailyCheckinStatus(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { canClaim: false, reason: "not_member" };
  const last = m.lastDailyCheckin ? new Date(m.lastDailyCheckin) : null;
  const now = new Date();
  if (!last) return { canClaim: true };
  const hoursSince = (now - last) / (1000 * 60 * 60);
  return {
    canClaim: hoursSince >= 24,
    nextAt: last ? new Date(last.getTime() + 24 * 60 * 60 * 1000) : null,
    lastAt: last,
  };
}

/** Weekly check-in: can claim if 7d since lastWeeklyCheckin. */
function getWeeklyCheckinStatus(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { canClaim: false, reason: "not_member" };
  const last = m.lastWeeklyCheckin ? new Date(m.lastWeeklyCheckin) : null;
  const now = new Date();
  if (!last) return { canClaim: true };
  const daysSince = (now - last) / (1000 * 60 * 60 * 24);
  return {
    canClaim: daysSince >= 7,
    nextAt: last ? new Date(last.getTime() + 7 * 24 * 60 * 60 * 1000) : null,
    lastAt: last,
  };
}

/** Apply daily check-in: add 10 points and set lastDailyCheckin. */
function applyDailyCheckin(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };
  const current = typeof m.points === "number" ? m.points : 0;
  m.points = current + 2;
  m.lastDailyCheckin = new Date().toISOString();
  writeMembers(members);
  return { success: true, newBalance: m.points, pointsAdded: 2 };
}

/** Apply weekly check-in: add 25 points and set lastWeeklyCheckin. */
function applyWeeklyCheckin(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };
  const current = typeof m.points === "number" ? m.points : 0;
  m.points = current + 10;
  m.lastWeeklyCheckin = new Date().toISOString();
  writeMembers(members);
  return { success: true, newBalance: m.points, pointsAdded: 10 };
}

/** Get Minecraft username for a member (for redemption posts). */
function getMinecraftUsername(discordId) {
  const members = readMembers();
  const m = members[discordId];
  return m ? (m.minecraftUser || null) : null;
}

module.exports = {
  readMembers,
  writeMembers,
  getBalance,
  isMember,
  addPoints,
  spendPoints,
  getDailyCheckinStatus,
  getWeeklyCheckinStatus,
  applyDailyCheckin,
  applyWeeklyCheckin,
  getMinecraftUsername,
};
