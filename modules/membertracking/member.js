// modules/membertracking/member.js
// ✅ UPDATED: Added kick, ban, and view subcommands
// ✅ Kick: Removes from empire with 3-month reapply cooldown
// ✅ Ban: Permanent ban from all clans
// ✅ View: Shows member information (replaces old /member command)

const {
  getMemberByDiscordId,
  getMemberByMinecraftUser,
  getMemberByEmpireId,
  getDominantColor,
  getProperMinecraftName,
} = require("./memberlogic");
const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { createMemberEmbed } = require("./memberembed");
const { kickMember, banMember } = require("./memberkickban");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("member")
    .setDescription("Manage Yazanaki Empire members")
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View information about a Yazanaki Empire member or any Minecraft player")
        .addStringOption(option =>
          option
            .setName("minecraft")
            .setDescription("Minecraft username (case-insensitive)")
            .setRequired(false)
        )
        .addUserOption(option =>
          option
            .setName("discord")
            .setDescription("Discord user")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("empireid")
            .setDescription("Empire ID (e.g. SNU-000014)")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("kick")
        .setDescription("Kick a member from the Yazanaki Empire (3-month reapply cooldown)")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Discord user to kick")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for kicking (optional)")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("ban")
        .setDescription("Permanently ban a member from all Yazanaki clans")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Discord user to ban")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for banning (optional)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ============================================================
    // KICK SUBCOMMAND (Admin only)
    // ============================================================
    if (sub === "kick") {
      // Check permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You need the **Kick Members** permission to use this command.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided.";

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/member kick] 🚨 Kick initiated by ${interaction.user.tag}`);
      console.log(`[/member kick] 🎯 Target: ${targetUser.tag} (${targetUser.id})`);
      console.log(`[/member kick] 📋 Reason: ${reason}`);

      const result = await kickMember(targetUser.id, reason, interaction.client);

      if (!result.success) {
        const reasons = {
          member_not_found: "Member not found in database.",
          not_in_yazanaki: "User is not in Yazanaki Empire guild.",
          error: `An error occurred: ${result.error || 'Unknown error'}`
        };

        console.error(`[/member kick] ❌ Kick failed: ${result.reason}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        return interaction.editReply({
          content: `❌ Failed to kick member: ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }

      const reapplyDate = new Date(result.canReapplyAt);
      const reapplyTimestamp = Math.floor(reapplyDate.getTime() / 1000);

      const embed = new EmbedBuilder()
        .setTitle("🚨 Member Kicked")
        .setDescription(
          `${targetUser} has been kicked from the Yazanaki Empire.\n\n` +
          `**Empire ID:** \`${result.empireId}\` *(deactivated)*\n` +
          `**Former Clan:** ${result.clan}\n` +
          `**Reason:** ${reason}\n\n` +
          `**Can Reapply:** <t:${reapplyTimestamp}:F> (<t:${reapplyTimestamp}:R>)\n\n` +
          `All empire roles have been removed.`
        )
        .setColor(0xFF6600)
        .setFooter({ text: `Kicked by ${interaction.user.tag}` })
        .setTimestamp();

      console.log(`[/member kick] ✅ Successfully kicked ${targetUser.tag}`);
      console.log(`[/member kick] ⏰ Can reapply: ${reapplyDate.toISOString()}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // BAN SUBCOMMAND (Admin only)
    // ============================================================
    if (sub === "ban") {
      // Check permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return interaction.reply({
          content: "❌ You need the **Kick Members** permission to use this command.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const targetUser = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided.";

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/member ban] 🔨 Ban initiated by ${interaction.user.tag}`);
      console.log(`[/member ban] 🎯 Target: ${targetUser.tag} (${targetUser.id})`);
      console.log(`[/member ban] 📋 Reason: ${reason}`);

      const result = await banMember(targetUser.id, reason, interaction.client);

      if (!result.success) {
        const reasons = {
          member_not_found: "Member not found in database.",
          not_in_yazanaki: "User is not in Yazanaki Empire guild.",
          error: `An error occurred: ${result.error || 'Unknown error'}`
        };

        console.error(`[/member ban] ❌ Ban failed: ${result.reason}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

        return interaction.editReply({
          content: `❌ Failed to ban member: ${reasons[result.reason] || result.reason}`,
          ephemeral: true
        });
      }

      const empireLine = result.empireId
        ? `**Empire ID:** \`${result.empireId}\` *(deactivated)*\n`
        : `**Empire ID:** \`n/d\` *(user was not an active empire member)*\n`;

      const clanLine = result.clan
        ? `**Former Clan:** ${result.clan}\n`
        : `**Former Clan:** n/d (not in any Yazanaki clan)\n`;

      const embed = new EmbedBuilder()
        .setTitle("🔨 Member Banned")
        .setDescription(
          `${targetUser} has been **permanently banned** from the Yazanaki Empire.\n\n` +
          empireLine +
          clanLine +
          `**Reason:** ${reason}\n\n` +
          `⛔ **This user is permanently banned from all Yazanaki clans.**\n\n` +
          `All empire roles have been removed and the **Empire Enemy** role has been applied in the Yazanaki Discord.`
        )
        .setColor(0xFF0000)
        .setFooter({ text: `Banned by ${interaction.user.tag}` })
        .setTimestamp();

      console.log(`[/member ban] ✅ Successfully banned ${targetUser.tag}`);
      console.log(`[/member ban] ⛔ PERMANENT BAN - Cannot reapply`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // VIEW SUBCOMMAND (Everyone)
    // ============================================================
    if (sub === "view") {
      const empireArg = interaction.options.getString("empireid");
      const mcArg = interaction.options.getString("minecraft");
      const discordArg = interaction.options.getUser("discord");

      let finalMemberData = null;
      let finalMCUsername = null;
      let discordDisplay = null;

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/member view] 🎯 Command invoked by: ${interaction.user.tag}`);

      const targetDiscordUser = discordArg || interaction.user;

      console.log(`[/member view] 🆔 Empire ID arg: ${empireArg || "none"}`);
      console.log(`[/member view] 👤 Target Discord User: ${targetDiscordUser.tag} (${targetDiscordUser.id})`);
      console.log(`[/member view] 🎮 MC Arg: ${mcArg || "none"}`);
      console.log(`[/member view] 🤖 Client provided: ${interaction.client ? "YES ✅" : "NO ❌"}`);

      // Priority: empireid > minecraft > discord (default invoker when no MC/empire)
      if (empireArg) {
        console.log(`[/member view] 🔍 Searching by Empire ID: ${empireArg}`);
        const empireResult = await getMemberByEmpireId(empireArg, interaction.client);
        console.log(
          `[/member view] 📊 getMemberByEmpireId result:`,
          empireResult?.member ? "Found" : empireResult?.reason || "none"
        );

        if (!empireResult || !empireResult.member) {
          console.log(`[/member view] ❌ Empire ID lookup failed (${empireResult?.reason || "unknown"})`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          const id = empireArg.trim().toUpperCase();
          let msg = `❌ No active member could be resolved for Empire ID \`${id}\`.`;
          if (empireResult?.reason === "id_not_found") {
            msg = `❌ Empire ID \`${id}\` was not found in the registry.`;
          } else if (empireResult?.reason === "registry_no_discord") {
            msg = `❌ Empire ID \`${id}\` exists but has no Discord assignment yet.`;
          } else if (empireResult?.reason === "not_linked_or_not_member") {
            msg =
              `❌ Empire ID \`${id}\` is not linked to an active empire member ` +
              `(user may have left, been kicked, or needs \`/link\`).`;
          }
          return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }

        finalMemberData = empireResult.member;
        finalMCUsername = empireResult.member.minecraftUser;
        try {
          discordDisplay = await interaction.client.users.fetch(empireResult.discordId);
          console.log(`[/member view] ✅ Found via Empire ID — Discord: ${discordDisplay.tag}`);
        } catch (err) {
          console.warn("[/member view] ⚠️ Could not fetch discord user:", err.message);
        }
        console.log(
          `[/member view] 🎭 Rank: ${finalMemberData.YazanakiRank}, Status: ${finalMemberData.Status}`
        );
      } else if (mcArg) {
        console.log(`[/member view] 🔍 Searching by MC username: ${mcArg}`);

        const mcResult = await getMemberByMinecraftUser(mcArg, interaction.client);
        console.log(`[/member view] 📊 getMemberByMinecraftUser result:`, mcResult?.member ? "Found" : "Not found");

        if (mcResult && mcResult.member) {
          finalMemberData = mcResult.member;
          finalMCUsername = mcResult.member.minecraftUser || mcResult.exactUsername || mcArg;

          console.log(`[/member view] ✅ Found via MC username`);
          console.log(`[/member view] 🎭 Rank: ${finalMemberData.YazanakiRank}, Status: ${finalMemberData.Status}`);

          if (mcResult.member.discordId) {
            try {
              discordDisplay = await interaction.client.users.fetch(mcResult.member.discordId);
              console.log(`[/member view] ✅ Found Discord user for MC: ${discordDisplay.tag}`);
            } catch (err) {
              console.warn("[/member view] ⚠️ Could not fetch discord user:", err.message);
            }
          }
        } else {
          finalMCUsername = mcResult?.exactUsername || mcArg;
          console.log(`[/member view] ℹ️ MC username not linked, showing basic info for: ${finalMCUsername}`);
        }
      } else {
        console.log(`[/member view] 🔍 Searching by Discord ID...`);

        const result = await getMemberByDiscordId(targetDiscordUser.id, interaction.client);
        console.log(`[/member view] 📊 getMemberByDiscordId result:`, result ? "Found" : "Not found");

        if (result && result.member) {
          finalMemberData = result.member;
          finalMCUsername = result.member.minecraftUser;
          discordDisplay = targetDiscordUser;

          console.log(`[/member view] ✅ Found via Discord ID - MC: ${finalMCUsername}`);
          console.log(`[/member view] 🎭 Rank: ${finalMemberData.YazanakiRank}, Status: ${finalMemberData.Status}`);
        } else {
          console.log(`[/member view] ❌ No link found for Discord ID: ${targetDiscordUser.id}`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          return interaction.reply({
            content: discordArg
              ? `❌ <@${discordArg.id}> is not linked. They need to use \`/link <minecraft_username>\` first.`
              : `❌ You are not linked. Use \`/link <minecraft_username>\` to link your account.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // ============================================================
      // ENSURE MC USERNAME EXISTS
      // ============================================================
      if (!finalMCUsername) {
        console.log(`[/member view] ❌ No MC username found at all`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        return interaction.reply({
          content: "❌ Could not find Minecraft username. Please provide a valid username or link your account.",
          flags: MessageFlags.Ephemeral,
        });
      }

      console.log(`[/member view] 🎮 Final MC Username (before Mojang): ${finalMCUsername}`);

      // ============================================================
      // GET PROPER CAPITALIZATION FROM MOJANG
      // ============================================================
      const properMCUsername = await getProperMinecraftName(finalMCUsername);
      console.log(`[/member view] ✅ Proper MC Username (from Mojang): ${properMCUsername}`);
      
      // Update the MC username in member data if it exists
      if (finalMemberData) {
        finalMemberData.minecraftUser = properMCUsername;
      } else {
        // Non-Yazanaki player: build minimal memberData for clearer embed
        finalMemberData = {
          minecraftUser: properMCUsername,
          minecraftVersion: "n/d",
          JoinedClan: "n/d",
          JoinDate: "n/d",
          YazanakiRank: "n/d",
          EmpireID: "n/d",
          Status: "Non-member"
        };
      }

      console.log(`[/member view] 📊 Final Member Data:`, {
        minecraftUser: finalMemberData?.minecraftUser || 'none',
        rank: finalMemberData?.YazanakiRank || 'none',
        status: finalMemberData?.Status || 'none',
        clan: finalMemberData?.JoinedClan || 'none'
      });
      console.log(`[/member view] 👤 Discord Display: ${discordDisplay?.tag || 'none'}`);

      // ============================================================
      // CALCULATE DOMINANT COLOR FROM PLAYER HEAD
      // ============================================================
      const avatarURL = `https://mc-heads.net/avatar/${encodeURIComponent(properMCUsername)}/100`;
      let embedColor = 0x339eff; // fallback

      try {
        embedColor = await getDominantColor(avatarURL);
        console.log(`[/member view] 🎨 Dominant color calculated: #${embedColor.toString(16).padStart(6, '0')}`);
      } catch (err) {
        console.warn("[/member view] ⚠️ Failed to get dominant color:", err.message);
      }

      // ============================================================
      // CREATE EMBED
      // ============================================================
      console.log(`[/member view] 📝 Creating embed...`);
      const embed = createMemberEmbed(
        discordDisplay, 
        finalMemberData || { minecraftUser: properMCUsername }, 
        embedColor
      );

      console.log(`[/member view] ✅ Embed created successfully`);
      console.log(`[/member view] 🟠 Adding DonutSMP button for MC: ${properMCUsername}`);
      const serverRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`member_server_donutsmp_${properMCUsername}`)
          .setLabel("DonutSMP")
          .setStyle(ButtonStyle.Secondary)
      );

      console.log("[/member view] 📤 Sending member embed + DonutSMP button");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      const message = await interaction.reply({
        embeds: [embed],
        components: [serverRow],
        fetchReply: true
      });

      setTimeout(async () => {
        try {
          const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(serverRow.components[0]).setDisabled(true)
          );
          await message.edit({ components: [disabledRow] });
        } catch {
          // message deleted or cannot be edited
        }
      }, 10 * 60 * 1000);
      return message;
    }
  },
};