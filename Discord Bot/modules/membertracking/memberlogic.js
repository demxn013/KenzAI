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
// FIXED VERSION — Case-insensitive lookup but data remains proper
// --------------------------------------------------------------
function normalizeUsername(u) {
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
 * ----------------------------------------------------------
 * PATCH: Compatibility alias for member.js
 * ----------------------------------------------------------
 * /member expects "getMemberByMinecraftUser" to exist.
 * We provide a wrapper that returns the expected structure.
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

// Higher-level resolver
function getMemberByDiscordOrMC(discordId = null, mcUser = null) {
  if (discordId) {
    const m = getMemberByDiscordId(discordId);
    if (m) return { discordId, ...m };
  }
  if (mcUser) {
    return getMemberByMinecraftNameInsensitive(mcUser);
  }
  return null;
}

function getMemberByDiscordId(discordId) {
  const members = readMembers();
  return members[discordId] || null;
}

// ----------- IMAGE / COLOR FUNCTIONS (unchanged) -----------
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

// ----------- MAIN RESOLUTION LOGIC (patched only at the end) -----------
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
    if (stored) {
      memberData = stored;
      mcUsername = stored.minecraftUser || "n/d";
    } else {
      const linkedMC = getMCFromDiscord(discordUserOption.id);
      if (linkedMC) {
        mcUsername = linkedMC;
        const storedByMC = getMemberByDiscordOrMC(null, linkedMC);
        memberData =
          storedByMC || { minecraftUser: linkedMC, minecraftVersion: "``n/d``" };
      }
    }
  } else if (mcOption) {
    const byMC = getMemberByDiscordOrMC(null, mcOption);

    if (byMC) {
      memberData = byMC;
      discordUser = await client.users.fetch(byMC.discordId).catch(() => null);
      mcUsername = byMC.minecraftUser || mcOption;
    } else {
      const linkedDiscordId = getDiscordFromMC(mcOption);

      if (linkedDiscordId) {
        discordUser = await client.users.fetch(linkedDiscordId).catch(() => null);
        mcUsername = mcOption;

        const storedByMC = getMemberByDiscordOrMC(linkedDiscordId, mcOption);
        memberData =
          storedByMC || { minecraftUser: mcOption, minecraftVersion: "``n/d``" };
      } else {
        mcUsername = await getProperMinecraftName(mcOption);
      }
    }
  } else {
    discordUser = invokingUser;

    const stored = getMemberByDiscordOrMC(invokingUser.id, null);
    if (stored) {
      memberData = stored;
      mcUsername = stored.minecraftUser || "n/d";
    } else {
      const linkedMC = getMCFromDiscord(invokingUser.id);
      if (linkedMC) {
        mcUsername = linkedMC;
        const storedByMC = getMemberByDiscordOrMC(null, linkedMC);
        memberData =
          storedByMC || { minecraftUser: linkedMC, minecraftVersion: "``n/d``" };
      }
    }
  }

  // -------------------------------
  // ✅ PATCH: Always output Mojang-correct username
  // -------------------------------
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
  const m = getMemberByDiscordId(discordId);
  if (m) return false;

  const linkedMC = getMCFromDiscord(discordId);
  return !linkedMC;
}

module.exports = {
  readMembers,
  writeMembers,
  getMemberByDiscordId,
  getMemberByMinecraftNameInsensitive,

  // 🔥 Patched compatibility exports
  getMemberByMinecraftUser,
  getMemberByDiscordOrMC,

  fetchImageBuffer,
  getProperMinecraftName,
  getDominantColor,

  resolveCommandTarget,
  isUnlinked
};
