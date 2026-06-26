// modules/cosmetics/cosmeticsService.js
// Shared purchase/equip flow for badges & cosmetics, reused by BOTH the Discord
// `/shop` command and the launcher (via the internal HTTP endpoint ->
// YazanakiAPI). Centralising it here keeps the two surfaces identical and keeps
// KenzAI the single writer of points (it spends via pointslogic against
// members.json; the API must never touch the MySQL point columns directly).
//
// Every result is a plain `{ ok, reason?, message?, ... }` object so it is safe
// to JSON-serialise straight back over HTTP.

const repo = require("./cosmeticsRepository");
const { purchaseItem } = require("./cosmeticsConfig");
const { getBalance, isMember } = require("../points/pointslogic");

/** Trim a repo item row down to the fields a client needs to render it. */
function slimItem(it) {
  if (!it) return null;
  return {
    item_id:    it.item_id,
    kind:       it.kind,
    type:       it.type,
    name:       it.name,
    asset_key:  it.asset_key || null,
    emoji:      it.emoji || null,
    equipped:   !!it.equipped,
    expires_at: it.expires_at || null,
  };
}

/**
 * Current balance + inventory for a member, returned after every mutation so the
 * caller (Discord or launcher) can refresh without a second round-trip.
 * Intentionally omits the per-category breakdown — categories are internal and
 * not surfaced to players.
 */
async function snapshot(discordId) {
  const [owned, equipped] = await Promise.all([
    repo.getOwned(discordId),
    repo.getEquipped(discordId),
  ]);
  return {
    balance:  getBalance(discordId) || 0,
    owned:    owned.map(slimItem),
    equipped: equipped.map(slimItem),
  };
}

/**
 * Buy an item for a member. Mirrors the old /shop selectMenuHandler exactly:
 * validate -> (hidden category gate + balance via purchaseItem -> spendPoints)
 * -> grant ownership.
 */
async function purchase(discordId, itemId) {
  if (!isMember(discordId)) {
    return { ok: false, reason: "not_member", message: "You must be a Yazanaki Empire member to buy this." };
  }
  if (!repo.isAvailable()) {
    return { ok: false, reason: "db_unavailable", message: "🛠️ The shop is temporarily unavailable. Please try again later." };
  }

  const item = await repo.getItem(itemId);
  if (!item || !item.enabled || !item.purchasable) {
    return { ok: false, reason: "unavailable", message: "❌ That item is no longer available." };
  }

  // Block re-buying a permanent item already owned (temporary ones can re-buy).
  if (item.duration_days == null && (await repo.owns(discordId, itemId))) {
    return { ok: false, reason: "already_owned", message: "❌ You already own that item." };
  }

  const spend = purchaseItem(discordId, item); // deducts points or fails (balance/gate)
  if (!spend.success) {
    return { ok: false, reason: "purchase_failed", message: spend.failReason };
  }

  await repo.grant(discordId, itemId, "purchase");

  const snap = await snapshot(discordId);
  return { ok: true, item: slimItem(item), newBalance: spend.newBalance, ...snap };
}

/** Equip an owned item (slot rules enforced in the repo). */
async function equip(discordId, itemId) {
  if (!isMember(discordId)) return { ok: false, reason: "not_member", message: "Not a member." };
  if (!repo.isAvailable()) return { ok: false, reason: "db_unavailable", message: "Cosmetics unavailable." };

  const r = await repo.equip(discordId, itemId);
  if (!r.ok) {
    const messages = {
      not_owned:         "❌ You don't own that item.",
      badge_slots_full:  "❌ You already have the maximum number of badges equipped.",
      db_unavailable:    "❌ Cosmetics are temporarily unavailable.",
    };
    return { ok: false, reason: r.reason, message: messages[r.reason] || "❌ Could not equip that item." };
  }
  const snap = await snapshot(discordId);
  return { ok: true, item: slimItem(r.item), ...snap };
}

/** Unequip an owned item. */
async function unequip(discordId, itemId) {
  if (!isMember(discordId)) return { ok: false, reason: "not_member", message: "Not a member." };
  if (!repo.isAvailable()) return { ok: false, reason: "db_unavailable", message: "Cosmetics unavailable." };

  const r = await repo.unequip(discordId, itemId);
  if (!r.ok) return { ok: false, reason: "not_equipped", message: "❌ That item wasn't equipped." };

  const snap = await snapshot(discordId);
  return { ok: true, ...snap };
}

module.exports = { purchase, equip, unequip, snapshot, slimItem };
