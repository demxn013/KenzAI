const fs = require("fs");
const path = require("path");

// Data directory
const dataDir = path.join(__dirname, "..", "data");
const dataPath = path.join(dataDir, "applicants.json");

// Ensure directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure file exists
if (!fs.existsSync(dataPath)) {
  fs.writeFileSync(dataPath, JSON.stringify({}, null, 2));
}

// Load all applicants
function loadApplicants() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error("Failed to load applicants.json:", err);
    return {};
  }
}

// Save all applicants
function saveApplicants(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save applicants.json:", err);
  }
}

/**
 * Save or update one applicant
 *
 * Structure produced:
 * {
 *   discordId,
 *   discordUser,
 *   minecraftUser,       // Exact capitalization, never changed
 *   minecraftUserKey,    // Lowercase internal lookup key ONLY
 *   minecraftVersion,
 *   timezone,
 *   previousGroups,
 *   reason,
 *   openedAt,
 *   server,
 *   accepted,
 *   closeReason,
 *   closedAt
 * }
 */
function saveApplicant(
  discordId,
  applicantData,
  serverId = null,
  closeReason = null,
  accepted = false,
  closedAt = null
) {
  const data = loadApplicants();

  // Support legacy field names (minecraftName) while normalizing to minecraftUser
  const mcOriginal =
    // prefer explicit new key
    (applicantData && (applicantData.minecraftUser || applicantData.minecraftName)) ||
    "";
  const mcKey = mcOriginal ? mcOriginal.toString().toLowerCase() : "";

  data[discordId] = {
    discordId,
    // prefer applicantData.discordUser, fallback to discordTag for legacy
    discordUser: applicantData.discordUser || applicantData.discordTag || null,

    // Canonical stored fields
    minecraftUser: mcOriginal || null,
    minecraftUserKey: mcKey || null,

    minecraftVersion:
      // prefer explicit new key; fallback to legacy
      applicantData.minecraftVersion ?? applicantData.minecraftVersion ?? null,

    timezone: applicantData.timezone || null,
    previousGroups: applicantData.previousGroups || null,
    reason: applicantData.reason || null,
    openedAt: applicantData.openedAt || new Date().toISOString(),

    server: serverId || applicantData.server || null,

    accepted: !!accepted,
    closeReason: closeReason || applicantData.closeReason || null,
    closedAt: closedAt || applicantData.closedAt || null
  };

  saveApplicants(data);
  return data[discordId];
}

function getApplicant(discordId) {
  const data = loadApplicants();
  return data[discordId] || null;
}

function getAllApplicants() {
  return loadApplicants();
}

module.exports = {
  saveApplicant,
  getApplicant,
  getAllApplicants
};
