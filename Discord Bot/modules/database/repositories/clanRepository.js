const mysqlPool = require("../mysqlPool");

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
      await conn.execute(`DELETE FROM clans WHERE discord_guild_id NOT IN (${ph})`, guildIds);
    }

    for (const gid of guildIds) {
      const json = sanitizeClanEntry(clansObj[gid]);
      await conn.execute(
        `INSERT INTO clans (discord_guild_id, clan_json) VALUES (?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE clan_json = CAST(? AS JSON)`,
        [String(gid), JSON.stringify(json), JSON.stringify(json)]
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

function sanitizeClanEntry(entry) {
  return entry && typeof entry === "object" ? entry : {};
}

async function loadAllClansAsMap() {
  const pool = mysqlPool.getPool();
  if (!pool) return {};

  const [rows] = await pool.execute("SELECT discord_guild_id, clan_json FROM clans");
  const out = {};
  for (const row of rows) {
    const raw = row.clan_json;
    out[String(row.discord_guild_id)] =
      typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  return out;
}

module.exports = {
  replaceAllClans,
  loadAllClansAsMap,
};
