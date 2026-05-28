// modules/database/repositories/userRepository.js
// Targets the flat-column `members` table from migration 002.

const mysqlPool = require("../mysqlPool");

// ---------------------------------------------------------------------------
// Helpers: convert between members.json shape ↔ flat SQL row
// ---------------------------------------------------------------------------

/**
 * Parse a date string (ISO or DD.MM.YYYY) to a MySQL DATE string (YYYY-MM-DD).
 * Returns null if unparseable.
 */
function toSqlDate(v) {
  if (!v || v === "n/d") return null;
  // DD.MM.YYYY format (used by JoinDate)
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
    const [dd, mm, yyyy] = v.split(".");
    return `${yyyy}-${mm}-${dd}`;
  }
  // ISO string — take only date part
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/**
 * Parse any ISO / undefined value to MySQL DATETIME string or null.
 */
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
 * Coerce status value to one of the ENUM members.
 * Falls back to 'Draft' for unknown values.
 */
const VALID_STATUSES = new Set(["Draft", "Military", "Council", "Royalty", "Citizen"]);
function toStatus(v) {
  if (!v || v === "n/d") return "Draft";
  // Capitalise first letter for case normalisation
  const normalised = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  if (VALID_STATUSES.has(normalised)) return normalised;
  // Some entries use "Military" to mean the Military status
  if (v.toLowerCase() === "military") return "Military";
  return "Draft";
}

/**
 * Convert a members.json entry to a flat SQL parameter object.
 */
function profileToRow(discordId, profile) {
  const p = profile && typeof profile === "object" ? profile : {};
  const cats = p.pointsByCategory && typeof p.pointsByCategory === "object"
    ? p.pointsByCategory : {};

  // Collect InviteCount keys into a JSON column
  const inviteData = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof k === "string" && k.endsWith("InviteCount") && typeof v === "number") {
      inviteData[k] = v;
    }
  }

  return {
    discord_id:           String(discordId),
    discord_user:         p.discordUser || "",
    minecraft_user:       p.minecraftUser || "",
    minecraft_version:    p.minecraftVersion || null,
    joined_clan:          p.JoinedClan || null,
    // clan_guild_id is not in the JSON profile — leave null; backfill can set it
    clan_guild_id:        p.clanGuildId || null,
    join_date:            toSqlDate(p.JoinDate),
    yazanaki_rank:        p.YazanakiRank || null,
    empire_id:            p.EmpireID || null,
    status:               toStatus(p.Status),
    points:               typeof p.points === "number" ? p.points : 0,
    pts_activity:         typeof cats.activity     === "number" ? cats.activity     : 0,
    pts_development:      typeof cats.development  === "number" ? cats.development  : 0,
    pts_contribution:     typeof cats.contribution === "number" ? cats.contribution : 0,
    pts_skill:            typeof cats.skill        === "number" ? cats.skill        : 0,
    pts_leadership:       typeof cats.leadership   === "number" ? cats.leadership   : 0,
    pts_special:          typeof cats.special      === "number" ? cats.special      : 0,
    draft_start_date:     toSqlDatetime(p.draftStartDate),
    draft_expiry_date:    toSqlDatetime(p.draftExpiryDate),
    draft_reminder_sent:  p.draftReminderSent ? 1 : 0,
    draft_notified:       p.draftNotified ? 1 : 0,
    draft_notified_at:    toSqlDatetime(p.draftNotifiedAt),
    draft_outcome:        p.draftOutcome || null,
    draft_completed_date: toSqlDatetime(p.draftCompletedDate),
    last_daily_checkin:   toSqlDatetime(p.lastDailyCheckin),
    last_weekly_checkin:  toSqlDatetime(p.lastWeeklyCheckin),
    alternate_accounts:   JSON.stringify(
                            Array.isArray(p.alternateAccounts) ? p.alternateAccounts : []
                          ),
    invite_data:          JSON.stringify(Object.keys(inviteData).length ? inviteData : null),
  };
}

/**
 * Convert a flat SQL row back to the members.json shape consumed by all
 * business-logic modules.
 */
function rowToProfile(row) {
  if (!row) return null;

  const cats = {};
  cats.activity     = row.pts_activity     || 0;
  cats.development  = row.pts_development  || 0;
  cats.contribution = row.pts_contribution || 0;
  cats.skill        = row.pts_skill        || 0;
  cats.leadership   = row.pts_leadership   || 0;
  cats.special      = row.pts_special      || 0;

  let alternateAccounts = [];
  try {
    const raw = row.alternate_accounts;
    alternateAccounts = raw
      ? (typeof raw === "string" ? JSON.parse(raw) : raw) || []
      : [];
  } catch { alternateAccounts = []; }

  // Restore InviteCount keys from invite_data column
  let inviteCounts = {};
  try {
    const raw = row.invite_data;
    if (raw) {
      inviteCounts = (typeof raw === "string" ? JSON.parse(raw) : raw) || {};
    }
  } catch { inviteCounts = {}; }

  const profile = {
    discordId:          row.discord_id,
    discordUser:        row.discord_user   || "",
    minecraftUser:      row.minecraft_user || "",
    minecraftVersion:   row.minecraft_version || "",
    JoinedClan:         row.joined_clan    || "",
    clanGuildId:        row.clan_guild_id  || null,
    JoinDate:           row.join_date      || "",
    YazanakiRank:       row.yazanaki_rank  || "n/d",
    EmpireID:           row.empire_id      || "",
    Status:             row.status         || "Draft",
    points:             row.points         || 0,
    pointsByCategory:   cats,
    draftStartDate:     row.draft_start_date     ? new Date(row.draft_start_date).toISOString()     : null,
    draftExpiryDate:    row.draft_expiry_date     ? new Date(row.draft_expiry_date).toISOString()    : null,
    draftReminderSent:  !!row.draft_reminder_sent,
    draftNotified:      !!row.draft_notified,
    draftNotifiedAt:    row.draft_notified_at     ? new Date(row.draft_notified_at).toISOString()    : null,
    draftOutcome:       row.draft_outcome         || null,
    draftCompletedDate: row.draft_completed_date  ? new Date(row.draft_completed_date).toISOString(): null,
    lastDailyCheckin:   row.last_daily_checkin    ? new Date(row.last_daily_checkin).toISOString()   : null,
    lastWeeklyCheckin:  row.last_weekly_checkin   ? new Date(row.last_weekly_checkin).toISOString()  : null,
    alternateAccounts,
    ...inviteCounts,
  };

  return profile;
}

// ---------------------------------------------------------------------------
// Public API — mirrors what membersPersistence expects
// ---------------------------------------------------------------------------

/**
 * Replace ALL rows in `members` with the provided map.
 * Uses INSERT ... ON DUPLICATE KEY UPDATE for efficiency.
 * @param {Object} membersMap  { [discordId]: profileObject }
 */
async function replaceAllUsers(membersMap) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const map = membersMap && typeof membersMap === "object" ? membersMap : {};
  const ids = Object.keys(map);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Delete rows no longer present in the map
    if (ids.length === 0) {
      await conn.execute("DELETE FROM members");
    } else {
      const ph = ids.map(() => "?").join(", ");
      await conn.execute(`DELETE FROM members WHERE discord_id NOT IN (${ph})`, ids);
    }

    // Upsert each member
    for (const id of ids) {
      await _upsertRow(conn, id, map[id]);
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
 * Insert or update a single member row.
 */
async function upsertUser(discordId, profile) {
  const pool = mysqlPool.getPool();
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    await _upsertRow(conn, discordId, profile);
  } finally {
    conn.release();
  }
}

/**
 * Delete a single member row.
 */
async function deleteUser(discordId) {
  const pool = mysqlPool.getPool();
  if (!pool) return;
  await pool.execute("DELETE FROM members WHERE discord_id = ?", [String(discordId)]);
}

/**
 * Load all members as a map { [discordId]: profileObject }.
 */
async function loadAllUsersAsMap() {
  const pool = mysqlPool.getPool();
  if (!pool) return {};

  const [rows] = await pool.execute("SELECT * FROM members");
  const out = {};
  for (const row of rows) {
    const profile = rowToProfile(row);
    if (profile) out[String(row.discord_id)] = profile;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function _upsertRow(conn, discordId, profile) {
  const r = profileToRow(discordId, profile);

  await conn.execute(
    `INSERT INTO members (
       discord_id, discord_user, minecraft_user, minecraft_version,
       joined_clan, clan_guild_id, join_date, yazanaki_rank, empire_id, status,
       points, pts_activity, pts_development, pts_contribution, pts_skill, pts_leadership, pts_special,
       draft_start_date, draft_expiry_date, draft_reminder_sent, draft_notified,
       draft_notified_at, draft_outcome, draft_completed_date,
       last_daily_checkin, last_weekly_checkin,
       alternate_accounts, invite_data
     ) VALUES (
       :discord_id, :discord_user, :minecraft_user, :minecraft_version,
       :joined_clan, :clan_guild_id, :join_date, :yazanaki_rank, :empire_id, :status,
       :points, :pts_activity, :pts_development, :pts_contribution, :pts_skill, :pts_leadership, :pts_special,
       :draft_start_date, :draft_expiry_date, :draft_reminder_sent, :draft_notified,
       :draft_notified_at, :draft_outcome, :draft_completed_date,
       :last_daily_checkin, :last_weekly_checkin,
       :alternate_accounts, :invite_data
     )
     ON DUPLICATE KEY UPDATE
       discord_user          = VALUES(discord_user),
       minecraft_user        = VALUES(minecraft_user),
       minecraft_version     = VALUES(minecraft_version),
       joined_clan           = VALUES(joined_clan),
       clan_guild_id         = VALUES(clan_guild_id),
       join_date             = VALUES(join_date),
       yazanaki_rank         = VALUES(yazanaki_rank),
       empire_id             = VALUES(empire_id),
       status                = VALUES(status),
       points                = VALUES(points),
       pts_activity          = VALUES(pts_activity),
       pts_development       = VALUES(pts_development),
       pts_contribution      = VALUES(pts_contribution),
       pts_skill             = VALUES(pts_skill),
       pts_leadership        = VALUES(pts_leadership),
       pts_special           = VALUES(pts_special),
       draft_start_date      = VALUES(draft_start_date),
       draft_expiry_date     = VALUES(draft_expiry_date),
       draft_reminder_sent   = VALUES(draft_reminder_sent),
       draft_notified        = VALUES(draft_notified),
       draft_notified_at     = VALUES(draft_notified_at),
       draft_outcome         = VALUES(draft_outcome),
       draft_completed_date  = VALUES(draft_completed_date),
       last_daily_checkin    = VALUES(last_daily_checkin),
       last_weekly_checkin   = VALUES(last_weekly_checkin),
       alternate_accounts    = VALUES(alternate_accounts),
       invite_data           = VALUES(invite_data)`,
    r
  );
}

// Keep old name used by adminTasks for backfill compatibility
function normalizeProfilesMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  for (const [id, profile] of Object.entries(map)) {
    if (!profile || typeof profile !== "object") continue;
    const discordKey = profile.discordId || id;
    out[String(discordKey)] = { ...profile, discordId: String(discordKey) };
  }
  return out;
}

module.exports = {
  normalizeProfilesMap,
  replaceAllUsers,
  upsertUser,
  deleteUser,
  loadAllUsersAsMap,
  // Exposed for testing / internal use
  profileToRow,
  rowToProfile,
};