-- ============================================================
-- 002_cosmetics.sql — Badges & Cosmetics
--
-- Adds the catalog + per-member ownership/equip tables that power the
-- points-funded badges & cosmetics system. Both are FLAT tables: they are
-- queried directly by YazanakiAPI (and, later, the Mod), and they hold the
-- authoritative data (there is no JSON mirror), so they use
-- CREATE TABLE IF NOT EXISTS and are NEVER dropped.
--
-- Item kinds:
--   • 'badge'    — emblem; can be bought OR granted/earned. type = 'badge'.
--   • 'cosmetic' — visual; buy-only. type = 'cape' | 'pet' (more added later).
--
-- Pricing per item is flexible:
--   • deduct_map JSON  → spend specific amounts from specific categories.
--   • cost + category_requirements JSON → total cost with a hidden gate.
--
-- Equip rules (one equipped per cosmetic type, up to 3 badges) and expiry
-- (expires_at) are enforced in application code, keeping the schema simple.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ------------------------------------------------------------
-- SHOP ITEMS — the catalog (managed via the /catalog admin command).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_items (
    item_id                VARCHAR(60)  NOT NULL,
    kind                   ENUM('badge','cosmetic') NOT NULL,
    type                   VARCHAR(40)  NOT NULL DEFAULT 'badge',
    name                   VARCHAR(100) NOT NULL,
    description            VARCHAR(255) NOT NULL DEFAULT '',
    cost                   INT          NOT NULL DEFAULT 0,
    deduct_map             JSON         NULL,
    category_requirements  JSON         NULL,
    duration_days          INT          NULL,
    purchasable            TINYINT(1)   NOT NULL DEFAULT 1,
    enabled                TINYINT(1)   NOT NULL DEFAULT 1,
    asset_key              VARCHAR(120) NULL,
    emoji                  VARCHAR(64)  NULL,
    created_at             DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at             DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (item_id),
    INDEX idx_shop_items_kind    (kind),
    INDEX idx_shop_items_type    (type),
    INDEX idx_shop_items_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- MEMBER COSMETICS — per-member ownership + equipped flag (inventory).
--   source: how it was acquired. expires_at NULL = permanent.
--   equipped: 1 = currently worn/shown (slot limits enforced in code).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_cosmetics (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    discord_id   VARCHAR(20) NOT NULL,
    item_id      VARCHAR(60) NOT NULL,
    source       ENUM('purchase','grant','earn') NOT NULL DEFAULT 'purchase',
    acquired_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   DATETIME    NULL,
    equipped     TINYINT(1)  NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_member_item (discord_id, item_id),
    INDEX idx_member_cosmetics_discord  (discord_id),
    INDEX idx_member_cosmetics_item     (item_id),
    INDEX idx_member_cosmetics_equipped (discord_id, equipped)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
