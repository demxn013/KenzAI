// modules/applications/acceptedapplicants.js

const fs = require("fs");
const path = require("path");

// ABSOLUTE data directory (GUARANTEED CORRECT)
const dataDir = path.join(__dirname, "..", "data");

// Files
const applicantsPath = path.join(dataDir, "applicants.json");
const membersPath = path.join(dataDir, "members.json");
const clansPath = path.join(dataDir, "clans.json");

// Ensure /modules/data exists
if (!fs.existsSync(dataDir)) {
    console.log("[acceptedapps] Creating data directory:", dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure members.json exists
if (!fs.existsSync(membersPath)) {
    console.log("[acceptedapps] Creating members.json");
    fs.writeFileSync(membersPath, JSON.stringify({}, null, 4));
}

// Safe JSON loaders
function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`[acceptedapps] Missing file: ${filePath}`);
        return {};
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
        console.error(`[acceptedapps] JSON parse error in ${filePath}`, err);
        return {};
    }
}

function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

function formatDate(dateString) {
    const d = new Date(dateString);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

// MAIN FUNCTION
module.exports.acceptApplicant = function (discordId) {

    console.log(`[acceptedapps] Attempting to accept applicant ${discordId}`);

    const applicants = loadJSON(applicantsPath);
    const members = loadJSON(membersPath);
    const clans = loadJSON(clansPath);

    const data = applicants[discordId];

    if (!data) {
        console.log(`[acceptedapps] Applicant ${discordId} not found in applicants.json`);
        return;
    }

    if (!data.accepted) {
        console.log(`[acceptedapps] Applicant ${discordId} is not marked as accepted`);
        return;
    }

    // FIX 1 — Correct field names coming from saveApplicant()
    const discordUser = data.discordUser || "";
    const minecraftUser = data.minecraftUser || "";   // (correct field)
    const minecraftVersion = data.minecraftVersion || ""; // (correct field)

    // FIX 2 — Application acceptance date is NOW, not closedAt
    const closeDate = formatDate(new Date().toISOString());

    // Detect clan based on guild/server ID
    const clanName = clans[data.server]?.name || "Unknown";

    // Create the final entry
    const entry = {
        discordId,
        discordUser,
        minecraftUser,
        minecraftVersion,
        JoinedClan: clanName,
        JoinDate: closeDate,
        YazanakiRank: "",
        EmpireID: "",
        Status: ""
    };

    console.log(`[acceptedapps] Writing entry for ${discordId}:`, entry);

    // Write into members.json
    members[discordId] = entry;
    saveJSON(membersPath, members);

    console.log(`[acceptedapps] SUCCESS: Added ${discordId} to members.json`);
};
