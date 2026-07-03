-- ============================================================
-- 004_server_links.sql — multi-server clan links + stock pending buys
--
-- 1. clans.server_links: a JSON array of label-only server ids a clan is on
--    (e.g. ["elementalmc","freshsmp"]). DonutSMP keeps its dedicated
--    donutsmp_team_name column (it also carries the in-game team name).
--
-- 2. stock_pending_buys: durable pending BUY orders awaiting staff "Mark Paid"
--    confirmation, for servers without a stats API to auto-detect payment
--    (FreshSMP/ElementalMC). Mirrors stock_pending_sells from 003_stock.sql.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE clans
  ADD COLUMN server_links TEXT NULL AFTER donutsmp_team_name;

CREATE TABLE IF NOT EXISTS stock_pending_buys (
    tx_id       VARCHAR(60) NOT NULL,
    guild_id    VARCHAR(20) NOT NULL,
    discord_id  VARCHAR(20) NOT NULL,
    shares      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status      VARCHAR(20) NULL,
    data        JSON NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tx_id),
    INDEX idx_stock_pending_buys_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
