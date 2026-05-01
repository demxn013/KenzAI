const mysqlPool = require("../mysqlPool");

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

async function replaceAllUsers(membersMap) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const map = normalizeProfilesMap(membersMap);
  const ids = Object.keys(map);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (ids.length === 0) {
      await conn.execute("DELETE FROM users");
    } else {
      const placeholders = ids.map(() => "?").join(", ");
      await conn.execute(`DELETE FROM users WHERE discord_id NOT IN (${placeholders})`, ids);
    }

    for (const id of ids) {
      await conn.execute(
        `INSERT INTO users (discord_id, profile_json) VALUES (?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE profile_json = CAST(? AS JSON)`,
        [id, JSON.stringify(map[id]), JSON.stringify(map[id])]
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function upsertUser(discordId, profile) {
  const pool = mysqlPool.getPool();
  if (!pool) return;
  const id = String(discordId);
  const body = typeof profile === "object" ? { ...profile, discordId: id } : { discordId: id };
  await pool.execute(
    `INSERT INTO users (discord_id, profile_json) VALUES (?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE profile_json = CAST(? AS JSON)`,
    [id, JSON.stringify(body), JSON.stringify(body)]
  );
}

async function deleteUser(discordId) {
  const pool = mysqlPool.getPool();
  if (!pool) return;
  await pool.execute("DELETE FROM users WHERE discord_id = ?", [String(discordId)]);
}

async function loadAllUsersAsMap() {
  const pool = mysqlPool.getPool();
  if (!pool) return {};

  const [rows] = await pool.execute(
    "SELECT discord_id, profile_json FROM users"
  );

  const out = {};
  for (const row of rows) {
    const raw = row.profile_json;
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    out[String(row.discord_id)] = obj;
  }
  return out;
}

module.exports = {
  normalizeProfilesMap,
  replaceAllUsers,
  upsertUser,
  deleteUser,
  loadAllUsersAsMap,
};
