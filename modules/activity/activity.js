// modules/activity/activity.js
// /activity check — run an activity check for a clan.
//
// You paste the message link of an activity-check post and pick the clan it
// applies to. Clan members prove they're active by reacting to that message
// with their clan's logo emoji (see modules/clantracking/clanEmojis.js, sourced
// from modules/images/clanemblems). The command reports which clan members
// reacted (active) and which did not (inactive), then offers a single
// confirmation to kick the inactive members from the clan via kickMember()
// (modules/membertracking/memberkickban.js).

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { getClanEmojiId, getClanEmoji } = require("../clantracking/clanEmojis");
const { readClans } = require("../database/clansPersistence");
const { readMembers } = require("../database/membersPersistence");
const { kickMember } = require("../membertracking/memberkickban");

// Static snapshot used only to build the command's clan choice list at registration.
// Runtime resolution always reads clans live via readClans().
let CLAN_CHOICES = [];
try {
  const clansSnapshot = require("../data/clans.json");
  CLAN_CHOICES = Object.values(clansSnapshot)
    // Only clans with a configured logo emoji can be activity-checked.
    .filter((c) => c && c.abbr && c.name && getClanEmojiId(c.abbr))
    .map((c) => ({ name: `${c.name} (${c.abbr})`, value: c.abbr }))
    .slice(0, 25);
} catch {
  CLAN_CHOICES = [];
}

const MESSAGE_LINK_RE = /channels\/(\d+)\/(\d+)\/(\d+)/;
const MAX_LIST = 40; // cap mentions per embed field to stay within Discord limits

/**
 * Fetch every (non-bot) user ID that reacted with a given reaction, paginating
 * past Discord's 100-per-request limit.
 */
async function fetchAllReactorIds(reaction) {
  const ids = new Set();
  let after;
  // Safety cap: 50 pages * 100 = 5000 reactors.
  for (let page = 0; page < 50; page++) {
    const batch = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
    if (batch.size === 0) break;
    for (const user of batch.values()) {
      if (!user.bot) ids.add(user.id);
    }
    after = batch.lastKey();
    if (batch.size < 100) break;
  }
  return ids;
}

/**
 * Render a list of member IDs as mentions, truncated for embed limits.
 */
function renderMemberList(ids) {
  if (ids.length === 0) return "—";
  const shown = ids.slice(0, MAX_LIST).map((id) => `<@${id}>`).join("\n");
  const extra = ids.length > MAX_LIST ? `\n… +${ids.length - MAX_LIST} more` : "";
  return shown + extra;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Clan activity tools")
    .addSubcommand((sub) => {
      sub
        .setName("check")
        .setDescription("Tally reactions to an activity-check message and kick clan members who didn't react")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Link to the activity-check message (right-click → Copy Message Link)")
            .setRequired(true)
        );
      const clanOpt = (o) =>
        o
          .setName("clan")
          .setDescription("Which clan this activity check is for")
          .setRequired(true);
      sub.addStringOption((o) => {
        clanOpt(o);
        if (CLAN_CHOICES.length) o.addChoices(...CLAN_CHOICES);
        return o;
      });
      return sub;
    }),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== "check") return;

    // Admin gate — consistent with other clan/member management commands.
    if (!interaction.member?.permissions?.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ You need the **Kick Members** permission to run an activity check.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const link = interaction.options.getString("message", true);
    const clanAbbr = interaction.options.getString("clan", true).toUpperCase();

    const match = link.match(MESSAGE_LINK_RE);
    if (!match) {
      return interaction.reply({
        content: "❌ That doesn't look like a message link. Right-click the message → **Copy Message Link**.",
        flags: MessageFlags.Ephemeral,
      });
    }
    const [, , channelId, messageId] = match;

    // Resolve the clan and its emoji.
    let clans = {};
    try {
      clans = readClans();
    } catch (err) {
      console.error("[/activity check] ❌ Could not read clans:", err);
    }
    const clanEntry = Object.values(clans).find((c) => c.abbr?.toUpperCase() === clanAbbr);
    const clanName = clanEntry?.name || clanAbbr;
    const emojiId = getClanEmojiId(clanAbbr);

    if (!emojiId) {
      return interaction.reply({
        content:
          `❌ No clan emoji is configured for **${clanName}** (${clanAbbr}), so I can't run an emoji-based activity check for it.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch the target message.
    let message;
    try {
      const channel = await interaction.client.channels.fetch(channelId);
      message = await channel.messages.fetch(messageId);
    } catch (err) {
      console.warn("[/activity check] ⚠️ Could not fetch message:", err.message);
      return interaction.editReply({
        content: "❌ I couldn't fetch that message. Make sure the link is correct and I can see that channel.",
      });
    }

    // Find the clan-emoji reaction on the message.
    const reaction =
      message.reactions.cache.get(emojiId) ||
      message.reactions.cache.find((r) => r.emoji?.id === emojiId);

    const reactorIds = reaction ? await fetchAllReactorIds(reaction) : new Set();

    // Determine clan roster from members.json.
    let members = {};
    try {
      members = readMembers();
    } catch (err) {
      console.error("[/activity check] ❌ Could not read members:", err);
    }

    const clanMemberIds = Object.entries(members)
      .filter(([, m]) => m.JoinedClan === clanName)
      .map(([discordId]) => discordId);

    const active = clanMemberIds.filter((id) => reactorIds.has(id));
    const inactive = clanMemberIds.filter((id) => !reactorIds.has(id));

    // Reactors who aren't registered members of this clan (info only).
    const memberIdSet = new Set(clanMemberIds);
    const outsiders = [...reactorIds].filter((id) => !memberIdSet.has(id));

    const total = clanMemberIds.length;
    const pct = total > 0 ? Math.round((active.length / total) * 100) : 0;

    const embed = new EmbedBuilder()
      .setTitle(`📋 Activity Check — ${getClanEmoji(clanAbbr)}${clanName}`)
      .setColor(0x5865f2)
      .setURL(link)
      .setDescription(
        `**Clan members:** ${total}\n` +
        `**Reacted (active):** ${active.length} (${pct}%)\n` +
        `**Did not react (inactive):** ${inactive.length}\n` +
        (outsiders.length ? `**Other reactors (not in clan roster):** ${outsiders.length}\n` : "") +
        `\n[Jump to activity-check message](${link})`
      )
      .setFooter({ text: `Activity check by ${interaction.user.tag}` })
      .setTimestamp();

    if (total === 0) {
      embed.addFields({
        name: "No roster",
        value: `No registered members found with **${clanName}** as their clan.`,
        inline: false,
      });
    } else {
      embed.addFields(
        { name: `❌ Did not react (${inactive.length})`, value: renderMemberList(inactive).slice(0, 1024), inline: false },
        { name: `✅ Reacted (${active.length})`, value: renderMemberList(active).slice(0, 1024), inline: false },
      );
    }

    if (!reaction) {
      embed.addFields({
        name: "⚠️ Note",
        value: `No ${getClanEmoji(clanAbbr)}\`:${clanAbbr}:\` reactions found on that message yet. Everyone shows as inactive — **no one will be kicked**.`,
        inline: false,
      });
    }

    // ── Decide whether a bulk kick is safe to offer ──────────────────────────
    // Never offer to kick when we couldn't find the clan-emoji reaction, or when
    // nobody actually reacted: in those cases the entire roster shows as
    // "inactive", and that's almost always a wrong-message-link mistake rather
    // than a real mass-inactivity event. We also never kick the admin running
    // the command.
    const kickTargets = inactive.filter((id) => id !== interaction.user.id);
    const canKick = !!reaction && reactorIds.size > 0 && kickTargets.length > 0;

    if (!canKick) {
      return interaction.editReply({ embeds: [embed] });
    }

    // Mass kicks are destructive (roles removed, 3-month reapply cooldown) and
    // hard to undo, so require one explicit confirmation first.
    const plural = kickTargets.length === 1 ? "" : "s";
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("activity_kick_confirm")
        .setLabel(`Kick ${kickTargets.length} inactive member${plural}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("activity_kick_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    embed.addFields({
      name: "⚠️ Confirm kick",
      value:
        `Clicking **Kick** removes the **${kickTargets.length}** member${plural} listed under ` +
        `“Did not react” from **${clanName}** — roles stripped, moved to the kicked list, ` +
        `3-month reapply cooldown.`,
      inline: false,
    });

    await interaction.editReply({ embeds: [embed], components: [row] });

    // In-command collector (mirrors /relink) so this doesn't depend on
    // events/interactionCreate.js routing, which only reloads on a full restart.
    const promptMessage = await interaction.fetchReply();
    let choice;
    try {
      choice = await promptMessage.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 120000,
      });
    } catch {
      return interaction.editReply({
        content: "⏱️ Activity-check kick timed out — no one was kicked.",
        embeds: [embed],
        components: [],
      });
    }

    if (choice.customId === "activity_kick_cancel") {
      return choice.update({
        content: "❌ Cancelled — no one was kicked.",
        embeds: [embed],
        components: [],
      });
    }

    await choice.update({
      content: `⏳ Kicking ${kickTargets.length} inactive member${plural}…`,
      embeds: [embed],
      components: [],
    });

    const kickReason = `Failed activity check for ${clanName} — did not react to the activity-check message`;
    const kickedIds = [];
    const failedIds = [];

    // Sequential on purpose: kickMember does a full read-modify-write of
    // members.json, so concurrent kicks would race on the same map.
    for (const id of kickTargets) {
      try {
        const res = await kickMember(id, kickReason, interaction.client);
        if (res?.success) kickedIds.push(id);
        else failedIds.push(id);
      } catch (err) {
        console.error(`[/activity check] ❌ Error kicking ${id}:`, err);
        failedIds.push(id);
      }
    }

    const resultEmbed = new EmbedBuilder()
      .setTitle(`📋 Activity Check — ${getClanEmoji(clanAbbr)}${clanName}`)
      .setColor(failedIds.length ? 0xe67e22 : 0x2ecc71)
      .setURL(link)
      .setDescription(
        `**Kicked for inactivity:** ${kickedIds.length}\n` +
        (failedIds.length ? `**Failed to kick:** ${failedIds.length} (see logs)\n` : "") +
        `**Still active:** ${active.length}\n` +
        `\n[Jump to activity-check message](${link})`
      )
      .setFooter({ text: `Activity check by ${interaction.user.tag}` })
      .setTimestamp();

    resultEmbed.addFields({
      name: `👢 Kicked (${kickedIds.length})`,
      value: renderMemberList(kickedIds).slice(0, 1024),
      inline: false,
    });
    if (failedIds.length) {
      resultEmbed.addFields({
        name: `⚠️ Could not kick (${failedIds.length})`,
        value: renderMemberList(failedIds).slice(0, 1024),
        inline: false,
      });
    }

    return interaction.editReply({ content: "", embeds: [resultEmbed], components: [] });
  },
};
