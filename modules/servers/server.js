// modules/servers/server.js
// /server command + button handler for DonutSMP (and future servers)

const path = require("path");
const fs = require("fs");
const Jimp = require("jimp");
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const clanlogic = require("../clantracking/clanlogic");
const { readMembers } = require("../membertracking/memberlogic");
const donutsmp = require("./donutsmp");
const { getServerClient, isClanLinkedToServer } = require("./serverRegistry");
const {
  createServerListEmbed,
  createTeamEmbed,
  createPlayerEmbed,
  createClanSelectEmbed,
  num,
  parsePlaytimeToMinutes
} = require("./serverembed");

const { stores } = require("../database/stores");
const serverLogosDir = path.join(__dirname, "../images/serverlogos");

const BUTTON_TIMEOUT_MS = 10 * 60 * 1000;

// servers.json (map of serverId -> config, plus a top-level statEmojis key).
// Persistence is handled by the dual-write MapStore (JSON + MySQL `servers`).
function readServers() {
  return stores.servers.readMap();
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

      // Button ids are generic across servers (server ids have no underscores):
      //   server_<id>                     -> pick a server, list its linked clans
      //   server_<id>_clan_<guildId>      -> a clan's team (from /server)
      //   clan_server_<id>_<guildId>      -> a clan's team (from /clan view)
      //   member_server_<id>_<mcUsername> -> a player's stats (from /member view)
      // Servers with a stats API (DonutSMP today) use the live-stats path; the
      // rest are label-only and show a roster built from accepted clan members.

      if (id.startsWith("server_") && id.includes("_clan_")) {
        const rest = id.slice("server_".length);
        const sep = rest.indexOf("_clan_");
        const serverId = rest.slice(0, sep);
        const guildId = rest.slice(sep + "_clan_".length);
        console.log(`[/server buttons] 🏰 ${serverId} team via /server for guild: ${guildId}`);
        await handleClanServer(interaction, serverId, guildId);
        return;
      }

      if (id.startsWith("server_")) {
        const serverId = id.slice("server_".length);
        console.log(`[/server buttons] 🌐 Server selected: ${serverId}`);
        await handleServerSelected(interaction, serverId);
        return;
      }

      if (id.startsWith("clan_server_")) {
        const rest = id.slice("clan_server_".length);
        const us = rest.indexOf("_"); // server id has no underscore; guildId is numeric
        const serverId = rest.slice(0, us);
        const guildId = rest.slice(us + 1);
        console.log(`[/server buttons] 🏰 ${serverId} team via /clan view for guild: ${guildId}`);
        await handleClanServer(interaction, serverId, guildId);
        return;
      }

      if (id.startsWith("member_server_")) {
        const rest = id.slice("member_server_".length);
        const us = rest.indexOf("_"); // server id has no underscore
        const serverId = rest.slice(0, us);
        const mcUsername = rest.slice(us + 1);
        console.log(`[/server buttons] 🎮 ${serverId} stats via /member view for: ${mcUsername}`);
        await handleMemberServer(interaction, serverId, mcUsername);
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

/** Server button clicked in the /server list — show that server's linked clans. */
async function handleServerSelected(interaction, serverId) {
  const all = readServers();
  const server = all && all[serverId];
  if (!server || typeof server !== "object" || server.enabled === false) {
    console.warn(`[/server buttons] ⚠️ Unknown or disabled server: ${serverId}`);
    return interaction.reply({ content: "Unknown or disabled server.", ephemeral: true }).catch(() => {});
  }
  await interaction.deferUpdate();
  const displayName = server.name || serverId;
  const clans = clanlogic.readClans();
  const linked = Object.entries(clans)
    .filter(([, c]) => isClanLinkedToServer(c, serverId))
    .map(([guildId, c]) => ({ guildId, abbr: c.abbr, name: c.name }));
  console.log(
    `[/server buttons] 🏰 Clans linked to ${serverId}:`,
    linked.length ? linked.map(c => `${c.abbr}(${c.guildId})`).join(", ") : "none"
  );
  // Servers with an API client can supply select-embed styling; label-only use defaults.
  const client = getServerClient(serverId);
  const clanSelectOpts = client && client.getClanSelectOptions
    ? { ...client.getClanSelectOptions(), embedColor: client.defaultEmbedColor }
    : {};
  const embed = createClanSelectEmbed(displayName, linked, clanSelectOpts);
  const row = new ActionRowBuilder();
  for (const { guildId, abbr } of linked.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`server_${serverId}_clan_${guildId}`)
        .setLabel(abbr)
        .setStyle(ButtonStyle.Secondary)
    );
  }
  console.log(`[/server buttons] 📤 Sending ${displayName} clan select embed with ${row.components.length} clan button(s)`);
  await interaction.editReply({ embeds: [embed], components: row.components.length ? [row] : [] });
  console.log("[/server buttons] ✅ Message updated");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

/** Route a clan-team button to the live-stats view (DonutSMP) or the roster view. */
async function handleClanServer(interaction, serverId, guildId) {
  // DonutSMP is the only server with a live stats API today; it gets the rich
  // team-stats view. Every other (label-only) server shows a member roster.
  if (serverId === "donutsmp") return handleClanDonutSMP(interaction, guildId);
  return handleClanRoster(interaction, serverId, guildId);
}

/** Route a member-stats button to the live-stats view (DonutSMP) or a notice. */
async function handleMemberServer(interaction, serverId, mcUsername) {
  if (serverId === "donutsmp") return handleMemberDonutSMP(interaction, mcUsername);
  const all = readServers();
  const displayName = (all && all[serverId] && all[serverId].name) || serverId;
  return interaction.reply({
    content: `${displayName}: live player stats aren't available for this server yet.`,
    ephemeral: true,
  }).catch(() => {});
}

/** Label-only clan view: roster of accepted clan members (no live stats). */
async function handleClanRoster(interaction, serverId, guildId) {
  console.log(`[/server buttons] 📥 handleClanRoster: server=${serverId} guildId=${guildId}`);
  await interaction.deferReply();
  const all = readServers();
  const displayName = (all && all[serverId] && all[serverId].name) || serverId;
  const clans = clanlogic.readClans();
  const clan = clans[guildId];
  if (!clan || !isClanLinkedToServer(clan, serverId)) {
    console.log("[/server buttons] ❌ Clan not found or not linked to this server");
    return interaction.editReply({ content: `Clan not found or not linked to ${displayName}.`, ephemeral: true });
  }

  // No per-player API for label-only servers, so show the roster of accepted
  // clan members (same member source as the DonutSMP roster fallback).
  const members = readMembers();
  const roster = [];
  for (const [, m] of Object.entries(members)) {
    if (!m.JoinedClan) continue;
    if (m.JoinedClan === clan.name || m.JoinedClan === clan.abbr) {
      const mc = m.minecraftUser || m.minecraftName;
      if (mc) roster.push(String(mc).trim());
    }
  }
  console.log(`[/server buttons] 👥 ${displayName} roster for ${clan.abbr}: ${roster.length} member(s)`);

  const logo = getServerLogoAttachment(serverId);
  let embedColor = 0x000000;
  let logoBuffer = null;
  if (logo) {
    try {
      logoBuffer = fs.readFileSync(logo.path);
      embedColor = await getDominantColorFromBuffer(logoBuffer);
    } catch (err) {
      console.error("[/server buttons] ❌ Failed to read server logo:", err.message);
    }
  }

  const rosterText = roster.length
    ? roster.map(u => `• ${u}`).join("\n").slice(0, 1024)
    : "_No accepted members are linked to this clan yet._";
  const fields = [{ name: `Members (${roster.length})`, value: rosterText, inline: false }];
  const embed = createTeamEmbed(displayName, clan.abbr, clan.name, fields, {
    embedColor,
    footer: `${displayName} roster • live stats aren't available for this server`,
  });

  if (logo && logoBuffer) {
    try {
      const attachment = new AttachmentBuilder(logoBuffer, { name: "serverlogo.png" });
      embed.setThumbnail("attachment://serverlogo.png");
      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error("[/server buttons] ❌ Failed to attach server logo:", err.message);
      await interaction.editReply({ embeds: [embed] });
    }
  } else {
    await interaction.editReply({ embeds: [embed] });
  }
  console.log("[/server buttons] ✅ Roster embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

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

/**
 * Resolve the correct DonutSMP username for a player.
 * Bedrock players on DonutSMP (via Geyser) have a "." prefix.
 * If the initial lookup fails and the username doesn't already start with ".",
 * we automatically retry with "." prepended.
 *
 * @param {string} mcUsername - The MC username to look up
 * @returns {Promise<{ statsRes: object, lookupRes: object, resolvedUsername: string }>}
 */
async function resolveDonutSmpPlayer(mcUsername) {
  console.log(`[/server] 🔍 Resolving DonutSMP player: ${mcUsername}`);

  // First attempt with the username as-is
  const [statsRes, lookupRes] = await Promise.all([
    donutsmp.getPlayerStats(mcUsername),
    donutsmp.getPlayerLookup(mcUsername)
  ]);

  // If found, return immediately
  if (statsRes.ok || lookupRes.ok) {
    console.log(`[/server] ✅ Found player with original username: ${mcUsername}`);
    return { statsRes, lookupRes, resolvedUsername: mcUsername };
  }

  // If not found and username doesn't already start with ".", retry with "." prefix
  // This handles Bedrock players on DonutSMP via Geyser
  if (!mcUsername.startsWith(".")) {
    const bedrockUsername = `.${mcUsername}`;
    console.log(`[/server] 🔄 Not found, retrying with Bedrock prefix: ${bedrockUsername}`);

    const [statsResRetry, lookupResRetry] = await Promise.all([
      donutsmp.getPlayerStats(bedrockUsername),
      donutsmp.getPlayerLookup(bedrockUsername)
    ]);

    if (statsResRetry.ok || lookupResRetry.ok) {
      console.log(`[/server] ✅ Found player with Bedrock prefix: ${bedrockUsername}`);
      return { statsRes: statsResRetry, lookupRes: lookupResRetry, resolvedUsername: bedrockUsername };
    }

    console.log(`[/server] ❌ Player not found with either username: ${mcUsername} or ${bedrockUsername}`);
    // Return the retry results (both failed) with the bedrock username for better error context
    return { statsRes: statsResRetry, lookupRes: lookupResRetry, resolvedUsername: bedrockUsername };
  }

  // Username already starts with ".", nothing more to try
  console.log(`[/server] ❌ Player not found: ${mcUsername}`);
  return { statsRes, lookupRes, resolvedUsername: mcUsername };
}

async function handleMemberDonutSMP(interaction, mcUsername) {
  console.log(`[/server buttons] 📥 handleMemberDonutSMP: MC username=${mcUsername}`);
  await interaction.deferReply();
  console.log("[/server buttons] 🌐 Fetching DonutSMP stats + lookup for", mcUsername);

  // Use the resolver that automatically handles Bedrock "." prefix
  const { statsRes, lookupRes, resolvedUsername } = await resolveDonutSmpPlayer(mcUsername);

  if (!statsRes.ok && !lookupRes.ok) {
    const msg = statsRes.message || lookupRes.message || "No DonutSMP data for this player.";
    console.log(`[/server buttons] ❌ No DonutSMP data for ${mcUsername} (tried: ${resolvedUsername}): ${msg}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return interaction.editReply({
      content: `DonutSMP: ${msg}`,
      ephemeral: true
    });
  }

  if (resolvedUsername !== mcUsername) {
    console.log(`[/server buttons] ℹ️ Resolved Bedrock username: ${mcUsername} → ${resolvedUsername}`);
  }

  const stats = statsRes.ok ? statsRes.stats : {};
  const lookup = lookupRes.ok ? lookupRes.lookup : null;
  console.log(`[/server buttons] 📊 Stats: ${statsRes.ok ? "ok" : "missing"}, Lookup: ${lookupRes.ok ? "ok" : "missing"}`);
  const statEmojis = getStatEmojis("donutsmp");
  const fields = donutsmp.getPlayerEmbedFields(stats, lookup, statEmojis);

  // Use the resolved username for the embed title and avatar
  const embed = createPlayerEmbed("DonutSMP", resolvedUsername, fields, {
    thumbnailUrl: `https://mc-heads.net/avatar/${encodeURIComponent(resolvedUsername)}/100`,
    embedColor: donutsmp.defaultEmbedColor,
    footer: "DonutSMP player stats"
  });
  console.log(`[/server buttons] 📤 Sending DonutSMP player stats embed for ${resolvedUsername}`);
  await interaction.editReply({ embeds: [embed] });
  console.log("[/server buttons] ✅ Player stats embed sent");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}