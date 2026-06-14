// modules/database/repositories/clanRepository.js
// Targets the flat-column `clans` table from migration 002.

const mysqlPool = require("../mysqlPool");

// ---------------------------------------------------------------------------
// Helpers: convert between clans.json shape ↔ flat SQL row
// ---------------------------------------------------------------------------

/**
 * Parse a date string (YYYY-MM-DD or ISO) to MySQL DATE string or null.
 */
function toSqlDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/**
 * Convert a clans.json entry to a flat SQL parameter object.
 */
function clanToRow(guildId, clan) {
  const c = clan && typeof clan === "object" ? clan : {};
  return {
    guild_id:           String(guildId),
    abbr:               c.abbr              || "",
    name:               c.name              || "",
    joined_empire:      toSqlDate(c.joinedEmpire),
    yazanaki_role_id:   c.yazanakiRoleId    || null,
    clan_role_id:       c.clanRoleId        || null,
    invite:             c.invite            || null,
    residents:          typeof c.residents === "number" ? c.residents : 0,
    application_mode:   c.applicationMode  || "manual",
    donutsmp_team_name: c.donutsmpTeamName || null,
  };
}

/**
 * Convert a flat SQL row back to the clans.json shape.
 */
function rowToClan(row) {
  if (!row) return null;
  return {
    abbr:             row.abbr              || "",
    name:             row.name              || "",
    joinedEmpire:     row.joined_empire     || null,
    yazanakiRoleId:   row.yazanaki_role_id  || null,
    clanRoleId:       row.clan_role_id      || null,
    invite:           row.invite            || "#",
    residents:        row.residents         || 0,
    applicationMode:  row.application_mode  || "manual",
    donutsmpTeamName: row.donutsmp_team_name || null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replace ALL rows in `clans` with the provided map.
 * @param {Object} clansObj  { [guildId]: clanObject }
 */
async function replaceAllClans(clansObj) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const guildIds = Object.keys(clansObj || {});
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (guildIds.length === 0) {
      await conn.execute("DELETE FROM clans");
    } else {
      const ph = guildIds.map(() => "?").join(", ");
      await conn.execute(
        `DELETE FROM clans WHERE guild_id NOT IN (${ph})`,
        guildIds
      );
    }

    for (const gid of guildIds) {
      await _upsertClan(conn, gid, clansObj[gid]);
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
 * Insert or update a single clan row.
 */
async function upsertClan(guildId, clan) {
  const pool = mysqlPool.getPool();
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    await _upsertClan(conn, guildId, clan);
  } finally {
    conn.release();
  }
}

/**
 * Load all clans as a map { [guildId]: clanObject }.
 */
async function loadAllClansAsMap() {
  const pool = mysqlPool.getPool();
  if (!pool) return {};

  const [rows] = await pool.execute("SELECT * FROM clans");
  const out = {};
  for (const row of rows) {
    out[String(row.guild_id)] = rowToClan(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function _upsertClan(conn, guildId, clan) {
  const r = clanToRow(guildId, clan);

  await conn.execute(
    `INSERT INTO clans (
       guild_id, abbr, name, joined_empire,
       yazanaki_role_id, clan_role_id, invite, residents,
       application_mode, donutsmp_team_name
     ) VALUES (
       :guild_id, :abbr, :name, :joined_empire,
       :yazanaki_role_id, :clan_role_id, :invite, :residents,
       :application_mode, :donutsmp_team_name
     )
     ON DUPLICATE KEY UPDATE
       abbr               = VALUES(abbr),
       name               = VALUES(name),
       joined_empire      = VALUES(joined_empire),
       yazanaki_role_id   = VALUES(yazanaki_role_id),
       clan_role_id       = VALUES(clan_role_id),
       invite             = VALUES(invite),
       residents          = VALUES(residents),
       application_mode   = VALUES(application_mode),
       donutsmp_team_name = VALUES(donutsmp_team_name)`,
    r
  );
}

module.exports = {
  replaceAllClans,
  upsertClan,
  loadAllClansAsMap,
  // Exposed for testing / internal use
  clanToRow,
  rowToClan,
};