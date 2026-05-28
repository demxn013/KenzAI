-- ============================================================
-- KenzAI Discord Bot — New flat-column schema (002)
-- Drops old JSON-blob tables and creates properly normalized ones.
-- Run: /db migrate  then  /db backfill  to re-populate from JSON.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET foreign_key_checks = 0;

-- Drop old JSON-blob tables that are being replaced
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS empire_assignments;
DROP TABLE IF EXISTS empire_sequence;
-- Note: member_events is KEPT (structure is fine, just appending to it)
-- Note: clans table is being replaced with flat-column version below
DROP TABLE IF EXISTS clans;

SET foreign_key_checks = 1;

-- ============================================================
-- MEMBERS
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
-- CLANS
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
-- EMPIRE IDS
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

-- Global sequential counter for empire IDs (clan_abbr = '_global')
CREATE TABLE IF NOT EXISTS empire_id_counters (
    clan_abbr    VARCHAR(10) NOT NULL,
    next_number  INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (clan_abbr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO empire_id_counters (clan_abbr, next_number) VALUES ('_global', 14);

-- ============================================================
-- KICKED MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS kicked_members (
    discord_id      VARCHAR(20) NOT NULL,
    empire_id       VARCHAR(20),
    discord_user    VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_user  VARCHAR(100),
    kicked_at       DATETIME NOT NULL,
    can_reapply_at  DATETIME NOT NULL,
    kick_reason     TEXT,
    original_clan   VARCHAR(100),
    original_data   JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_can_reapply_at (can_reapply_at),
    INDEX idx_empire_id      (empire_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- BANNED MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS banned_members (
    discord_id            VARCHAR(20) NOT NULL,
    empire_id             VARCHAR(20),
    discord_user          VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_user        VARCHAR(100),
    banned_at             DATETIME NOT NULL,
    ban_reason            TEXT,
    original_clan         VARCHAR(100),
    original_data         JSON,
    never_joined_yazanaki TINYINT(1) DEFAULT 0,
    PRIMARY KEY (discord_id),
    INDEX idx_empire_id     (empire_id),
    INDEX idx_never_joined  (never_joined_yazanaki)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- APPLICANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS applicants (
    discord_id         VARCHAR(20) NOT NULL,
    discord_user       VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_user     VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_user_key VARCHAR(100) NOT NULL DEFAULT '',
    minecraft_version  VARCHAR(50),
    timezone           VARCHAR(100),
    previous_groups    TEXT,
    reason             TEXT,
    opened_at          DATETIME NOT NULL,
    server_guild_id    VARCHAR(20) NOT NULL DEFAULT '',
    accepted           TINYINT(1) DEFAULT 0,
    close_reason       TEXT,
    closed_at          DATETIME,
    PRIMARY KEY (discord_id),
    INDEX idx_server_guild_id    (server_guild_id),
    INDEX idx_accepted           (accepted),
    INDEX idx_minecraft_user_key (minecraft_user_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ACCOUNT LINKING
-- ============================================================
CREATE TABLE IF NOT EXISTS linking (
    discord_id     VARCHAR(20) NOT NULL,
    main_account   VARCHAR(100) NOT NULL,
    PRIMARY KEY (discord_id),
    INDEX idx_main_account (main_account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS linking_alternates (
    id             INT UNSIGNED AUTO_INCREMENT,
    discord_id     VARCHAR(20) NOT NULL,
    minecraft_user VARCHAR(100) NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_discord_id     (discord_id),
    INDEX idx_minecraft_user (minecraft_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TICKET CACHE
-- ============================================================
CREATE TABLE IF NOT EXISTS ticket_cache (
    channel_id      VARCHAR(20) NOT NULL,
    type            VARCHAR(50) NOT NULL,
    opener_id       VARCHAR(20) NOT NULL,
    opener_tag      VARCHAR(100) NOT NULL,
    ticket_number   INT UNSIGNED NOT NULL,
    opened_at       DATETIME NOT NULL,
    server_guild_id VARCHAR(20),
    PRIMARY KEY (channel_id),
    INDEX idx_opener_id      (opener_id),
    INDEX idx_type           (type),
    INDEX idx_server_guild_id (server_guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticket_counters (
    counter_key  VARCHAR(100) NOT NULL,
    value        INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id            VARCHAR(20) NOT NULL,
    subscription_tier  ENUM('standard','vip') NOT NULL DEFAULT 'standard',
    payment_platform   VARCHAR(50) DEFAULT 'manual',
    payment_id         VARCHAR(100),
    active             TINYINT(1) DEFAULT 1,
    max_slots_allowed  TINYINT UNSIGNED DEFAULT 1,
    created_at         DATETIME NOT NULL,
    updated_at         DATETIME NOT NULL,
    PRIMARY KEY (user_id),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_logs (
    log_id    VARCHAR(30) NOT NULL,
    user_id   VARCHAR(20) NOT NULL,
    action    VARCHAR(50) NOT NULL,
    tier      VARCHAR(50),
    platform  VARCHAR(50),
    payment_id VARCHAR(100),
    timestamp DATETIME NOT NULL,
    PRIMARY KEY (log_id),
    INDEX idx_user_id   (user_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- BOT SLOTS
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_slots (
    id             INT UNSIGNED AUTO_INCREMENT,
    user_id        VARCHAR(20) NOT NULL,
    slot_index     TINYINT UNSIGNED NOT NULL,
    minecraft_user VARCHAR(100),
    server_id      VARCHAR(50),
    status         VARCHAR(50),
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_slot (user_id, slot_index),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS slot_queue (
    id             INT UNSIGNED AUTO_INCREMENT,
    user_id        VARCHAR(20) NOT NULL,
    minecraft_user VARCHAR(100),
    server_id      VARCHAR(50),
    queued_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SERVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS servers (
    server_id    VARCHAR(50) NOT NULL,
    name         VARCHAR(100) NOT NULL,
    api_base_url VARCHAR(255),
    api_key_env  VARCHAR(100),
    enabled      TINYINT(1) DEFAULT 1,
    PRIMARY KEY (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ARCHIVED MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS archived_members (
    discord_id     VARCHAR(20) NOT NULL,
    archive_reason VARCHAR(100),
    archived_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    original_data  JSON,
    PRIMARY KEY (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- MEMBER EVENTS (kept from 001, structure unchanged)
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