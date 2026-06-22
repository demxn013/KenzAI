// modules/roles/roleScheduler.js
// Daily background refresh of clan role configuration.
//
// Clan discords add/rename/reorder/delete roles over time, which left KenzAI's
// roles config (roles.json + the MySQL `roles_config` table) out of date. This
// scheduler re-syncs every registered clan guild once a day using
// updateGuildRoles(), which is non-destructive: it preserves any status/rank
// categorization, refreshes names/priorities/positions, adds new roles, and
// prunes deleted ones. Persistence goes through stores.roles_config, so both
// JSON and MySQL stay in sync.
//
// The MAIN Yazanaki Empire guild is intentionally NOT auto-synced here — its
// status/rank split is hand-curated. Use `/roles update` to refresh it on demand.

const { readClans } = require("../database/clansPersistence");
const { updateGuildRoles } = require("./rolesconfig");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000; // let caches settle after startup before first run

let intervalTimer = null;
let initialTimer = null;
let started = false;
let running = false;
let client = null;

/**
 * Resolve the refresh interval. Defaults to 24h; override with
 * ROLE_REFRESH_INTERVAL_HOURS (e.g. "12" or "0.5" for testing).
 */
function getIntervalMs() {
  const hours = parseFloat(process.env.ROLE_REFRESH_INTERVAL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : DAY_MS;
}

/**
 * Refresh role config for every registered clan guild.
 * Safe to call manually. Skips guilds the bot isn't a member of.
 * @returns {Promise<{ ok: number, skipped: number, failed: number }>}
 */
async function refreshClanRoles() {
  if (!client) {
    console.warn("[roleScheduler] ⚠️ Client not initialized, skipping clan role refresh");
    return { ok: 0, skipped: 0, failed: 0 };
  }
  if (running) {
    console.log("[roleScheduler] ⏭️ Previous refresh still running, skipping this tick");
    return { ok: 0, skipped: 0, failed: 0 };
  }

  running = true;
  let ok = 0, skipped = 0, failed = 0;
  try {
    let clans = {};
    try {
      clans = readClans();
    } catch (err) {
      console.error("[roleScheduler] ❌ Could not read clans:", err.message);
      return { ok, skipped, failed };
    }

    const clanIds = Object.keys(clans).filter((id) => id !== YAZANAKI_EMPIRE_GUILD_ID);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[roleScheduler] 🔄 Daily clan role refresh — ${clanIds.length} clan(s)`);

    for (const guildId of clanIds) {
      const clanName = clans[guildId]?.name || clans[guildId]?.abbr || guildId;

      let guild = client.guilds.cache.get(guildId);
      if (!guild) {
        guild = await client.guilds.fetch(guildId).catch(() => null);
      }
      if (!guild) {
        console.warn(`[roleScheduler] ⚠️ Bot not in clan guild ${clanName} (${guildId}) — skipping`);
        skipped++;
        continue;
      }

      try {
        const success = await updateGuildRoles(guildId, guild);
        if (success) {
          ok++;
          console.log(`[roleScheduler] ✅ Refreshed roles for ${clanName}`);
        } else {
          failed++;
          console.warn(`[roleScheduler] ⚠️ Refresh returned false for ${clanName}`);
        }
      } catch (err) {
        failed++;
        console.error(`[roleScheduler] ❌ Error refreshing ${clanName}:`, err.message);
      }
    }

    console.log(`[roleScheduler] 📊 Clan role refresh complete — ok:${ok} skipped:${skipped} failed:${failed}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } finally {
    running = false;
  }
  return { ok, skipped, failed };
}

/**
 * Start the daily clan role refresh scheduler.
 * @param {Client} discordClient
 */
function startRoleScheduler(discordClient) {
  if (started) {
    console.log("[roleScheduler] ⚠️ Role scheduler already running");
    return;
  }
  started = true;
  client = discordClient;

  const interval = getIntervalMs();
  console.log(
    `[roleScheduler] 🚀 Clan role auto-refresh enabled — every ${(interval / 3600000).toFixed(1)}h ` +
    `(first run in ${Math.round(INITIAL_DELAY_MS / 1000)}s)`
  );

  initialTimer = setTimeout(() => {
    refreshClanRoles();
    intervalTimer = setInterval(refreshClanRoles, interval);
  }, INITIAL_DELAY_MS);
}

/**
 * Stop the scheduler (clears pending and recurring timers).
 */
function stopRoleScheduler() {
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  started = false;
  console.log("[roleScheduler] ⏸️ Role scheduler stopped");
}

module.exports = {
  startRoleScheduler,
  stopRoleScheduler,
  refreshClanRoles,
};
