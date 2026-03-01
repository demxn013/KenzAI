// modules/points/points.js
// Yazanaki Points System: balance, shop, checkin, add. Redeem flows for Discord perks, in-game loot, clan services.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const {
  readMembers,
  writeMembers,
  getBalance,
  isMember,
  addPoints,
  spendPoints,
  getDailyCheckinStatus,
  getWeeklyCheckinStatus,
  applyDailyCheckin,
  applyWeeklyCheckin,
  getMinecraftUsername,
} = require("./pointslogic");
const {
  REWARDS,
  getRewardById,
  getRewardsByCategory,
  isPromotionRoleId,
  YAZANAKI_GUILD_ID,
} = require("./pointsconfig");
const channels = require("../data/channels");
const { readClans } = require("../clantracking/clanlogic");

function getPointsStaffChannelId() {
  return channels.get("points.staffChannelId") || process.env.POINTS_STAFF_CHANNEL_ID || null;
}

function ensureMember(interaction) {
  if (!isMember(interaction.user.id)) {
    return { ok: false, message: "You must be a Yazanaki Empire member (in members.json) to use points." };
  }
  return { ok: true };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("points")
    .setDescription("Yazanaki points: balance, shop, check-in, and rewards")
    .addSubcommand((sub) =>
      sub.setName("balance").setDescription("View your points balance")
    )
    .addSubcommand((sub) =>
      sub.setName("shop").setDescription("Open the points shop")
    )
    .addSubcommand((sub) =>
      sub.setName("checkin").setDescription("Daily or weekly check-in for points")
    )
    .addSubcommand((sub) =>
      sub
        .setName("invite")
        .setDescription("Get your personal invite link to earn points")
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Grant points to a member (admin only)")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("User to grant points to").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt.setName("amount").setDescription("Amount of points").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason (optional)").setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "balance") {
      const check = ensureMember(interaction);
      if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("Points Balance")
        .setDescription(`You have **${balance}** points.`)
        .addFields({
          name: "How to earn",
          value: "`/points checkin` (daily/weekly), chat in allowed channels, join voice, or receive staff grants.",
        })
        .setColor(0x339eff);
      return interaction.reply({ embeds: [embed], ephemeral: false });
    }

    if (sub === "shop") {
      const check = ensureMember(interaction);
      if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("Points Shop")
        .setDescription(
          `Your balance: **${balance}** points.\n` +
            "Choose a category below.\n\n" +
            "__**Ways to earn points (in-game):**__\n" +
            "- Recruiting a member: `5 points`\n" +
            "- Every 1mil given to leadership: `30 points`\n" +
            "- Killing a non Yazanaki member wearing maxed neth: `100 points`\n" +
            "- Building a farm: `150 points`"
        )
        .setColor(0x339eff);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("points_shop_discord")
          .setLabel("Discord Perks")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("points_shop_in_game")
          .setLabel("In-Game Loot")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("points_shop_clan")
          .setLabel("Clan Services")
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
    }

    if (sub === "checkin") {
      const check = ensureMember(interaction);
      if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });
      const daily = getDailyCheckinStatus(interaction.user.id);
      const weekly = getWeeklyCheckinStatus(interaction.user.id);
      let totalAdded = 0;
      const lines = [];

      if (daily.canClaim) {
        const r = applyDailyCheckin(interaction.user.id);
        if (r.success) {
          totalAdded += r.pointsAdded;
          lines.push(`✅ Daily check-in: **+${r.pointsAdded}** pts`);
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
          lines.push(`✅ Weekly check-in: **+${r.pointsAdded}** pts`);
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

    if (sub === "invite") {
      const check = ensureMember(interaction);
      if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });

      const members = readMembers();
      const memberEntry = members[interaction.user.id];
      if (!memberEntry) {
        return interaction.reply({
          content: "❌ You are not in members.json. Ask leadership to register you as a member first.",
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
          if (match) {
            clanAbbrev = match[1];
          }
        }
      } catch {
        if (typeof empireId === "string") {
          const match = empireId.match(/^([A-Z]+)-/);
          if (match) {
            clanAbbrev = match[1];
          }
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
        if (urlMatch && urlMatch[1]) {
          code = urlMatch[1];
        }

        try {
          const invite = await interaction.client.fetchInvite(code);
          if (invite && invite.guild && invite.guild.id === guild.id) {
            inviteCode = invite.code;
          }
        } catch {
          // Existing invite is invalid or deleted; we'll create a new one below.
        }
      }

      if (!inviteCode) {
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

      const inviteUrl = memberEntry[inviteKey] || `https://discord.gg/${inviteCode}`;

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
          return `**${abbrev}**: ${value}`;
        });

      const descriptionLines = [
        `This is your invite link. Use this to invite people to **${clanName}** and earn points.`,
        "",
        allInviteLines.length ? allInviteLines.join("\n") : inviteUrl,
      ];

      const embed = new EmbedBuilder()
        .setTitle("Your Invite Link")
        .setDescription(descriptionLines.join("\n"))
        .setColor(0x339eff);

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "add") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: "❌ You need Administrator permission to grant points.",
          ephemeral: true,
        });
      }
      const target = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      const reason = interaction.options.getString("reason") || "Staff grant";
      if (amount < 1) {
        return interaction.reply({ content: "❌ Amount must be at least 1.", ephemeral: true });
      }
      const result = addPoints(target.id, amount, "staff");
      if (!result.success) {
        return interaction.reply({
          content: target.id === interaction.user.id ? "❌ Target is not a member." : `❌ ${target.tag} is not in members.json.`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: `✅ Granted **${amount}** points to ${target.tag}. New balance: **${result.newBalance}**. Reason: ${reason}`,
        ephemeral: true,
      });
    }
  },

  async buttonHandler(interaction) {
    const customId = interaction.customId;

    if (customId === "points_shop_discord") {
      const rewards = getRewardsByCategory("discord");
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("Discord Perks")
        .setDescription(`Balance: **${balance}** pts. Select a reward.`)
        .setColor(0x339eff);
      const options = rewards.map((r) => ({
        label: `${r.name} (${r.cost} pts)`,
        value: `points_redeem_${r.id}`,
        description: `Cost: ${r.cost} points`,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("points_select_reward")
          .setPlaceholder("Choose reward…")
          .addOptions(options)
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (customId === "points_shop_in_game") {
      const rewards = getRewardsByCategory("in_game");
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("In-Game Loot & Currency")
        .setDescription(`Balance: **${balance}** pts. Select a reward (staff will fulfill in-game).`)
        .setColor(0x339eff);
      const options = rewards.slice(0, 25).map((r) => ({
        label: `${r.name} (${r.cost} pts)`,
        value: `points_redeem_${r.id}`,
        description: `Cost: ${r.cost} points`,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("points_select_reward")
          .setPlaceholder("Choose reward…")
          .addOptions(options)
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (customId === "points_shop_clan") {
      const rewards = getRewardsByCategory("clan");
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setTitle("Clan Services")
        .setDescription(`Balance: **${balance}** pts. Clan leaders will prioritize your request.`)
        .setColor(0x339eff);
      const options = rewards.map((r) => ({
        label: `${r.name} (${r.cost} pts)`,
        value: `points_redeem_${r.id}`,
        description: `Cost: ${r.cost} points`,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("points_select_reward")
          .setPlaceholder("Choose reward…")
          .addOptions(options)
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (customId.startsWith("points_redeem_")) {
      const rewardId = customId.replace("points_redeem_", "");
      const reward = getRewardById(rewardId);
      if (!reward) return interaction.update({ content: "Unknown reward.", components: [] });
      const balance = getBalance(interaction.user.id);
      if (balance < reward.cost) {
        return interaction.reply({
          content: `❌ You need **${reward.cost}** points; you have **${balance}**.`,
          ephemeral: true,
        });
      }

      if (reward.type === "custom_role") {
        const modal = new ModalBuilder()
          .setCustomId(`points_customrole_modal_${rewardId}`)
          .setTitle("Custom Role")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("role_name")
                .setLabel("Role name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("role_color")
                .setLabel("Color (hex, e.g. #FF0000)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder("#FF0000 or leave blank")
            )
          );
        return interaction.showModal(modal);
      }

      if (reward.type === "nickname") {
        const modal = new ModalBuilder()
          .setCustomId(`points_nickname_modal_${rewardId}`)
          .setTitle("Nickname Change")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("nickname")
                .setLabel("New nickname")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(32)
            )
          );
        return interaction.showModal(modal);
      }

      if (reward.type === "clan_service") {
        const modal = new ModalBuilder()
          .setCustomId(`points_clan_build_modal_${rewardId}`)
          .setTitle("Custom Build Request")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("description")
                .setLabel("What do you want built?")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(1000)
                .setPlaceholder("Describe the build; clan leaders will prioritize it.")
            )
          );
        return interaction.showModal(modal);
      }

      if (reward.type === "color_role") {
        if (reward.roleIds && reward.roleIds.length > 0) {
          const roleId = reward.roleIds[0];
          if (isPromotionRoleId(roleId)) {
            return interaction.reply({ content: "❌ That reward is not available.", ephemeral: true });
          }
          const result = spendPoints(interaction.user.id, reward.cost);
          if (!result.success) {
            return interaction.reply({
              content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
              ephemeral: true,
            });
          }
          try {
            const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
            const member = await guild.members.fetch(interaction.user.id);
            await member.roles.add(roleId);
          } catch (e) {
            addPoints(interaction.user.id, reward.cost, "refund");
            return interaction.reply({ content: "❌ Could not assign role. Points refunded.", ephemeral: true });
          }
          return interaction.reply({
            content: `✅ You bought **${reward.name}**. New balance: **${result.newBalance}** pts.`,
            ephemeral: true,
          });
        }
        return interaction.reply({
          content: "❌ Color roles are not configured. Contact staff.",
          ephemeral: true,
        });
      }

      // in_game: confirm and post to staff
      const result = spendPoints(interaction.user.id, reward.cost);
      if (!result.success) {
        return interaction.reply({
          content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
          ephemeral: true,
        });
      }
      const mcName = getMinecraftUsername(interaction.user.id);
      const staffChannelId = getPointsStaffChannelId();
      if (staffChannelId) {
        try {
          const ch = await interaction.client.channels.fetch(staffChannelId);
          await ch.send({
            content: `**Points redemption (in-game)**\nUser: ${interaction.user.tag} (${interaction.user.id})\nMinecraft: ${mcName || "n/d"}\nReward: **${reward.name}** (${reward.cost} pts)\nFulfill in-game (e.g. /pay, give items).`,
          });
        } catch (e) {
          console.error("[points] Staff channel post failed:", e);
        }
      }
      return interaction.reply({
        content: `✅ You purchased **${reward.name}**. Your request was sent to staff; they will fulfill it in-game shortly. New balance: **${result.newBalance}** pts.`,
        ephemeral: true,
      });
    }
  },

  async selectMenuHandler(interaction) {
    if (interaction.customId !== "points_select_reward") return;
    const value = interaction.values[0];
    if (!value.startsWith("points_redeem_")) return;
    const rewardId = value.replace("points_redeem_", "");
    const reward = getRewardById(rewardId);
    if (!reward) return interaction.reply({ content: "Unknown reward.", ephemeral: true });
    const balance = getBalance(interaction.user.id);
    if (balance < reward.cost) {
      return interaction.reply({
        content: `❌ You need **${reward.cost}** points; you have **${balance}**.`,
        ephemeral: true,
      });
    }

    if (reward.type === "custom_role") {
      const modal = new ModalBuilder()
        .setCustomId(`points_customrole_modal_${rewardId}`)
        .setTitle("Custom Role")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("role_name")
              .setLabel("Role name")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(100)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("role_color")
              .setLabel("Color (hex, e.g. #FF0000)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder("#FF0000 or leave blank")
          )
        );
      return interaction.showModal(modal);
    }

    if (reward.type === "nickname") {
      const modal = new ModalBuilder()
        .setCustomId(`points_nickname_modal_${rewardId}`)
        .setTitle("Nickname Change")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("nickname")
              .setLabel("New nickname")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(32)
          )
        );
      return interaction.showModal(modal);
    }

    if (reward.type === "clan_service") {
      const modal = new ModalBuilder()
        .setCustomId(`points_clan_build_modal_${rewardId}`)
        .setTitle("Custom Build Request")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("description")
              .setLabel("What do you want built?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
              .setPlaceholder("Describe the build; clan leaders will prioritize it.")
          )
        );
      return interaction.showModal(modal);
    }

    if (reward.type === "color_role") {
      if (reward.roleIds && reward.roleIds.length > 0) {
        const roleId = reward.roleIds[0];
        if (isPromotionRoleId(roleId)) {
          return interaction.reply({ content: "❌ That reward is not available.", ephemeral: true });
        }
        const result = spendPoints(interaction.user.id, reward.cost);
        if (!result.success) {
          return interaction.reply({
            content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
            ephemeral: true,
          });
        }
        try {
          const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
          const member = await guild.members.fetch(interaction.user.id);
          await member.roles.add(roleId);
        } catch (e) {
          addPoints(interaction.user.id, reward.cost, "refund");
          return interaction.reply({ content: "❌ Could not assign role. Points refunded.", ephemeral: true });
        }
        return interaction.reply({
          content: `✅ You bought **${reward.name}**. New balance: **${result.newBalance}** pts.`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: "❌ Color roles are not configured. Contact staff.",
        ephemeral: true,
      });
    }

    // in_game
    const result = spendPoints(interaction.user.id, reward.cost);
    if (!result.success) {
      return interaction.reply({
        content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
        ephemeral: true,
      });
    }
    const mcName = getMinecraftUsername(interaction.user.id);
    const staffChannelId = getPointsStaffChannelId();
      if (staffChannelId) {
      try {
        const ch = await interaction.client.channels.fetch(staffChannelId);
        await ch.send({
          content: `**Points redemption (in-game)**\nUser: ${interaction.user.tag} (${interaction.user.id})\nMinecraft: ${mcName || "n/d"}\nReward: **${reward.name}** (${reward.cost} pts)\nFulfill in-game.`,
        });
      } catch (e) {
        console.error("[points] Staff channel post failed:", e);
      }
    }
    return interaction.reply({
      content: `✅ You purchased **${reward.name}**. Staff will fulfill in-game shortly. New balance: **${result.newBalance}** pts.`,
      ephemeral: true,
    });
  },

  async modalHandler(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith("points_customrole_modal_")) {
      const rewardId = customId.replace("points_customrole_modal_", "");
      const reward = getRewardById(rewardId) || getRewardById("custom_role");
      const roleName = interaction.fields.getTextInputValue("role_name").trim();
      const colorInput = interaction.fields.getTextInputValue("role_color")?.trim() || "";
      let color = 0;
      if (colorInput) {
        const hex = colorInput.replace(/^#/, "");
        if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
          color = parseInt(hex, 16);
        }
      }
      const result = spendPoints(interaction.user.id, reward.cost);
      if (!result.success) {
        return interaction.reply({
          content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
          ephemeral: true,
        });
      }
      try {
        const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
        const botMember = await guild.members.fetch(interaction.client.user.id);
        const createOptions = { name: roleName || "Custom", color };
        const role = await guild.roles.create(createOptions);
        const botTop = botMember.roles.highest?.position ?? 0;
        if (botTop > 0) await role.setPosition(botTop - 1).catch(() => {});
        const member = await guild.members.fetch(interaction.user.id);
        await member.roles.add(role.id);
        await interaction.reply({
          content: `✅ Custom role **${roleName}** created and assigned. New balance: **${result.newBalance}** pts.`,
          ephemeral: true,
        });
      } catch (e) {
        addPoints(interaction.user.id, reward.cost, "refund");
        console.error("[points] Custom role create failed:", e);
        return interaction.reply({
          content: "❌ Could not create role (check bot has Manage Roles and role is below bot's top role). Points refunded.",
          ephemeral: true,
        });
      }
      return;
    }

    if (customId.startsWith("points_nickname_modal_")) {
      const rewardId = customId.replace("points_nickname_modal_", "");
      const reward = getRewardById(rewardId) || getRewardById("nickname");
      const nickname = interaction.fields.getTextInputValue("nickname").trim();
      const result = spendPoints(interaction.user.id, reward.cost);
      if (!result.success) {
        return interaction.reply({
          content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
          ephemeral: true,
        });
      }
      try {
        const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
        const member = await guild.members.fetch(interaction.user.id);
        await member.setNickname(nickname);
        return interaction.reply({
          content: `✅ Nickname set to **${nickname}**. New balance: **${result.newBalance}** pts.`,
          ephemeral: true,
        });
      } catch (e) {
        addPoints(interaction.user.id, reward.cost, "refund");
        return interaction.reply({
          content: "❌ Could not set nickname. Points refunded.",
          ephemeral: true,
        });
      }
    }

    if (customId.startsWith("points_clan_build_modal_")) {
      const rewardId = customId.replace("points_clan_build_modal_", "");
      const reward = getRewardById(rewardId) || getRewardById("custom_build");
      const description = interaction.fields.getTextInputValue("description").trim();
      const result = spendPoints(interaction.user.id, reward.cost);
      if (!result.success) {
        return interaction.reply({
          content: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Failed.",
          ephemeral: true,
        });
      }
      const mcName = getMinecraftUsername(interaction.user.id);
      const staffChannelId = getPointsStaffChannelId();
      if (staffChannelId) {
        try {
          const ch = await interaction.client.channels.fetch(staffChannelId);
          await ch.send({
            content: `**Clan service: Custom Build** (${reward.cost} pts)\nUser: ${interaction.user.tag} (${interaction.user.id})\nMinecraft: ${mcName || "n/d"}\n**Description:**\n${description}\n\n⚠️ **Clan leaders must prioritize this build.**`,
          });
        } catch (e) {
          console.error("[points] Staff channel post failed:", e);
        }
      }
      return interaction.reply({
        content: `✅ Your build request was submitted. Clan leaders will prioritize it. New balance: **${result.newBalance}** pts.`,
        ephemeral: true,
      });
    }
  },
};
