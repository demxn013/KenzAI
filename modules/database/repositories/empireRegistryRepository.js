// modules/database/repositories/empireRegistryRepository.js
// Targets the flat-column `empire_ids` + `empire_id_counters` tables from migration 002.

const mysqlPool = require("../mysqlPool");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSqlDatetime(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return null;
  }
}

/**
 * Convert an assignment entry (from empireids.json ids map) to a flat SQL row.
 * @param {string} empireId  e.g. "SNU-000014"
 * @param {Object} entry     the value from ids[empireId]
 */
function assignmentToRow(empireId, entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  // Extract clan_abbr from the empireId prefix (e.g. "SNU" from "SNU-000014")
  const clanAbbr = e.clanAbbr || (empireId.includes("-") ? empireId.split("-")[0] : "YZNK");

  return {
    empire_id:      String(empireId),
    discord_id:     e.discordId     || null,
    minecraft_user: e.minecraftUser || null,
    clan_abbr:      clanAbbr,
    assigned_at:    toSqlDatetime(e.assignedAt) || new Date().toISOString().slice(0, 19).replace("T", " "),
    reserved:       e.reserved      ? 1 : 0,
    active:         e.active === false ? 0 : 1,
    archived_at:    toSqlDatetime(e.archivedAt),
    kicked_at:      toSqlDatetime(e.kickedAt),
    banned_at:      toSqlDatetime(e.bannedAt),
  };
}

/**
 * Convert a flat SQL row back to the assignment entry shape stored in
 * empireids.json's ids map.
 */
function rowToAssignment(row) {
  if (!row) return null;
  const entry = {
    discordId:     row.discord_id     || null,
    minecraftUser: row.minecraft_user || null,
    clanAbbr:      row.clan_abbr,
    assignedAt:    row.assigned_at    ? new Date(row.assigned_at).toISOString()  : null,
    reserved:      !!row.reserved,
    active:        row.active !== 0,
  };
  if (row.archived_at) entry.archivedAt = new Date(row.archived_at).toISOString();
  if (row.kicked_at)   entry.kickedAt   = new Date(row.kicked_at).toISOString();
  if (row.banned_at)   entry.bannedAt   = new Date(row.banned_at).toISOString();
  return entry;
}

// ---------------------------------------------------------------------------
// Public API — mirrors what empireRegistryPersistence expects
// ---------------------------------------------------------------------------

/**
 * Persist the full registry state { nextNumber, ids: { ... } }.
 * Replaces all empire_ids rows and updates the counter.
 */
async function saveRegistryState(state) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const nextNumber =
    state && typeof state.nextNumber === "number" ? state.nextNumber : 14;
  const ids =
    state && state.ids && typeof state.ids === "object" ? state.ids : {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Update global counter
    await conn.execute(
      `INSERT INTO empire_id_counters (clan_abbr, next_number)
       VALUES ('_global', ?)
       ON DUPLICATE KEY UPDATE next_number = VALUES(next_number)`,
      [nextNumber]
    );

    // Remove rows not in current ids set
    const keep = Object.keys(ids);
    if (keep.length === 0) {
      await conn.execute("DELETE FROM empire_ids");
    } else {
      const ph = keep.map(() => "?").join(", ");
      await conn.execute(
        `DELETE FROM empire_ids WHERE empire_id NOT IN (${ph})`,
        keep
      );
    }

    // Upsert each assignment
    for (const eid of keep) {
      await _upsertAssignment(conn, eid, ids[eid]);
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Load the full registry state { nextNumber, ids: { ... } }.
 * Returns null if the pool is unavailable.
 */
async function loadRegistryState() {
  const pool = mysqlPool.getPool();
  if (!pool) return null;

  const [[counterRows], [assignRows]] = await Promise.all([
    pool.execute(
      "SELECT next_number FROM empire_id_counters WHERE clan_abbr = '_global'"
    ),
    pool.execute("SELECT * FROM empire_ids"),
  ]);

  const nextNumber =
    counterRows && counterRows[0] && typeof counterRows[0].next_number === "number"
      ? counterRows[0].next_number
      : 14;

  const ids = {};
  for (const row of assignRows || []) {
    ids[String(row.empire_id)] = rowToAssignment(row);
  }

  return { nextNumber, ids };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function _upsertAssignment(conn, empireId, entry) {
  const r = assignmentToRow(empireId, entry);

  await conn.execute(
    `INSERT INTO empire_ids (
       empire_id, discord_id, minecraft_user, clan_abbr,
       assigned_at, reserved, active, archived_at, kicked_at, banned_at
     ) VALUES (
       :empire_id, :discord_id, :minecraft_user, :clan_abbr,
       :assigned_at, :reserved, :active, :archived_at, :kicked_at, :banned_at
     )
     ON DUPLICATE KEY UPDATE
       discord_id     = VALUES(discord_id),
       minecraft_user = VALUES(minecraft_user),
       clan_abbr      = VALUES(clan_abbr),
       assigned_at    = VALUES(assigned_at),
       reserved       = VALUES(reserved),
       active         = VALUES(active),
       archived_at    = VALUES(archived_at),
       kicked_at      = VALUES(kicked_at),
       banned_at      = VALUES(banned_at)`,
    r
  );
}

module.exports = {
  saveRegistryState,
  loadRegistryState,
  // Exposed for testing / internal use
  assignmentToRow,
  rowToAssignment,
};