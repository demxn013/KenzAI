// modules/cosmetics/cosmeticsServer.js
// Private, server-to-server HTTP endpoint that lets YazanakiAPI drive cosmetic
// purchases/equips THROUGH KenzAI — which is the single writer of points. The
// launcher never talks to this directly; it calls YazanakiAPI, which (after
// verifying the player's Minecraft identity) forwards here.
//
// Reuses cosmeticsService, so a launcher purchase and a Discord /shop purchase
// run the exact same validated flow.
//
// Auth: a shared internal secret in the `X-Internal-Secret` header. Bind to
// localhost by default so it is NOT internet-facing — only the co-located API
// should reach it (or a private network with COSMETICS_INTERNAL_HOST set).
//
// .env:
//   COSMETICS_INTERNAL_SECRET   required — without it the endpoint stays OFF
//   COSMETICS_INTERNAL_PORT     default 4825
//   COSMETICS_INTERNAL_HOST     default 127.0.0.1

"use strict";

const http = require("http");
const crypto = require("crypto");
const cosmeticsService = require("./cosmeticsService");

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const secret = process.env.COSMETICS_INTERNAL_SECRET;
  if (!secret) return false; // fail closed
  const got = String(req.headers["x-internal-secret"] || "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// reason -> HTTP status so the API can relay sensible codes to the launcher.
function statusForReason(reason) {
  switch (reason) {
    case "not_member":      return 403;
    case "db_unavailable":  return 503;
    case "unavailable":
    case "already_owned":
    case "purchase_failed":
    case "not_owned":
    case "badge_slots_full":
    case "not_equipped":    return 409;
    default:                return 400;
  }
}

function startCosmeticsServer() {
  if (!process.env.COSMETICS_INTERNAL_SECRET) {
    console.warn("[cosmeticsServer] ⚠️ COSMETICS_INTERNAL_SECRET not set — internal cosmetics endpoint disabled");
    return null;
  }

  const PORT = parseInt(process.env.COSMETICS_INTERNAL_PORT || "4825", 10);
  const HOST = process.env.COSMETICS_INTERNAL_HOST || "127.0.0.1";

  const HANDLERS = {
    "/internal/purchase": (discordId, itemId) => cosmeticsService.purchase(discordId, itemId),
    "/internal/equip":    (discordId, itemId) => cosmeticsService.equip(discordId, itemId),
    "/internal/unequip":  (discordId, itemId) => cosmeticsService.unequip(discordId, itemId),
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/internal/health") {
      return jsonResponse(res, 200, { ok: true, service: "KenzAI cosmetics internal" });
    }
    if (req.method !== "POST") {
      return jsonResponse(res, 405, { ok: false, error: "method_not_allowed" });
    }
    if (!authorized(req)) {
      return jsonResponse(res, 401, { ok: false, error: "unauthorized" });
    }

    const handler = HANDLERS[req.url];
    if (!handler) {
      return jsonResponse(res, 404, { ok: false, error: "unknown_endpoint" });
    }

    let body;
    try {
      const raw = await readBody(req);
      body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      return jsonResponse(res, 400, { ok: false, error: "invalid_json" });
    }

    const discordId = String(body.discordId || "").trim();
    const itemId = String(body.itemId || "").trim();
    if (!discordId || !itemId) {
      return jsonResponse(res, 400, { ok: false, error: "missing_fields" });
    }

    try {
      const result = await handler(discordId, itemId);
      return jsonResponse(res, result.ok ? 200 : statusForReason(result.reason), result);
    } catch (err) {
      console.error("[cosmeticsServer] ❌ handler error:", err);
      return jsonResponse(res, 500, { ok: false, error: "internal_error" });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[cosmeticsServer] ✅ internal cosmetics endpoint on http://${HOST}:${PORT}`);
  });
  server.on("error", (err) => console.error("[cosmeticsServer] ❌ server error:", err.message));

  return server;
}

module.exports = { startCosmeticsServer };
