const mysqlPool = require("../mysqlPool");

/**
 * Persists empireids.json shape: { nextNumber, ids: { [empireId]: { ... } } }
 */
async function saveRegistryState(state) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const nextNumber =
    state && typeof state.nextNumber === "number" ? state.nextNumber : 14;
  const ids = (state && state.ids && typeof state.ids === "object") ? state.ids : {};

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "INSERT INTO empire_sequence (id, next_number) VALUES (1, ?) ON DUPLICATE KEY UPDATE next_number = VALUES(next_number)",
      [nextNumber]
    );

    const keep = Object.keys(ids);
    if (keep.length === 0) {
      await conn.execute("DELETE FROM empire_assignments");
    } else {
      const ph = keep.map(() => "?").join(", ");
      await conn.execute(
        `DELETE FROM empire_assignments WHERE empire_id NOT IN (${ph})`,
        keep
      );
    }

    for (const eid of keep) {
      await conn.execute(
        `INSERT INTO empire_assignments (empire_id, assignment_json) VALUES (?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE assignment_json = CAST(? AS JSON)`,
        [String(eid), JSON.stringify(ids[eid]), JSON.stringify(ids[eid])]
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

async function loadRegistryState() {
  const pool = mysqlPool.getPool();
  if (!pool) return null;

  const [seqPacket, assignPacket] = await Promise.all([
    pool.execute("SELECT next_number FROM empire_sequence WHERE id = 1"),
    pool.execute("SELECT empire_id, assignment_json FROM empire_assignments"),
  ]);
  const seqRows = seqPacket[0];
  const assignRows = assignPacket[0];

  const nextNumber =
    seqRows && seqRows[0] && typeof seqRows[0].next_number === "number"
      ? seqRows[0].next_number
      : 14;

  const ids = {};
  for (const row of assignRows || []) {
    const raw = row.assignment_json;
    ids[String(row.empire_id)] =
      typeof raw === "string" ? JSON.parse(raw) : raw;
  }

  return { nextNumber, ids };
}

module.exports = {
  saveRegistryState,
  loadRegistryState,
};
