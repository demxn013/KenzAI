// modules/onboarding/onboardingflow.js
// Runtime state machine for the application onboarding flow.
//
// Phases (in order):
//   intro         → welcome + read the Constitution           (in ticket)
//   commands      → key KenzAI commands to know               (in ticket)
//   clanTour      → walk the clan's important channels         (in each channel)
//   joinYazanaki  → join the Yazanaki Empire discord (gated)   (in ticket)
//   empireTour    → walk the Empire's important channels       (in each channel)
//   complete      → wait for a higher-up (manual) OR auto-accept (automatic)
//
// State lives on the ticket channel's cache entry (modules/data/cache.js) under
// `.onboarding`. Buttons carry identity only — `onb|next|<discordId>|<ticketChannelId>`
// and `onb|joined|<discordId>|<ticketChannelId>` — so everything is driven from the
// stored state and survives restarts. Only the applicant can advance (ownership
// guard) and stale clicks are ignored.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const cache = require("../data/cache");
const config = require("./onboardingconfig");
const defaults = require("./onboardingdefaults");
const { readClans } = require("../database/clansPersistence");
const { saveApplicant, getApplicant } = require("../applications/applicants");
const { acceptApplicant, checkInYazanaki } = require("../applications/acceptedapplicants");

const ORDER = ["intro", "commands", "clanTour", "joinYazanaki", "empireTour", "complete"];

// ============================================================
// STATE HELPERS (persisted on the ticket's cache entry)
// ============================================================

function readState(ticketChannelId) {
  const entry = cache.get(ticketChannelId);
  return entry && entry.onboarding ? entry.onboarding : null;
}

function writeState(ticketChannelId, onboarding) {
  const entry = cache.get(ticketChannelId) || {};
  entry.onboarding = onboarding;
  cache.set(ticketChannelId, entry);
}

function normalizeMode(mode) {
  // Legacy "timed" (never implemented) and anything unknown → manual.
  return mode === "automatic" ? "automatic" : "manual";
}

function phaseAfter(phase) {
  return ORDER[ORDER.indexOf(phase) + 1] || "complete";
}

function tourFor(state, phase) {
  if (phase === "clanTour") return config.getClanTour(state.clanGuildId);
  if (phase === "empireTour") return config.getEmpireTour();
  return [];
}

/**
 * Enter a phase, resetting the tour index. Empty tour phases are skipped
 * (cascades to the following phase).
 */
function enterPhase(state, phase) {
  state.phase = phase;
  state.tourIndex = 0;
  if (phase === "clanTour" || phase === "empireTour") {
    const tour = tourFor(state, phase);
    if (!tour || tour.length === 0) {
      enterPhase(state, phaseAfter(phase));
    }
  }
}

/**
 * Advance one step from the current phase (used by the "next" button).
 * Within a tour, moves to the next channel until exhausted, then to the
 * following phase.
 */
function nextStep(state) {
  const phase = state.phase;
  if (phase === "clanTour" || phase === "empireTour") {
    const tour = tourFor(state, phase);
    if (state.tourIndex + 1 < tour.length) {
      state.tourIndex += 1;
      return;
    }
    enterPhase(state, phaseAfter(phase));
    return;
  }
  enterPhase(state, phaseAfter(phase));
}

// ============================================================
// COMPONENT / EMBED BUILDERS
// ============================================================

function nextButton(discordId, ticketChannelId, label) {
  return new ButtonBuilder()
    .setCustomId(`onb|next|${discordId}|${ticketChannelId}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Success);
}

function joinedButton(discordId, ticketChannelId) {
  return new ButtonBuilder()
    .setCustomId(`onb|joined|${discordId}|${ticketChannelId}`)
    .setLabel("I've joined — Continue")
    .setStyle(ButtonStyle.Success);
}

function linkButton(label, url, emoji) {
  const b = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  if (emoji) b.setEmoji(emoji);
  return b;
}

// ============================================================
// PHASE RENDERERS — each returns { channelId, messageId } | null
// ============================================================

async function deleteActiveMessage(client, state) {
  const am = state.activeMessage;
  state.activeMessage = null;
  if (!am) return;
  try {
    const ch = await client.channels.fetch(am.channelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(am.messageId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
  } catch (_) {
    /* best-effort cleanup */
  }
}

async function renderIntro(ticketChannel, discordId) {
  const embed = new EmbedBuilder()
    .setTitle("👋 Welcome to your application!")
    .setColor(defaults.EMBED_COLOR)
    .setDescription(
      [
        `Hey <@${discordId}> — welcome! Before your application can be reviewed, KenzAI will walk you through the essentials so you know your way around.`,
        "",
        "**Step 1 — Read the Constitution.**",
        "Every Yazanakian is expected to know and uphold the Constitution. Give it a read, then click **I've read it — Next** below to continue.",
        "",
        `> 📜 [Yazanaki Empire Constitution](${defaults.CONSTITUTION_URL})`,
      ].join("\n")
    )
    .setFooter({ text: "Onboarding • Step 1" });

  const row = new ActionRowBuilder().addComponents(
    linkButton("📜 Read the Constitution", defaults.CONSTITUTION_URL),
    nextButton(discordId, ticketChannel.id, "I've read it — Next")
  );

  const msg = await ticketChannel.send({
    content: `<@${discordId}>`,
    embeds: [embed],
    components: [row],
  });
  return { channelId: ticketChannel.id, messageId: msg.id };
}

async function renderCommands(ticketChannel, discordId) {
  const commandList = defaults.TAUGHT_COMMANDS.map(
    (c) => `**\`${c.command}\`**\n> ${c.description}`
  ).join("\n\n");

  const embed = new EmbedBuilder()
    .setTitle("🤖 KenzAI — Commands to know")
    .setColor(defaults.EMBED_COLOR)
    .setDescription(
      [
        "KenzAI runs the whole Empire from Discord. Here are the commands you'll use most:",
        "",
        commandList,
        "",
        "When you're ready, click **Next** to continue.",
      ].join("\n")
    )
    .setFooter({ text: "Onboarding • Step 2" });

  const row = new ActionRowBuilder().addComponents(
    nextButton(discordId, ticketChannel.id, "Next")
  );

  const msg = await ticketChannel.send({
    content: `<@${discordId}>`,
    embeds: [embed],
    components: [row],
  });
  return { channelId: ticketChannel.id, messageId: msg.id };
}

function tourEmbed(entry, index, total, scopeLabel, postedInChannel) {
  const desc = [entry.description || ""];
  desc.push("");
  desc.push(`📍 Channel: <#${entry.channelId}>`);
  if (!postedInChannel) {
    desc.push("");
    desc.push("_(Head to the channel above, then come back and click **Next**.)_");
  }

  return new EmbedBuilder()
    .setTitle(entry.title || "Important channel")
    .setColor(defaults.EMBED_COLOR)
    .setDescription(desc.join("\n"))
    .setFooter({ text: `${scopeLabel} • ${index + 1}/${total}` });
}

/**
 * Post the current tour step. Tries to post (and ping) inside the target
 * channel; if the channel isn't a sendable text channel (forum/category/voice/
 * missing) or the send fails, falls back to posting in the ticket with a
 * clickable jump link.
 */
async function postTourStep(client, ticketChannel, state, discordId, entry, phase) {
  const tour = tourFor(state, phase);
  const scopeLabel = phase === "clanTour" ? "Clan tour" : "Empire tour";
  const row = new ActionRowBuilder().addComponents(
    nextButton(discordId, ticketChannel.id, "I've read this — Next")
  );

  let target = null;
  try {
    target = await client.channels.fetch(entry.channelId);
  } catch (_) {
    target = null;
  }

  const canPost =
    target &&
    typeof target.isTextBased === "function" &&
    target.isTextBased() &&
    typeof target.send === "function";

  if (canPost) {
    const embed = tourEmbed(entry, state.tourIndex, tour.length, scopeLabel, true);
    const msg = await target
      .send({ content: `<@${discordId}>`, embeds: [embed], components: [row] })
      .catch(() => null);
    if (msg) return { channelId: target.id, messageId: msg.id };
  }

  // Fallback: post in the ticket with a jump link (handles forums/categories/
  // voice channels and any send failure).
  const embed = tourEmbed(entry, state.tourIndex, tour.length, scopeLabel, false);
  const msg = await ticketChannel.send({
    content: `<@${discordId}>`,
    embeds: [embed],
    components: [row],
  });
  return { channelId: ticketChannel.id, messageId: msg.id };
}

async function renderJoinYazanaki(ticketChannel, discordId) {
  const embed = new EmbedBuilder()
    .setTitle("🏛️ Join the Yazanaki Empire")
    .setColor(defaults.EMBED_COLOR)
    .setDescription(
      [
        `Great work, <@${discordId}>! You now know the basics of the clan's discord and KenzAI's commands.`,
        "",
        "To be accepted, you **must join the main Yazanaki Empire discord**. Click the button below to join, then come back and press **I've joined — Continue**.",
      ].join("\n")
    )
    .setFooter({ text: "Onboarding • Join the Empire" });

  const row = new ActionRowBuilder().addComponents(
    linkButton("Join the Yazanaki Empire", defaults.YAZANAKI_INVITE_URL, "🏛️"),
    joinedButton(discordId, ticketChannel.id)
  );

  const msg = await ticketChannel.send({
    content: `<@${discordId}>`,
    embeds: [embed],
    components: [row],
  });
  return { channelId: ticketChannel.id, messageId: msg.id };
}

// ============================================================
// COMPLETION (manual message OR automatic accept)
// ============================================================

async function disableControlRow(client, ticketChannel, state, discordId) {
  if (!state.controlMessageId) return;
  try {
    const msg = await ticketChannel.messages.fetch(state.controlMessageId).catch(() => null);
    if (!msg) return;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`accept_application_${discordId}`)
        .setLabel("✅ Accept")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`reject_application_${discordId}`)
        .setLabel("❌ Reject")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );
    await msg.edit({ components: [row] }).catch(() => {});
  } catch (_) {
    /* best-effort */
  }
}

async function autoAccept(client, ticketChannel, state, discordId) {
  const current = getApplicant(discordId);
  if (!current) return { success: false, reason: "applicant_not_found" };

  // Mark accepted (mirrors the staff Accept path in application.js) so
  // acceptApplicant() will proceed.
  saveApplicant(
    discordId,
    current,
    current.server ?? state.clanGuildId,
    current.closeReason ?? null,
    true,
    new Date().toISOString()
  );

  const result = await acceptApplicant(discordId, client);

  if (!result.success) {
    // Revert the accepted flag so staff can still handle it manually.
    const reverted = getApplicant(discordId);
    if (reverted) {
      saveApplicant(
        discordId,
        reverted,
        reverted.server ?? state.clanGuildId,
        reverted.closeReason ?? null,
        false,
        null
      );
    }
    return result;
  }

  await disableControlRow(client, ticketChannel, state, discordId);
  return result;
}

async function renderComplete(client, ticketChannel, state, discordId) {
  const clans = readClans();
  const clan = clans[state.clanGuildId];
  const clanName = clan?.name || "your clan";
  const mode = normalizeMode(clan?.applicationMode);

  if (mode === "automatic") {
    const result = await autoAccept(client, ticketChannel, state, discordId);
    if (result.success) {
      const embed = new EmbedBuilder()
        .setTitle("✅ Application Accepted")
        .setColor(0x00ff00)
        .setDescription(
          "Congratulations! You've completed onboarding and your application to the " +
            "Yazanaki Empire has been **automatically accepted**. You've been given the " +
            "appropriate roles. Welcome!"
        )
        .setTimestamp();
      await ticketChannel.send({ content: `<@${discordId}>`, embeds: [embed] }).catch(() => {});
      return;
    }
    // Auto-accept failed — fall back to the manual message and let staff handle it.
    console.warn(`[onboarding] ⚠️ Auto-accept failed for ${discordId}: ${result.reason}`);
    const embed = new EmbedBuilder()
      .setTitle("🎉 Onboarding Complete!")
      .setColor(defaults.EMBED_COLOR)
      .setDescription(
        [
          `Nice work, <@${discordId}>! You now know the basics about **${clanName}**, KenzAI's commands, and the Yazanaki Empire.`,
          "",
          "We couldn't finish accepting you automatically, so a higher-up will review and accept you shortly. Please be patient!",
        ].join("\n")
      )
      .setTimestamp();
    await ticketChannel.send({ content: `<@${discordId}>`, embeds: [embed] }).catch(() => {});
    return;
  }

  // Manual mode.
  const embed = new EmbedBuilder()
    .setTitle("🎉 Onboarding Complete!")
    .setColor(defaults.EMBED_COLOR)
    .setDescription(
      [
        `Nice work, <@${discordId}>! You now know the basics about **${clanName}**, KenzAI's commands, and the Yazanaki Empire.`,
        "",
        "A higher-up will now review your application and accept you soon — please be patient. Thanks for onboarding!",
      ].join("\n")
    )
    .setTimestamp();
  await ticketChannel.send({ content: `<@${discordId}>`, embeds: [embed] }).catch(() => {});
}

// ============================================================
// RENDER DISPATCH
// ============================================================

async function renderCurrent(client, ticketChannel, state, discordId) {
  await deleteActiveMessage(client, state);

  // Defensive: if a tour phase points past a (now shorter) tour, move on.
  if (state.phase === "clanTour" || state.phase === "empireTour") {
    const tour = tourFor(state, state.phase);
    if (!tour[state.tourIndex]) {
      enterPhase(state, phaseAfter(state.phase));
    }
  }

  switch (state.phase) {
    case "intro":
      state.activeMessage = await renderIntro(ticketChannel, discordId);
      break;
    case "commands":
      state.activeMessage = await renderCommands(ticketChannel, discordId);
      break;
    case "clanTour":
      state.activeMessage = await postTourStep(
        client,
        ticketChannel,
        state,
        discordId,
        tourFor(state, "clanTour")[state.tourIndex],
        "clanTour"
      );
      break;
    case "joinYazanaki":
      state.activeMessage = await renderJoinYazanaki(ticketChannel, discordId);
      break;
    case "empireTour":
      state.activeMessage = await postTourStep(
        client,
        ticketChannel,
        state,
        discordId,
        tourFor(state, "empireTour")[state.tourIndex],
        "empireTour"
      );
      break;
    case "complete":
      state.completedAt = new Date().toISOString();
      state.activeMessage = null;
      await renderComplete(client, ticketChannel, state, discordId);
      break;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Kick off onboarding for a freshly-created application ticket.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').TextChannel} ticketChannel
 * @param {{discordId:string, server?:string}} applicant
 * @param {string|null} controlMessageId  message id of the staff Accept/Reject row
 */
async function startOnboarding(client, ticketChannel, applicant, controlMessageId = null) {
  const discordId = applicant.discordId;
  const state = {
    phase: "intro",
    tourIndex: 0,
    activeMessage: null,
    controlMessageId: controlMessageId || null,
    clanGuildId: applicant.server || ticketChannel.guild.id,
    joinedYazanaki: false,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  await renderCurrent(client, ticketChannel, state, discordId);
  writeState(ticketChannel.id, state);
}

/**
 * Handle an `onb|...` button click. Routed here from events/interactionCreate.js
 * via the onboarding command's buttonHandler.
 */
async function handleButton(interaction) {
  const client = interaction.client;
  const parts = interaction.customId.split("|"); // ["onb", action, discordId, ticketChannelId]
  const action = parts[1];
  const discordId = parts[2];
  const ticketChannelId = parts[3];

  // Ownership guard — only the applicant can drive their onboarding.
  if (interaction.user.id !== discordId) {
    return interaction.reply({
      content: "❌ These onboarding buttons aren't for you.",
      ephemeral: true,
    });
  }

  const state = readState(ticketChannelId);
  if (!state || state.phase === "complete") {
    return interaction.reply({
      content: "ℹ️ This onboarding step is no longer active.",
      ephemeral: true,
    });
  }

  // Stale-button guard: ignore clicks on anything but the current step message.
  if (state.activeMessage && interaction.message?.id !== state.activeMessage.messageId) {
    return interaction.reply({
      content: "ℹ️ This step has already been completed — continue from the latest message.",
      ephemeral: true,
    });
  }

  const ticketChannel = await client.channels.fetch(ticketChannelId).catch(() => null);
  if (!ticketChannel) {
    return interaction.reply({
      content: "❌ Your application ticket could not be found. Please contact staff.",
      ephemeral: true,
    });
  }

  // ---- "I've joined" — verify Yazanaki membership before advancing ----
  if (action === "joined") {
    if (state.phase !== "joinYazanaki") {
      return interaction.reply({
        content: "ℹ️ This step is no longer active.",
        ephemeral: true,
      });
    }
    const check = await checkInYazanaki(client, discordId);
    if (!check.inGuild) {
      return interaction.reply({
        content:
          "❌ You haven't joined the **Yazanaki Empire** discord yet. Use the button above to join, then click **I've joined — Continue** again.",
        ephemeral: true,
      });
    }
    await interaction.deferUpdate().catch(() => {});
    state.joinedYazanaki = true;
    enterPhase(state, "empireTour");
    await renderCurrent(client, ticketChannel, state, discordId);
    writeState(ticketChannelId, state);
    return;
  }

  // ---- "Next" — advance one step ----
  if (action === "next") {
    await interaction.deferUpdate().catch(() => {});
    nextStep(state);
    await renderCurrent(client, ticketChannel, state, discordId);
    writeState(ticketChannelId, state);
    return;
  }

  return interaction.reply({ content: "❌ Unknown onboarding action.", ephemeral: true });
}

module.exports = {
  startOnboarding,
  handleButton,
  // exported for potential reuse/testing
  normalizeMode,
};
