// modules/discord/statistics/stats.js — /stats
const { SlashCommandBuilder } = require("discord.js");
const statsStore = require("./statsStore");
const levelStore = require("../levels/levelStore");
const inviteStore = require("../invites/inviteStore");
const { getGuildSettings } = require("../settings/settingsStore");
const { makeEmbed } = require("../common/embeds");

function fmtSeconds(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Server and member activity statistics")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("server").setDescription("Server-wide activity statistics"))
    .addSubcommand((s) =>
      s.setName("member").setDescription("A member's activity summary").addUserOption((o) => o.setName("user").setDescription("Member (default: you)"))
    ),

  async execute(interaction) {
    if (!getGuildSettings(interaction.guildId).statistics.enabled)
      return interaction.reply({ content: "Statistics are disabled. An admin can enable them with `/discord-config logging enabled:true`.", ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "server") {
      const rec = statsStore.get(guildId);
      const today = statsStore.get(guildId).daily[new Date().toISOString().slice(0, 10)] || {};
      return interaction.reply({
        embeds: [
          makeEmbed({
            color: "brand",
            title: `📊 ${interaction.guild.name} — statistics`,
            fields: [
              { name: "Members", value: String(interaction.guild.memberCount), inline: true },
              { name: "Net growth", value: `${(rec.joins || 0) - (rec.leaves || 0) >= 0 ? "+" : ""}${(rec.joins || 0) - (rec.leaves || 0)}`, inline: true },
              { name: "​", value: "​", inline: true },
              { name: "Total joins", value: String(rec.joins || 0), inline: true },
              { name: "Total leaves", value: String(rec.leaves || 0), inline: true },
              { name: "​", value: "​", inline: true },
              { name: "Messages (total)", value: String(rec.messages || 0), inline: true },
              { name: "Messages (7d)", value: String(statsStore.rangeSum(guildId, "messages", 7)), inline: true },
              { name: "Messages (today)", value: String(today.messages || 0), inline: true },
              { name: "Voice (total)", value: fmtSeconds(rec.voiceSeconds || 0), inline: true },
              { name: "Voice (7d)", value: fmtSeconds(statsStore.rangeSum(guildId, "voiceSeconds", 7)), inline: true },
              { name: "Voice (today)", value: fmtSeconds(today.voiceSeconds || 0), inline: true },
            ],
            footer: "Counters started when statistics were enabled",
            timestamp: true,
          }),
        ],
      });
    }

    if (sub === "member") {
      const user = interaction.options.getUser("user") || interaction.user;
      const lvl = levelStore.get(guildId, user.id);
      const info = levelStore.levelFromXp(lvl.xp);
      const inv = inviteStore.get(guildId, user.id);
      return interaction.reply({
        embeds: [
          makeEmbed({
            color: "brand",
            title: `📊 ${user.username} — activity`,
            thumbnail: user.displayAvatarURL(),
            fields: [
              { name: "Level", value: `${info.level} (${lvl.xp} XP)`, inline: true },
              { name: "Messages", value: String(lvl.messages || 0), inline: true },
              { name: "Voice", value: fmtSeconds(lvl.voiceSeconds || 0), inline: true },
              { name: "Invites", value: String(inviteStore.net(inv)), inline: true },
            ],
          }),
        ],
      });
    }
  },
};
