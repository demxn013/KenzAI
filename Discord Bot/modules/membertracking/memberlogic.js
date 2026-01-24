// modules/membertracking/memberlogic.js
// ✅ FIXED: Removed duplicate role detection, using roledetector.js as single source of truth
// Added proper error handling, logging, and data migration

const fs = require("fs");
const path = require("path");
const https = require("https");
const Jimp = require("jimp");
const { getMCFromDiscord, getDiscordFromMC } = require("../linking/linklogic");
const { detectRolesFromDiscord, batchDetectRoles } = require("./roledetector");

const membersPath = path.join(__dirname, "../data/members.json");

// ============================================================
// DATA ACCESS FUNCTIONS
// ============================================================

function readMembers() {
  try {
    if (!fs.existsSync(membersPath)) {
      console.error("[memberlogic] ❌ members.json does not exist. Creating empty file.");
      fs.writeFileSync(membersPath, JSON.stringify({}, null, 4));
      return {};
    }

    const raw = fs.readFileSync(membersPath, "utf8");
    if (!raw || !raw.trim()) return {};

    return JSON.parse(raw);
  } catch (err) {
    console.error("[memberlogic] ❌ Error reading members.json:", err);
    return {};
  }
}

/**
 * ✅ Write members.json to disk with backup
 */
function writeMembers(data) {
  try {
    // Create backup before writing
    if (fs.existsSync(membersPath)) {
      const backupPath = membersPath.replace('.json', '.backup.json');
      fs.copyFileSync(membersPath, backupPath);
    }

    fs.writeFileSync(membersPath, JSON.stringify(data, null, 4));
    console.log("[memberlogic] ✅ Saved members.json");
    return true;
  } catch (err) {
    console.error("[memberlogic] ❌ Failed to write members.json:", err);
    return false;
  }
}

/**
 * ✅ Update a member's rank and status in members.json
 */
function updateMemberRoles(discordId, rank, status) {
  try {
    const members = readMembers();
    
    if (!members[discordId]) {
      console.log(`[memberlogic] 📝 Creating new member entry for ${discordId}`);
      members[discordId] = {
        discordId,
        discordUser: "",
        minecraftUser: "",
        minecraftVersion: "",
        JoinedClan: "",
        JoinDate: "",
        YazanakiRank: rank || "n/d",
        EmpireID: "",
        Status: status || "n/d"
      };
    } else {
      console.log(`[memberlogic] 🔄 Updating roles for ${discordId}: Rank=${rank}, Status=${status}`);
      members[discordId].YazanakiRank = rank || "n/d";
      members[discordId].Status = status || "n/d";
    }
    
    const success = writeMembers(members);
    if (success) {
      console.log(`[memberlogic] ✅ Roles updated for ${discordId}`);
    }
    return success;
  } catch (err) {
    console.error(`[memberlogic] ❌ Failed to update member roles:`, err);
    return false;
  }
}

// --------------------------------------------------------------
// Case-insensitive lookup
// --------------------------------------------------------------
function normalizeUsername(u) {
  if (!u) return "";
  return u.replace(/^"(.+(?="$))"$/, "$1").trim().toLowerCase();
}

function getMemberByMinecraftNameInsensitive(inputMC) {
  if (!inputMC) return null;

  const lookupName = normalizeUsername(inputMC);
  const members = readMembers();

  const found = Object.entries(members).find(
    ([, data]) =>
      data.minecraftUser &&
      normalizeUsername(data.minecraftUser) === lookupName
  );

  if (!found) return null;

  const [discordId, memberData] = found;
  return { discordId, ...memberData };
}

/**
 * ✅ Search by Minecraft username with role detection and saving
 */
async function getMemberByMinecraftUser(inputMC, client = null) {
  if (!inputMC) {
    return { member: null, exactUsername: inputMC };
  }

  console.log(`[memberlogic] 🔍 Searching for MC username: ${inputMC}`);

  const linkedDiscordId = getDiscordFromMC(inputMC);
  
  if (!linkedDiscordId) {
    console.log(`[memberlogic] ℹ️ Not linked in linking.json`);
    return {
      member: null,
      exactUsername: inputMC
    };
  }

  console.log(`[memberlogic] ✅ Found link: ${inputMC} -> Discord ID ${linkedDiscordId}`);
  
  const linkedMC = getMCFromDiscord(linkedDiscordId);
  
  const members = readMembers();
  let empireData = null;
  
  if (members[linkedDiscordId]) {
    console.log(`[memberlogic] ✅ Found empire data by Discord ID`);
    empireData = members[linkedDiscordId];
  } else {
    const mcMatch = getMemberByMinecraftNameInsensitive(linkedMC);
    if (mcMatch) {
      console.log(`[memberlogic] ✅ Found empire data by MC username`);
      empireData = mcMatch;
    }
  }
  
  // ✅ DETECT ROLES FROM DISCORD IF CLIENT PROVIDED
  let detectedRoles = { rank: "n/d", status: "n/d" };
  if (client && linkedDiscordId) {
    console.log(`[memberlogic] 🎭 Detecting roles for Discord ID: ${linkedDiscordId}`);
    try {
      detectedRoles = await detectRolesFromDiscord(linkedDiscordId, client);
      console.log(`[memberlogic] ✅ Roles detected - Rank: ${detectedRoles.rank}, Status: ${detectedRoles.status}`);
      
      // ✅ SAVE TO members.json
      updateMemberRoles(linkedDiscordId, detectedRoles.rank, detectedRoles.status);
      
    } catch (err) {
      console.error(`[memberlogic] ❌ Error detecting roles:`, err);
    }
  } else {
    console.log(`[memberlogic] ⚠️ Client not provided - using stored roles or 'n/d'`);
    // Use stored roles if available
    if (empireData) {
      detectedRoles = {
        rank: empireData.YazanakiRank || "n/d",
        status: empireData.Status || "n/d"
      };
    }
  }
  
  const memberData = {
    discordId: linkedDiscordId,
    minecraftUser: linkedMC,
    minecraftVersion: empireData?.minecraftVersion || "",
    JoinedClan: empireData?.JoinedClan || "",
    JoinDate: empireData?.JoinDate || "",
    YazanakiRank: detectedRoles.rank,
    EmpireID: empireData?.EmpireID || "",
    Status: detectedRoles.status
  };
  
  console.log(`[memberlogic] 📊 Returning data:`, memberData);
  
  return {
    member: memberData,
    exactUsername: linkedMC
  };
}

/**
 * ✅ Gets member by Discord ID with role detection and saving
 */
async function getMemberByDiscordId(discordId, client = null) {
  if (!discordId) {
    console.warn("[memberlogic] ⚠️ No discordId provided");
    return null;
  }
  
  console.log(`[memberlogic] 🔍 Looking up Discord ID: ${discordId}`);
  
  const linkedMC = getMCFromDiscord(discordId);
  
  if (!linkedMC) {
    console.log(`[memberlogic] ℹ️ Not linked in linking.json`);
    return null;
  }
  
  console.log(`[memberlogic] ✅ Found link: ${discordId} -> ${linkedMC}`);
  
  const members = readMembers();
  let empireData = null;
  
  if (members[discordId]) {
    console.log(`[memberlogic] ✅ Found empire data by Discord ID`);
    empireData = members[discordId];
  } else {
    const mcMatch = getMemberByMinecraftNameInsensitive(linkedMC);
    if (mcMatch) {
      console.log(`[memberlogic] ✅ Found empire data by MC username`);
      empireData = mcMatch;
    }
  }
  
  // ✅ DETECT ROLES FROM DISCORD IF CLIENT PROVIDED
  let detectedRoles = { rank: "n/d", status: "n/d" };
  if (client) {
    console.log(`[memberlogic] 🎭 Detecting roles for Discord ID: ${discordId}`);
    try {
      detectedRoles = await detectRolesFromDiscord(discordId, client);
      console.log(`[memberlogic] ✅ Roles detected - Rank: ${detectedRoles.rank}, Status: ${detectedRoles.status}`);
      
      // ✅ SAVE TO members.json
      updateMemberRoles(discordId, detectedRoles.rank, detectedRoles.status);
      
    } catch (err) {
      console.error(`[memberlogic] ❌ Error detecting roles:`, err);
    }
  } else {
    console.log(`[memberlogic] ⚠️ Client not provided - using stored roles or 'n/d'`);
    // Use stored roles if available
    if (empireData) {
      detectedRoles = {
        rank: empireData.YazanakiRank || "n/d",
        status: empireData.Status || "n/d"
      };
    }
  }
  
  const memberData = {
    discordId,
    minecraftUser: linkedMC,
    minecraftVersion: empireData?.minecraftVersion || "",
    JoinedClan: empireData?.JoinedClan || "",
    JoinDate: empireData?.JoinDate || "",
    YazanakiRank: detectedRoles.rank,
    EmpireID: empireData?.EmpireID || "",
    Status: detectedRoles.status
  };
  
  console.log(`[memberlogic] 📊 Returning data:`, memberData);
  
  return { member: memberData };
}

/**
 * Higher-level resolver
 */
async function getMemberByDiscordOrMC(discordId = null, mcUser = null, client = null) {
  if (discordId) {
    const result = await getMemberByDiscordId(discordId, client);
    if (result && result.member) {
      return { member: result.member, discordId };
    }
  }
  
  if (mcUser) {
    const result = await getMemberByMinecraftUser(mcUser, client);
    if (result && result.member) {
      return { member: result.member, discordId: result.member.discordId };
    }
  }
  
  return null;
}

// ----------- IMAGE / COLOR FUNCTIONS -----------
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    try {
      https
        .get(url, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", (err) => reject(err));
        })
        .on("error", (err) => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

async function getProperMinecraftName(username) {
  if (!username) return username;

  const url = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(
    username
  )}`;

  return new Promise((resolve) => {
    try {
      https
        .get(url, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(json.name || username);
            } catch {
              resolve(username);
            }
          });
        })
        .on("error", () => resolve(username));
    } catch {
      resolve(username);
    }
  });
}

async function getDominantColor(url) {
  try {
    const buffer = await fetchImageBuffer(url);
    const image = await Jimp.read(buffer);

    const maxDim = 128;
    if (image.bitmap.width > maxDim || image.bitmap.height > maxDim) {
      image.resize(maxDim, Jimp.AUTO);
    }

    const colorCount = {};

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const key = `${r},${g},${b}`;
      colorCount[key] = (colorCount[key] || 0) + 1;
    });

    const entries = Object.entries(colorCount);
    if (!entries.length) return 0x339eff;

    entries.sort((a, b) => b[1] - a[1]);
    const [r, g, b] = entries[0][0].split(",").map(Number);

    return (r << 16) + (g << 8) + b;
  } catch (err) {
    console.error("getDominantColor error:", err);
    return 0x339eff;
  }
}

// ----------- MAIN RESOLUTION LOGIC -----------
async function resolveCommandTarget(
  client,
  discordUserOption = null,
  mcOption = null,
  invokingUser
) {
  let discordUser = null;
  let mcUsername = "n/d";
  let memberData = null;

  if (discordUserOption) {
    discordUser = discordUserOption;

    const stored = await getMemberByDiscordOrMC(discordUserOption.id, null, client);
    if (stored && stored.member) {
      memberData = stored.member;
      mcUsername = stored.member.minecraftUser || "n/d";
    } else {
      const linkedMC = getMCFromDiscord(discordUserOption.id);
      if (linkedMC) {
        mcUsername = linkedMC;
        memberData = { minecraftUser: linkedMC, minecraftVersion: "n/d" };
      }
    }
  } else if (mcOption) {
    const byMC = await getMemberByDiscordOrMC(null, mcOption, client);

    if (byMC && byMC.member) {
      memberData = byMC.member;
      discordUser = await client.users.fetch(byMC.discordId).catch(() => null);
      mcUsername = byMC.member.minecraftUser || mcOption;
    } else {
      const linkedDiscordId = getDiscordFromMC(mcOption);

      if (linkedDiscordId) {
        discordUser = await client.users.fetch(linkedDiscordId).catch(() => null);
        mcUsername = mcOption;
        memberData = { minecraftUser: mcOption, minecraftVersion: "n/d" };
      } else {
        mcUsername = await getProperMinecraftName(mcOption);
      }
    }
  } else {
    discordUser = invokingUser;

    const stored = await getMemberByDiscordOrMC(invokingUser.id, null, client);
    if (stored && stored.member) {
      memberData = stored.member;
      mcUsername = stored.member.minecraftUser || "n/d";
    } else {
      const linkedMC = getMCFromDiscord(invokingUser.id);
      if (linkedMC) {
        mcUsername = linkedMC;
        memberData = { minecraftUser: linkedMC, minecraftVersion: "n/d" };
      }
    }
  }

  if (mcUsername && mcUsername !== "n/d") {
    const proper = await getProperMinecraftName(mcUsername);
    mcUsername = proper;

    if (memberData) {
      memberData.minecraftUser = proper;
    }
  }

  return { discordUser, mcUsername, memberData };
}

function isUnlinked(discordId) {
  const linkedMC = getMCFromDiscord(discordId);
  return !linkedMC;
}

/**
 * ✅ NEW: Migrate all existing members - detect and update their roles
 * Useful for fixing empty rank/status fields
 */
async function migrateAllMemberRoles(client) {
  console.log("[memberlogic] 🔄 Starting member role migration...");
  
  const members = readMembers();
  const discordIds = Object.keys(members);
  
  if (discordIds.length === 0) {
    console.log("[memberlogic] ℹ️ No members to migrate");
    return { success: 0, failed: 0, skipped: 0 };
  }

  console.log(`[memberlogic] 📊 Found ${discordIds.length} members to migrate`);
  
  const results = await batchDetectRoles(discordIds, client);
  
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const [discordId, roleData] of Object.entries(results)) {
    try {
      // Skip if detection failed
      if (roleData.error) {
        console.log(`[memberlogic] ⚠️ Skipping ${discordId}: ${roleData.error}`);
        skippedCount++;
        continue;
      }

      // Update roles
      const updated = updateMemberRoles(discordId, roleData.rank, roleData.status);
      
      if (updated) {
        successCount++;
      } else {
        failedCount++;
      }
      
    } catch (err) {
      console.error(`[memberlogic] ❌ Failed to migrate ${discordId}:`, err);
      failedCount++;
    }
  }

  console.log(`[memberlogic] ✅ Migration complete: ${successCount} success, ${failedCount} failed, ${skippedCount} skipped`);
  
  return { success: successCount, failed: failedCount, skipped: skippedCount };
}

module.exports = {
  readMembers,
  writeMembers,
  getMemberByDiscordId,
  getMemberByMinecraftNameInsensitive,
  getMemberByMinecraftUser,
  getMemberByDiscordOrMC,
  fetchImageBuffer,
  getProperMinecraftName,
  getDominantColor,
  resolveCommandTarget,
  isUnlinked,
  updateMemberRoles,
  migrateAllMemberRoles  // ✅ NEW
};