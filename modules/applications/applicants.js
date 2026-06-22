// Persistence is handled by the dual-write MapStore (JSON + MySQL `applicants`).
const { stores } = require("../database/stores");

// Load all applicants (from MySQL cache or JSON disk, per rollout flags)
function loadApplicants() {
  return stores.applicants.readMap();
}

// Save all applicants (writes JSON + syncs MySQL when enabled)
function saveApplicants(data) {
  stores.applicants.writeMap(data);
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

/**
 * Delete an applicant record entirely.
 * Used to clear a post-rejection cooldown (e.g. via /pardon).
 * @param {string} discordId
 * @returns {boolean} true if a record existed and was removed
 */
function deleteApplicant(discordId) {
  const data = loadApplicants();
  if (!data[discordId]) return false;
  delete data[discordId];
  saveApplicants(data);
  return true;
}

module.exports = {
  saveApplicant,
  getApplicant,
  getAllApplicants,
  deleteApplicant
};
