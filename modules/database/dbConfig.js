// modules/database/dbConfig.js
// Environment-driven MySQL + rollout flags.
// MYSQL_ENABLED=true with valid DB_* creds enables the pool; otherwise the bot stays JSON-only.
//
// Required .env variables when MYSQL_ENABLED=true:
//   DB_HOST         MySQL host              (default: 127.0.0.1)
//   DB_PORT         MySQL port              (default: 3306)
//   DB_USER         MySQL username          (required)
//   DB_PASSWORD     MySQL password          (required, alias: DB_PASS)
//   DB_NAME         MySQL database name     (required)
//
// Optional rollout flags (all default false / json):
//   DB_DUAL_WRITE                 Write to MySQL AND JSON on every writeMembers / writeClans
//   DB_DUAL_WRITE_EMPIRE_REGISTRY Write to MySQL AND JSON on every saveEmpireRegistry
//   DB_READ_MEMBERS               "json" (default) | "mysql"
//   DB_READ_CLANS                 "json" (default) | "mysql"
//   DB_READ_EMPIRE_REGISTRY       "json" (default) | "mysql"
//   DB_JSON_WRITES_DISABLED       Stop writing JSON files (MySQL-only mode)
//
// Recommended rollout order:
//   1. MYSQL_ENABLED=true, DB_DUAL_WRITE=true  → dual-write, reads still from JSON
//   2. /db migrate  → apply migration 002_flat_schema.sql
//   3. /db backfill → populate MySQL from JSON
//   4. DB_READ_MEMBERS=mysql, DB_READ_CLANS=mysql, DB_READ_EMPIRE_REGISTRY=mysql
//   5. Verify with /db parity
//   6. DB_JSON_WRITES_DISABLED=true (optional, when confident)

function parseBool(v, defaultVal = false) {
  if (v === undefined || v === null || v === "") return defaultVal;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function parseSource(v, allowed, defaultVal) {
  const s = (v || "").toLowerCase().trim();
  if (allowed.includes(s)) return s;
  return defaultVal;
}

module.exports = {
  mysqlEnabled: parseBool(process.env.MYSQL_ENABLED, false),
  host:         process.env.DB_HOST     || "127.0.0.1",
  port:         Number(process.env.DB_PORT || 3306),
  user:         process.env.DB_USER     || "",
  password:     process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database:     process.env.DB_NAME     || "",

  /** When true, writes go to MySQL as well as JSON. */
  dualWrite: parseBool(process.env.DB_DUAL_WRITE, false),

  /** Primary read source: json | mysql */
  readMembersSource:      parseSource(process.env.DB_READ_MEMBERS,          ["json", "mysql"], "json"),
  readClansSource:        parseSource(process.env.DB_READ_CLANS,            ["json", "mysql"], "json"),
  readEmpireRegistrySource: parseSource(process.env.DB_READ_EMPIRE_REGISTRY, ["json", "mysql"], "json"),

  /** When true, JSON files are not written (MySQL-only writes). */
  jsonWritesDisabled: parseBool(process.env.DB_JSON_WRITES_DISABLED, false),

  /** Empire registry dual-write flag (separate from main dualWrite). */
  dualWriteEmpireRegistry: parseBool(process.env.DB_DUAL_WRITE_EMPIRE_REGISTRY, false),
};