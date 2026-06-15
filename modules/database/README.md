# KenzAI MySQL Layer

KenzAI is the **source of truth** for all Yazanaki Empire data. This module adds
full MySQL support on top of the existing JSON storage using a **dual-write
rollout** so the bot can be migrated to MySQL with zero downtime and an easy
rollback at every step.

The same MySQL database is consumed downstream by:

- **YazanakiAPI** — reads `members ⋈ empire_ids ⋈ clans` and serves the Mod.
- **YazanakiMod** — pulls the member list from YazanakiAPI every 5 minutes.
- **AFK-Client** — (planned) read-only access to `members` / `bot_slots`.

---

## How it works

Every persistent store keeps writing its JSON file **and** mirrors to MySQL.
Reads come from JSON by default; flip a flag per-domain to read from MySQL.

```
module code ──► persistence wrapper ──► JSON file   (source of truth for reads)
                                   └──► MySQL table  (dual-write, becomes primary)
```

Two repository styles are used:

| Style | Tables | Why |
|-------|--------|-----|
| **Flat** (bespoke columns) | `members`, `clans`, `empire_ids`, `empire_id_counters`, `member_events` | Queried directly by the API/Mod, so every field is a real column. |
| **Hybrid** (generic `MapStore`) | everything else (see below) | A lossless `data` JSON column the bot reads back verbatim + a few indexed columns for analytics. One generic factory instead of ~14 bespoke repos. |

The generic pieces:

- `mysqlMapRepository.js` — builds CRUD for any `{ id: value }` store from a
  `toRow` / `fromRow` mapper.
- `mapStore.js` — dual-write persistence (JSON ⇆ memory ⇆ MySQL) with
  `unwrap`/`wrap` hooks for nested (`roles.json`) and singleton (`channels.json`)
  shapes.
- `stores.js` — the registry: one small mapper per store.

## Tables

**Member-facing (flat):** `members` (accepted empire members only),
`clans` (one row per clan, keyed by guild id — scales as the empire grows),
`empire_ids` + `empire_id_counters`, `member_events`.

**Hybrid (`stores.js`):** `applicants` (every application; accepted ones are
also copied into `members`), `kicked_members`, `banned_members`, `linking`,
`subscriptions`, `subscription_logs`, `bot_slots`, `slot_queue`, `servers`,
`archived_members`, `draft_deserters`, `court_requests`, `roles_config`
(one row per guild), `channels_config` (singleton).

`schema_migrations` tracks which `migrations/NNN_*.sql` files have run so each
applies exactly once.

> Applications vs. accepted members are intentionally **separate tables**:
> `applicants` holds all applications, and on acceptance the data is copied into
> `members`. `cache.json` (transient ticket counters) stays local by design.

## Environment flags

```ini
MYSQL_ENABLED=true
DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=...

# Rollout (all default false / json)
DB_DUAL_WRITE=true              # write MySQL + JSON (covers the extra stores too)
DB_DUAL_WRITE_EMPIRE_REGISTRY=true
DB_READ_MEMBERS=json|mysql
DB_READ_CLANS=json|mysql
DB_READ_EMPIRE_REGISTRY=json|mysql
DB_READ_EXTRAS=json|mysql       # applicants, linking, kicked/banned, subs, etc.
DB_JSON_WRITES_DISABLED=false   # MySQL-only mode (final step)
```

## Rollout steps

1. Set `MYSQL_ENABLED=true`, `DB_DUAL_WRITE=true`,
   `DB_DUAL_WRITE_EMPIRE_REGISTRY=true`. Restart.
2. `/db migrate` — applies `002` + `003` (admin only, no shell needed).
3. `/db backfill` — populates every table from JSON.
4. `/db parity` — verify JSON vs MySQL row counts match.
5. Flip reads: `DB_READ_MEMBERS=mysql`, `DB_READ_CLANS=mysql`,
   `DB_READ_EMPIRE_REGISTRY=mysql`, `DB_READ_EXTRAS=mysql`. Restart, re-check `/db parity`.
6. (Optional, when confident) `DB_JSON_WRITES_DISABLED=true` for MySQL-only.

Equivalent CLI scripts (need shell access): `npm run db:migrate`,
`npm run db:backfill`, `npm run db:parity`.
