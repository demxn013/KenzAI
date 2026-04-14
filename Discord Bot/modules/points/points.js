// modules/points/points.js
// Yazanaki Points System: balance, checkin, add, invite.
// Shop functionality moved to /shop command (modules/points/shop.js).

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
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
        .setDescription("Get your personal invite link to earn points")
        .addUserOption((opt) =>
          opt
            .setName("user")
            .setDescription("View another member's invite links (admin only)")
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
            content: "❌ Only administrators can view other members' invite links.",
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

      const empireId = memberEntry.EmpireID || "";
      let clanAbbrev = "YZNK";
      let clanName = memberEntry.JoinedClan || "Yazanaki Empire";

      let guild = interaction.guild || null;
      try {
        const clans = readClans();
        if (guild && clans[guild.id]) {
          const clanConfig = clans[guild.id];
          if (clanConfig.abbr) clanAbbrev = clanConfig.abbr;
          if (clanConfig.name) clanName = clanConfig.name;
        } else if (typeof empireId === "string") {
          const match = empireId.match(/^([A-Z]+)-/);
          if (match) clanAbbrev = match[1];
        }
      } catch {
        if (typeof empireId === "string") {
          const match = empireId.match(/^([A-Z]+)-/);
          if (match) clanAbbrev = match[1];
        }
      }

      const inviteKey = `${clanAbbrev}PointsInviteLink`;

      if (!guild) {
        guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
      }

      let inviteCode = null;
      const storedInvite = memberEntry[inviteKey];
      if (storedInvite) {
        let code = storedInvite;
        const urlMatch =
          typeof storedInvite === "string"
            ? storedInvite.match(/discord(?:\.gg|\.com\/invite)\/([^/]+)/i)
            : null;
        if (urlMatch && urlMatch[1]) code = urlMatch[1];
        try {
          const invite = await interaction.client.fetchInvite(code);
          if (invite && invite.guild && invite.guild.id === guild.id) {
            inviteCode = invite.code;
          }
        } catch {
          // Stale invite — will create new one below
        }
      }

      if (!inviteCode && isSelf) {
        const { ChannelType } = require("discord.js");
        let channelId = guild.systemChannelId || guild.rulesChannelId || null;
        if (!channelId) {
          const textChannel = guild.channels.cache
            .filter((ch) => ch.type === ChannelType.GuildText)
            .first();
          channelId = textChannel ? textChannel.id : null;
        }

        if (!channelId) {
          return interaction.reply({
            content: "❌ Could not find a channel to create an invite in. Please contact staff.",
            ephemeral: true,
          });
        }

        try {
          const invite = await guild.invites.create(channelId, {
            maxAge: 0,
            maxUses: 0,
            unique: true,
          });
          inviteCode = invite.code;
          memberEntry[inviteKey] = `https://discord.gg/${invite.code}`;
          writeMembers(members);
        } catch (err) {
          console.error("[points] Failed to create invite link:", err);
          return interaction.reply({
            content: "❌ I couldn't create an invite link. Please contact staff.",
            ephemeral: true,
          });
        }
      }

      const inviteUrl = memberEntry[inviteKey] || (inviteCode ? `https://discord.gg/${inviteCode}` : "n/d");

      let totalInvites = 0;
      const allInviteLines = Object.entries(memberEntry)
        .filter(
          ([key, value]) =>
            typeof key === "string" &&
            key.endsWith("PointsInviteLink") &&
            typeof value === "string" &&
            value.trim().length > 0
        )
        .map(([key, value]) => {
          const abbrev = key.replace("PointsInviteLink", "");
          const countKey = `${abbrev}InviteCount`;
          const count = typeof memberEntry[countKey] === "number" ? memberEntry[countKey] : 0;
          totalInvites += count;
          return `**${abbrev}**: ${value} — Invites: **${count}**`;
        });

      const headerLine = isSelf
        ? `This is your invite link. Recruiting earns you **Contribution** points.`
        : `These are ${targetUser.tag}'s invite links.`;

      const descriptionLines = [
        headerLine,
        "",
        allInviteLines.length ? allInviteLines.join("\n") : inviteUrl,
      ];

      if (totalInvites > 0) {
        descriptionLines.push("", `Total recruits (all clans): **${totalInvites}**`);
      }

      const embed = new EmbedBuilder()
        .setTitle(isSelf ? "Your Invite Link" : `${targetUser.tag}'s Invite Links`)
        .setDescription(descriptionLines.join("\n"))
        .setColor(0x339eff);

      return interaction.reply({ embeds: [embed], ephemeral: true });
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