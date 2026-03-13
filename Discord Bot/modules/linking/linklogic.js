// modules/linking/linklogic.js
const fs = require("fs");
const path = require("path");

// applicants module (needed for autolinking support)
const applicants = require("../applications/applicants");

const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "linking.json");

function ensureDataFile() {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    if (!fs.existsSync(dataFile)) {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
      return {};
    }

    const raw = fs.readFileSync(dataFile, "utf8");
    if (!raw || !raw.trim()) {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
      return {};
    }

    const parsed = JSON.parse(raw);

    // Ensure new structure for each entry:
    // {
    //   discordId,
    //   main: "MainName",
    //   minecraftUser: "MainName", // kept for backward compatibility
    //   alternateAccounts: ["Alt1", "Alt2"]
    // }
    const migrated = {};
    for (const [discordId, value] of Object.entries(parsed || {})) {
      if (!value || typeof value !== "object") continue;
      const mainName =
        typeof value.main === "string"
          ? value.main
          : typeof value.minecraftUser === "string"
          ? value.minecraftUser
          : null;
      if (!mainName) continue;

      const alts = Array.isArray(value.alternateAccounts)
        ? value.alternateAccounts.filter((v) => typeof v === "string" && v.trim() !== "")
        : [];

      migrated[discordId] = {
        discordId,
        main: mainName,
        minecraftUser: mainName,
        alternateAccounts: alts,
      };
    }

    return migrated;
  } catch (err) {
    console.error("linklogic.ensureDataFile error:", err);

    try {
      fs.writeFileSync(dataFile, JSON.stringify({}, null, 2));
    } catch (e) {}

    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("linklogic.saveData error:", err);
  }
}

function normalizeName(name) {
  if (!name) return "";
  return String(name).trim().toLowerCase();
}

function isMinecraftNameTaken(data, mcName) {
  const key = normalizeName(mcName);
  if (!key) return false;

  for (const entry of Object.values(data)) {
    if (!entry || typeof entry !== "object") continue;
    const main = normalizeName(entry.main || entry.minecraftUser);
    if (main && main === key) return true;
    if (Array.isArray(entry.alternateAccounts)) {
      for (const alt of entry.alternateAccounts) {
        if (normalizeName(alt) === key) return true;
      }
    }
  }

  return false;
}

/**
 * Legacy helper kept for backward compatibility.
 * Behaves like the old implementation: links the **main** account,
 * rejecting if the user is already linked or the username is taken.
 */
function linkMember(discordId, mcName, opts = {}) {
  return linkMainAccount(discordId, mcName, opts);
}

/**
 * Link or (optionally) validate linking a main Minecraft account.
 * - discordId: Discord user ID
 * - mcName: Minecraft username (original casing preserved)
 * - opts.dryRun: if true, only validates and does not write to disk
 */
function linkMainAccount(discordId, mcName, opts = {}) {
  const { dryRun = false } = opts;
  const data = ensureDataFile();

  if (!discordId) {
    return { success: false, reason: "invalid_arguments" };
  }

  // Pull from applicants if mcName not provided
  if (!mcName) {
    const app = applicants.getApplicant(discordId);
    if (app && (app.minecraftUser || app.minecraftName)) {
      mcName = app.minecraftUser || app.minecraftName;
    } else {
      return { success: false, reason: "no_mcname_provided" };
    }
  }

  const existing = data[discordId];
  if (existing && existing.main) {
    return {
      success: false,
      reason: "already_linked",
      details: { discordId, minecraftUser: existing.main },
    };
  }

  if (isMinecraftNameTaken(data, mcName)) {
    return {
      success: false,
      reason: "username_used",
      details: { minecraftUser: mcName },
    };
  }

  if (!dryRun) {
    data[discordId] = {
      discordId,
      main: mcName,
      minecraftUser: mcName,
      alternateAccounts: existing?.alternateAccounts || [],
    };
    saveData(data);
  }

  return { success: true, discordId, minecraftUser: mcName };
}

/**
 * Link or validate an alternate Minecraft account for a Discord user.
 * Requires that a main account is already linked.
 * - opts.dryRun: if true, only validates and does not write to disk
 */
function linkAltAccount(discordId, mcName, opts = {}) {
  const { dryRun = false } = opts;
  const data = ensureDataFile();

  if (!discordId) {
    return { success: false, reason: "invalid_arguments" };
  }

  if (!mcName) {
    return { success: false, reason: "no_mcname_provided" };
  }

  const existing = data[discordId];
  if (!existing || !existing.main) {
    return {
      success: false,
      reason: "no_main_linked",
      details: { discordId },
    };
  }

  if (isMinecraftNameTaken(data, mcName)) {
    return {
      success: false,
      reason: "username_used",
      details: { minecraftUser: mcName },
    };
  }

  const currentAlts = Array.isArray(existing.alternateAccounts)
    ? existing.alternateAccounts
    : [];

  if (currentAlts.some((alt) => normalizeName(alt) === normalizeName(mcName))) {
    return {
      success: false,
      reason: "already_linked_alt",
      details: { discordId, minecraftUser: mcName },
    };
  }

  if (!dryRun) {
    const updated = {
      discordId,
      main: existing.main,
      minecraftUser: existing.main,
      alternateAccounts: [...currentAlts, mcName],
    };
    data[discordId] = updated;
    saveData(data);
  }

  return { success: true, discordId, minecraftUser: mcName };
}

// Lookup helpers
function getMCFromDiscord(discordId) {
  const data = ensureDataFile();
  const entry = data[discordId];
  if (!entry) return null;
  return entry.main || entry.minecraftUser || null;
}

function getDiscordFromMC(mcName) {
  if (!mcName) return null;
  const data = ensureDataFile();
  const key = normalizeName(mcName);
  if (!key) return null;

  for (const [discordId, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== "object") continue;
    const main = normalizeName(entry.main || entry.minecraftUser);
    if (main && main === key) return discordId;
    if (Array.isArray(entry.alternateAccounts)) {
      for (const alt of entry.alternateAccounts) {
        if (normalizeName(alt) === key) return discordId;
      }
    }
  }

  return null;
}

function getAllAccountsForDiscord(discordId) {
  const data = ensureDataFile();
  const entry = data[discordId];
  if (!entry || typeof entry !== "object") {
    return { main: null, alternateAccounts: [] };
  }
  const main = entry.main || entry.minecraftUser || null;
  const alts = Array.isArray(entry.alternateAccounts)
    ? entry.alternateAccounts.filter((v) => typeof v === "string" && v.trim() !== "")
    : [];
  return { main, alternateAccounts: alts };
}

module.exports = {
  linkMember,
  linkMainAccount,
  linkAltAccount,
  getMCFromDiscord,
  getDiscordFromMC,
  getAllAccountsForDiscord,
  _ensureDataFile: ensureDataFile,
  _saveData: saveData,
  _isMinecraftNameTaken: isMinecraftNameTaken,
};
