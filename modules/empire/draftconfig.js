// modules/empire/draftconfig.js
// ✅ Draft system configuration
// Supports both TESTING MODE (minutes) and PRODUCTION MODE (days)

// ============================================================
// GUILD CONFIGURATION
// ============================================================

// Yazanaki Empire Guild ID (main empire server)
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// ============================================================
// ROLE IDs (from Yazanaki Empire guild)
// ============================================================

const ROLES = {
  DRAFT: "1345398371522842624",           // Draft role
  CITIZEN: "1334641779009519668",         // Citizen role
  IMPERIAL_ARMY: "1345398184653885440",   // Imperial Army role
  MILITARY: "1334641887017177141"         // Military status role
};

// ============================================================
// TESTING MODE TOGGLE
// ============================================================

// ⚠️ WARNING: Set to false for production!
// When true, draft duration is in MINUTES instead of DAYS
let TESTING_MODE = false;

// ============================================================
// PRODUCTION MODE CONFIGURATION (DAYS)
// ============================================================

const DRAFT_DURATION_DAYS = 90;           // 3 months (90 days)
const REMINDER_DAYS_BEFORE = 14;          // Reminder 2 weeks before expiry
const AUTO_CITIZEN_HOURS = 24;            // Auto-citizen 24 hours after expiry notification

// ============================================================
// TESTING MODE CONFIGURATION (MINUTES)
// ============================================================

const DRAFT_DURATION_MINUTES = 5;         // 5 minutes for testing
const REMINDER_MINUTES_BEFORE = 2;        // Reminder 2 minutes before expiry
const AUTO_CITIZEN_MINUTES = 1;           // Auto-citizen 1 minute after expiry notification

// ============================================================
// SCHEDULER CONFIGURATION
// ============================================================

// How often to check for draft updates (in milliseconds)
const CHECK_INTERVAL_PRODUCTION = 60 * 60 * 1000;  // 1 hour
const CHECK_INTERVAL_TESTING = 30 * 1000;          // 30 seconds

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get draft duration in milliseconds based on current mode
 */
function getDraftDuration() {
  if (TESTING_MODE) {
    return DRAFT_DURATION_MINUTES * 60 * 1000;
  }
  return DRAFT_DURATION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Get reminder time threshold in milliseconds
 * Returns how much time BEFORE expiry to send reminder
 */
function getReminderTime() {
  if (TESTING_MODE) {
    return REMINDER_MINUTES_BEFORE * 60 * 1000;
  }
  return REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000;
}

/**
 * Get auto-citizen timeout in milliseconds
 * Returns how long AFTER expiry notification to auto-assign citizen
 */
function getAutoCitizenTimeout() {
  if (TESTING_MODE) {
    return AUTO_CITIZEN_MINUTES * 60 * 1000;
  }
  return AUTO_CITIZEN_HOURS * 60 * 60 * 1000;
}

/**
 * Get check interval for scheduler
 */
function getCheckInterval() {
  if (TESTING_MODE) {
    return CHECK_INTERVAL_TESTING;
  }
  return CHECK_INTERVAL_PRODUCTION;
}

/**
 * Get human-readable duration string
 */
function getDurationString() {
  if (TESTING_MODE) {
    return `${DRAFT_DURATION_MINUTES} minute(s)`;
  }
  return `${DRAFT_DURATION_DAYS} days (${Math.floor(DRAFT_DURATION_DAYS / 30)} months)`;
}

/**
 * Get human-readable reminder string
 */
function getReminderString() {
  if (TESTING_MODE) {
    return `${REMINDER_MINUTES_BEFORE} minute(s)`;
  }
  return `${REMINDER_DAYS_BEFORE} days`;
}

/**
 * Get human-readable auto-citizen string
 */
function getAutoCitizenString() {
  if (TESTING_MODE) {
    return `${AUTO_CITIZEN_MINUTES} minute(s)`;
  }
  return `${AUTO_CITIZEN_HOURS} hour(s)`;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Guild & Role IDs
  YAZANAKI_EMPIRE_GUILD_ID,
  ROLES,
  
  // Mode toggle
  TESTING_MODE,
  
  // Production config
  DRAFT_DURATION_DAYS,
  REMINDER_DAYS_BEFORE,
  AUTO_CITIZEN_HOURS,
  
  // Testing config
  DRAFT_DURATION_MINUTES,
  REMINDER_MINUTES_BEFORE,
  AUTO_CITIZEN_MINUTES,
  
  // Helper functions
  getDraftDuration,
  getReminderTime,
  getAutoCitizenTimeout,
  getCheckInterval,
  getDurationString,
  getReminderString,
  getAutoCitizenString
};