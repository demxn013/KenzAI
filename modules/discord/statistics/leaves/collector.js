// modules/discord/statistics/leaves/collector.js
// Counts member leaves and posts a leave log.
const statsStore = require("../statsStore");
const { getGuildSettings } = require("../../settings/settingsStore");
const { makeEmbed } = require("../../common/embeds");

async function handleLeave(member) {
  try {
    const stats = getGuildSettings(member.guild.id).statistics;
    if (!stats.enabled) return;
    statsStore.recordLeave(member.guild.id);

    const chId = stats.logs.joinLeaveChannelId;
    if (!chId) return;
    const ch = member.guild.channels.cache.get(chId);
    if (!ch?.isTextBased()) return;

    const roles = member.roles?.cache
      ? [...member.roles.cache.filter((r) => r.id !== member.guild.id).values()].map((r) => `<@&${r.id}>`).slice(0, 10).join(" ")
      : "";
    await ch
      .send({
        embeds: [
          makeEmbed({
            color: "danger",
            description: `📤 **${member.user.tag}** left.`,
            fields: [
              { name: "Member #", value: String(member.guild.memberCount), inline: true },
              ...(roles ? [{ name: "Roles", value: roles, inline: false }] : []),
            ],
            footer: `ID: ${member.id}`,
            timestamp: true,
          }),
        ],
      })
      .catch(() => {});
  } catch (err) {
    console.error("[discord/stats] ❌ leave:", err.message);
  }
}

module.exports = { handleLeave };
