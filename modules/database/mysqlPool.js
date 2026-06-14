const config = require("./dbConfig");

let pool = null;

function isConfigured() {
  return !!(config.mysqlEnabled && config.user && config.database);
}

function getPool() {
  return pool;
}

async function createPool() {
  if (!isConfigured()) {
    return null;
  }
  const mysql = require("mysql2/promise");
  pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
  return pool;
}

async function ping() {
  const p = getPool();
  if (!p) return { ok: false, reason: "pool_disabled" };
  const conn = await p.getConnection();
  try {
    await conn.ping();
    return { ok: true };
  } finally {
    conn.release();
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  isConfigured,
  createPool,
  getPool,
  ping,
  closePool,
};
