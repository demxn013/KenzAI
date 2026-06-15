-- ============================================================
-- KenzAI Discord Bot — Extra stores schema (003)
-- Wires every remaining JSON store into MySQL using a hybrid layout:
--   • a lossless `data` JSON column (the bot reads this back verbatim)
--   • a few indexed columns derived for SQL analytics / API queries
--
-- The speculative 002 versions of these tables (whose columns did not match the
-- real JSON shapes and were never populated) are dropped and recreated here.
-- Run order is tracked in `schema_migrations`, so this file runs exactly once.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Replace mismatched / placeholder tables from 002 (no real data yet).
DROP TABLE IF EXISTS linking_alternates;
DROP TABLE IF EXISTS linking;
DROP TABLE IF EXISTS applicants;
DROP TABLE IF EXISTS kicked_members;
DROP TABLE IF EXISTS banned_members;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS subscription_logs;
DROP TABLE IF EXISTS bot_slots;
DROP TABLE IF EXISTS slot_queue;
DROP TABLE IF EXISTS servers;
DROP TABLE IF EXISTS archived_members;

-- ============================================================
-- APPLICATIONS — every application ever submitted.
-- Accepted applicants are additionally copied into `members`.
-- ============================================================
CREATE TABLE IF NOT EXISTS applicants (
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
-- KICKED MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS kicked_members (
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
-- BANNED MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS banned_members (
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
-- ACCOUNT LINKING (main + alternate accounts in data JSON)
-- ============================================================
CREATE TABLE IF NOT EXISTS linking (
    discord_id    VARCHAR(20) NOT NULL,
    main_account  VARCHAR(100),
    data          JSON,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (discord_id),
    INDEX idx_main_account (main_account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SUBSCRIPTIONS (bot-slot monetization)
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id            VARCHAR(20) NOT NULL,
    tier               VARCHAR(50),
    active             TINYINT(1) DEFAULT 0,
    max_slots_allowed  INT DEFAULT 0,
    data               JSON,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_logs (
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
-- BOT SLOTS + QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_slots (
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

CREATE TABLE IF NOT EXISTS slot_queue (
    queue_id   VARCHAR(40) NOT NULL,
    user_id    VARCHAR(20),
    tier       VARCHAR(50),
    queued_at  DATETIME,
    data       JSON,
    PRIMARY KEY (queue_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SERVERS (game-server registry / config)
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
    server_id  VARCHAR(60) NOT NULL,
    name       VARCHAR(100),
    enabled    TINYINT(1) DEFAULT 1,
    data       JSON,
    PRIMARY KEY (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ARCHIVED MEMBERS + DRAFT DESERTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS archived_members (
    discord_id     VARCHAR(20) NOT NULL,
    empire_id      VARCHAR(20),
    minecraft_user VARCHAR(100),
    original_clan  VARCHAR(100),
    left_at        DATETIME,
    data           JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_empire_id (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS draft_deserters (
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
-- JUDICIARY COURT REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS court_requests (
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
-- ROLE-DETECTION CONFIG (one row per guild) + CHANNEL CONFIG (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS roles_config (
    guild_id  VARCHAR(20) NOT NULL,
    name      VARCHAR(100),
    data      JSON,
    PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channels_config (
    config_key VARCHAR(50) NOT NULL,
    data       JSON,
    PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- JUDICIARY — cases, archived cases, and the audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS judiciary_cases (
    case_id  VARCHAR(60) NOT NULL,
    data     JSON,
    PRIMARY KEY (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS judiciary_archived_cases (
    case_id  VARCHAR(60) NOT NULL,
    data     JSON,
    PRIMARY KEY (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS judiciary_audit_log (
    log_id     VARCHAR(40) NOT NULL,
    case_id    VARCHAR(60),
    action     VARCHAR(80),
    logged_at  DATETIME,
    data       JSON,
    PRIMARY KEY (log_id),
    INDEX idx_case_id (case_id),
    INDEX idx_action  (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
