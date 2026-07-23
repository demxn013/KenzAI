// modules/discord/giveaways/giveawaylogic.js
// Giveaway rendering, entry requirements, winner selection, and end/reroll.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const store = require("./giveawayStore");
const levelStore = require("../levels/levelStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { EMBED_COLORS } = require("../discordconfig");

function emoji(guildId) {
  return getGuildSettings(guildId).giveaways.emoji || "🎉";
}

const ts = (v) => Math.floor(new Date(v).getTime() / 1000);
const { formatDuration } = require("../common/util");

function buildEmbed(record) {
  const e = emoji(record.guildId);
  const status = record.status || "active";
  const reqs = [];
  if (record.requiredRoleId) reqs.push(`Role: <@&${record.requiredRoleId}>`);
  if (record.requiredLevel) reqs.push(`Level: **${record.requiredLevel}+**`);

  const stampSource = record.endsAt || record.startsAt || Date.now();
  const embed = new EmbedBuilder()
    .setColor(status === "active" ? EMBED_COLORS.brand : EMBED_COLORS.neutral)
    .setTitle(`${e} ${record.prize} ${e}`)
    .setFooter({ text: `${record.winnerCount} winner${record.winnerCount > 1 ? "s" : ""} • ${record.entries.length} entries` })
    .setTimestamp(new Date(stampSource));

  const lines = [];
  if (status === "scheduled") {
    lines.push(`⏳ This giveaway hasn't started yet.`);
    if (record.startsAt) lines.push(`Starts: <t:${ts(record.startsAt)}:R>`);
    if (record.durationMs) lines.push(`Will run for **${formatDuration(record.durationMs)}**`);
  } else if (status === "active") {
    lines.push(`Click the button below to enter!`);
    lines.push(`Ends: <t:${ts(record.endsAt)}:R>`);
  } else {
    lines.push(
      record.winnerIds && record.winnerIds.length
        ? `Winner${record.winnerIds.length > 1 ? "s" : ""}: ${record.winnerIds.map((id) => `<@${id}>`).join(", ")}`
        : "Ended — no valid entries."
    );
    lines.push(`Ended: <t:${ts(record.endedAt || record.endsAt || Date.now())}:R>`);
  }
  lines.push(`Hosted by: <@${record.hostId}>`);
  if (reqs.length) lines.push(`\n**Requirements**\n${reqs.join("\n")}`);
  embed.setDescription(lines.join("\n"));
  return embed;
}

function buildRow(messageId, { disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dgw_enter_${messageId}`)
      .setLabel("Enter")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );
}

/** @returns {{ok: boolean, reason?: string}} */
function meetsRequirements(member, record) {
  if (record.requiredRoleId && !member.roles.cache.has(record.requiredRoleId))
    return { ok: false, reason: `You need the <@&${record.requiredRoleId}> role to enter.` };
  if (record.requiredLevel) {
    const lvl = levelStore.get(record.guildId, member.id).level;
    if (lvl < record.requiredLevel)
      return { ok: false, reason: `You need to be level **${record.requiredLevel}+** to enter (you're level ${lvl}).` };
  }
  return { ok: true };
}

/** Pick up to `count` unique winners from current entries who are still valid. */
async function pickWinners(guild, record, count, exclude = []) {
  const pool = [];
  for (const userId of record.entries) {
    if (exclude.includes(userId)) continue;
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    if (!member) continue;
    if (!meetsRequirements(member, record).ok) continue;
    pool.push(userId);
  }
  // Fisher–Yates shuffle, then take `count`.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

async function fetchMessage(client, record) {
  const guild = client.guilds.cache.get(record.guildId);
  if (!guild) return { guild: null };
  const channel = guild.channels.cache.get(record.channelId) || (await guild.channels.fetch(record.channelId).catch(() => null));
  if (!channel?.isTextBased()) return { guild, channel: null };
  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  return { guild, channel, message };
}

/** Activate a scheduled giveaway: flip to active, set endsAt, enable entry. */
async function activateGiveaway(client, record) {
  const { guild, channel, message } = await fetchMessage(client, record);
  if (!guild) {
    store.remove(record.messageId);
    return { ok: false };
  }
  record.status = "active";
  record.endsAt = new Date(Date.now() + (record.durationMs || 0)).toISOString();
  store.save(record);

  if (message) {
    await message.edit({ embeds: [buildEmbed(record)], components: [buildRow(record.messageId)] }).catch(() => {});
  }
  if (channel) {
    await channel.send({ content: `${emoji(record.guildId)} The giveaway for **${record.prize}** has started — good luck!` }).catch(() => {});
  }
  return { ok: true };
}

/** End a giveaway: pick winners, update the message, announce. */
async function endGiveaway(client, record) {
  const { guild, channel, message } = await fetchMessage(client, record);
  if (!guild) {
    store.remove(record.messageId);
    return { ok: false };
  }

  const winners = await pickWinners(guild, record, record.winnerCount);
  record.status = "ended";
  record.endedAt = new Date().toISOString();
  record.winnerIds = winners;
  store.save(record);

  if (message) {
    await message.edit({ embeds: [buildEmbed(record)], components: [buildRow(record.messageId, { disabled: true })] }).catch(() => {});
  }
  if (channel) {
    const e = emoji(record.guildId);
    const text = winners.length
      ? `${e} Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}! You won **${record.prize}**!`
      : `${e} The giveaway for **${record.prize}** ended with no valid entries.`;
    await channel.send({ content: text, allowedMentions: { users: winners } }).catch(() => {});
  }
  return { ok: true, winners };
}

/** Reroll: pick new winners (excluding the previous ones) and announce. */
async function rerollGiveaway(client, record, count) {
  const { guild, channel } = await fetchMessage(client, record);
  if (!guild) return { ok: false, reason: "Guild not found." };
  const winners = await pickWinners(guild, record, count || record.winnerCount, record.winnerIds || []);
  if (!winners.length) return { ok: false, reason: "No eligible entries to reroll." };
  record.winnerIds = [...(record.winnerIds || []), ...winners];
  store.save(record);
  if (channel) {
    const e = emoji(record.guildId);
    await channel
      .send({ content: `${e} Reroll! New winner${winners.length > 1 ? "s" : ""}: ${winners.map((id) => `<@${id}>`).join(", ")} — **${record.prize}**!`, allowedMentions: { users: winners } })
      .catch(() => {});
  }
  return { ok: true, winners };
}

module.exports = {
  buildEmbed,
  buildRow,
  meetsRequirements,
  pickWinners,
  activateGiveaway,
  endGiveaway,
  rerollGiveaway,
  emoji,
};
