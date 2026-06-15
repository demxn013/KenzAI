// modules/judiciary/courtrequests.js
// ✅ Court requests data management

// Persistence is handled by the dual-write MapStore (JSON + MySQL `court_requests`).
const { stores } = require("../database/stores");

/**
 * Load all court requests
 */
function loadCourtRequests() {
  return stores.court_requests.readMap();
}

/**
 * Save all court requests
 */
function saveCourtRequests(data) {
  stores.court_requests.writeMap(data);
}

/**
 * Save or update one court request
 * 
 * Structure:
 * {
 *   discordId,
 *   discordUser,
 *   reporterMinecraft,
 *   accusedMinecraft,
 *   accusedDiscord,
 *   crimeType,
 *   incidentDetails,
 *   ticketChannel,
 *   ticketNumber,
 *   openedAt,
 *   escalated,
 *   escalatedAt,
 *   escalatedBy,
 *   dismissed,
 *   dismissedAt,
 *   dismissedBy,
 *   closeReason,
 *   closedAt
 * }
 */
function saveCourtRequest(discordId, requestData) {
  const data = loadCourtRequests();

  data[discordId] = {
    discordId,
    discordUser: requestData.discordUser || null,
    reporterMinecraft: requestData.reporterMinecraft || null,
    accusedMinecraft: requestData.accusedMinecraft || null,
    accusedDiscord: requestData.accusedDiscord || null,
    crimeType: requestData.crimeType || null,
    incidentDetails: requestData.incidentDetails || null,
    ticketChannel: requestData.ticketChannel || null,
    ticketNumber: requestData.ticketNumber || null,
    openedAt: requestData.openedAt || new Date().toISOString(),
    escalated: requestData.escalated || false,
    escalatedAt: requestData.escalatedAt || null,
    escalatedBy: requestData.escalatedBy || null,
    dismissed: requestData.dismissed || false,
    dismissedAt: requestData.dismissedAt || null,
    dismissedBy: requestData.dismissedBy || null,
    closeReason: requestData.closeReason || null,
    closedAt: requestData.closedAt || null
  };

  saveCourtRequests(data);
  return data[discordId];
}

/**
 * Get a court request by Discord ID
 */
function getCourtRequest(discordId) {
  const data = loadCourtRequests();
  return data[discordId] || null;
}

/**
 * Get all court requests
 */
function getAllCourtRequests() {
  return loadCourtRequests();
}

/**
 * Get court requests with filters
 */
function getFilteredCourtRequests(filters = {}) {
  const data = loadCourtRequests();
  let requests = Object.values(data);

  if (filters.escalated !== undefined) {
    requests = requests.filter(r => r.escalated === filters.escalated);
  }

  if (filters.dismissed !== undefined) {
    requests = requests.filter(r => r.dismissed === filters.dismissed);
  }

  if (filters.closed !== undefined) {
    const isClosed = filters.closed;
    requests = requests.filter(r => isClosed ? !!r.closedAt : !r.closedAt);
  }

  // Sort by opened date (newest first)
  requests.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));

  return requests;
}

module.exports = {
  saveCourtRequest,
  getCourtRequest,
  getAllCourtRequests,
  getFilteredCourtRequests
};