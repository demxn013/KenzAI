// modules/database/mysqlMapRepository.js
// Generic MySQL repository for "map" stores — a JSON object keyed by string id
// ({ [id]: valueObject }). Each store provides a `toRow(id, value)` mapper that
// returns a flat column object (including the primary-key column) and a
// `fromRow(row)` mapper that reconstructs the value object.
//
// This removes the need to hand-write a bespoke repository for every JSON store.
// The column list is derived dynamically from the keys returned by `toRow`, so a
// store only has to declare its mapper + table + primary-key column.

const mysqlPool = require("./mysqlPool");

/**
 * @param {Object}   opts
 * @param {string}   opts.table   SQL table name
 * @param {string}   opts.pk      primary-key column name
 * @param {Function} opts.toRow   (id, value) => ({ [col]: val, ... }) incl. pk
 * @param {Function} opts.fromRow (row)       => valueObject
 */
function makeMapRepository({ table, pk, toRow, fromRow }) {
  if (!table || !pk || typeof toRow !== "function" || typeof fromRow !== "function") {
    throw new Error(`makeMapRepository: invalid config for table=${table}`);
  }

  function buildUpsert(row) {
    const cols = Object.keys(row);
    const colList = cols.map((c) => `\`${c}\``).join(", ");
    const placeholders = cols.map((c) => `:${c}`).join(", ");
    const updates = cols
      .filter((c) => c !== pk)
      .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
      .join(", ");
    const sql =
      `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})` +
      (updates ? ` ON DUPLICATE KEY UPDATE ${updates}` : "");
    return sql;
  }

  async function _upsertRow(conn, id, value) {
    const row = toRow(id, value);
    await conn.execute(buildUpsert(row), row);
  }

  /** Replace ALL rows in the table with the provided map (transactional). */
  async function replaceAll(map) {
    const pool = mysqlPool.getPool();
    if (!pool) return;

    const entries = Object.entries(map && typeof map === "object" ? map : {});
    const ids = entries.map(([id]) => String(id));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (ids.length === 0) {
        await conn.execute(`DELETE FROM \`${table}\``);
      } else {
        const ph = ids.map(() => "?").join(", ");
        await conn.execute(
          `DELETE FROM \`${table}\` WHERE \`${pk}\` NOT IN (${ph})`,
          ids
        );
      }

      for (const [id, value] of entries) {
        await _upsertRow(conn, id, value);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  /** Insert or update a single row. */
  async function upsert(id, value) {
    const pool = mysqlPool.getPool();
    if (!pool) return;
    const conn = await pool.getConnection();
    try {
      await _upsertRow(conn, id, value);
    } finally {
      conn.release();
    }
  }

  /** Delete a single row by id. */
  async function deleteById(id) {
    const pool = mysqlPool.getPool();
    if (!pool) return;
    await pool.execute(`DELETE FROM \`${table}\` WHERE \`${pk}\` = ?`, [String(id)]);
  }

  /** Load all rows as a map { [id]: valueObject }. */
  async function loadAllAsMap() {
    const pool = mysqlPool.getPool();
    if (!pool) return {};
    const [rows] = await pool.execute(`SELECT * FROM \`${table}\``);
    const out = {};
    for (const row of rows || []) {
      out[String(row[pk])] = fromRow(row);
    }
    return out;
  }

  /** Row count (for parity checks). */
  async function count() {
    const pool = mysqlPool.getPool();
    if (!pool) return 0;
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM \`${table}\``
    );
    return rows && rows[0] ? Number(rows[0].n) : 0;
  }

  return {
    table,
    pk,
    replaceAll,
    upsert,
    deleteById,
    loadAllAsMap,
    count,
    // Exposed for testing / debugging.
    toRow,
    fromRow,
    buildUpsert,
  };
}

module.exports = { makeMapRepository };
