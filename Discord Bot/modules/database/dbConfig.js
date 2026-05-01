// Environment-driven MySQL + rollout flags.
// MYSQL_ENABLED=true with valid DB_* enables the pool; otherwise the bot stays JSON-only.

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
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || process.env.DB_PASS || "",
  database: process.env.DB_NAME || "",

  /** When true, writes go to MySQL as well as JSON (unless JSON writes are disabled). */
  dualWrite: parseBool(process.env.DB_DUAL_WRITE, false),

  /** Primary read source: json | mysql */
  readMembersSource: parseSource(process.env.DB_READ_MEMBERS, ["json", "mysql"], "json"),
  readClansSource: parseSource(process.env.DB_READ_CLANS, ["json", "mysql"], "json"),

  /** When true, members.json / clans.json / empireids.json are not written (MySQL-only writes). */
  jsonWritesDisabled: parseBool(process.env.DB_JSON_WRITES_DISABLED, false),

  /** After cutover: same as jsonWritesDisabled + read from mysql (set env explicitly). */
  readEmpireRegistrySource: parseSource(
    process.env.DB_READ_EMPIRE_REGISTRY,
    ["json", "mysql"],
    "json"
  ),
  dualWriteEmpireRegistry: parseBool(process.env.DB_DUAL_WRITE_EMPIRE_REGISTRY, false),
};
