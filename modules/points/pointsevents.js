// modules/points/pointsevents.js
// Message and voice point awards (only for Yazanaki members in allowed channels)
// All awarded points are now categorized.
// Invite tracking: tracks ALL invites (not just /points invite links) using the Discord invite.inviter field.

const cache = require("../data/cache");
const { readMembers, writeMembers, addPoints, isMember } = require("./pointslogic");
const {
  YAZANAKI_GUILD_ID,
  POINTS_MESSAGE_CHANNEL_IDS,
  DAILY_MESSAGE_CAP,
  POINTS_PER_MESSAGE,
  VOICE_POINTS_PER_10_MIN,
  DAILY_VOICE_CAP,
  POINTS_PER_INVITE,
} = require("./pointsconfig");
const { readClans } = require("../clantracking/clanlogic");

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function handleMessageCreate(message) {
  if (message.author.bot) return;
  if (message.guild?.id !== YAZANAKI_GUILD_ID) return;
  if (POINTS_MESSAGE_CHANNEL_IDS.length > 0 && !POINTS_MESSAGE_CHANNEL_IDS.includes(message.channel.id)) return;
  if (!isMember(message.author.id)) return;

  const key = `points_msg_${message.guild.id}_${message.author.id}_${todayKey()}`;
  const current = cache.get(key);
  const count = typeof current === "number" ? current : 0;
  if (count >= DAILY_MESSAGE_CAP) return;

  cache.set(key, count + 1);
  // Message activity → activity category
  addPoints(message.author.id, POINTS_PER_MESSAGE, "message", "activity");
}

function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.member?.user?.id || oldState.member?.user?.id;
  if (!userId || newState.guild.id !== YAZANAKI_GUILD_ID) return;
  if (!isMember(userId)) return;

  const joinKey = `points_voice_join_${userId}`;
  const dailyKey = `points_voice_${userId}_${todayKey()}`;

  const wasIn = oldState.channelId != null;
  const isIn = newState.channelId != null;

  if (wasIn && !isIn) {
    const joinData = cache.get(joinKey);
    if (joinData && typeof joinData === "number") {
      const durationMs = Date.now() - joinData;
      const durationMinutes = Math.floor(durationMs / (60 * 1000));
      const pointsToAdd = Math.floor(durationMinutes / 10) * VOICE_POINTS_PER_10_MIN;
      if (pointsToAdd > 0) {
        const dailyData = cache.get(dailyKey) || { total: 0 };
        const remaining = Math.max(0, DAILY_VOICE_CAP - dailyData.total);
        const add = Math.min(pointsToAdd, remaining);
        if (add > 0) {
          // Voice activity → activity category
          addPoints(userId, add, "voice", "activity");
          dailyData.total = (dailyData.total || 0) + add;
          cache.set(dailyKey, dailyData);
        }
      }
    }
    cache.delete(joinKey);
  } else if (!wasIn && isIn) {
    cache.set(joinKey, Date.now());
  }
}

function isInviteGuild(guildId) {
  if (!guildId) return false;
  if (guildId === YAZANAKI_GUILD_ID) return true;
  try {
    const clans = readClans();
    return !!clans[guildId];
  } catch {
    return false;
  }
}

/**
 * Get the clan abbreviation for a guild (used to build the invite count key).
 * Returns the abbreviation (e.g. "ONF") or null if not a registered clan.
 */
function getClanAbbrevForGuild(guildId) {
  if (guildId === YAZANAKI_GUILD_ID) return "YZNK";
  try {
    const clans = readClans();
    return clans[guildId]?.abbr || null;
  } catch {
    return null;
  }
}

async function handleGuildMemberAdd(member) {
  const guild = member.guild;
  if (!guild || !isInviteGuild(guild.id)) return;

  let invites;
  try {
    invites = await guild.invites.fetch();
  } catch {
    return;
  }

  // Find which invite was used by comparing current uses vs cached uses
  let usedInvite = null;

  for (const invite of invites.values()) {
    const key = `points_invite_uses_${guild.id}_${invite.code}`;
    const prev = cache.get(key);
    const prevUses = typeof prev === "number" ? prev : 0;
    const currentUses = invite.uses || 0;
    if (!usedInvite && currentUses > prevUses) {
      usedInvite = invite;
    }
    cache.set(key, currentUses);
  }

  if (!usedInvite) return;

  // ✅ Use the invite's inviter field directly — works for ALL invites, not just /points invite ones
  const inviterId = usedInvite.inviter?.id;
  if (!inviterId) return;

  // Record invite attribution for the military squadron system so a recruit can
  // later be auto-sorted under whoever invited them. Best-effort; a clan-guild
  // attribution takes precedence over an Empire-guild one (handled downstream).
  try {
    require("../yazanaki/squadronlogic").recordInvite(member.id, {
      inviterId,
      guildId: guild.id,
      clanAbbr: getClanAbbrevForGuild(guild.id),
    });
  } catch (err) {
    console.warn("[pointsevents] ⚠️ squadron recordInvite failed:", err.message);
  }

  if (!isMember(inviterId)) return;

  const clanAbbrev = getClanAbbrevForGuild(guild.id);
  if (!clanAbbrev) return;

  const members = readMembers();
  const memberEntry = members[inviterId];
  if (!memberEntry) return;

  // Increment the invite count for this clan
  const countKey = `${clanAbbrev}InviteCount`;
  const currentCount = typeof memberEntry[countKey] === "number" ? memberEntry[countKey] : 0;
  memberEntry[countKey] = currentCount + 1;
  writeMembers(members);

  console.log(`[pointsevents] 📨 Invite credited to ${inviterId} in ${clanAbbrev} (total: ${memberEntry[countKey]})`);

  // Invite → contribution category
  addPoints(inviterId, POINTS_PER_INVITE, "invite", "contribution");
}

async function primeInviteCache(client) {
  const guildIds = new Set();
  guildIds.add(YAZANAKI_GUILD_ID);
  try {
    const clans = readClans();
    for (const gid of Object.keys(clans)) {
      guildIds.add(gid);
    }
  } catch {
    // ignore
  }

  for (const guildId of guildIds) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    try {
      const invites = await guild.invites.fetch();
      for (const invite of invites.values()) {
        const key = `points_invite_uses_${guild.id}_${invite.code}`;
        cache.set(key, invite.uses || 0);
      }
    } catch {
      // ignore per-guild failures
    }
  }
}

function setupPointsEvents(client) {
  client.on("messageCreate", handleMessageCreate);
  client.on("voiceStateUpdate", handleVoiceStateUpdate);
  client.on("guildMemberAdd", handleGuildMemberAdd);
  client.once("ready", () => {
    primeInviteCache(client).catch(() => {});
  });
}

module.exports = { setupPointsEvents, handleMessageCreate, handleVoiceStateUpdate, handleGuildMemberAdd };