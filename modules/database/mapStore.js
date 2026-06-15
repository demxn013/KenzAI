// modules/database/mapStore.js
// Generic dual-write persistence for a JSON "map" store.
//
// Mirrors the behaviour of membersPersistence / clansPersistence but generalised
// so every remaining JSON store can be wired with a few lines instead of a
// bespoke module:
//   • JSON file stays the source of truth for reads unless DB_READ_EXTRAS=mysql
//   • Writes always update the JSON file (unless DB_JSON_WRITES_DISABLED) and,
//     when dual-write / mysql-read / json-disabled is active, sync to MySQL.
//
// Some stores are not a flat { [id]: value } map on disk:
//   • roles.json is { guilds: { [guildId]: cfg } }  -> unwrap/wrap on `guilds`
//   • channels.json is a single config object        -> stored as one row
// `unwrap(fileObject) -> map` and `wrap(map) -> fileObject` handle those shapes.

const fs = require("fs");
const path = require("path");
const config = require("./dbConfig");
const mysqlPool = require("./mysqlPool");
const { makeMapRepository } = require("./mysqlMapRepository");

const identity = (x) => x;

class MapStore {
  /**
   * @param {Object}   opts
   * @param {string}   opts.name      logical name (logging + registry key)
   * @param {string}   opts.jsonPath  absolute path to the JSON file
   * @param {string}   opts.table     MySQL table name
   * @param {string}   opts.pk        primary-key column
   * @param {Function} opts.toRow     (id, value) => row
   * @param {Function} opts.fromRow   (row) => value
   * @param {Function} [opts.unwrap]  (fileObject) => map        (default identity)
   * @param {Function} [opts.wrap]    (map) => fileObject        (default identity)
   * @param {Function} [opts.defaults] () => fileObject when file missing
   * @param {number}   [opts.indent]  JSON indent (default 2)
   * @param {boolean}  [opts.backup]  write a .backup.json on save (default true)
   */
  constructor(opts) {
    this.name = opts.name;
    this.jsonPath = opts.jsonPath;
    this.unwrap = opts.unwrap || identity;
    this.wrap = opts.wrap || identity;
    this.defaults = opts.defaults || (() => ({}));
    this.indent = opts.indent != null ? opts.indent : 2;
    this.backup = opts.backup !== false;
    this.repo = makeMapRepository({
      table: opts.table,
      pk: opts.pk,
      toRow: opts.toRow,
      fromRow: opts.fromRow,
    });
    this.table = opts.table;
    /** In-memory map cache used when DB_READ_EXTRAS=mysql. */
    this.memory = null;
  }

  isReadMysql() {
    return config.readExtrasSource === "mysql";
  }

  _ensureDir() {
    const dir = path.dirname(this.jsonPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /** Read the raw file object (full on-disk shape), creating defaults if absent. */
  readFileObject() {
    this._ensureDir();
    if (!fs.existsSync(this.jsonPath)) {
      const def = this.defaults();
      try {
        fs.writeFileSync(this.jsonPath, JSON.stringify(def, null, this.indent));
      } catch (_) {}
      return def;
    }
    try {
      const raw = fs.readFileSync(this.jsonPath, "utf8");
      return raw && raw.trim() ? JSON.parse(raw) : this.defaults();
    } catch (err) {
      console.error(`[mapStore:${this.name}] ❌ read ${path.basename(this.jsonPath)}:`, err.message);
      return this.defaults();
    }
  }

  /** Read the id→value map from disk. */
  readMapFromDisk() {
    return this.unwrap(this.readFileObject()) || {};
  }

  _writeFileObject(fileObject) {
    if (config.jsonWritesDisabled) return true;
    this._ensureDir();
    try {
      if (this.backup && fs.existsSync(this.jsonPath)) {
        fs.copyFileSync(this.jsonPath, this.jsonPath.replace(/\.json$/, ".backup.json"));
      }
      fs.writeFileSync(this.jsonPath, JSON.stringify(fileObject, null, this.indent));
      return true;
    } catch (err) {
      console.error(`[mapStore:${this.name}] ❌ write ${path.basename(this.jsonPath)}:`, err.message);
      return false;
    }
  }

  _shouldSyncMysql() {
    if (!mysqlPool.getPool()) return false;
    return config.dualWrite || config.jsonWritesDisabled || this.isReadMysql();
  }

  _scheduleMysqlSync(map) {
    if (!this._shouldSyncMysql()) return;
    const snapshot = JSON.parse(JSON.stringify(map || {}));
    setImmediate(() => {
      this.repo.replaceAll(snapshot).catch((err) =>
        console.error(`[mapStore:${this.name}] ❌ MySQL sync:`, err.message)
      );
    });
  }

  // ---- Public API (the bit modules call) --------------------------------

  /** Returns the id→value map (from MySQL memory cache or JSON disk). */
  readMap() {
    if (this.isReadMysql()) {
      if (this.memory && typeof this.memory === "object") return this.memory;
      console.warn(`[mapStore:${this.name}] ⚠️ mysql read mode but cache empty — disk fallback`);
    }
    return this.readMapFromDisk();
  }

  /** Returns the full on-disk file object (handles wrapped shapes for reads). */
  readObject() {
    if (this.isReadMysql() && this.memory && typeof this.memory === "object") {
      return this.wrap(this.memory);
    }
    return this.readFileObject();
  }

  /** Persist an id→value map (writes JSON + schedules MySQL sync). */
  writeMap(map) {
    const clean = map && typeof map === "object" ? map : {};
    this.memory = JSON.parse(JSON.stringify(clean));
    this._writeFileObject(this.wrap(clean));
    this._scheduleMysqlSync(clean);
    return true;
  }

  /** Persist a full on-disk file object (unwraps to a map first). */
  writeObject(fileObject) {
    return this.writeMap(this.unwrap(fileObject) || {});
  }

  /** Load this store's MySQL rows into the memory cache (mysql read mode). */
  async hydrate() {
    if (!mysqlPool.getPool()) return false;
    if (!this.isReadMysql()) return false;
    this.memory = await this.repo.loadAllAsMap();
    console.log(`[mapStore:${this.name}] ✅ MySQL cache loaded (${Object.keys(this.memory || {}).length} rows)`);
    return true;
  }

  /** Backfill MySQL from the current JSON file. Returns rows written. */
  async backfillFromDisk() {
    const map = this.readMapFromDisk();
    await this.repo.replaceAll(map);
    return Object.keys(map || {}).length;
  }

  /** JSON vs MySQL row counts (parity). */
  async parity() {
    const jsonCount = Object.keys(this.readMapFromDisk() || {}).length;
    const sqlCount = await this.repo.count();
    return { name: this.name, table: this.table, json: jsonCount, sql: sqlCount };
  }
}

module.exports = { MapStore };
