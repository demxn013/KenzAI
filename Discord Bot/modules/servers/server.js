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
    console.error("[/server] ❌ Error reading servers.json:", err);
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
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/server] 🎯 Command invoked by: ${interaction.user.tag} (${interaction.user.id})`);
    const servers = getEnabledServers();
    console.log(
      "[/server] 📋 Enabled servers:",
      servers.length ? servers.map(s => s.id).join(", ") : "none"
    );
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
    console.log(`[/server] 📤 Sending server list embed with ${row.components.length} button(s)`);
    await interaction.reply({
      embeds: [embed],
      components: rows.length ? rows : [],
      ephemeral: false
    });
    console.log("[/server] ✅ Reply sent");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },

  async buttonHandler(interaction) {
    const id = interaction.customId;
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `[/server buttons] 🔘 Button clicked: ${id} by ${interaction.user.tag} (${interaction.user.id})`
    );

    try {
      // server_donutsmp -> show clans with DonutSMP team, buttons per clan
      if (id === "server_donutsmp") {
        console.log("[/server buttons] 🌐 Server: DonutSMP selected");
        await interaction.deferUpdate();
        const clans = clanlogic.readClans();
        const withTeam = Object.entries(clans)
          .filter(([, c]) => c.donutsmpTeamName)
          .map(([guildId, c]) => ({ guildId, abbr: c.abbr, name: c.name }));
        console.log(
          "[/server buttons] 🏰 Clans with DonutSMP team:",
          withTeam.length ? withTeam.map(c => `${c.abbr}(${c.guildId})`).join(", ") : "none"
        );
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
        console.log(`[/server buttons] 📤 Sending DonutSMP clan select embed with ${row.components.length} clan button(s)`);
        await interaction.editReply({
          embeds: [embed],
          components: row.components.length ? [row] : []
        });
        console.log("[/server buttons] ✅ Message updated");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return;
      }

      // server_donutsmp_clan_<guildId> -> same as clan_server_donutsmp_<guildId>
      if (id.startsWith("server_donutsmp_clan_")) {
        const guildId = id.slice("server_donutsmp_clan_".length);
        console.log(`[/server buttons] 🏰 DonutSMP team via /server for guild: ${guildId}`);
        await handleClanDonutSMP(interaction, guildId);
        return;
      }

      // clan_server_donutsmp_<guildId>
      if (id.startsWith("clan_server_donutsmp_")) {
        const guildId = id.slice("clan_server_donutsmp_".length);
        console.log(`[/server buttons] 🏰 DonutSMP team via /clan view for guild: ${guildId}`);
        await handleClanDonutSMP(interaction, guildId);
        return;
      }

      // member_server_donutsmp_<mcUsername>
      if (id.startsWith("member_server_donutsmp_")) {
        const mcUsername = id.slice("member_server_donutsmp_".length);
        console.log(`[/server buttons] 🎮 DonutSMP stats via /member view for: ${mcUsername}`);
        await handleMemberDonutSMP(interaction, mcUsername);
        return;
      }

      console.warn("[/server buttons] ⚠️ Unknown server button id:", id);
      await interaction.reply({ content: "Unknown server button.", ephemeral: true }).catch(() => {});
    } catch (err) {
      console.error(`[/server buttons] ❌ Error handling button ${id}:`, err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "❌ An error occurred handling this server button.",
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: "❌ An error occurred handling this server button.",
            ephemeral: true
          });
        }
      } catch {
        // ignore follow-up errors
      }
    }
  }
};

async function handleClanDonutSMP(interaction, guildId) {
  console.log(`[/server buttons] 📥 handleClanDonutSMP: guildId=${guildId}`);
  await interaction.deferReply();
  const clans = clanlogic.readClans();
  const clan = clans[guildId];
  if (!clan || !clan.donutsmpTeamName) {
    console.log("[/server buttons] ❌ Clan not found or no DonutSMP team linked");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return interaction.editReply({
      content: "Clan not found or has no DonutSMP team linked.",
      ephemeral: true
    });
  }
  console.log(`[/server buttons] 🏰 Clan: ${clan.abbr} - ${clan.name}, DonutSMP team: ${clan.donutsmpTeamName}`);
  const members = readMembers();
  const clanMemberMCs = [];
  for (const [discordId, m] of Object.entries(members)) {
    if (!m.JoinedClan) continue;
    if (m.JoinedClan === clan.name || m.JoinedClan === clan.abbr) {
      const mc = m.minecraftUser || m.minecraftName;
      if (mc) clanMemberMCs.push(mc.trim());
    }
  }
  console.log(`[/server buttons] 👥 Clan members with MC: ${clanMemberMCs.length} (${clanMemberMCs.join(", ") || "none"})`);

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
  console.log(`[/server buttons] 🌐 Fetching DonutSMP stats for ${clanMemberMCs.length} member(s)...`);
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
  console.log(`[/server buttons] 📊 Summed stats: kills=${summed.kills}, deaths=${summed.deaths}, money=${summed.money}, playtime=${summed.playtime}, shards=${summed.shards}`);
  console.log("[/server buttons] 🌐 Fetching DonutSMP kills leaderboard (page 1)...");
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
  console.log(`[/server buttons] 📋 Leaderboard highlights: ${highlights.length} clan member(s) in top page`);
  const embed = createDonutSMPTeamEmbed(clan.abbr, clan.name, summed, highlights);
  console.log(`[/server buttons] 📤 Sending DonutSMP team stats embed for ${clan.abbr}`);
  await interaction.editReply({ embeds: [embed] });
  console.log("[/server buttons] ✅ Team stats embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

async function handleMemberDonutSMP(interaction, mcUsername) {
  console.log(`[/server buttons] 📥 handleMemberDonutSMP: MC username=${mcUsername}`);
  await interaction.deferReply();
  console.log("[/server buttons] 🌐 Fetching DonutSMP stats + lookup for", mcUsername);
  const [statsRes, lookupRes] = await Promise.all([
    getPlayerStats(mcUsername),
    getPlayerLookup(mcUsername)
  ]);
  if (!statsRes.ok && !lookupRes.ok) {
    const msg = statsRes.message || lookupRes.message || "No DonutSMP data for this player.";
    console.log(`[/server buttons] ❌ No DonutSMP data for ${mcUsername}: ${msg}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return interaction.editReply({
      content: `DonutSMP: ${msg}`,
      ephemeral: true
    });
  }
  const stats = statsRes.ok ? statsRes.stats : {};
  const lookup = lookupRes.ok ? lookupRes.lookup : null;
  console.log(`[/server buttons] 📊 Stats: ${statsRes.ok ? "ok" : "missing"}, Lookup: ${lookupRes.ok ? "ok" : "missing"}`);
  const embed = createDonutSMPPlayerEmbed(mcUsername, stats, lookup);
  console.log(`[/server buttons] 📤 Sending DonutSMP player stats embed for ${mcUsername}`);
  await interaction.editReply({ embeds: [embed] });
  console.log("[/server buttons] ✅ Player stats embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}
