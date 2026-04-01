// Discord Bot/modules/mcbot/mcbotlogic.js
// Security validation layer for /mcbot command.
// Validates members against members.json, empireids.json, kicked/banned lists.
// Makes authenticated HTTP calls to the VPS bot API.

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const dataDir = path.join(__dirname, "..", "data");
const membersPath = path.join(dataDir, "members.json");
const empireIdsPath = path.join(dataDir, "empireids.json");
const kickedMembersPath = path.join(dataDir, "kicked_members.json");
const bannedMembersPath = path.join(dataDir, "banned_members.json");

// ============================================================
// CONFIG — loaded from process.env (KenzAI's .env)
// MCBOT_VPS_URL  — e.g. "http://123.45.67.89:4823"
// MCBOT_API_KEY  — must match API_KEY in VPS .env
// ============================================================

function getVpsUrl() {
  const url = process.env.MCBOT_VPS_URL;
  if (!url) throw new Error("MCBOT_VPS_URL is not set in .env");
  return url.replace(/\/$/, "");
}

function getApiKey() {
  const key = process.env.MCBOT_API_KEY;
  if (!key) throw new Error("MCBOT_API_KEY is not set in .env");
  return key;
}

// ============================================================
// DATA READERS
// ============================================================

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error(`[mcbotlogic] ❌ Error reading ${path.basename(filePath)}:`, err.message);
    return {};
  }
}

// ============================================================
// SECURITY VALIDATION
// ============================================================

function validateMember(discordId) {
  console.log(`[mcbotlogic] 🔍 Validating member: ${discordId}`);

  const members = readJSON(membersPath);
  const member = members[discordId];

  if (!member) {
    console.warn(`[mcbotlogic] ❌ Not in members.json: ${discordId}`);
    return {
      valid: false,
      reason: "not_a_member",
      message: "❌ You are not a registered Yazanaki Empire member.\nJoin a clan first before using the bot system.",
    };
  }

  const banned = readJSON(bannedMembersPath);
  if (banned[discordId]) {
    const banData = banned[discordId];
    console.warn(`[mcbotlogic] ⛔ User is banned: ${discordId}`);
    return {
      valid: false,
      reason: "banned",
      message: `⛔ You are permanently banned from all Yazanaki systems.\nReason: ${banData.banReason || "Not specified"}`,
    };
  }

  const kicked = readJSON(kickedMembersPath);
  if (kicked[discordId]) {
    const kickData = kicked[discordId];
    const canReapplyAt = kickData.canReapplyAt ? new Date(kickData.canReapplyAt) : null;
    const now = new Date();

    if (!canReapplyAt || now < canReapplyAt) {
      const timestamp = canReapplyAt
        ? `<t:${Math.floor(canReapplyAt.getTime() / 1000)}:R>`
        : "an unknown date";
      console.warn(`[mcbotlogic] 🦶 User is kicked (cooldown active): ${discordId}`);
      return {
        valid: false,
        reason: "kicked",
        message: `🦶 You were kicked from the Yazanaki Empire. You may reapply ${timestamp}.`,
      };
    }
  }

  const empireIds = readJSON(empireIdsPath);
  const empireId = member.EmpireID;

  if (!empireId) {
    console.warn(`[mcbotlogic] ⚠️ Member has no EmpireID: ${discordId}`);
    return {
      valid: false,
      reason: "no_empire_id",
      message: "❌ You do not have an Empire ID assigned. Contact an admin.",
    };
  }

  const idEntry = empireIds.ids?.[empireId];
  if (idEntry && idEntry.active === false) {
    console.warn(`[mcbotlogic] ⚠️ Empire ID is deactivated: ${empireId}`);
    return {
      valid: false,
      reason: "deactivated_empire_id",
      message: "❌ Your Empire ID has been deactivated. Contact an admin.",
    };
  }

  const minecraftUser = member.minecraftUser;
  if (!minecraftUser) {
    console.warn(`[mcbotlogic] ⚠️ Member has no minecraftUser set: ${discordId}`);
    return {
      valid: false,
      reason: "no_minecraft_user",
      message: "❌ No Minecraft username is linked to your account. Contact an admin.",
    };
  }

  console.log(`[mcbotlogic] ✅ Validation passed: ${discordId} → ${minecraftUser} (${empireId})`);
  return { valid: true, member, empireId, minecraftUser };
}

// ============================================================
// FIND OWNER BY MINECRAFT USERNAME
// ============================================================

function findOwnerByMinecraftUser(minecraftUser) {
  const members = readJSON(membersPath);
  const lower = minecraftUser.toLowerCase();
  for (const [discordId, data] of Object.entries(members)) {
    if (data?.minecraftUser?.toLowerCase() === lower) return discordId;
  }
  return null;
}

// ============================================================
// VPS API CLIENT
// ============================================================

function vpsRequest(method, endpoint, body = null) {
  return new Promise((resolve) => {
    let vpsUrl, apiKey;
    try {
      vpsUrl = getVpsUrl();
      apiKey = getApiKey();
    } catch (err) {
      return resolve({ ok: false, status: 0, data: { error: err.message } });
    }

    const url = new URL(vpsUrl + endpoint);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: parseInt(url.port || "80", 10),
      path: url.pathname + url.search,
      method,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(raw);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
        } catch (_) {
          resolve({ ok: false, status: res.statusCode, data: { error: "Invalid JSON response from VPS" } });
        }
      });
    });

    req.on("error", (err) => {
      console.error(`[mcbotlogic] ❌ VPS request error (${method} ${endpoint}):`, err.message);
      resolve({ ok: false, status: 0, data: { error: `Cannot connect to VPS: ${err.message}` } });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, status: 0, data: { error: "VPS request timed out (10s)" } });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ============================================================
// PUBLIC API WRAPPERS
// ============================================================

/** Ping the VPS to check if it's reachable */
async function pingVps() {
  return vpsRequest("GET", "/ping");
}

/** Start a bot for a validated member */
async function startBotOnVps(discordId, minecraftUser, serverAddress, version) {
  return vpsRequest("POST", "/start", { discordId, minecraftUser, serverAddress, version });
}

/**
 * Stop a specific bot by discordId + minecraftUser.
 */
async function stopBotOnVps(discordId, minecraftUser) {
  return vpsRequest("POST", "/stop", { discordId, minecraftUser });
}

/**
 * Get status for a specific (discordId, minecraftUser) bot.
 */
async function getBotStatusFromVps(discordId, minecraftUser) {
  return vpsRequest("GET", `/status/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
}

/**
 * Get statuses of ALL bots running for a given Discord user.
 */
async function getUserBotsFromVps(discordId) {
  return vpsRequest("GET", `/bots/${encodeURIComponent(discordId)}`);
}

/** List all active bots (admin) */
async function listAllBotsOnVps() {
  return vpsRequest("GET", "/list");
}

/** Stop all bots (admin emergency) */
async function stopAllBotsOnVps() {
  return vpsRequest("POST", "/stopall");
}

/**
 * Poll the VPS for a pending Microsoft device code for a specific bot.
 */
async function getDeviceCodeFromVps(discordId, minecraftUser) {
  return vpsRequest("GET", `/devicecode/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
}

/**
 * Tell the VPS to clear the device code for a specific bot (after DMing the user).
 */
async function clearDeviceCodeOnVps(discordId, minecraftUser) {
  return vpsRequest("DELETE", `/devicecode/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
}

/**
 * Get bots that ended unexpectedly since the last poll.
 * Used by botmonitor.js to DM users when their bots go offline.
 * Returns: { ok, data: { bots: [...] } }
 */
async function getEndedBotsFromVps() {
  return vpsRequest("GET", "/ended");
}

module.exports = {
  validateMember,
  findOwnerByMinecraftUser,
  pingVps,
  startBotOnVps,
  stopBotOnVps,
  getBotStatusFromVps,
  getUserBotsFromVps,
  listAllBotsOnVps,
  stopAllBotsOnVps,
  getDeviceCodeFromVps,
  clearDeviceCodeOnVps,
  getEndedBotsFromVps,
};