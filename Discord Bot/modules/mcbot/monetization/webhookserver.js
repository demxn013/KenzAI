// Discord Bot/modules/mcbot/monetization/webhookserver.js
// Lightweight HTTP webhook receiver for Patreon and Stripe subscription events.
// Uses Node's built-in `http` module — no extra dependencies needed.
//
// Start with: startWebhookServer(client)  (called from index.js on ready)
//
// Required .env vars:
//   WEBHOOK_PORT           — port to listen on (default 4824)
//   PATREON_WEBHOOK_SECRET — secret from your Patreon webhook settings
//   STRIPE_WEBHOOK_SECRET  — webhook signing secret from Stripe dashboard
//
// Patreon webhook docs: https://docs.patreon.com/#webhooks
// Stripe  webhook docs: https://stripe.com/docs/webhooks

"use strict";

const http   = require("http");
const crypto = require("crypto");
const {
  grantSubscription,
  revokeSubscription,
  updateSubscriptionTier,
} = require("./slotmanager");
const db = require("./subscriptiondb");

// ============================================================
// TIER MAPPING
// Customise these to match your actual Patreon tiers / Stripe prices.
// ============================================================

// Patreon: pledge amount in cents → internal tier
const PATREON_AMOUNT_TO_TIER = {
  499:  "standard",   // $4.99
  999:  "premium",    // $9.99
  1999: "vip",        // $19.99
};

// Patreon: tier title (exact, case-insensitive) → internal tier
const PATREON_TITLE_TO_TIER = {
  "standard": "standard",
  "premium":  "premium",
  "vip":      "vip",
};

// Stripe: price ID → internal tier (fill in your actual Stripe price IDs)
const STRIPE_PRICE_TO_TIER = {
  // "price_XXXXXXXXXXXXXXXX": "standard",
  // "price_YYYYYYYYYYYYYYYY": "premium",
  // "price_ZZZZZZZZZZZZZZZZ": "vip",
};

// ============================================================
// HELPERS
// ============================================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end",  ()  => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ============================================================
// PATREON SIGNATURE VERIFICATION (HMAC-MD5)
// ============================================================

function verifyPatreonSignature(rawBody, signature) {
  const secret = process.env.PATREON_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhookserver] ⚠️ PATREON_WEBHOOK_SECRET not set — skipping signature check");
    return true;
  }
  const expected = crypto.createHmac("md5", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
}

// ============================================================
// STRIPE SIGNATURE VERIFICATION (HMAC-SHA256 with timestamp)
// ============================================================

function verifyStripeSignature(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[webhookserver] ⚠️ STRIPE_WEBHOOK_SECRET not set — skipping signature check");
    return true;
  }

  const parts = {};
  for (const part of (header || "").split(",")) {
    const [k, v] = part.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }

  const timestamp = parts["t"];
  const v1sig     = parts["v1"];
  if (!timestamp || !v1sig) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    console.warn("[webhookserver] ⚠️ Stripe webhook timestamp too old — possible replay attack");
    return false;
  }

  const payload  = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1sig));
}

// ============================================================
// PATREON EVENT HANDLER
// ============================================================

async function handlePatreonEvent(event, data, discordClient) {
  const patreonUserId = data?.data?.relationships?.patron?.data?.id || data?.data?.id;
  const pledgeAmount  = data?.data?.attributes?.currently_entitled_amount_cents
                     || data?.data?.attributes?.amount_cents
                     || 0;
  const tierTitle     = (data?.data?.attributes?.title || "").toLowerCase();

  const tier = PATREON_AMOUNT_TO_TIER[pledgeAmount] || PATREON_TITLE_TO_TIER[tierTitle] || null;

  // Look up Discord ID from our DB (payment_id stored during grant/link flow)
  const allUsers   = db.getAllUsers();
  const userRecord = Object.values(allUsers).find(u => u.payment_id === patreonUserId);
  const discordId  = userRecord?.user_id;

  console.log(`[webhookserver] 📦 Patreon event: ${event} | patreonId=${patreonUserId} | tier=${tier} | discordId=${discordId || "unknown"}`);

  if (!discordId) {
    console.warn(`[webhookserver] ⚠️ Patreon user ${patreonUserId} not linked to any Discord account — ignoring`);
    return;
  }

  switch (event) {
    case "members:create":
    case "members:pledge:create":
      if (tier) {
        grantSubscription(discordId, tier, "patreon", patreonUserId);
        await _notifyUser(discordClient, discordId, `✅ Your **${tier}** KenzAI subscription is now active! Use \`/mcbot slot status\` to check your bot slots.`);
      }
      break;

    case "members:update":
    case "members:pledge:update": {
      const existing = db.getUser(discordId);
      if (tier && existing?.subscription_tier !== tier) {
        updateSubscriptionTier(discordId, tier, "patreon");
        await _notifyUser(discordClient, discordId, `🔄 Your KenzAI subscription has been updated to **${tier}**. Use \`/mcbot slot status\` to review your slots.`);
      }
      break;
    }

    case "members:delete":
    case "members:pledge:delete": {
      const result = revokeSubscription(discordId, "patreon");
      await _notifyUser(discordClient, discordId,
        `❌ Your KenzAI subscription has been cancelled. **${result.revokedSlots}** bot slot(s) have been released.`
      );
      break;
    }

    default:
      console.log(`[webhookserver] ℹ️ Unhandled Patreon event: ${event}`);
  }
}

// ============================================================
// STRIPE EVENT HANDLER
// ============================================================

async function handleStripeEvent(event, discordClient) {
  const type   = event.type;
  const object = event.data?.object;

  console.log(`[webhookserver] 💳 Stripe event: ${type}`);

  const discordId = object?.metadata?.discord_id
                 || object?.customer_details?.metadata?.discord_id;
  const priceId   = object?.items?.data?.[0]?.price?.id
                 || object?.plan?.id
                 || object?.price?.id;
  const tier      = STRIPE_PRICE_TO_TIER[priceId] || null;

  if (!discordId) {
    console.warn(`[webhookserver] ⚠️ Stripe event ${type} has no discord_id in metadata — ignoring`);
    return;
  }

  switch (type) {
    case "customer.subscription.created":
      if (tier) {
        grantSubscription(discordId, tier, "stripe", object?.customer);
        await _notifyUser(discordClient, discordId, `✅ Your **${tier}** KenzAI subscription is now active! Use \`/mcbot slot status\` to check your bot slots.`);
      }
      break;

    case "customer.subscription.updated": {
      const existing = db.getUser(discordId);
      if (tier && existing?.subscription_tier !== tier) {
        updateSubscriptionTier(discordId, tier, "stripe");
        await _notifyUser(discordClient, discordId, `🔄 Your KenzAI subscription has been updated to **${tier}**. Use \`/mcbot slot status\` to review your slots.`);
      }
      break;
    }

    case "customer.subscription.deleted":
    case "customer.subscription.paused": {
      const result = revokeSubscription(discordId, "stripe");
      await _notifyUser(discordClient, discordId,
        `❌ Your KenzAI subscription has been cancelled/paused. **${result.revokedSlots}** bot slot(s) have been released.`
      );
      break;
    }

    case "invoice.payment_failed":
      await _notifyUser(discordClient, discordId,
        `⚠️ Your KenzAI subscription payment failed. Please update your payment method to keep your bot slots active.`
      );
      break;

    default:
      console.log(`[webhookserver] ℹ️ Unhandled Stripe event: ${type}`);
  }
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
    console.log(`[webhookserver] 📨 DM sent to ${discordId}`);
  } catch (err) {
    console.warn(`[webhookserver] ⚠️ Could not DM ${discordId}:`, err.message);
  }
}

// ============================================================
// HTTP SERVER
// ============================================================

function startWebhookServer(discordClient) {
  const PORT = parseInt(process.env.WEBHOOK_PORT || "4824", 10);

  const server = http.createServer(async (req, res) => {
    const url = req.url;

    if (req.method === "GET" && url === "/webhook/health") {
      return jsonResponse(res, 200, { ok: true, service: "KenzAI webhook server" });
    }

    if (req.method !== "POST") {
      return jsonResponse(res, 405, { error: "Method not allowed" });
    }

    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch {
      return jsonResponse(res, 400, { error: "Failed to read body" });
    }

    if (url === "/webhook/patreon") {
      const sig   = req.headers["x-patreon-signature"] || "";
      const event = req.headers["x-patreon-event"]     || "";

      if (!verifyPatreonSignature(rawBody, sig)) {
        console.warn("[webhookserver] ❌ Invalid Patreon signature");
        return jsonResponse(res, 401, { error: "Invalid signature" });
      }

      let payload;
      try { payload = JSON.parse(rawBody.toString("utf8")); }
      catch { return jsonResponse(res, 400, { error: "Invalid JSON" }); }

      jsonResponse(res, 200, { ok: true });
      handlePatreonEvent(event, payload, discordClient).catch(err =>
        console.error("[webhookserver] ❌ Patreon handler error:", err)
      );
      return;
    }

    if (url === "/webhook/stripe") {
      const sig = req.headers["stripe-signature"] || "";

      if (!verifyStripeSignature(rawBody, sig)) {
        console.warn("[webhookserver] ❌ Invalid Stripe signature");
        return jsonResponse(res, 401, { error: "Invalid signature" });
      }

      let event;
      try { event = JSON.parse(rawBody.toString("utf8")); }
      catch { return jsonResponse(res, 400, { error: "Invalid JSON" }); }

      jsonResponse(res, 200, { ok: true });
      handleStripeEvent(event, discordClient).catch(err =>
        console.error("[webhookserver] ❌ Stripe handler error:", err)
      );
      return;
    }

    jsonResponse(res, 404, { error: "Unknown webhook endpoint" });
  });

  server.listen(PORT, () => {
    console.log(`[webhookserver] ✅ Webhook server listening on port ${PORT}`);
    console.log(`[webhookserver] 📡 Patreon: POST http://YOUR_IP:${PORT}/webhook/patreon`);
    console.log(`[webhookserver] 📡 Stripe:  POST http://YOUR_IP:${PORT}/webhook/stripe`);
  });

  server.on("error", err => {
    console.error("[webhookserver] ❌ Server error:", err.message);
  });

  return server;
}

module.exports = { startWebhookServer };