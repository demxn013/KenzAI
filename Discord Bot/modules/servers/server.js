// modules/servers/server.js
// /server command + button handler for DonutSMP (and future servers)

const path = require("path");
const fs = require("fs");
const Jimp = require("jimp");
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const clanlogic = require("../clantracking/clanlogic");
const { readMembers } = require("../membertracking/memberlogic");
const donutsmp = require("./donutsmp");
const {
  createServerListEmbed,
  createTeamEmbed,
  createPlayerEmbed,
  createClanSelectEmbed,
  num,
  parsePlaytimeToMinutes
} = require("./serverembed");

const serversPath = path.join(__dirname, "../data/servers.json");
const serverLogosDir = path.join(__dirname, "../images/serverlogos");

const BUTTON_TIMEOUT_MS = 10 * 60 * 1000;

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
    .filter(([key, s]) => key !== "statEmojis" && s && typeof s === "object" && s.enabled !== false)
    .map(([id, s]) => ({ id, ...s }));
}

/** Get optional stat emoji map for a server (from servers.json statEmojis[serverId]). */
function getStatEmojis(serverId) {
  const all = readServers();
  const map = all.statEmojis && all.statEmojis[serverId];
  if (!map || typeof map !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (v != null && String(v).trim() !== "") out[k] = String(v).trim();
  }
  return Object.keys(out).length ? out : null;
}

/**
 * If the server has a logo in modules/images/serverlogos/{serverName}.png, return
 * { path, attachmentName } for use as embed thumbnail; otherwise return null.
 * path is always resolved to absolute for reliable file read.
 */
function getServerLogoAttachment(serverId) {
  const all = readServers();
  const server = serverId && all[serverId] && typeof all[serverId] === "object" ? all[serverId] : null;
  if (!server || !server.name) return null;
  const fileName = `${server.name}.png`;
  const logoPath = path.resolve(path.join(serverLogosDir, fileName));
  if (!fs.existsSync(logoPath)) {
    console.log(`[/server] ⚠️ Server logo not found: ${logoPath}`);
    return null;
  }
  return { path: logoPath, attachmentName: fileName };
}

/**
 * Get dominant color from an image buffer (same concept as /member view avatar color).
 * Returns 0xRRGGBB for use with embed.setColor(). Fallback 0xED6B23 on error.
 * @param {Buffer} buffer - PNG/JPEG image buffer
 * @returns {Promise<number>}
 */
async function getDominantColorFromBuffer(buffer) {
  const fallback = 0xED6B23;
  try {
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
    if (!entries.length) return fallback;
    entries.sort((a, b) => b[1] - a[1]);
    const [r, g, b] = entries[0][0].split(",").map(Number);
    return (r << 16) + (g << 8) + b;
  } catch (err) {
    console.warn("[/server] ⚠️ getDominantColorFromBuffer:", err.message);
    return fallback;
  }
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
    const message = await interaction.reply({
      embeds: [embed],
      components: rows.length ? rows : [],
      ephemeral: false,
      fetchReply: true
    });
    console.log("[/server] ✅ Reply sent");

    if (rows.length) {
      setTimeout(async () => {
        try {
          const disabledRow = new ActionRowBuilder();
          for (const btn of row.components) {
            disabledRow.addComponents(ButtonBuilder.from(btn).setDisabled(true));
          }
          await message.edit({ components: [disabledRow] });
        } catch {
          // ignore edit failures (message deleted, etc.)
        }
      }, BUTTON_TIMEOUT_MS);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  },

  async buttonHandler(interaction) {
    const id = interaction.customId;
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `[/server buttons] 🔘 Button clicked: ${id} by ${interaction.user.tag} (${interaction.user.id})`
    );

    try {
      const messageAge = Date.now() - interaction.message.createdTimestamp;
      if (messageAge > BUTTON_TIMEOUT_MS) {
        await interaction.reply({
          content: "⏰ These buttons have expired. Please run the command again for fresh data.",
          ephemeral: true
        }).catch(() => {});
        return;
      }

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
        const clanSelectOpts = { ...donutsmp.getClanSelectOptions(), embedColor: donutsmp.defaultEmbedColor };
        const embed = createClanSelectEmbed("DonutSMP", withTeam, clanSelectOpts);
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

  let clanMemberMCs = [];
  let rosterSource = "members"; // "api" | "members"
  const rosterRes = await donutsmp.getTeamRoster(clan.donutsmpTeamName);
  if (rosterRes.ok && rosterRes.usernames && rosterRes.usernames.length > 0) {
    clanMemberMCs = rosterRes.usernames.map((u) => String(u).trim()).filter(Boolean);
    rosterSource = "api";
    console.log(`[/server buttons] 👥 Using in-game team roster from DonutSMP API: ${clanMemberMCs.length} player(s) (${clanMemberMCs.join(", ")})`);
  } else {
    const members = readMembers();
    for (const [discordId, m] of Object.entries(members)) {
      if (!m.JoinedClan) continue;
      if (m.JoinedClan === clan.name || m.JoinedClan === clan.abbr) {
        const mc = m.minecraftUser || m.minecraftName;
        if (mc) clanMemberMCs.push(mc.trim());
      }
    }
    console.log(`[/server buttons] 👥 Using accepted clan members: ${clanMemberMCs.length} player(s) (${clanMemberMCs.join(", ") || "none"})`);
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
  console.log(`[/server buttons] 🌐 Fetching DonutSMP stats for ${clanMemberMCs.length} member(s)...`);
  for (const mc of clanMemberMCs) {
    const res = await donutsmp.getPlayerStats(mc);
    if (!res.ok || !res.stats) continue;
    const s = res.stats;
    summed.kills += num(s.kills);
    summed.deaths += num(s.deaths);
    summed.money += num(s.money);
    summed.mobs_killed += num(s.mobs_killed);
    summed.broken_blocks += num(s.broken_blocks);
    summed.placed_blocks += num(s.placed_blocks);
    summed.shards += num(s.shards);
    const ptMinutes = parsePlaytimeToMinutes(s.playtime || "0");
    playtimeMinutes.total += ptMinutes;
  }
  summed.playtime = playtimeMinutes.total;
  console.log(`[/server buttons] 📊 Summed stats: kills=${summed.kills}, deaths=${summed.deaths}, money=${summed.money}, playtime=${playtimeMinutes.total} min, shards=${summed.shards}`);
  console.log("[/server buttons] 🌐 Fetching DonutSMP kills leaderboard (page 1)...");
  const lbRes = await donutsmp.getLeaderboard("kills", 1);
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
  const statEmojis = getStatEmojis("donutsmp");
  const logo = getServerLogoAttachment("donutsmp");
  let embedColor = donutsmp.defaultEmbedColor;
  let logoBuffer = null;
  if (logo) {
    try {
      logoBuffer = fs.readFileSync(logo.path);
      embedColor = await getDominantColorFromBuffer(logoBuffer);
      console.log(`[/server buttons] 🎨 Embed color from logo: #${embedColor.toString(16).padStart(6, "0")}`);
    } catch (err) {
      console.error("[/server buttons] ❌ Failed to read server logo:", err.message);
    }
  }
  const fields = donutsmp.getTeamEmbedFields(summed, highlights, statEmojis);
  const embed = createTeamEmbed("DonutSMP", clan.abbr, clan.name, fields, {
    highlights,
    statEmojis,
    embedColor,
    footer: donutsmp.getTeamEmbedFooter(rosterSource)
  });
  const logoAttachmentName = "serverlogo.png";
  if (logo && logoBuffer) {
    try {
      const attachment = new AttachmentBuilder(logoBuffer, { name: logoAttachmentName });
      embed.setThumbnail(`attachment://${logoAttachmentName}`);
      console.log(`[/server buttons] 📤 Sending DonutSMP team stats embed for ${clan.abbr} (with server logo: ${logo.path})`);
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error("[/server buttons] ❌ Failed to attach server logo:", err.message);
      await interaction.editReply({ embeds: [embed] });
    }
  } else {
    console.log(`[/server buttons] 📤 Sending DonutSMP team stats embed for ${clan.abbr}`);
    await interaction.editReply({ embeds: [embed] });
  }
  console.log("[/server buttons] ✅ Team stats embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

async function handleMemberDonutSMP(interaction, mcUsername) {
  console.log(`[/server buttons] 📥 handleMemberDonutSMP: MC username=${mcUsername}`);
  await interaction.deferReply();
  console.log("[/server buttons] 🌐 Fetching DonutSMP stats + lookup for", mcUsername);
  const [statsRes, lookupRes] = await Promise.all([
    donutsmp.getPlayerStats(mcUsername),
    donutsmp.getPlayerLookup(mcUsername)
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
  const statEmojis = getStatEmojis("donutsmp");
  const fields = donutsmp.getPlayerEmbedFields(stats, lookup, statEmojis);
  const embed = createPlayerEmbed("DonutSMP", mcUsername, fields, {
    thumbnailUrl: `https://mc-heads.net/avatar/${encodeURIComponent(mcUsername)}/100`,
    embedColor: donutsmp.defaultEmbedColor,
    footer: "DonutSMP player stats"
  });
  console.log(`[/server buttons] 📤 Sending DonutSMP player stats embed for ${mcUsername}`);
  await interaction.editReply({ embeds: [embed] });
  console.log("[/server buttons] ✅ Player stats embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}
