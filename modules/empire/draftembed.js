// modules/empire/draftembed.js
// ✅ All draft-related embeds and buttons

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("./draftconfig");

// ============================================================
// ACTIVE DRAFTS LIST (/draft list)
// ============================================================

// Draft lifecycle stages, ordered from most → least urgent.
// Used both for the "status" sort grouping and the per-line badge.
const DRAFT_STAGES = {
  notified: { order: 0, emoji: "🔴", label: "Awaiting Choice" },
  reminder: { order: 1, emoji: "🟠", label: "Reminder Sent" },
  active:   { order: 2, emoji: "🟢", label: "In Progress" },
};

const SORT_LABELS = {
  time: "Time Remaining",
  clan: "Clan",
  status: "Draft Status",
};

// Keep a safe margin under Discord's 4096-char description limit.
const DESCRIPTION_BUDGET = 3900;

/**
 * Classify an active draft into a lifecycle stage based on its flags.
 */
function getDraftStage(draft) {
  if (draft.draftNotified) return "notified";
  if (draft.draftReminderSent) return "reminder";
  return "active";
}

/**
 * Clan abbreviation derived from the Empire ID prefix (e.g. "ONF-000056" -> "ONF").
 */
function clanAbbrOf(draft) {
  const id = draft.EmpireID || "";
  const idx = id.indexOf("-");
  return idx > 0 ? id.slice(0, idx) : null;
}

/**
 * Render a single draft as one compact line.
 * @param {boolean} withBadge - prefix the line with the stage emoji
 *        (skipped when the section header already conveys the stage).
 */
function formatDraftLine(draft, unit, withBadge = true) {
  const badge = withBadge ? `${DRAFT_STAGES[getDraftStage(draft)].emoji} ` : "";
  const id = draft.EmpireID || "n/d";
  return `${badge}\`${id}\` <@${draft.discordId}> · ${draft.daysRemaining}${unit}`;
}

/**
 * Group active drafts into ordered sections according to the sort mode.
 * Returns an array of { title, lines } where title may be null (flat list).
 */
function buildDraftSections(drafts, sort, unit) {
  if (sort === "clan") {
    const groups = new Map();
    for (const draft of drafts) {
      const clan = draft.JoinedClan || "Unknown Clan";
      if (!groups.has(clan)) groups.set(clan, []);
      groups.get(clan).push(draft);
    }

    return [...groups.entries()]
      // Largest clans first, then alphabetical for ties.
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([clan, members]) => {
        members.sort((a, b) => a.daysRemaining - b.daysRemaining);
        const abbr = clanAbbrOf(members[0]);
        const heading = abbr ? `${clan} (${abbr})` : clan;
        return {
          title: `__**${heading}**__ — ${members.length}`,
          lines: members.map(d => formatDraftLine(d, unit, true)),
        };
      });
  }

  if (sort === "status") {
    const groups = new Map();
    for (const draft of drafts) {
      const stage = getDraftStage(draft);
      if (!groups.has(stage)) groups.set(stage, []);
      groups.get(stage).push(draft);
    }

    return [...groups.entries()]
      .sort((a, b) => DRAFT_STAGES[a[0]].order - DRAFT_STAGES[b[0]].order)
      .map(([stage, members]) => {
        members.sort((a, b) => a.daysRemaining - b.daysRemaining);
        const { emoji, label } = DRAFT_STAGES[stage];
        return {
          // Header already shows the stage, so drop the per-line badge.
          title: `__**${emoji} ${label}**__ — ${members.length}`,
          lines: members.map(d => formatDraftLine(d, unit, false)),
        };
      });
  }

  // Default: flat list sorted by time remaining (most urgent first).
  const sorted = [...drafts].sort((a, b) => a.daysRemaining - b.daysRemaining);
  return [{ title: null, lines: sorted.map(d => formatDraftLine(d, unit, true)) }];
}

/**
 * Pack sections into a description string within Discord's char budget,
 * counting how many drafts had to be dropped.
 */
function packSections(sections, startUsed) {
  const parts = [];
  let used = startUsed;
  let truncated = 0;

  for (const section of sections) {
    const titleText = section.title ? `${section.title}\n` : "";
    let localUsed = used + titleText.length;
    const kept = [];

    for (let i = 0; i < section.lines.length; i++) {
      const cost = section.lines[i].length + 1; // + newline
      if (localUsed + cost > DESCRIPTION_BUDGET) {
        truncated += section.lines.length - i;
        break;
      }
      kept.push(section.lines[i]);
      localUsed += cost;
    }

    if (kept.length > 0) {
      parts.push(titleText + kept.join("\n"));
      used = localUsed;
    } else {
      // Nothing from this section fit — don't leave a dangling header.
      truncated += section.lines.length;
    }
  }

  return { body: parts.join("\n\n"), truncated };
}

/**
 * Build the `/draft list` embed: a compact, grouped, readable view of all
 * active drafts that can be sorted by time remaining, clan, or draft status.
 *
 * @param {Array} activeDrafts - drafts from getActiveDrafts()
 * @param {Object} opts
 * @param {"time"|"clan"|"status"} [opts.sort="time"]
 * @param {boolean} [opts.testingMode=false]
 * @param {string|null} [opts.clanFilter=null] - case-insensitive match on clan name/abbr
 * @returns {{ embed: EmbedBuilder, matched: number }}
 */
function createDraftListEmbed(activeDrafts, { sort = "time", testingMode = false, clanFilter = null } = {}) {
  const unit = testingMode ? "m" : "d";

  // Optional clan filter (matches full name, abbreviation, or Empire ID prefix).
  let drafts = activeDrafts;
  if (clanFilter) {
    const needle = clanFilter.trim().toLowerCase();
    drafts = activeDrafts.filter(d => {
      const name = (d.JoinedClan || "").toLowerCase();
      const abbr = (clanAbbrOf(d) || "").toLowerCase();
      return name.includes(needle) || abbr === needle || abbr.includes(needle);
    });
  }

  const sortLabel = SORT_LABELS[sort] || SORT_LABELS.time;

  const header =
    `Total: **${drafts.length}** active draft(s)` +
    (clanFilter ? ` matching \`${clanFilter}\`` : "") +
    `\n🔴 Awaiting choice · 🟠 Reminder sent · 🟢 In progress`;

  const embed = new EmbedBuilder()
    .setTitle("🎖️ Active Drafts")
    .setColor(0xFFAA00)
    .setFooter({
      text: `${testingMode ? "TESTING MODE" : "Production Mode"} • Sorted by ${sortLabel}`,
    });

  if (drafts.length === 0) {
    embed.setDescription(
      clanFilter
        ? `No active drafts match \`${clanFilter}\`.`
        : "No active drafts found."
    );
    return { embed, matched: 0 };
  }

  const sections = buildDraftSections(drafts, sort, unit);
  const { body, truncated } = packSections(sections, header.length + 2);

  let description = `${header}\n\n${body}`;
  if (truncated > 0) {
    description += `\n\n⚠️ **+${truncated} more not shown.** Use the \`clan\` filter to narrow results.`;
  }

  embed.setDescription(description);
  return { embed, matched: drafts.length };
}

/**
 * Create reminder DM embed (2 weeks before expiry)
 */
function createReminderEmbed(memberData) {
  const expiryTimestamp = Math.floor(new Date(memberData.draftExpiryDate).getTime() / 1000);
  const timeframe = config.TESTING_MODE ? "2 minutes" : "2 weeks";
  
  return new EmbedBuilder()
    .setTitle("⏰ Draft Reminder")
    .setDescription(
      `Your draft period in the **Yazanaki Empire** will end in **${timeframe}**!\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**Expiry Date:** <t:${expiryTimestamp}:F>\n\n` +
      `Start thinking about your next step!`
    )
    .setColor(0xFFAA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create expiry DM embed with choice buttons
 */
function createExpiryEmbed(discordId, memberData) {
  const timeframe = config.TESTING_MODE ? "1 minute" : "24 hours";
  
  const embed = new EmbedBuilder()
    .setTitle("⏰ Your Draft Period Has Ended")
    .setDescription(
      `Congratulations on completing your 3-month draft in the **Yazanaki Empire**!\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n\n` +
      `Please choose your next step below. **If you don't respond within ${timeframe}, you will automatically become a Citizen.**`
    )
    .setColor(0x000000)
    .setFooter({ text: `You have ${timeframe} to make your choice` });
  
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`draft_army_${discordId}`)
      .setLabel("🎖️ Join Imperial Army")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`draft_citizen_${discordId}`)
      .setLabel("🏛️ Become Citizen")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`draft_leave_${discordId}`)
      .setLabel("👋 Leave Yazanaki")
      .setStyle(ButtonStyle.Danger)
  );
  
  return { embed, buttons };
}

/**
 * Create auto-citizen notification embed
 */
function createAutoCitizenEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("✅ Draft Completed - Citizen Status Assigned")
    .setDescription(
      `Your draft period has ended and you didn't make a choice within the time limit.\n\n` +
      `You have been **automatically assigned as a Citizen** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**Status:** Citizen\n\n` +
      `Welcome to the empire! 🏛️`
    )
    .setColor(0x00AA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create confirmation embed for joining Imperial Army
 */
function createArmyConfirmationEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("🎖️ Welcome to the Imperial Army!")
    .setDescription(
      `Congratulations! You have joined the **Imperial Army** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**New Rank:** Imperial Army\n` +
      `**Status:** Military\n\n` +
      `Your duty to the empire begins now! 🎖️`
    )
    .setColor(0x00AA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create confirmation embed for becoming Citizen
 */
function createCitizenConfirmationEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("🏛️ Welcome as a Citizen!")
    .setDescription(
      `You are now a **Citizen** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**New Rank:** Citizen\n` +
      `**Status:** Citizen\n\n` +
      `Enjoy your life in the empire! 🏛️`
    )
    .setColor(0x0099FF)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create farewell embed for leaving empire
 */
function createFarewellEmbed(empireId) {
  return new EmbedBuilder()
    .setTitle("👋 Farewell from the Yazanaki Empire")
    .setDescription(
      `You have chosen to leave the Yazanaki Empire.\n\n` +
      `**Former Empire ID:** \`${empireId}\` *(deactivated)*\n\n` +
      `All your roles have been removed. Your Empire ID has been archived.\n\n` +
      `If you wish to return in the future, you may reapply and your Empire ID will be restored.\n\n` +
      `Farewell, and may your journeys be prosperous. 🌟`
    )
    .setColor(0xFF0000)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

module.exports = {
  createDraftListEmbed,
  createReminderEmbed,
  createExpiryEmbed,
  createAutoCitizenEmbed,
  createArmyConfirmationEmbed,
  createCitizenConfirmationEmbed,
  createFarewellEmbed
};