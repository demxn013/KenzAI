// modules/servers/server.js
// /server command + button handler for DonutSMP (and future servers)

const path = require("path");
const fs = require("fs");
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const clanlogic = require("../clantracking/clanlogic");
const { readMembers } = require("../membertracking/memberlogic");
const { getPlayerStats, getPlayerLookup, getLeaderboard } = require("./donutsmp");
const {
  createServerListEmbed,
  createDonutSMPTeamEmbed,
  createDonutSMPPlayerEmbed,
  createDonutSMPClanSelectEmbed,
  num
} = require("./serverembed");

const serversPath = path.join(__dirname, "../data/servers.json");

function readServers() {
  try {
    if (!fs.existsSync(serversPath)) return {};
    const raw = fs.readFileSync(serversPath, "utf8");
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error("[servers] Error reading servers.json:", err);
    return {};
  }
}

function getEnabledServers() {
  const all = readServers();
  return Object.entries(all)
    .filter(([, s]) => s && s.enabled !== false)
    .map(([id, s]) => ({ id, ...s }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("List official servers Yazanaki is in and view in-game clans/teams"),

  async execute(interaction) {
    const servers = getEnabledServers();
    const embed = createServerListEmbed(servers);
    const rows = [];
    const row = new ActionRowBuilder();
    for (const s of servers.slice(0, 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`server_${s.id}`)
          .setLabel(s.name)
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (row.components.length) rows.push(row);
    await interaction.reply({
      embeds: [embed],
      components: rows.length ? rows : [],
      ephemeral: false
    });
  },

  async buttonHandler(interaction) {
    const id = interaction.customId;

    // server_donutsmp -> show clans with DonutSMP team, buttons per clan
    if (id === "server_donutsmp") {
      await interaction.deferUpdate();
      const clans = clanlogic.readClans();
      const withTeam = Object.entries(clans)
        .filter(([, c]) => c.donutsmpTeamName)
        .map(([guildId, c]) => ({ guildId, abbr: c.abbr, name: c.name }));
      const embed = createDonutSMPClanSelectEmbed(withTeam);
      const row = new ActionRowBuilder();
      for (const { guildId, abbr } of withTeam.slice(0, 5)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`server_donutsmp_clan_${guildId}`)
            .setLabel(abbr)
            .setStyle(ButtonStyle.Secondary)
        );
      }
      await interaction.editReply({
        embeds: [embed],
        components: row.components.length ? [row] : []
      });
      return;
    }

    // server_donutsmp_clan_<guildId> -> same as clan_server_donutsmp_<guildId>
    if (id.startsWith("server_donutsmp_clan_")) {
      const guildId = id.slice("server_donutsmp_clan_".length);
      await handleClanDonutSMP(interaction, guildId);
      return;
    }

    // clan_server_donutsmp_<guildId>
    if (id.startsWith("clan_server_donutsmp_")) {
      const guildId = id.slice("clan_server_donutsmp_".length);
      await handleClanDonutSMP(interaction, guildId);
      return;
    }

    // member_server_donutsmp_<mcUsername>
    if (id.startsWith("member_server_donutsmp_")) {
      const mcUsername = id.slice("member_server_donutsmp_".length);
      await handleMemberDonutSMP(interaction, mcUsername);
      return;
    }

    await interaction.reply({ content: "Unknown server button.", ephemeral: true }).catch(() => {});
  }
};

async function handleClanDonutSMP(interaction, guildId) {
  await interaction.deferReply();
  const clans = clanlogic.readClans();
  const clan = clans[guildId];
  if (!clan || !clan.donutsmpTeamName) {
    return interaction.editReply({
      content: "Clan not found or has no DonutSMP team linked.",
      ephemeral: true
    });
  }
  const members = readMembers();
  const clanMemberMCs = [];
  for (const [discordId, m] of Object.entries(members)) {
    if (!m.JoinedClan) continue;
    if (m.JoinedClan === clan.name || m.JoinedClan === clan.abbr) {
      const mc = m.minecraftUser || m.minecraftName;
      if (mc) clanMemberMCs.push(mc.trim());
    }
  }

  const summed = {
    kills: 0,
    deaths: 0,
    money: 0,
    playtime: "0",
    shards: 0,
    mobs_killed: 0,
    broken_blocks: 0,
    placed_blocks: 0
  };
  const playtimeMinutes = { total: 0 };
  for (const mc of clanMemberMCs) {
    const res = await getPlayerStats(mc);
    if (!res.ok || !res.stats) continue;
    const s = res.stats;
    summed.kills += num(s.kills);
    summed.deaths += num(s.deaths);
    summed.money += num(s.money);
    summed.mobs_killed += num(s.mobs_killed);
    summed.broken_blocks += num(s.broken_blocks);
    summed.placed_blocks += num(s.placed_blocks);
    summed.shards += num(s.shards);
    const pt = String(s.playtime || "0");
    const match = pt.match(/(\d+)\s*min/i) || pt.match(/(\d+)/);
    if (match) playtimeMinutes.total += parseInt(match[1], 10);
  }
  summed.playtime = `${playtimeMinutes.total} min`;
  const lbRes = await getLeaderboard("kills", 1);
  const highlights = [];
  if (lbRes.ok && Array.isArray(lbRes.result)) {
    const mcSet = new Set(clanMemberMCs.map((u) => u.toLowerCase()));
    lbRes.result.forEach((entry, idx) => {
      if (entry.username && mcSet.has(entry.username.toLowerCase())) {
        highlights.push({
          username: entry.username,
          value: entry.value || "—",
          rank: idx + 1
        });
      }
    });
  }
  const embed = createDonutSMPTeamEmbed(clan.abbr, clan.name, summed, highlights);
  await interaction.editReply({ embeds: [embed] });
}

async function handleMemberDonutSMP(interaction, mcUsername) {
  await interaction.deferReply();
  const [statsRes, lookupRes] = await Promise.all([
    getPlayerStats(mcUsername),
    getPlayerLookup(mcUsername)
  ]);
  if (!statsRes.ok && !lookupRes.ok) {
    const msg = statsRes.message || lookupRes.message || "No DonutSMP data for this player.";
    return interaction.editReply({
      content: `DonutSMP: ${msg}`,
      ephemeral: true
    });
  }
  const stats = statsRes.ok ? statsRes.stats : {};
  const lookup = lookupRes.ok ? lookupRes.lookup : null;
  const embed = createDonutSMPPlayerEmbed(mcUsername, stats, lookup);
  await interaction.editReply({ embeds: [embed] });
}
