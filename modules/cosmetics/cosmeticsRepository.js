// modules/cosmetics/cosmeticsRepository.js
// Data layer for the badges & cosmetics system (MySQL-only, FLAT tables from
// migration 002_cosmetics.sql: `shop_items` catalog + `member_cosmetics`
// ownership/equip). Mirrors the style of repositories/userRepository.js.
//
// There is no JSON mirror for cosmetics — if MySQL is disabled getPool() is
// null and every function degrades gracefully (catalog reads return [], writes
// report db_unavailable) so callers can show a friendly message.

const mysqlPool = require("../database/mysqlPool");
const { slotForItem, MAX_EQUIPPED_BADGES } = require("./cosmeticsConfig");

function getPool() {
  return mysqlPool.getPool();
}

function isAvailable() {
  return !!mysqlPool.getPool();
}

/** Defensive JSON parse — mysql2 may return a JSON column as object or string. */
function parseJson(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

/** Normalise a `shop_items` row into a plain item object. */
function rowToItem(row) {
  if (!row) return null;
  return {
    item_id:               row.item_id,
    kind:                  row.kind,
    type:                  row.type,
    name:                  row.name,
    description:           row.description || "",
    cost:                  typeof row.cost === "number" ? row.cost : Number(row.cost) || 0,
    deduct_map:            parseJson(row.deduct_map, null),
    category_requirements: parseJson(row.category_requirements, null),
    duration_days:         row.duration_days == null ? null : Number(row.duration_days),
    purchasable:           !!row.purchasable,
    enabled:               !!row.enabled,
    asset_key:             row.asset_key || null,
    emoji:                 row.emoji || null,
  };
}

/** Convert a duration (days) to a MySQL DATETIME expiry string, or null. */
function expiryFromDuration(durationDays) {
  if (!durationDays || durationDays <= 0) return null;
  const d = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// ---------------------------------------------------------------------------
// CATALOG
// ---------------------------------------------------------------------------

/**
 * List catalog items.
 * @param {{kind?:string, type?:string, enabledOnly?:boolean, purchasableOnly?:boolean}} opts
 */
async function listItems(opts = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = {};
  if (opts.kind)            { where.push("kind = :kind");                params.kind = opts.kind; }
  if (opts.type)            { where.push("type = :type");                params.type = opts.type; }
  if (opts.enabledOnly)     { where.push("enabled = 1"); }
  if (opts.purchasableOnly) { where.push("purchasable = 1"); }
  const sql =
    "SELECT * FROM shop_items" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY kind, type, cost, name";
  const [rows] = await pool.execute(sql, params);
  return rows.map(rowToItem);
}

async function getItem(itemId) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.execute("SELECT * FROM shop_items WHERE item_id = :id", { id: itemId });
  return rows.length ? rowToItem(rows[0]) : null;
}

/**
 * Insert or update a catalog item. Only provided fields are written on update.
 * `fields` uses snake_case column names; deduct_map / category_requirements may
 * be objects (they are stringified here).
 */
async function upsertItem(fields) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };

  const existing = await getItem(fields.item_id);

  const row = {
    item_id:               fields.item_id,
    kind:                  fields.kind                  ?? existing?.kind ?? "badge",
    type:                  fields.type                  ?? existing?.type ?? "badge",
    name:                  fields.name                  ?? existing?.name ?? fields.item_id,
    description:           fields.description           ?? existing?.description ?? "",
    cost:                  fields.cost                  ?? existing?.cost ?? 0,
    deduct_map:            fields.deduct_map !== undefined
                             ? (fields.deduct_map ? JSON.stringify(fields.deduct_map) : null)
                             : (existing?.deduct_map ? JSON.stringify(existing.deduct_map) : null),
    category_requirements: fields.category_requirements !== undefined
                             ? (fields.category_requirements ? JSON.stringify(fields.category_requirements) : null)
                             : (existing?.category_requirements ? JSON.stringify(existing.category_requirements) : null),
    duration_days:         fields.duration_days !== undefined ? fields.duration_days : (existing?.duration_days ?? null),
    purchasable:           fields.purchasable !== undefined ? (fields.purchasable ? 1 : 0) : (existing ? (existing.purchasable ? 1 : 0) : 1),
    enabled:               fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : (existing ? (existing.enabled ? 1 : 0) : 1),
    asset_key:             fields.asset_key !== undefined ? fields.asset_key : (existing?.asset_key ?? null),
    emoji:                 fields.emoji !== undefined ? fields.emoji : (existing?.emoji ?? null),
  };

  await pool.execute(
    `INSERT INTO shop_items
       (item_id, kind, type, name, description, cost, deduct_map, category_requirements,
        duration_days, purchasable, enabled, asset_key, emoji)
     VALUES
       (:item_id, :kind, :type, :name, :description, :cost, :deduct_map, :category_requirements,
        :duration_days, :purchasable, :enabled, :asset_key, :emoji)
     ON DUPLICATE KEY UPDATE
       kind=VALUES(kind), type=VALUES(type), name=VALUES(name), description=VALUES(description),
       cost=VALUES(cost), deduct_map=VALUES(deduct_map), category_requirements=VALUES(category_requirements),
       duration_days=VALUES(duration_days), purchasable=VALUES(purchasable), enabled=VALUES(enabled),
       asset_key=VALUES(asset_key), emoji=VALUES(emoji)`,
    row
  );
  return { ok: true, created: !existing };
}

async function setEnabled(itemId, enabled) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };
  const [res] = await pool.execute(
    "UPDATE shop_items SET enabled = :en WHERE item_id = :id",
    { en: enabled ? 1 : 0, id: itemId }
  );
  return { ok: res.affectedRows > 0 };
}

/** Delete a catalog item AND any ownership rows referencing it (avoid orphans). */
async function deleteItem(itemId) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM member_cosmetics WHERE item_id = :id", { id: itemId });
    const [res] = await conn.execute("DELETE FROM shop_items WHERE item_id = :id", { id: itemId });
    await conn.commit();
    return { ok: res.affectedRows > 0 };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// OWNERSHIP
// ---------------------------------------------------------------------------

const NOT_EXPIRED = "(mc.expires_at IS NULL OR mc.expires_at > NOW())";

/** All owned (non-expired) items for a member, joined to catalog metadata. */
async function getOwned(discordId) {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.execute(
    `SELECT si.*, mc.source, mc.acquired_at, mc.expires_at, mc.equipped
       FROM member_cosmetics mc
       JOIN shop_items si ON si.item_id = mc.item_id
      WHERE mc.discord_id = :did AND ${NOT_EXPIRED}
      ORDER BY si.kind, si.type, si.name`,
    { did: String(discordId) }
  );
  return rows.map((r) => ({
    ...rowToItem(r),
    source:      r.source,
    acquired_at: r.acquired_at,
    expires_at:  r.expires_at,
    equipped:    !!r.equipped,
  }));
}

async function getOwnedIds(discordId) {
  const owned = await getOwned(discordId);
  return new Set(owned.map((i) => i.item_id));
}

async function owns(discordId, itemId) {
  const pool = getPool();
  if (!pool) return false;
  const [rows] = await pool.execute(
    `SELECT 1 FROM member_cosmetics mc
      WHERE mc.discord_id = :did AND mc.item_id = :iid AND ${NOT_EXPIRED} LIMIT 1`,
    { did: String(discordId), iid: itemId }
  );
  return rows.length > 0;
}

/** Equipped (non-expired) items for a member. */
async function getEquipped(discordId) {
  const owned = await getOwned(discordId);
  return owned.filter((i) => i.equipped);
}

/**
 * Give a member an item. Idempotent: re-granting updates expiry/source.
 * @param {string} source 'purchase' | 'grant' | 'earn'
 * @param {number|null} durationDays overrides item.duration_days if provided
 */
async function grant(discordId, itemId, source = "grant", durationDays = undefined) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: "no_such_item" };

  const days = durationDays !== undefined ? durationDays : item.duration_days;
  const expiresAt = expiryFromDuration(days);

  await pool.execute(
    `INSERT INTO member_cosmetics (discord_id, item_id, source, expires_at)
       VALUES (:did, :iid, :src, :exp)
     ON DUPLICATE KEY UPDATE source = VALUES(source), expires_at = VALUES(expires_at)`,
    { did: String(discordId), iid: itemId, src: source, exp: expiresAt }
  );
  return { ok: true, item, expiresAt };
}

async function revoke(discordId, itemId) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };
  const [res] = await pool.execute(
    "DELETE FROM member_cosmetics WHERE discord_id = :did AND item_id = :iid",
    { did: String(discordId), iid: itemId }
  );
  return { ok: res.affectedRows > 0 };
}

// ---------------------------------------------------------------------------
// EQUIP — slot rules: one equipped per cosmetic type, up to N badges.
// ---------------------------------------------------------------------------

async function equip(discordId, itemId) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };

  const did = String(discordId);
  // Must own a non-expired copy.
  const [ownRows] = await pool.execute(
    `SELECT si.* FROM member_cosmetics mc
       JOIN shop_items si ON si.item_id = mc.item_id
      WHERE mc.discord_id = :did AND mc.item_id = :iid AND ${NOT_EXPIRED} LIMIT 1`,
    { did, iid: itemId }
  );
  if (!ownRows.length) return { ok: false, reason: "not_owned" };
  const item = rowToItem(ownRows[0]);

  if (item.kind === "cosmetic") {
    // Unequip any other equipped cosmetic of the same type (one slot per type).
    await pool.execute(
      `UPDATE member_cosmetics mc
         JOIN shop_items si ON si.item_id = mc.item_id
          SET mc.equipped = 0
        WHERE mc.discord_id = :did AND si.type = :type AND mc.item_id <> :iid`,
      { did, type: item.type, iid: itemId }
    );
  } else {
    // Badge: enforce the equipped-badge limit.
    const [cnt] = await pool.execute(
      `SELECT COUNT(*) AS c FROM member_cosmetics mc
         JOIN shop_items si ON si.item_id = mc.item_id
        WHERE mc.discord_id = :did AND mc.equipped = 1 AND si.kind = 'badge'
          AND mc.item_id <> :iid AND ${NOT_EXPIRED}`,
      { did, iid: itemId }
    );
    if ((cnt[0]?.c || 0) >= MAX_EQUIPPED_BADGES) {
      return { ok: false, reason: "badge_slots_full" };
    }
  }

  await pool.execute(
    "UPDATE member_cosmetics SET equipped = 1 WHERE discord_id = :did AND item_id = :iid",
    { did, iid: itemId }
  );
  return { ok: true, item };
}

async function unequip(discordId, itemId) {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_unavailable" };
  const [res] = await pool.execute(
    "UPDATE member_cosmetics SET equipped = 0 WHERE discord_id = :did AND item_id = :iid",
    { did: String(discordId), iid: itemId }
  );
  return { ok: res.affectedRows > 0 };
}

module.exports = {
  isAvailable,
  // catalog
  listItems,
  getItem,
  upsertItem,
  setEnabled,
  deleteItem,
  // ownership
  getOwned,
  getOwnedIds,
  owns,
  grant,
  revoke,
  // equip
  getEquipped,
  equip,
  unequip,
  // helpers (exported for tests)
  rowToItem,
};
