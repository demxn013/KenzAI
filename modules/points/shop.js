// modules/points/shop.js
// /shop — Renamed from /points shop. Handles all shop purchases.
// Category requirements are hidden from users; failure messages are intentionally vague.

const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ChannelType,
  } = require("discord.js");
  const {
    getBalance,
    isMember,
    addPoints,
    spendPoints,
    checkCategoryRequirements,
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
  
  function getPointsStaffChannelId() {
    return channels.get("points.staffChannelId") || process.env.POINTS_STAFF_CHANNEL_ID || null;
  }
  
  function ensureMember(interaction) {
    if (!isMember(interaction.user.id)) {
      return { ok: false, message: "You must be a Yazanaki Empire member to use the shop." };
    }
    return { ok: true };
  }
  
  /**
   * Attempt to purchase a reward. Handles both category + total checks and spending.
   * Returns { success, failReason } where failReason is user-facing (intentionally vague for category failures).
   */
  async function attemptPurchase(interaction, reward) {
    const balance = getBalance(interaction.user.id);
  
    // 1. Check total points
    if (balance < reward.cost) {
      return {
        success: false,
        failReason: `❌ You need **${reward.cost}** points; you have **${balance}**.`
      };
    }
  
    // 2. Check category requirements (hidden — vague failure message)
    const catCheck = checkCategoryRequirements(interaction.user.id, reward.categoryRequirements || {});
    if (!catCheck.meets) {
      return {
        success: false,
        failReason: "❌ You are not ready for this reward yet. Keep contributing and developing your skills."
      };
    }
  
    // 3. Deduct points using deductMap if present, else proportional
    const result = spendPoints(interaction.user.id, reward.cost, reward.deductMap || null);
    if (!result.success) {
      return {
        success: false,
        failReason: result.reason === "insufficient_balance" ? "❌ Insufficient points." : "❌ Purchase failed."
      };
    }
  
    return { success: true, newBalance: result.newBalance };
  }
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName("shop")
      .setDescription("Open the Yazanaki Empire points shop"),
  
    async execute(interaction) {
      const check = ensureMember(interaction);
      if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });
  
      const balance = getBalance(interaction.user.id);
  
      const embed = new EmbedBuilder()
        .setTitle("Points Shop")
        .setDescription(
          `Your balance: **${balance}** points.\n` +
          "Choose a category below.\n\n" +
          "__**Ways to earn points (in-game):**__\n" +
          "- Recruiting a member: `5 contribution points`\n" +
          "- Every 1mil given to leadership: `30 development points`\n" +
          "- Killing a non Yazanaki member wearing maxed neth: `100 skill points`\n" +
          "- Building a farm: `150 development points`"
        )
        .setColor(0x339eff);
  
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("shop_discord")
          .setLabel("Discord Perks")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("shop_in_game")
          .setLabel("In-Game Loot")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("shop_clan")
          .setLabel("Clan Services")
          .setStyle(ButtonStyle.Secondary)
      );
  
      return interaction.reply({ embeds: [embed], components: [row], ephemeral: false });
    },
  
    async buttonHandler(interaction) {
      const customId = interaction.customId;
  
      // ── Category selectors ──────────────────────────────────
      if (customId === "shop_discord") {
        const rewards = getRewardsByCategory("discord");
        const balance = getBalance(interaction.user.id);
        const embed = new EmbedBuilder()
          .setTitle("Discord Perks")
          .setDescription(`Balance: **${balance}** pts. Select a reward.`)
          .setColor(0x339eff);
        const options = rewards.map((r) => ({
          label: `${r.name} (${r.cost} pts)`,
          value: `shop_redeem_${r.id}`,
          description: `Cost: ${r.cost} points`,
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("shop_select_reward")
            .setPlaceholder("Choose reward…")
            .addOptions(options)
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }
  
      if (customId === "shop_in_game") {
        const rewards = getRewardsByCategory("in_game");
        const balance = getBalance(interaction.user.id);
        const embed = new EmbedBuilder()
          .setTitle("In-Game Loot & Currency")
          .setDescription(`Balance: **${balance}** pts. Select a reward (staff will fulfill in-game).`)
          .setColor(0x339eff);
        const options = rewards.slice(0, 25).map((r) => ({
          label: `${r.name} (${r.cost} pts)`,
          value: `shop_redeem_${r.id}`,
          description: `Cost: ${r.cost} points`,
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("shop_select_reward")
            .setPlaceholder("Choose reward…")
            .addOptions(options)
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }
  
      if (customId === "shop_clan") {
        const rewards = getRewardsByCategory("clan");
        const balance = getBalance(interaction.user.id);
        const embed = new EmbedBuilder()
          .setTitle("Clan Services")
          .setDescription(`Balance: **${balance}** pts. Clan leaders will prioritize your request.`)
          .setColor(0x339eff);
        const options = rewards.map((r) => ({
          label: `${r.name} (${r.cost} pts)`,
          value: `shop_redeem_${r.id}`,
          description: `Cost: ${r.cost} points`,
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("shop_select_reward")
            .setPlaceholder("Choose reward…")
            .addOptions(options)
        );
        return interaction.update({ embeds: [embed], components: [row] });
      }
  
      // ── Direct redeem buttons (from old points system compatibility) ──
      if (customId.startsWith("shop_redeem_")) {
        return _handleRedeemButton(interaction, customId.replace("shop_redeem_", ""));
      }
    },
  
    async selectMenuHandler(interaction) {
      if (interaction.customId !== "shop_select_reward") return;
      const value = interaction.values[0];
      if (!value.startsWith("shop_redeem_")) return;
      const rewardId = value.replace("shop_redeem_", "");
      return _handleRedeemButton(interaction, rewardId);
    },
  
    async modalHandler(interaction) {
      const customId = interaction.customId;
  
      if (customId.startsWith("shop_customrole_modal_")) {
        const rewardId = customId.replace("shop_customrole_modal_", "");
        const reward = getRewardById(rewardId) || getRewardById("custom_role");
        const roleName = interaction.fields.getTextInputValue("role_name").trim();
        const colorInput = interaction.fields.getTextInputValue("role_color")?.trim() || "";
        let color = 0;
        if (colorInput) {
          const hex = colorInput.replace(/^#/, "");
          if (/^[0-9A-Fa-f]{6}$/.test(hex)) color = parseInt(hex, 16);
        }
  
        const purchase = await attemptPurchase(interaction, reward);
        if (!purchase.success) {
          return interaction.reply({ content: purchase.failReason, ephemeral: true });
        }
  
        try {
          const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
          const botMember = await guild.members.fetch(interaction.client.user.id);
          const role = await guild.roles.create({ name: roleName || "Custom", color });
          const botTop = botMember.roles.highest?.position ?? 0;
          if (botTop > 0) await role.setPosition(botTop - 1).catch(() => {});
          const member = await guild.members.fetch(interaction.user.id);
          await member.roles.add(role.id);
          return interaction.reply({
            content: `✅ Custom role **${roleName}** created and assigned. New balance: **${purchase.newBalance}** pts.`,
            ephemeral: true,
          });
        } catch (e) {
          // Refund
          addPoints(interaction.user.id, reward.cost, "refund", "special");
          console.error("[shop] Custom role create failed:", e);
          return interaction.reply({
            content: "❌ Could not create role (check bot has Manage Roles). Points refunded.",
            ephemeral: true,
          });
        }
      }
  
      if (customId.startsWith("shop_nickname_modal_")) {
        const rewardId = customId.replace("shop_nickname_modal_", "");
        const reward = getRewardById(rewardId) || getRewardById("nickname");
        const nickname = interaction.fields.getTextInputValue("nickname").trim();
  
        const purchase = await attemptPurchase(interaction, reward);
        if (!purchase.success) {
          return interaction.reply({ content: purchase.failReason, ephemeral: true });
        }
  
        try {
          const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
          const member = await guild.members.fetch(interaction.user.id);
          await member.setNickname(nickname);
          return interaction.reply({
            content: `✅ Nickname set to **${nickname}**. New balance: **${purchase.newBalance}** pts.`,
            ephemeral: true,
          });
        } catch (e) {
          addPoints(interaction.user.id, reward.cost, "refund", "special");
          return interaction.reply({ content: "❌ Could not set nickname. Points refunded.", ephemeral: true });
        }
      }
  
      if (customId.startsWith("shop_clan_build_modal_")) {
        const rewardId = customId.replace("shop_clan_build_modal_", "");
        const reward = getRewardById(rewardId) || getRewardById("custom_build");
        const description = interaction.fields.getTextInputValue("description").trim();
  
        const purchase = await attemptPurchase(interaction, reward);
        if (!purchase.success) {
          return interaction.reply({ content: purchase.failReason, ephemeral: true });
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
            console.error("[shop] Staff channel post failed:", e);
          }
        }
        return interaction.reply({
          content: `✅ Your build request was submitted. Clan leaders will prioritize it. New balance: **${purchase.newBalance}** pts.`,
          ephemeral: true,
        });
      }
    },
  };
  
  // ─────────────────────────────────────────────────────────────
  // Internal: handle a specific reward redemption
  // ─────────────────────────────────────────────────────────────
  async function _handleRedeemButton(interaction, rewardId) {
    const reward = getRewardById(rewardId);
    if (!reward) return interaction.reply({ content: "Unknown reward.", ephemeral: true });
  
    // ── custom_role: show modal ──
    if (reward.type === "custom_role") {
      const modal = new ModalBuilder()
        .setCustomId(`shop_customrole_modal_${rewardId}`)
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
  
    // ── nickname: show modal ──
    if (reward.type === "nickname") {
      const modal = new ModalBuilder()
        .setCustomId(`shop_nickname_modal_${rewardId}`)
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
  
    // ── clan_service: show modal ──
    if (reward.type === "clan_service") {
      const modal = new ModalBuilder()
        .setCustomId(`shop_clan_build_modal_${rewardId}`)
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
  
    // ── color_role: immediate ──
    if (reward.type === "color_role") {
      if (reward.roleIds && reward.roleIds.length > 0) {
        const roleId = reward.roleIds[0];
        if (isPromotionRoleId(roleId)) {
          return interaction.reply({ content: "❌ That reward is not available.", ephemeral: true });
        }
  
        const purchase = await attemptPurchase(interaction, reward);
        if (!purchase.success) {
          return interaction.reply({ content: purchase.failReason, ephemeral: true });
        }
  
        try {
          const guild = await interaction.client.guilds.fetch(YAZANAKI_GUILD_ID);
          const member = await guild.members.fetch(interaction.user.id);
          await member.roles.add(roleId);
        } catch (e) {
          addPoints(interaction.user.id, reward.cost, "refund", "special");
          return interaction.reply({ content: "❌ Could not assign role. Points refunded.", ephemeral: true });
        }
        return interaction.reply({
          content: `✅ You bought **${reward.name}**. New balance: **${purchase.newBalance}** pts.`,
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: "❌ Color roles are not configured. Contact staff.",
        ephemeral: true,
      });
    }
  
    // ── in_game: immediate, post to staff ──
    const purchase = await attemptPurchase(interaction, reward);
    if (!purchase.success) {
      return interaction.reply({ content: purchase.failReason, ephemeral: true });
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
        console.error("[shop] Staff channel post failed:", e);
      }
    }
  
    return interaction.reply({
      content: `✅ You purchased **${reward.name}**. Your request was sent to staff; they will fulfill it in-game shortly. New balance: **${purchase.newBalance}** pts.`,
      ephemeral: true,
    });
  }