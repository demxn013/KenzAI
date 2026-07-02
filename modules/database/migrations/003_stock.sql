-- ============================================================
-- 003_stock.sql — Clan Stock Market
--
-- Every clan gets its own "stock" once /stock post is first run in its
-- guild. Shares are held in a clan treasury pool and sold to investors for
-- real in-game Minecraft money (see modules/stock/). These tables mirror
-- the generic MapStore hybrid shape used by modules/database/stores.js:
-- a `data` JSON column holds the full object losslessly, plus a handful of
-- indexed columns for analytics. There is no external API dependency on
-- these tables (unlike clans/members), so the JSON file stays the primary
-- read path and MySQL is a dual-write mirror.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS clan_stocks (
    guild_id           VARCHAR(20) NOT NULL,
    server_id          VARCHAR(60) NULL,
    current_price      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    treasury_shares    BIGINT UNSIGNED NOT NULL DEFAULT 0,
    outstanding_shares BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data               JSON NULL,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_holdings (
    holding_id  VARCHAR(60) NOT NULL,
    guild_id    VARCHAR(20) NOT NULL,
    discord_id  VARCHAR(20) NOT NULL,
    shares      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data        JSON NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (holding_id),
    INDEX idx_stock_holdings_guild   (guild_id),
    INDEX idx_stock_holdings_discord (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_transactions (
    tx_id       VARCHAR(60) NOT NULL,
    guild_id    VARCHAR(20) NOT NULL,
    discord_id  VARCHAR(20) NOT NULL,
    tx_type     VARCHAR(20) NULL,
    shares      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data        JSON NULL,
    logged_at   DATETIME NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tx_id),
    INDEX idx_stock_tx_guild   (guild_id),
    INDEX idx_stock_tx_discord (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_pending_sells (
    tx_id       VARCHAR(60) NOT NULL,
    guild_id    VARCHAR(20) NOT NULL,
    discord_id  VARCHAR(20) NOT NULL,
    shares      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status      VARCHAR(20) NULL,
    data        JSON NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tx_id),
    INDEX idx_stock_pending_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
