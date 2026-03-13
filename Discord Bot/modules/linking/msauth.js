// modules/linking/msauth.js
// Lightweight, internal “device code style” verification helper for /link.
// NOTE: This is a stub implementation that mimics the UX of a Microsoft
// device-code flow (userCode + verificationUri) but does NOT integrate with
// real Microsoft APIs yet. It is designed so that a real MS integration can
// be plugged in later without changing /link command logic.

const crypto = require("crypto");

// In-memory store of pending verifications:
// Map<discordId, { type, mcName, userCode, verificationUri, expiresAt }>
const pending = new Map();

const DEFAULT_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function generateUserCode() {
  // Simple 8-character alphanumeric code
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Start a pseudo device-code verification session.
 * Returns { userCode, verificationUri, expiresAt, token }.
 * `token` is an opaque handle for pollForVerification (currently discordId).
 */
function requestDeviceCode(discordId, mcName, type) {
  if (!discordId) {
    throw new Error("requestDeviceCode: discordId is required");
  }

  const userCode = generateUserCode();
  const verificationUri = "https://microsoft.com/devicelogin";
  const expiresAt = Date.now() + DEFAULT_EXPIRY_MS;

  pending.set(discordId, {
    type,
    mcName,
    userCode,
    verificationUri,
    expiresAt,
  });

  return {
    userCode,
    verificationUri,
    expiresAt,
    token: discordId,
  };
}

/**
 * Poll for verification result.
 * CURRENT STUB BEHAVIOR:
 * - Waits a short delay and then resolves as “verified” as long as the
 *   code has not expired in our in-memory store.
 * - Returns { success, minecraftProfileName, reason? }.
 *
 * This is intentionally simple so the /link flow can be wired and tested
 * without needing live Microsoft credentials. A real implementation should:
 * - Contact Microsoft’s device-code endpoint to obtain a real userCode
 * - Poll the token endpoint until the user completes login
 * - Call the Minecraft/Xbox APIs to verify ownership of the requested account
 */
async function pollForVerification(token) {
  const discordId = token;
  const entry = pending.get(discordId);

  if (!entry) {
    return { success: false, reason: "no_pending_verification" };
  }

  if (Date.now() > entry.expiresAt) {
    pending.delete(discordId);
    return { success: false, reason: "expired" };
  }

  // Simulate some waiting time for the “verification”
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // For now, treat this as verified as long as it hasn't expired.
  pending.delete(discordId);

  return {
    success: true,
    minecraftProfileName: entry.mcName,
    type: entry.type,
  };
}

module.exports = {
  requestDeviceCode,
  pollForVerification,
};

