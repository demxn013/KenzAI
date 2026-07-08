-- ============================================================
-- 004_squadrons.sql
-- Military chain-of-command trees (per High General) + recruit invite
-- attribution. Both are hybrid "extra" stores: JSON stays authoritative and
-- these tables mirror it losslessly via a `data JSON` column plus a few
-- indexed columns for SQL analytics. Dropped & recreated like the other
-- hybrid tables in 001_schema.sql (JSON is the source of truth; a backfill
-- repopulates them).
-- ============================================================

-- One row per High General's command tree. The officer skeleton
-- (HG -> Generals -> Captains -> Imperial Army soldiers) lives in `data.nodes`;
-- recruits are NOT stored here (they are resolved from invites).
DROP TABLE IF EXISTS military_squadrons;
CREATE TABLE military_squadrons (
    squadron_id     VARCHAR(64) NOT NULL,
    guild_id        VARCHAR(20),
    name            VARCHAR(120),
    high_general_id VARCHAR(20),
    data            JSON,
    PRIMARY KEY (squadron_id),
    INDEX idx_ms_guild (guild_id),
    INDEX idx_ms_hg (high_general_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Recruit invite attribution, keyed by the invited member's Discord ID.
-- inviter_id is captured at join time; soldier_id / tree are the resolved,
-- persisted placement (which Imperial Army soldier the recruit sits under).
DROP TABLE IF EXISTS military_invites;
CREATE TABLE military_invites (
    discord_id VARCHAR(20) NOT NULL,
    inviter_id VARCHAR(20),
    soldier_id VARCHAR(20),
    data       JSON,
    PRIMARY KEY (discord_id),
    INDEX idx_mi_inviter (inviter_id),
    INDEX idx_mi_soldier (soldier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
