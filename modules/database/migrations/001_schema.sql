-- ============================================================
-- KenzAI Discord Bot — Full database schema (single file)
--
-- This is the ONE schema file for the whole bot. It is idempotent and safe to
-- run against either a brand-new database or the existing live database:
--
--   • Data-bearing tables (members, clans, empire_ids, empire_id_counters,
--     member_events) use CREATE TABLE IF NOT EXISTS — they are NEVER dropped,
--     so existing rows are preserved.
--   • Everything else (the hybrid "extra" stores) is dropped and recreated to
--     guarantee the correct shape. These hold no authoritative data — JSON is
--     still the source of truth and `/db backfill` repopulates them.
--
-- Run order is tracked in `schema_migrations` so this applies exactly once per
-- database (re-running is harmless thanks to the rules above).
--
-- Two storage styles live here:
--   • FLAT   — bespoke columns, queried directly by YazanakiAPI / the Mod.
--   • HYBRID — a lossless `data` JSON column the bot reads back verbatim, plus
--              a few indexed columns derived for SQL analytics.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
-- Remove dead / speculative tables (no authoritative data).
--   users / empire_assignments / empire_sequence — old JSON-blob design,
--     replaced by members + empire_ids.
--   linking_alternates — alternates now live inside linking.data (JSON).
--   ticket_cache / ticket_counters — never wired up (cache.json stays local).
-- ------------------------------------------------------------
SET foreign_key_checks = 0;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS empire_assignments;
DROP TABLE IF EXISTS empire_sequence;
DROP TABLE IF EXISTS linking_alternates;
DROP TABLE IF EXISTS ticket_cache;
DROP TABLE IF EXISTS ticket_counters;
SET foreign_key_checks = 1;

-- ============================================================
-- ============================================================
--  CORE (FLAT) TABLES — data-bearing, never dropped.
-- ============================================================
-- ============================================================

-- ============================================================
-- MEMBERS — accepted empire members only.
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
    discord_id            VARCHAR(20) NOT NULL,
    discord_user          VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_user        VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_version     VARCHAR(50),
    joined_clan           VARCHAR(100),
    clan_guild_id         VARCHAR(20),
    join_date             DATE,
    yazanaki_rank         VARCHAR(100),
    empire_id             VARCHAR(20),
    status                ENUM('Draft','Military','Council','Royalty','Citizen') DEFAULT 'Draft',
    points                INT DEFAULT 0,
    pts_activity          INT DEFAULT 0,
    pts_development       INT DEFAULT 0,
    pts_contribution      INT DEFAULT 0,
    pts_skill             INT DEFAULT 0,
    pts_leadership        INT DEFAULT 0,
    pts_special           INT DEFAULT 0,
    draft_start_date      DATETIME,
    draft_expiry_date     DATETIME,
    draft_reminder_sent   TINYINT(1) DEFAULT 0,
    draft_notified        TINYINT(1) DEFAULT 0,
    draft_notified_at     DATETIME,
    draft_outcome         VARCHAR(50),
    draft_completed_date  DATETIME,
    last_daily_checkin    DATETIME,
    last_weekly_checkin   DATETIME,
    alternate_accounts    JSON,
    invite_data           JSON,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (discord_id),
    INDEX idx_clan_guild_id   (clan_guild_id),
    INDEX idx_status          (status),
    INDEX idx_empire_id       (empire_id),
    INDEX idx_minecraft_user  (minecraft_user),
    INDEX idx_draft_expiry    (draft_expiry_date),
    INDEX idx_points          (points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- CLANS — one row per clan Discord server (keyed by guild id).
-- ============================================================
CREATE TABLE IF NOT EXISTS clans (
    guild_id              VARCHAR(20) NOT NULL,
    abbr                  VARCHAR(10) NOT NULL,
    name                  VARCHAR(100) NOT NULL,
    joined_empire         DATE,
    yazanaki_role_id      VARCHAR(20),
    clan_role_id          VARCHAR(20),
    invite                VARCHAR(255),
    residents             INT DEFAULT 0,
    application_mode      VARCHAR(20) DEFAULT 'manual',
    donutsmp_team_name    VARCHAR(50),
    PRIMARY KEY (guild_id),
    INDEX idx_abbr (abbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- EMPIRE IDS + global counter.
-- ============================================================
CREATE TABLE IF NOT EXISTS empire_ids (
    empire_id      VARCHAR(20) NOT NULL,
    discord_id     VARCHAR(20),
    minecraft_user VARCHAR(100),
    clan_abbr      VARCHAR(10) NOT NULL,
    assigned_at    DATETIME NOT NULL,
    reserved       TINYINT(1) DEFAULT 0,
    active         TINYINT(1) DEFAULT 1,
    archived_at    DATETIME,
    kicked_at      DATETIME,
    banned_at      DATETIME,
    PRIMARY KEY (empire_id),
    INDEX idx_discord_id (discord_id),
    INDEX idx_clan_abbr  (clan_abbr),
    INDEX idx_active     (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS empire_id_counters (
    clan_abbr    VARCHAR(10) NOT NULL,
    next_number  INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (clan_abbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO empire_id_counters (clan_abbr, next_number) VALUES ('_global', 14);

-- ============================================================
-- MEMBER EVENTS — append-only event log.
-- ============================================================
CREATE TABLE IF NOT EXISTS member_events (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    discord_id       VARCHAR(32) NULL,
    event_type       VARCHAR(64) NOT NULL,
    payload_json     JSON NULL,
    actor_discord_id VARCHAR(32) NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_member_events_discord      (discord_id),
    KEY idx_member_events_type_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ============================================================
--  HYBRID (EXTRA) STORES — `data` JSON + indexed analytics columns.
--  Dropped and recreated to guarantee shape (no authoritative data here;
--  `/db backfill` repopulates them from the JSON files).
-- ============================================================
-- ============================================================

DROP TABLE IF EXISTS applicants;
DROP TABLE IF EXISTS kicked_members;
DROP TABLE IF EXISTS banned_members;
DROP TABLE IF EXISTS linking;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS subscription_logs;
DROP TABLE IF EXISTS bot_slots;
DROP TABLE IF EXISTS slot_queue;
DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS archived_members;
DROP TABLE IF EXISTS draft_deserters;
DROP TABLE IF EXISTS court_requests;
DROP TABLE IF EXISTS roles_config;
DROP TABLE IF EXISTS channels_config;
DROP TABLE IF EXISTS judiciary_cases;
DROP TABLE IF EXISTS judiciary_archived_cases;
DROP TABLE IF EXISTS judiciary_audit_log;

-- ============================================================
-- APPLICATIONS — every application ever submitted.
-- Accepted applicants are additionally copied into `members`.
-- ============================================================
CREATE TABLE applicants (
    discord_id          VARCHAR(20) NOT NULL,
    discord_user        VARCHAR(100),
    minecraft_user      VARCHAR(100),
    minecraft_user_key  VARCHAR(100),
    server_guild_id     VARCHAR(20),
    accepted            TINYINT(1) DEFAULT 0,
    opened_at           DATETIME,
    closed_at           DATETIME,
    data                JSON,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (discord_id),
    INDEX idx_server_guild_id    (server_guild_id),
    INDEX idx_accepted           (accepted),
    INDEX idx_minecraft_user_key (minecraft_user_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- KICKED MEMBERS (3-month reapply cooldown).
-- ============================================================
CREATE TABLE kicked_members (
    discord_id      VARCHAR(20) NOT NULL,
    empire_id       VARCHAR(20),
    discord_user    VARCHAR(100),
    minecraft_user  VARCHAR(100),
    original_clan   VARCHAR(100),
    kicked_at       DATETIME,
    can_reapply_at  DATETIME,
    data            JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_can_reapply_at (can_reapply_at),
    INDEX idx_empire_id      (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- BANNED MEMBERS.
-- ============================================================
CREATE TABLE banned_members (
    discord_id      VARCHAR(20) NOT NULL,
    empire_id       VARCHAR(20),
    discord_user    VARCHAR(100),
    minecraft_user  VARCHAR(100),
    original_clan   VARCHAR(100),
    banned_at       DATETIME,
    data            JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_empire_id (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ACCOUNT LINKING (main + alternate accounts in data JSON).
-- ============================================================
CREATE TABLE linking (
    discord_id    VARCHAR(20) NOT NULL,
    main_account  VARCHAR(100),
    data          JSON,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (discord_id),
    INDEX idx_main_account (main_account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SUBSCRIPTIONS (bot-slot monetization).
-- ============================================================
CREATE TABLE subscriptions (
    user_id            VARCHAR(20) NOT NULL,
    tier               VARCHAR(50),
    active             TINYINT(1) DEFAULT 0,
    max_slots_allowed  INT DEFAULT 0,
    data               JSON,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE subscription_logs (
    log_id    VARCHAR(40) NOT NULL,
    user_id   VARCHAR(20),
    action    VARCHAR(50),
    tier      VARCHAR(50),
    logged_at DATETIME,
    data      JSON,
    PRIMARY KEY (log_id),
    INDEX idx_user_id   (user_id),
    INDEX idx_logged_at (logged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- BOT SLOTS + QUEUE.
-- ============================================================
CREATE TABLE bot_slots (
    slot_id      VARCHAR(40) NOT NULL,
    owner_id     VARCHAR(20),
    mc_username  VARCHAR(100),
    tier         VARCHAR(50),
    server_id    VARCHAR(50),
    data         JSON,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (slot_id),
    INDEX idx_owner_id (owner_id),
    INDEX idx_tier     (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE slot_queue (
    queue_id   VARCHAR(40) NOT NULL,
    user_id    VARCHAR(20),
    tier       VARCHAR(50),
    queued_at  DATETIME,
    data       JSON,
    PRIMARY KEY (queue_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SERVERS (game-server registry / config).
-- ============================================================
CREATE TABLE servers (
    server_id  VARCHAR(60) NOT NULL,
    name       VARCHAR(100),
    enabled    TINYINT(1) DEFAULT 1,
    data       JSON,
    PRIMARY KEY (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ARCHIVED MEMBERS + DRAFT DESERTERS.
-- ============================================================
CREATE TABLE archived_members (
    discord_id     VARCHAR(20) NOT NULL,
    empire_id      VARCHAR(20),
    minecraft_user VARCHAR(100),
    original_clan  VARCHAR(100),
    left_at        DATETIME,
    data           JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_empire_id (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE draft_deserters (
    discord_id        VARCHAR(20) NOT NULL,
    empire_id         VARCHAR(20),
    minecraft_user    VARCHAR(100),
    original_clan     VARCHAR(100),
    deserted_at       DATETIME,
    punishment_served TINYINT(1) DEFAULT 0,
    data              JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_empire_id (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- JUDICIARY COURT REQUESTS.
-- ============================================================
CREATE TABLE court_requests (
    discord_id        VARCHAR(20) NOT NULL,
    accused_minecraft VARCHAR(100),
    crime_type        VARCHAR(100),
    ticket_channel    VARCHAR(20),
    ticket_number     INT,
    opened_at         DATETIME,
    escalated         TINYINT(1) DEFAULT 0,
    dismissed         TINYINT(1) DEFAULT 0,
    data              JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_escalated (escalated),
    INDEX idx_dismissed (dismissed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ROLE-DETECTION CONFIG (one row per guild) + CHANNEL CONFIG (singleton).
-- ============================================================
CREATE TABLE roles_config (
    guild_id  VARCHAR(20) NOT NULL,
    name      VARCHAR(100),
    data      JSON,
    PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE channels_config (
    config_key VARCHAR(50) NOT NULL,
    data       JSON,
    PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- JUDICIARY — cases, archived cases, and the audit log.
-- ============================================================
CREATE TABLE judiciary_cases (
    case_id  VARCHAR(60) NOT NULL,
    data     JSON,
    PRIMARY KEY (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE judiciary_archived_cases (
    case_id  VARCHAR(60) NOT NULL,
    data     JSON,
    PRIMARY KEY (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE judiciary_audit_log (
    log_id     VARCHAR(40) NOT NULL,
    case_id    VARCHAR(60),
    action     VARCHAR(80),
    logged_at  DATETIME,
    data       JSON,
    PRIMARY KEY (log_id),
    INDEX idx_case_id (case_id),
    INDEX idx_action  (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
