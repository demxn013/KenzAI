const mysqlPool = require("../mysqlPool");

async function appendEvent({
  discordId,
  eventType,
  payload,
  actorDiscordId,
}) {
  const pool = mysqlPool.getPool();
  if (!pool) return;

  const payloadVal =
    payload === undefined || payload === null
      ? null
      : typeof payload === "string"
        ? payload
        : JSON.stringify(payload);

  await pool.execute(
    `INSERT INTO member_events (discord_id, event_type, payload_json, actor_discord_id)
     VALUES (?, ?, ?, ?)`,
    [
      discordId ? String(discordId) : null,
      String(eventType),
      payloadVal,
      actorDiscordId ? String(actorDiscordId) : null,
    ]
  );
}

module.exports = {
  appendEvent,
};
