// modules/cosmetics/cosmeticsConfig.js
// Constants + pure helpers for the badges & cosmetics system, plus the shared
// purchase flow (reuses the existing points logic — spendPoints /
// checkCategoryRequirements — so buying behaves exactly like the old shop did).

const {
  getBalance,
  checkCategoryRequirements,
  spendPoints,
  VALID_CATEGORIES,
} = require("../points/pointslogic");

// Cosmetic visual types scaffolded now (more can be added later via /catalog).
// NOTE: clan glow is intentionally NOT a cosmetic — it is fixed per clan by the
// mod and must not be changeable.
const COSMETIC_TYPES = ["cape", "pet"];

// Human labels for embeds / option lists.
const TYPE_LABELS = {
  cape: "Cape",
  pet: "Pet",
  badge: "Badge",
};

// How many badges a member may equip at once. Cosmetics are one-per-type.
const MAX_EQUIPPED_BADGES = 3;

/** The equip "slot" an item occupies: its type for cosmetics, 'badge' for badges. */
function slotForItem(item) {
  if (!item) return null;
  return item.kind === "badge" ? "badge" : item.type;
}

/**
 * Parse a "cat:amount,cat:amount" string into a validated { category: amount }
 * object (used by /catalog for deduct maps and hidden gates). Returns null when
 * empty. Unknown categories / non-positive amounts are skipped.
 */
function parseCategoryMap(input) {
  if (!input || typeof input !== "string") return null;
  const out = {};
  for (const pair of input.split(",")) {
    const [rawCat, rawAmt] = pair.split(":").map((s) => (s || "").trim());
    if (!rawCat) continue;
    const cat = rawCat.toLowerCase();
    const amt = parseInt(rawAmt, 10);
    if (VALID_CATEGORIES.includes(cat) && Number.isFinite(amt) && amt > 0) {
      out[cat] = amt;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Attempt to spend points for an item. Mirrors the old shop's attemptPurchase
 * but driven by a DB catalog item ({ cost, deduct_map, category_requirements }).
 * Does NOT grant the item — the caller records ownership on success.
 *
 * @returns {{ success: boolean, newBalance?: number, failReason?: string }}
 */
function purchaseItem(discordId, item) {
  const cost = typeof item.cost === "number" ? item.cost : 0;
  const balance = getBalance(discordId);

  if (balance == null) {
    return { success: false, failReason: "You must be a Yazanaki Empire member to buy this." };
  }
  if (balance < cost) {
    return { success: false, failReason: `❌ You need **${cost}** points; you have **${balance}**.` };
  }

  // Hidden category gate (intentionally vague failure message, like the old shop).
  const catCheck = checkCategoryRequirements(discordId, item.category_requirements || {});
  if (!catCheck.meets) {
    return {
      success: false,
      failReason: "❌ You are not ready for this item yet. Keep contributing and developing your skills.",
    };
  }

  const result = spendPoints(discordId, cost, item.deduct_map || null);
  if (!result.success) {
    return {
      success: false,
      failReason: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Purchase failed.",
    };
  }
  return { success: true, newBalance: result.newBalance };
}

module.exports = {
  COSMETIC_TYPES,
  TYPE_LABELS,
  MAX_EQUIPPED_BADGES,
  slotForItem,
  parseCategoryMap,
  purchaseItem,
};
