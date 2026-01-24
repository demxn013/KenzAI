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

// ✅ Import role detection from memberlogic
const { detectRolesFromDiscord } = require("../membertracking/memberlogic");

/**
 * ✅ UPDATED: Accept applicant and detect roles from Discord
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client (REQUIRED for role detection)
 */
module.exports.acceptApplicant = async function (discordId, client = null) {

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

    // Correct field names coming from saveApplicant()
    const discordUser = data.discordUser || "";
    const minecraftUser = data.minecraftUser || "";
    const minecraftVersion = data.minecraftVersion || "";

    // Application acceptance date is NOW
    const closeDate = formatDate(new Date().toISOString());

    // Detect clan based on guild/server ID
    const clanName = clans[data.server]?.name || "Unknown";

    // ✅ DETECT ROLES FROM DISCORD
    let detectedRoles = { rank: "n/d", status: "n/d" };
    
    if (client) {
        console.log(`[acceptedapps] Detecting roles for ${discordId}...`);
        try {
            detectedRoles = await detectRolesFromDiscord(discordId, client);
            console.log(`[acceptedapps] Roles detected - Rank: ${detectedRoles.rank}, Status: ${detectedRoles.status}`);
        } catch (err) {
            console.error(`[acceptedapps] Error detecting roles:`, err);
        }
    } else {
        console.warn(`[acceptedapps] No client provided - roles will be 'n/d'`);
    }

    // Create the final entry with detected roles
    const entry = {
        discordId,
        discordUser,
        minecraftUser,
        minecraftVersion,
        JoinedClan: clanName,
        JoinDate: closeDate,
        YazanakiRank: detectedRoles.rank, // ✅ FROM DISCORD ROLES
        EmpireID: "",
        Status: detectedRoles.status // ✅ FROM DISCORD ROLES
    };

    console.log(`[acceptedapps] Writing entry for ${discordId}:`, entry);

    // Write into members.json
    members[discordId] = entry;
    saveJSON(membersPath, members);

    console.log(`[acceptedapps] SUCCESS: Added ${discordId} to members.json with roles`);
};