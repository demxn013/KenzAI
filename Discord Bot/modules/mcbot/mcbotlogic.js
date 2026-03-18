// Discord Bot/modules/mcbot/mcbotlogic.js
// Logic layer between /mcbot commands and the VPS bot server.
// Handles member validation and all VPS HTTP API calls.

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

// ============================================================
// DATA PATHS
// ============================================================

const membersPath = path.join(__dirname, "../../data/members.json");
const bannedMembersPath = path.join(__dirname, "../../data/bannedMembers.json");
const kickedMembersPath = path.join(__dirname, "../../data/kickedMembers.json");
const empireIdsPath = path.join(__dirname, "../../data/empireIds.json");

// ============================================================
// HELPERS
// ============================================================

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function getVpsUrl() {
  const url = process.env.VPS_URL;
  if (!url || url.trim() === "") {
    throw new Error("VPS_URL is not configured in environment variables.");
  }
  return url.replace(/\/$/, "");
}

function getApiKey() {
  const key = process.env.VPS_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("VPS_API_KEY is not configured in environment variables.");
  }
  return key;
}

// ============================================================
// MEMBER VALIDATION
// ============================================================

/**
 * Validate that a Discord user is an active, non-banned,
 * non-kicked Yazanaki Empire member with a Minecraft account linked.
 */
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
// Scans members.json for the Discord ID whose minecraftUser
// matches the given MC username (case-insensitive).
// Used to route confirmation DMs to the account owner.
// ============================================================

/**
 * Find the Discord ID that owns a given Minecraft username.
 * @param {string} minecraftUser
 * @returns {string|null} discordId or null if not found
 */
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
// Makes authenticated HTTP requests to the VPS bot server.
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
 * @param {string} discordId
 * @param {string} minecraftUser
 */
async function stopBotOnVps(discordId, minecraftUser) {
  return vpsRequest("POST", "/stop", { discordId, minecraftUser });
}

/**
 * Get status for a specific (discordId, minecraftUser) bot.
 * @param {string} discordId
 * @param {string} minecraftUser
 */
async function getBotStatusFromVps(discordId, minecraftUser) {
  return vpsRequest("GET", `/status/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
}

/**
 * Get statuses of ALL bots running for a given Discord user.
 * @param {string} discordId
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
 * Returns { ok: true, pending: true, userCode, verificationUri, expiresAt }
 * or      { ok: false, pending: false } if no code is waiting.
 * @param {string} discordId
 * @param {string} minecraftUser
 */
async function getDeviceCodeFromVps(discordId, minecraftUser) {
  return vpsRequest("GET", `/devicecode/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
}

/**
 * Tell the VPS to clear the device code for a specific bot (after DMing the user).
 * @param {string} discordId
 * @param {string} minecraftUser
 */
async function clearDeviceCodeOnVps(discordId, minecraftUser) {
  return vpsRequest("DELETE", `/devicecode/${encodeURIComponent(discordId)}/${encodeURIComponent(minecraftUser)}`);
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
};