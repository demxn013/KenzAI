// modules/points/pointslogic.js
// Points balance stored on each member in members.json
// (points, pointsByCategory, lastDailyCheckin, lastWeeklyCheckin)

const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const membersPath = path.join(dataDir, "members.json");

// Valid categories
const VALID_CATEGORIES = ["activity", "development", "contribution", "skill", "leadership", "special"];

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
 * Ensure a member entry has the pointsByCategory structure.
 * Migrates existing members gracefully without resetting points.
 */
function ensureCategories(memberEntry) {
  if (!memberEntry.pointsByCategory || typeof memberEntry.pointsByCategory !== "object") {
    memberEntry.pointsByCategory = {
      activity: 0,
      development: 0,
      contribution: 0,
      skill: 0,
      leadership: 0,
      special: 0
    };
  } else {
    // Ensure all categories exist
    for (const cat of VALID_CATEGORIES) {
      if (typeof memberEntry.pointsByCategory[cat] !== "number") {
        memberEntry.pointsByCategory[cat] = 0;
      }
    }
  }
  return memberEntry;
}

/**
 * Get current points balance for a member. Returns null if not in members.json.
 */
function getBalance(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return null;
  return typeof m.points === "number" ? m.points : 0;
}

/**
 * Get category breakdown for a member.
 */
function getCategoryBalance(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return null;
  ensureCategories(m);
  return { ...m.pointsByCategory };
}

/**
 * Check if user is a Yazanaki member (in members.json).
 */
function isMember(discordId) {
  const members = readMembers();
  return !!members[discordId];
}

/**
 * Add points to a member in a specific category.
 * @param {string} discordId
 * @param {number} amount
 * @param {string} source - e.g. "checkin_daily", "staff"
 * @param {string} category - one of VALID_CATEGORIES
 * @returns {{ success: boolean, newBalance?: number, newCategoryBalance?: number, reason?: string }}
 */
function addPoints(discordId, amount, source = "staff", category = "activity") {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };

  ensureCategories(m);

  const resolvedCategory = VALID_CATEGORIES.includes(category) ? category : "activity";

  const current = typeof m.points === "number" ? m.points : 0;
  m.points = current + amount;
  m.pointsByCategory[resolvedCategory] = (m.pointsByCategory[resolvedCategory] || 0) + amount;

  writeMembers(members);
  return {
    success: true,
    newBalance: m.points,
    newCategoryBalance: m.pointsByCategory[resolvedCategory],
    category: resolvedCategory
  };
}

/**
 * Spend points (deduct from total AND categories proportionally or from specified category).
 * When buying from shop, deductMap allows precise per-category deductions.
 * @param {string} discordId
 * @param {number} amount - total to deduct
 * @param {Object|null} deductMap - optional { category: amount } breakdown
 * @returns {{ success: boolean, newBalance?: number, reason?: string }}
 */
function spendPoints(discordId, amount, deductMap = null) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };

  ensureCategories(m);

  const current = typeof m.points === "number" ? m.points : 0;
  if (current < amount) return { success: false, reason: "insufficient_balance" };

  m.points = current - amount;

  if (deductMap && typeof deductMap === "object") {
    // Deduct from specific categories
    for (const [cat, amt] of Object.entries(deductMap)) {
      if (VALID_CATEGORIES.includes(cat) && typeof amt === "number") {
        m.pointsByCategory[cat] = Math.max(0, (m.pointsByCategory[cat] || 0) - amt);
      }
    }
  } else {
    // Proportional deduction across all categories
    const totalCategoryPoints = VALID_CATEGORIES.reduce((sum, cat) => sum + (m.pointsByCategory[cat] || 0), 0);
    if (totalCategoryPoints > 0) {
      let remaining = amount;
      for (const cat of VALID_CATEGORIES) {
        const catVal = m.pointsByCategory[cat] || 0;
        if (catVal > 0 && remaining > 0) {
          const proportion = catVal / totalCategoryPoints;
          const deduct = Math.min(catVal, Math.round(amount * proportion));
          m.pointsByCategory[cat] = Math.max(0, catVal - deduct);
          remaining -= deduct;
        }
      }
      // If there's rounding remainder, take from the largest category
      if (remaining > 0) {
        const largest = VALID_CATEGORIES.reduce((a, b) =>
          (m.pointsByCategory[a] || 0) >= (m.pointsByCategory[b] || 0) ? a : b
        );
        m.pointsByCategory[largest] = Math.max(0, (m.pointsByCategory[largest] || 0) - remaining);
      }
    }
  }

  writeMembers(members);
  return { success: true, newBalance: m.points };
}

/**
 * Check if a member meets category requirements for a shop item.
 * @param {string} discordId
 * @param {Object} categoryRequirements - { category: minAmount }
 * @returns {{ meets: boolean, failing: string[] }}
 */
function checkCategoryRequirements(discordId, categoryRequirements) {
  if (!categoryRequirements || Object.keys(categoryRequirements).length === 0) {
    return { meets: true, failing: [] };
  }

  const cats = getCategoryBalance(discordId);
  if (!cats) return { meets: false, failing: Object.keys(categoryRequirements) };

  const failing = [];
  for (const [cat, required] of Object.entries(categoryRequirements)) {
    if ((cats[cat] || 0) < required) {
      failing.push(cat);
    }
  }

  return { meets: failing.length === 0, failing };
}

/** Daily check-in: can claim if 24h since lastDailyCheckin. */
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

/** Apply daily check-in: add 2 points to activity. */
function applyDailyCheckin(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };

  ensureCategories(m);

  const current = typeof m.points === "number" ? m.points : 0;
  m.points = current + 2;
  m.pointsByCategory.activity = (m.pointsByCategory.activity || 0) + 2;
  m.lastDailyCheckin = new Date().toISOString();
  writeMembers(members);
  return { success: true, newBalance: m.points, pointsAdded: 2 };
}

/** Apply weekly check-in: add 10 points to activity. */
function applyWeeklyCheckin(discordId) {
  const members = readMembers();
  const m = members[discordId];
  if (!m) return { success: false, reason: "not_member" };

  ensureCategories(m);

  const current = typeof m.points === "number" ? m.points : 0;
  m.points = current + 10;
  m.pointsByCategory.activity = (m.pointsByCategory.activity || 0) + 10;
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
  VALID_CATEGORIES,
  readMembers,
  writeMembers,
  getBalance,
  getCategoryBalance,
  isMember,
  addPoints,
  spendPoints,
  checkCategoryRequirements,
  getDailyCheckinStatus,
  getWeeklyCheckinStatus,
  applyDailyCheckin,
  applyWeeklyCheckin,
  getMinecraftUsername,
};