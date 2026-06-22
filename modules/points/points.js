// modules/points/points.js
// Yazanaki Points System: balance, checkin, add, invite.
// Shop functionality moved to /shop command (modules/points/shop.js).

const fs = require("fs");
const path = require("path");
const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  AttachmentBuilder,
} = require("discord.js");
const {
  readMembers,
  writeMembers,
  getBalance,
  getCategoryBalance,
  isMember,
  addPoints,
  getDailyCheckinStatus,
  getWeeklyCheckinStatus,
  applyDailyCheckin,
  applyWeeklyCheckin,
  getMinecraftUsername,
  VALID_CATEGORIES,
} = require("./pointslogic");
const {
  YAZANAKI_GUILD_ID,
} = require("./pointsconfig");
const channels = require("../data/channels");
const { readClans } = require("../clantracking/clanlogic");

// Path to clan emblems
const clemsDir = path.join(__dirname, "../images/clanemblems");
const YZNK_EMBLEM_PATH = path.join(clemsDir, "YZNK.png");

// Clan abbreviation → Discord emoji mapping (shared single source of truth)
const { getClanEmoji } = require("../clantracking/clanEmojis");

/**
 * Build the invite counts display for a member.
 * Returns an array of { abbr, name, count } for all clans where the member has an InviteCount key.
 * Also includes clans where count is 0 if the member has the countKey set.
 * @param {object} memberEntry - The member's data from members.json
 * @returns {Array<{abbr: string, name: string, guildId: string, count: number}>}
 */
function buildInviteCounts(memberEntry) {
  const clans = readClans();
  const results = [];

  // Build a map of abbr -> { name, guildId }
  const clanMap = {};
  for (const [guildId, clan] of Object.entries(clans)) {
    if (clan.abbr) {
      clanMap[clan.abbr.toUpperCase()] = { name: clan.name, guildId };
    }
  }
  // Also include YZNK for the Yazanaki Empire main server
  clanMap["YZNK"] = { name: "Yazanaki Empire", guildId: YAZANAKI_GUILD_ID };

  // Find all InviteCount keys on the member
  for (const [key, value] of Object.entries(memberEntry)) {
    if (typeof key === "string" && key.endsWith("InviteCount") && typeof value === "number" && value > 0) {
      const abbr = key.replace("InviteCount", "").toUpperCase();
      const clanInfo = clanMap[abbr];
      results.push({
        abbr,
        name: clanInfo?.name || abbr,
        guildId: clanInfo?.guildId || null,
        count: value,
      });
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);
  return results;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("points")
    .setDescription("Yazanaki points: balance, check-in, and rewards")
    .addSubcommand((sub) =>
      sub.setName("balance").setDescription("View your points balance and category breakdown")
    )
    .addSubcommand((sub) =>
      sub.setName("checkin").setDescription("Daily or weekly check-in for points")
    )
    .addSubcommand((sub) =>
      sub
        .setName("invite")
        .setDescription("View your invite counts per clan")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("View another member's invite counts (admin only)")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant points to a member in a specific category (admin only)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to grant points to").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("amount").setDescription("Amount of points").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("category")
            .setDescription("Category to assign points to")
            .setRequired(true)
            .addChoices(
              { name: "Activity", value: "activity" },
              { name: "Development", value: "development" },
              { name: "Contribution", value: "contribution" },
              { name: "Skill", value: "skill" },
              { name: "Leadership", value: "leadership" },
              { name: "Special", value: "special" }
            )
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason (optional)").setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── balance ──────────────────────────────────────────────
    if (sub === "balance") {
      if (!isMember(interaction.user.id)) {
        return interaction.reply({
          content: "You must be a Yazanaki Empire member to use points.",
          ephemeral: false
        });
      }

      const balance = getBalance(interaction.user.id);
      const cats = getCategoryBalance(interaction.user.id) || {};

      const embed = new EmbedBuilder()
        .setTitle("Points Balance")
        .setDescription(`You have **${balance}** total points.`)
        .addFields(
          {
            name: "How to earn",
            value: "`/points checkin` (daily/weekly), chat in allowed channels, join voice, or receive staff grants.",
          },
          {
            name: "📊 Category Breakdown",
            value: [
              `🟢 Activity: \`${cats.activity || 0}\``,
              `🔵 Development: \`${cats.development || 0}\``,
              `🟠 Contribution: \`${cats.contribution || 0}\``,
              `🟡 Skill: \`${cats.skill || 0}\``,
              `🟣 Leadership: \`${cats.leadership || 0}\``,
              `⭐ Special: \`${cats.special || 0}\``,
            ].join("\n"),
          }
        )
        .setColor(0x339eff);

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // ── checkin ──────────────────────────────────────────────
    if (sub === "checkin") {
      if (!isMember(interaction.user.id)) {
        return interaction.reply({
          content: "You must be a Yazanaki Empire member to use points.",
          ephemeral: true
        });
      }

      const daily = getDailyCheckinStatus(interaction.user.id);
      const weekly = getWeeklyCheckinStatus(interaction.user.id);
      let totalAdded = 0;
      const lines = [];

      if (daily.canClaim) {
        const r = applyDailyCheckin(interaction.user.id);
        if (r.success) {
          totalAdded += r.pointsAdded;
          lines.push(`✅ Daily check-in: **+${r.pointsAdded}** pts (Activity)`);
        }
      } else {
        lines.push(
          `⏳ Daily: next in <t:${Math.floor((daily.nextAt?.getTime() || 0) / 1000)}:R>`
        );
      }

      if (weekly.canClaim) {
        const r = applyWeeklyCheckin(interaction.user.id);
        if (r.success) {
          totalAdded += r.pointsAdded;
          lines.push(`✅ Weekly check-in: **+${r.pointsAdded}** pts (Activity)`);
        }
      } else {
        lines.push(
          `⏳ Weekly: next in <t:${Math.floor((weekly.nextAt?.getTime() || 0) / 1000)}:R>`
        );
      }

      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("Check-in")
        .setDescription(lines.join("\n") + (totalAdded ? `\n\nNew balance: **${balance}** pts` : ""))
        .setColor(totalAdded ? 0x00ff00 : 0xffaa00);

      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // ── invite ───────────────────────────────────────────────
    if (sub === "invite") {
      if (!isMember(interaction.user.id)) {
        return interaction.reply({
          content: "You must be a Yazanaki Empire member to use points.",
          ephemeral: false
        });
      }

      const targetUser = interaction.options.getUser("user");
      const isSelf = !targetUser || targetUser.id === interaction.user.id;

      if (!isSelf) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return interaction.reply({
            content: "❌ Only administrators can view other members' invite counts.",
            ephemeral: true,
          });
        }
      }

      const members = readMembers();
      const lookupId = isSelf ? interaction.user.id : targetUser.id;
      const memberEntry = members[lookupId];

      if (!memberEntry) {
        return interaction.reply({
          content: isSelf
            ? "❌ You are not in members.json. Ask leadership to register you as a member first."
            : "❌ That user is not in members.json.",
          ephemeral: true,
        });
      }

      // Build invite counts
      const inviteCounts = buildInviteCounts(memberEntry);
      const totalInvites = inviteCounts.reduce((sum, c) => sum + c.count, 0);

      // Build description lines — one per clan with emoji + name + count
      let descLines;
      if (inviteCounts.length === 0) {
        descLines = ["No invites recorded yet."];
      } else {
        descLines = inviteCounts.map(({ abbr, name, count }) => {
          const emoji = getClanEmoji(abbr);
          return `${emoji}**${name}**: **${count}** invite${count !== 1 ? "s" : ""}`;
        });
      }

      const displayName = isSelf
        ? (interaction.member?.displayName || interaction.user.username)
        : (targetUser.username);

      const embed = new EmbedBuilder()
        .setTitle(`${isSelf ? "Your" : `${displayName}'s`} Invites`)
        .setDescription(
          `${descLines.join("\n")}` +
          (totalInvites > 0 ? `\n\n**Total:** ${totalInvites} invite${totalInvites !== 1 ? "s" : ""}` : "")
        )
        .setColor(0x339eff)
        .setFooter({ text: "Invites earned across all Yazanaki clans" });

      // Use YZNK.png from clanemblems as the thumbnail
      const files = [];
      if (fs.existsSync(YZNK_EMBLEM_PATH)) {
        const yznkFileName = "YZNK.png";
        files.push(new AttachmentBuilder(YZNK_EMBLEM_PATH, { name: yznkFileName }));
        embed.setThumbnail(`attachment://${yznkFileName}`);
      }

      return interaction.reply({
        embeds: [embed],
        files,
        ephemeral: true,
      });
    }

    // ── add (admin) ───────────────────────────────────────────
    if (sub === "add") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: "❌ You need Administrator permission to grant points.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      const category = interaction.options.getString("category");
      const reason = interaction.options.getString("reason") || "Staff grant";

      if (amount < 1) {
        return interaction.reply({ content: "❌ Amount must be at least 1.", ephemeral: true });
      }

      const result = addPoints(target.id, amount, "staff", category);

      if (!result.success) {
        return interaction.reply({
          content: `❌ ${target.id === interaction.user.id ? "Target is not a member." : `${target.tag} is not in members.json.`}`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: `✅ Granted **${amount}** points to ${target.tag} in category **${category}**.\nNew total: **${result.newBalance}** | ${category}: **${result.newCategoryBalance}**\nReason: ${reason}`,
        ephemeral: true,
      });
    }
  },
};