// modules/applications/acceptedapplicants.js
// ✅ UPDATED: Now uses multi-guild role detection from modules/roles/

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
    console.log("[acceptedapps] 📁 Creating data directory:", dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure members.json exists
if (!fs.existsSync(membersPath)) {
    console.log("[acceptedapps] 📝 Creating members.json");
    fs.writeFileSync(membersPath, JSON.stringify({}, null, 4));
}

// Safe JSON loaders
function loadJSON(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`[acceptedapps] ⚠️ Missing file: ${filePath}`);
        return {};
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8");
        return raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
        console.error(`[acceptedapps] ❌ JSON parse error in ${filePath}`, err);
        return {};
    }
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`[acceptedapps] ✅ Saved ${path.basename(filePath)}`);
    } catch (err) {
        console.error(`[acceptedapps] ❌ Failed to save ${path.basename(filePath)}:`, err);
    }
}

function formatDate(dateString) {
    const d = new Date(dateString);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

// ✅ Import multi-guild role detection
const { detectRolesFromDiscord } = require("../roles/roledetector");

/**
 * ✅ Accept applicant and detect roles from ALL guilds
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client (REQUIRED for role detection)
 */
module.exports.acceptApplicant = async function (discordId, client = null) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[acceptedapps] 🎯 Attempting to accept applicant ${discordId}`);

    const applicants = loadJSON(applicantsPath);
    const members = loadJSON(membersPath);
    const clans = loadJSON(clansPath);

    const data = applicants[discordId];

    if (!data) {
        console.log(`[acceptedapps] ❌ Applicant ${discordId} not found in applicants.json`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return;
    }

    if (!data.accepted) {
        console.log(`[acceptedapps] ⚠️ Applicant ${discordId} is not marked as accepted`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return;
    }

    // Correct field names coming from saveApplicant()
    const discordUser = data.discordUser || "";
    const minecraftUser = data.minecraftUser || "";
    const minecraftVersion = data.minecraftVersion || "";

    console.log(`[acceptedapps] 📊 Applicant data:`);
    console.log(`  - Discord: ${discordUser}`);
    console.log(`  - Minecraft: ${minecraftUser}`);
    console.log(`  - Version: ${minecraftVersion}`);

    // Application acceptance date is NOW
    const closeDate = formatDate(new Date().toISOString());

    // Detect clan based on guild/server ID
    const clanName = clans[data.server]?.name || "Unknown";
    console.log(`  - Clan: ${clanName}`);

    // ✅ DETECT ROLES FROM ALL GUILDS (multi-guild support)
    let detectedRoles = { rank: "n/d", status: "n/d" };
    
    if (!client) {
        console.warn(`[acceptedapps] ⚠️ No client provided - roles will be 'n/d'`);
        console.warn(`[acceptedapps] ⚠️ Please update application.js to pass client to acceptApplicant()`);
    } else {
        console.log(`[acceptedapps] 🎭 Detecting roles across ALL guilds for ${discordId}...`);
        try {
            detectedRoles = await detectRolesFromDiscord(discordId, client);
            
            if (detectedRoles.error) {
                console.warn(`[acceptedapps] ⚠️ Role detection had issues: ${detectedRoles.error}`);
            } else {
                console.log(`[acceptedapps] ✅ Roles detected - Rank: ${detectedRoles.rank}, Status: ${detectedRoles.status}`);
                
                // Log which guilds were checked
                if (detectedRoles.guilds) {
                    const checkedGuilds = Object.entries(detectedRoles.guilds)
                        .filter(([, data]) => !data.error)
                        .map(([id, data]) => data.guild)
                        .join(", ");
                    
                    if (checkedGuilds) {
                        console.log(`[acceptedapps] 🌐 Checked guilds: ${checkedGuilds}`);
                    }
                }
            }
        } catch (err) {
            console.error(`[acceptedapps] ❌ Error detecting roles:`, err);
        }
    }

    // Create the final entry with detected roles
    const entry = {
        discordId,
        discordUser,
        minecraftUser,
        minecraftVersion,
        JoinedClan: clanName,
        JoinDate: closeDate,
        YazanakiRank: detectedRoles.rank, // ✅ FROM MULTI-GUILD DETECTION
        EmpireID: "",
        Status: detectedRoles.status // ✅ FROM MULTI-GUILD DETECTION
    };

    console.log(`[acceptedapps] 📝 Creating entry for ${discordId}:`, entry);

    // Write into members.json
    members[discordId] = entry;
    saveJSON(membersPath, members);

    console.log(`[acceptedapps] ✅ SUCCESS: Added ${discordId} to members.json with roles`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};