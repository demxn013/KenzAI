// modules/membertracking/memberlogic.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const Jimp = require("jimp");
const { getMCFromDiscord, getDiscordFromMC } = require("../linking/linklogic");

const membersPath = path.join(__dirname, "../data/members.json");

// ---- READ-ONLY VERSION ----
function readMembers() {
  try {
    if (!fs.existsSync(membersPath)) {
      console.error("members.json does not exist. Returning empty object.");
      return {};
    }

    const raw = fs.readFileSync(membersPath, "utf8");
    if (!raw || !raw.trim()) return {};

    return JSON.parse(raw);
  } catch (err) {
    console.error("Error reading members.json:", err);
    return {};
  }
}

// Disabled writer – kept exported for compatibility, but does nothing
function writeMembers() {
  console.warn("writeMembers() was called but writing to members.json is disabled.");
}

// --------------------------------------------------------------
// Case-insensitive lookup but data remains proper
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
 * Compatibility wrapper for member.js
 */
function getMemberByMinecraftUser(inputMC) {
  const result = getMemberByMinecraftNameInsensitive(inputMC);

  if (!result) {
    return {
      member: null,
      exactUsername: inputMC
    };
  }

  return {
    member: result,
    exactUsername: result.minecraftUser || inputMC
  };
}

/**
 * ✅ FIXED: Gets member by Discord ID
 * PRIMARY SOURCE: linking.json
 * SECONDARY SOURCE: members.json for extended data
 */
function getMemberByDiscordId(discordId) {
  if (!discordId) {
    console.warn("[getMemberByDiscordId] No discordId provided");
    return null;
  }
  
  console.log(`[getMemberByDiscordId] Looking up Discord ID: ${discordId}`);
  
  // ✅ STEP 1: Check linking.json FIRST (primary source of truth)
  const linkedMC = getMCFromDiscord(discordId);
  
  if (!linkedMC) {
    console.log(`[getMemberByDiscordId] No link found in linking.json for ${discordId}`);
    return null;
  }
  
  console.log(`[getMemberByDiscordId] Found link in linking.json: ${discordId} -> ${linkedMC}`);
  
  // ✅ STEP 2: Try to get extended data from members.json
  const members = readMembers();
  let extendedData = null;
  
  // First try direct Discord ID match
  if (members[discordId]) {
    console.log(`[getMemberByDiscordId] Found extended data by Discord ID in members.json`);
    extendedData = members[discordId];
  } else {
    // Try matching by MC username
    const mcMatch = getMemberByMinecraftNameInsensitive(linkedMC);
    if (mcMatch) {
      console.log(`[getMemberByDiscordId] Found extended data by MC username in members.json`);
      extendedData = mcMatch;
    }
  }
  
  // ✅ STEP 3: Build final member data
  if (extendedData) {
    // Has extended empire data
    console.log(`[getMemberByDiscordId] Returning full member data with extended info`);
    return {
      member: {
        discordId,
        minecraftUser: linkedMC, // Always use linking.json username
        minecraftVersion: extendedData.minecraftVersion || "n/d",
        JoinedClan: extendedData.JoinedClan || "n/d",
        JoinDate: extendedData.JoinDate || "n/d",
        YazanakiRank: extendedData.YazanakiRank || "n/d",
        EmpireID: extendedData.EmpireID || "n/d",
        Status: extendedData.Status || "n/d"
      }
    };
  } else {
    // Linked but no extended data yet
    console.log(`[getMemberByDiscordId] Linked but no extended data, returning basic structure`);
    return {
      member: {
        discordId,
        minecraftUser: linkedMC, // From linking.json
        minecraftVersion: "n/d",
        JoinedClan: "n/d", 
        JoinDate: "n/d",
        YazanakiRank: "n/d",
        EmpireID: "n/d",
        Status: "n/d"
      }
    };
  }
}

/**
 * Higher-level resolver that uses linking.json as primary source
 */
function getMemberByDiscordOrMC(discordId = null, mcUser = null) {
  if (discordId) {
    const result = getMemberByDiscordId(discordId);
    if (result && result.member) {
      return { member: result.member, discordId };
    }
  }
  
  if (mcUser) {
    // Try to find discord ID from linking.json first
    const linkedDiscordId = getDiscordFromMC(mcUser);
    
    if (linkedDiscordId) {
      // Found link, get full data via Discord ID
      const result = getMemberByDiscordId(linkedDiscordId);
      if (result && result.member) {
        return result;
      }
    }
    
    // No link found, try direct MC lookup in members.json
    const mcMatch = getMemberByMinecraftNameInsensitive(mcUser);
    if (mcMatch) {
      return mcMatch;
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

    const stored = getMemberByDiscordOrMC(discordUserOption.id, null);
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
    const byMC = getMemberByDiscordOrMC(null, mcOption);

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

    const stored = getMemberByDiscordOrMC(invokingUser.id, null);
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

  // Always output Mojang-correct username
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
  isUnlinked
};