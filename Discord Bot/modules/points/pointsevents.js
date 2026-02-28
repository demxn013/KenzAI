// modules/points/pointsevents.js
// Message and voice point awards (only for Yazanaki members in allowed channels)

const cache = require("../data/cache");
const { addPoints, isMember } = require("./pointslogic");
const {
  YAZANAKI_GUILD_ID,
  POINTS_MESSAGE_CHANNEL_IDS,
  DAILY_MESSAGE_CAP,
  POINTS_PER_MESSAGE,
  VOICE_POINTS_PER_10_MIN,
  DAILY_VOICE_CAP,
} = require("./pointsconfig");

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

  const newCount = count + 1;
  cache.set(key, newCount);
  addPoints(message.author.id, POINTS_PER_MESSAGE, "message");
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
          addPoints(userId, add, "voice");
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

function setupPointsEvents(client) {
  client.on("messageCreate", handleMessageCreate);
  client.on("voiceStateUpdate", handleVoiceStateUpdate);
}

module.exports = { setupPointsEvents, handleMessageCreate, handleVoiceStateUpdate };
