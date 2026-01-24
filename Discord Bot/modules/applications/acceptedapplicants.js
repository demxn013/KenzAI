// modules/applications/acceptedapplicants.js
// ✅ UPDATED: Now assigns clan roles in Yazanaki Empire when accepting applicants

const fs = require("fs");
const path = require("path");

// ABSOLUTE data directory (GUARANTEED CORRECT)
const dataDir = path.join(__dirname, "..", "data");

// Files
const applicantsPath = path.join(dataDir, "applicants.json");
const membersPath = path.join(dataDir, "members.json");
const clansPath = path.join(dataDir, "clans.json");

// Yazanaki Empire Guild ID (hardcoded - the main empire server)
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

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

// ✅ Import Empire ID system
const { assignEmpireId } = require("../empire/empireid");

/**
 * ✅ Assign clan role in Yazanaki Empire discord
 * @param {Client} client - Discord.js client
 * @param {string} discordId - User's Discord ID
 * @param {string} clanGuildId - Guild ID where they applied
 * @returns {Promise<boolean>} Success status
 */
async function assignClanRoleInYazanaki(client, discordId, clanGuildId) {
    try {
        console.log(`[acceptedapps] 🎭 Assigning clan role in Yazanaki Empire...`);
        
        // Load clans to find the role ID
        const clans = loadJSON(clansPath);
        const clan = clans[clanGuildId];
        
        if (!clan) {
            console.warn(`[acceptedapps] ⚠️ Clan not found for guild ${clanGuildId}`);
            return false;
        }
        
        if (!clan.yazanakiRoleId) {
            console.warn(`[acceptedapps] ⚠️ Clan ${clan.abbr} has no yazanakiRoleId configured`);
            console.warn(`[acceptedapps] ⚠️ Please update clans.json with the Yazanaki Empire role ID for ${clan.abbr}`);
            return false;
        }
        
        console.log(`[acceptedapps] 🎯 Clan: ${clan.abbr} (${clan.name})`);
        console.log(`[acceptedapps] 🎯 Yazanaki Role ID: ${clan.yazanakiRoleId}`);
        
        // Fetch Yazanaki Empire guild
        const yazanakiGuild = await client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
        
        if (!yazanakiGuild) {
            console.error(`[acceptedapps] ❌ Could not fetch Yazanaki Empire guild (${YAZANAKI_EMPIRE_GUILD_ID})`);
            return false;
        }
        
        console.log(`[acceptedapps] ✅ Fetched Yazanaki Empire guild: ${yazanakiGuild.name}`);
        
        // Fetch member in Yazanaki Empire
        const member = await yazanakiGuild.members.fetch(discordId).catch(() => null);
        
        if (!member) {
            console.warn(`[acceptedapps] ⚠️ User ${discordId} is not in Yazanaki Empire guild`);
            console.warn(`[acceptedapps] ⚠️ Role assignment skipped - they need to join Yazanaki Empire first`);
            return false;
        }
        
        console.log(`[acceptedapps] ✅ Found member in Yazanaki Empire: ${member.user.tag}`);
        
        // Check if role exists
        const role = yazanakiGuild.roles.cache.get(clan.yazanakiRoleId);
        
        if (!role) {
            console.error(`[acceptedapps] ❌ Role ${clan.yazanakiRoleId} not found in Yazanaki Empire`);
            return false;
        }
        
        console.log(`[acceptedapps] ✅ Found role: ${role.name}`);
        
        // Check if member already has the role
        if (member.roles.cache.has(clan.yazanakiRoleId)) {
            console.log(`[acceptedapps] ℹ️ Member already has role ${role.name}`);
            return true;
        }
        
        // Assign the role
        await member.roles.add(clan.yazanakiRoleId);
        
        console.log(`[acceptedapps] ✅ Assigned role ${role.name} to ${member.user.tag} in Yazanaki Empire!`);
        return true;
        
    } catch (err) {
        console.error(`[acceptedapps] ❌ Error assigning clan role:`, err);
        return false;
    }
}

/**
 * ✅ Accept applicant, assign Empire ID, and assign clan role in Yazanaki Empire
 * @param {string} discordId - Discord user ID
 * @param {Client} client - Discord.js client (REQUIRED for role detection and assignment)
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
    console.log(`  - Guild ID: ${data.server}`);

    // ✅ ASSIGN EMPIRE ID
    console.log(`[acceptedapps] 🆔 Assigning Empire ID...`);
    const empireIdResult = assignEmpireId(discordId, minecraftUser, data.server);
    
    let empireId = "";
    
    if (empireIdResult.success) {
        empireId = empireIdResult.empireId;
        
        if (empireIdResult.isReturning) {
            console.log(`[acceptedapps] ♻️ RETURNING MEMBER! Restored Empire ID: ${empireId}`);
        } else {
            console.log(`[acceptedapps] ✨ NEW MEMBER! Assigned Empire ID: ${empireId}`);
        }
    } else {
        console.error(`[acceptedapps] ❌ Failed to assign Empire ID: ${empireIdResult.reason}`);
        empireId = "ERROR";
    }

    // ✅ ASSIGN CLAN ROLE IN YAZANAKI EMPIRE
    if (client && data.server) {
        console.log(`[acceptedapps] 🎭 Attempting to assign clan role in Yazanaki Empire...`);
        const roleAssigned = await assignClanRoleInYazanaki(client, discordId, data.server);
        
        if (roleAssigned) {
            console.log(`[acceptedapps] ✅ Clan role assigned successfully in Yazanaki Empire!`);
        } else {
            console.warn(`[acceptedapps] ⚠️ Could not assign clan role in Yazanaki Empire`);
        }
    } else {
        console.warn(`[acceptedapps] ⚠️ Client not provided or no server ID - skipping clan role assignment`);
    }

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

    // Create the final entry with detected roles AND Empire ID
    const entry = {
        discordId,
        discordUser,
        minecraftUser,
        minecraftVersion,
        JoinedClan: clanName,
        JoinDate: closeDate,
        YazanakiRank: detectedRoles.rank,
        EmpireID: empireId, // ✅ EMPIRE ID ASSIGNED!
        Status: detectedRoles.status
    };

    console.log(`[acceptedapps] 📝 Creating entry for ${discordId}:`, entry);

    // Write into members.json
    members[discordId] = entry;
    saveJSON(membersPath, members);

    console.log(`[acceptedapps] ✅ SUCCESS: Added ${discordId} to members.json`);
    console.log(`[acceptedapps] 🆔 Empire ID: ${empireId}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};