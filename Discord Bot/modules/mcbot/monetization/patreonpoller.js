// Discord Bot/modules/mcbot/monetization/patreonpoller.js
// Polls the Patreon API on a schedule to sync active patron status
// with KenzAI subscriptions. No webhook or Pro plan required.
//
// How it works:
//   Every PATREON_POLL_INTERVAL_MS (default 5 min) it fetches all
//   campaign members via the Patreon API v2, reads their Discord ID
//   from their social connections, maps their entitled tier to an
//   internal tier, and calls grantSubscription / revokeSubscription
//   accordingly. Patrons who disconnect Discord or cancel are
//   automatically revoked on the next poll.
//
// Required .env vars:
//   PATREON_ACCESS_TOKEN      — Creator's access token (Patreon portal → API)
//
// Optional .env vars:
//   PATREON_CAMPAIGN_ID       — Auto-fetched on startup if not set
//   PATREON_POLL_INTERVAL_MS  — Poll interval in ms (default 300000 = 5 min)
//   PATREON_TIER_STANDARD_ID  — Patreon tier ID for Standard
//   PATREON_TIER_PREMIUM_ID   — Patreon tier ID for Premium
//   PATREON_TIER_VIP_ID       — Patreon tier ID for VIP
//
// Tier ID fallback:
//   If tier IDs are not set, tier is matched by title (case-insensitive):
//   "standard" → standard, "premium" → premium, "vip" → vip
//   You can find your tier IDs in the startup log when the poller runs.

"use strict";

const https = require("https");
const { grantSubscription, revokeSubscription } = require("./slotmanager");
const db = require("./subscriptiondb");

// ============================================================
// PATREON API HELPER
// Uses Node built-in https — no extra dependencies.
// ============================================================

function patreonRequest(urlOrPath) {
  return new Promise((resolve, reject) => {
    const token = process.env.PATREON_ACCESS_TOKEN;
    if (!token) return reject(new Error("PATREON_ACCESS_TOKEN not set"));

    // Accept either a full URL (from pagination links) or a path
    const fullUrl = urlOrPath.startsWith("http") ? urlOrPath : `https://www.patreon.com${urlOrPath}`;
    const url     = new URL(fullUrl);

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   "GET",
      headers:  { "Authorization": `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, data: null });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("Patreon request timed out")); });
    req.end();
  });
}

// ============================================================
// CAMPAIGN ID RESOLUTION
// ============================================================

let resolvedCampaignId = null;

async function getCampaignId() {
  if (resolvedCampaignId) return resolvedCampaignId;

  // Use env var if provided
  if (process.env.PATREON_CAMPAIGN_ID) {
    resolvedCampaignId = process.env.PATREON_CAMPAIGN_ID;
    console.log(`[patreonpoller] 📋 Campaign ID (from .env): ${resolvedCampaignId}`);
    return resolvedCampaignId;
  }

  // Auto-fetch from identity endpoint
  console.log("[patreonpoller] 🔍 Fetching campaign ID from Patreon API...");
  const res = await patreonRequest("/api/oauth2/v2/identity?include=campaign&fields[campaign]=creation_name");

  if (res.status !== 200 || !res.data) {
    throw new Error(`Failed to fetch identity (HTTP ${res.status})`);
  }

  const campaign = res.data.included?.find(i => i.type === "campaign");
  if (!campaign?.id) {
    throw new Error("No campaign found on this Patreon account");
  }

  resolvedCampaignId = campaign.id;
  console.log(`[patreonpoller] ✅ Campaign ID auto-detected: ${resolvedCampaignId}`);
  console.log(`[patreonpoller] 💡 Add PATREON_CAMPAIGN_ID=${resolvedCampaignId} to .env to skip auto-detection`);
  return resolvedCampaignId;
}

// ============================================================
// TIER RESOLUTION
// Maps a Patreon tier (by ID or title) to an internal tier name.
// ============================================================

function resolveTier(tierData) {
  if (!tierData) return null;

  const tierId    = tierData.id;
  const tierTitle = (tierData.attributes?.title || "").toLowerCase().trim();

  // Match by env-configured tier IDs first (most reliable)
  if (process.env.PATREON_TIER_VIP_ID      && tierId === process.env.PATREON_TIER_VIP_ID)      return "vip";
  if (process.env.PATREON_TIER_PREMIUM_ID  && tierId === process.env.PATREON_TIER_PREMIUM_ID)  return "premium";
  if (process.env.PATREON_TIER_STANDARD_ID && tierId === process.env.PATREON_TIER_STANDARD_ID) return "standard";

  // Fallback: match by title substring
  if (tierTitle.includes("vip"))      return "vip";
  if (tierTitle.includes("premium"))  return "premium";
  if (tierTitle.includes("standard")) return "standard";

  return null; // Tier not mapped — ignored
}

// ============================================================
// FETCH ALL MEMBERS (handles pagination)
// ============================================================

async function fetchAllMembers(campaignId) {
  const fields  = [
    "include=currently_entitled_tiers,user",
    "fields[member]=patron_status,currently_entitled_amount_cents,full_name",
    "fields[user]=social_connections,full_name",
    "fields[tier]=title,amount_cents",
    "page[count]=500",
  ].join("&");

  const members  = [];
  const included = {};
  let   nextUrl  = `/api/oauth2/v2/campaigns/${campaignId}/members?${fields}`;

  while (nextUrl) {
    const res = await patreonRequest(nextUrl);

    if (res.status === 401) throw new Error("PATREON_ACCESS_TOKEN is invalid or expired");
    if (res.status !== 200 || !res.data) throw new Error(`Patreon API error: HTTP ${res.status}`);

    // Index all included resources by type+id for easy lookup
    for (const item of res.data.included || []) {
      if (!included[item.type]) included[item.type] = {};
      included[item.type][item.id] = item;
    }

    members.push(...(res.data.data || []));
    nextUrl = res.data.links?.next || null;
  }

  return { members, included };
}

// ============================================================
// SYNC LOGIC
// ============================================================

/**
 * Run one full sync cycle.
 * Returns a summary object for logging.
 */
async function syncPatrons(discordClient) {
  const campaignId = await getCampaignId();
  const { members, included } = await fetchAllMembers(campaignId);

  // Log all available tiers on first run (helps fill in .env tier IDs)
  const allTiers = Object.values(included.tier || {});
  if (allTiers.length > 0) {
    console.log("[patreonpoller] 📦 Available Patreon tiers:");
    for (const t of allTiers) {
      console.log(`   ID: ${t.id}  Title: "${t.attributes?.title}"  Amount: $${(t.attributes?.amount_cents || 0) / 100}`);
    }
    console.log("[patreonpoller] 💡 Set PATREON_TIER_<NAME>_ID=<id> in .env to map tiers by ID");
  }

  const summary = { granted: 0, updated: 0, revoked: 0, skipped: 0, noDiscord: 0 };

  // Track which Discord IDs are active patrons this cycle
  const activePatronDiscordIds = new Set();

  for (const member of members) {
    const attrs = member.attributes || {};

    // Only process active patrons
    if (attrs.patron_status !== "active_patron") continue;

    // Get the linked user record from included data
    const userId     = member.relationships?.user?.data?.id;
    const userRecord = userId ? included.user?.[userId] : null;
    const discordConn = userRecord?.attributes?.social_connections?.discord;

    if (!discordConn?.user_id) {
      // Patron hasn't linked Discord — skip, but log
      const name = attrs.full_name || userRecord?.attributes?.full_name || "Unknown";
      console.log(`[patreonpoller] ⚠️ Patron "${name}" has no Discord linked — skipping`);
      summary.noDiscord++;
      continue;
    }

    const discordId = discordConn.user_id;

    // Determine highest-priority entitled tier
    const entitledTierRefs = member.relationships?.currently_entitled_tiers?.data || [];
    const TIER_PRIORITY     = { vip: 3, premium: 2, standard: 1 };
    let   resolvedTierName  = null;
    let   resolvedPriority  = 0;

    for (const ref of entitledTierRefs) {
      const tierData = included.tier?.[ref.id];
      const name     = resolveTier(tierData);
      if (name && (TIER_PRIORITY[name] || 0) > resolvedPriority) {
        resolvedTierName = name;
        resolvedPriority = TIER_PRIORITY[name];
      }
    }

    if (!resolvedTierName) {
      // No mapped tier — this patron has a tier we don't recognise
      summary.skipped++;
      continue;
    }

    activePatronDiscordIds.add(discordId);

    // Grant or update subscription
    const existing = db.getUser(discordId);
    if (!existing?.active) {
      grantSubscription(discordId, resolvedTierName, "patreon", userId);
      summary.granted++;
      console.log(`[patreonpoller] ✅ Granted ${resolvedTierName} → <@${discordId}>`);
      await _notifyUser(discordClient, discordId,
        `✅ Your **${resolvedTierName}** KenzAI subscription is now active!\nUse \`/mcbot slot status\` to check your bot slots.`
      );
    } else if (existing.subscription_tier !== resolvedTierName) {
      const prev = existing.subscription_tier;
      const { updateSubscriptionTier } = require("./slotmanager");
      updateSubscriptionTier(discordId, resolvedTierName, "patreon");
      summary.updated++;
      console.log(`[patreonpoller] 🔄 Updated ${discordId}: ${prev} → ${resolvedTierName}`);
      await _notifyUser(discordClient, discordId,
        `🔄 Your KenzAI subscription has been updated to **${resolvedTierName}**.\nUse \`/mcbot slot status\` to review your slots.`
      );
    }
  }

  // ── Revoke patrons who have cancelled / are no longer active ──
  const allUsers = db.getAllUsers();
  for (const [discordId, user] of Object.entries(allUsers)) {
    if (user.payment_platform !== "patreon") continue;
    if (!user.active) continue;
    if (activePatronDiscordIds.has(discordId)) continue;

    // Was a Patreon subscriber but no longer appears as active
    const result = revokeSubscription(discordId, "patreon");
    summary.revoked++;
    console.log(`[patreonpoller] ❌ Revoked ${discordId} (no longer active patron)`);
    await _notifyUser(discordClient, discordId,
      `❌ Your KenzAI subscription has expired or been cancelled on Patreon.\n**${result.revokedSlots}** bot slot(s) have been released.\nRejoin on Patreon to reactivate.`
    );
  }

  return summary;
}

// ============================================================
// DISCORD DM HELPER
// ============================================================

async function _notifyUser(discordClient, discordId, message) {
  if (!discordClient) return;
  try {
    const user = await discordClient.users.fetch(discordId);
    const dm   = await user.createDM();
    await dm.send(`**KenzAI Subscription Update**\n\n${message}`);
  } catch {
    // Non-fatal — user may have DMs closed
  }
}

// ============================================================
// SCHEDULER
// ============================================================

let _pollInterval = null;
let _discordClient = null;

async function _runPoll() {
  console.log("[patreonpoller] 🔄 Running Patreon sync...");
  try {
    const summary = await syncPatrons(_discordClient);
    console.log(
      `[patreonpoller] ✅ Sync complete — ` +
      `granted: ${summary.granted}, updated: ${summary.updated}, ` +
      `revoked: ${summary.revoked}, skipped: ${summary.skipped}, ` +
      `no Discord: ${summary.noDiscord}`
    );
  } catch (err) {
    console.error("[patreonpoller] ❌ Sync error:", err.message);
  }
}

/**
 * Start the Patreon poller. Call once from the ready event.
 * Silently skips if PATREON_ACCESS_TOKEN is not set.
 */
function startPatreonPoller(discordClient) {
  if (!process.env.PATREON_ACCESS_TOKEN) {
    console.log("[patreonpoller] ⏭️ Skipped (PATREON_ACCESS_TOKEN not set)");
    return;
  }

  if (_pollInterval) {
    console.warn("[patreonpoller] ⚠️ Already running");
    return;
  }

  _discordClient = discordClient;
  const intervalMs = parseInt(process.env.PATREON_POLL_INTERVAL_MS || "300000", 10);
  const intervalMin = Math.round(intervalMs / 60000);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[patreonpoller] 🚀 Starting Patreon sync (interval: ${intervalMin} min)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Run immediately, then on interval
  _runPoll();
  _pollInterval = setInterval(_runPoll, intervalMs);
}

/**
 * Stop the poller (e.g. for graceful shutdown).
 */
function stopPatreonPoller() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
    console.log("[patreonpoller] ⏸️ Patreon poller stopped");
  }
}

/**
 * Manually trigger one poll immediately (useful for testing).
 */
async function triggerManualPoll() {
  return _runPoll();
}

module.exports = { startPatreonPoller, stopPatreonPoller, triggerManualPoll };