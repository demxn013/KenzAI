-- KenzAI Discord bot — initial MySQL schema (member/clan/empire registry + audit)
-- Run: node scripts/mysql-migrate.js (from Discord Bot directory)

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS users (
  discord_id VARCHAR(32) NOT NULL,
  profile_json JSON NOT NULL,
  minecraft_user VARCHAR(64) COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (
      NULLIF(
        TRIM(
          JSON_UNQUOTE(JSON_EXTRACT(profile_json, '$.minecraftUser'))
        ),
        ''
      )
    ) STORED,
  empire_id_key VARCHAR(64) COLLATE utf8mb4_unicode_ci
    GENERATED ALWAYS AS (
      IF(
        LOWER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(profile_json, '$.EmpireID')), ''))) IN ('', 'pending'),
        NULL,
        TRIM(JSON_UNQUOTE(JSON_EXTRACT(profile_json, '$.EmpireID')))
      )
    ) STORED,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (discord_id),
  KEY idx_users_minecraft_user (minecraft_user),
  UNIQUE KEY uq_users_empire_id (empire_id_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clans (
  discord_guild_id VARCHAR(32) NOT NULL,
  clan_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (discord_guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS empire_sequence (
  id TINYINT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO empire_sequence (id, next_number) VALUES (1, 14);

CREATE TABLE IF NOT EXISTS empire_assignments (
  empire_id VARCHAR(32) NOT NULL,
  assignment_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empire_id),
  KEY idx_empire_assign_discord (
    (CAST(JSON_UNQUOTE(JSON_EXTRACT(assignment_json, '$.discordId')) AS CHAR(32)))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS member_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discord_id VARCHAR(32) NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json JSON NULL,
  actor_discord_id VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_member_events_discord (discord_id),
  KEY idx_member_events_type_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
