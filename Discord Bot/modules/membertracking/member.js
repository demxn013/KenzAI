const {
  getMemberByDiscordId,
  getMemberByMinecraftUser,
  getDominantColor,
} = require("./memberlogic");
const { SlashCommandBuilder } = require("discord.js");
const { createMemberEmbed } = require("./memberembed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("member")
    .setDescription("Shows information about a Yazanaki Empire member or any Minecraft player.")
    .addStringOption((option) =>
      option
        .setName("minecraft")
        .setDescription("Minecraft username (case-insensitive)")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("discord")
        .setDescription("Discord user")
        .setRequired(false)
    ),

  async execute(interaction) {
    const mcArg = interaction.options.getString("minecraft");
    const discordArg = interaction.options.getUser("discord");

    let finalMemberData = null;
    let finalMCUsername = null;
    let discordDisplay = null;

    // ============================================================
    // 1) SEARCH BY DISCORD ID (or default to command user)
    // ============================================================
    const targetDiscordUser = discordArg || interaction.user; // ✅ DEFAULT TO SELF
    
    const result = getMemberByDiscordId(targetDiscordUser.id);

    if (result && result.member) {
      finalMemberData = result.member;
      finalMCUsername = result.member.minecraftUser || null;
      discordDisplay = targetDiscordUser;
    } else if (!mcArg) {
      // If no discord match and no minecraft arg provided, show error
      return interaction.reply({
        content: discordArg 
          ? `❌ This Discord user isn't linked to the Empire.`
          : `❌ You are not linked. Use \`/link <minecraft_username>\` first.`,
        ephemeral: true,
      });
    }

    // ============================================================
    // 2) SEARCH BY MINECRAFT USERNAME (if provided and no discord match)
    // ============================================================
    if (!finalMCUsername && mcArg) {
      const mcResult = getMemberByMinecraftUser(mcArg);

      if (mcResult && mcResult.member) {
        finalMemberData = mcResult.member;
        finalMCUsername = mcResult.member.minecraftUser || mcResult.exactUsername || mcArg;
        
        // Try to get discord user from member data
        if (mcResult.member.discordId) {
          try {
            discordDisplay = await interaction.client.users.fetch(mcResult.member.discordId);
          } catch (err) {
            console.warn("Could not fetch discord user:", err);
          }
        }
      } else if (mcResult && mcResult.exactUsername) {
        finalMCUsername = mcResult.exactUsername;
      } else {
        finalMCUsername = mcArg;
      }
    }

    // ============================================================
    // 3) ENSURE MC USERNAME EXISTS
    // ============================================================
    if (!finalMCUsername) {
      return interaction.reply({
        content: "❌ You must provide a valid Minecraft username or linked Discord user.",
        ephemeral: true,
      });
    }

    // ============================================================
    // 4) CALCULATE DOMINANT COLOR FROM PLAYER HEAD
    // ============================================================
    const avatarURL = `https://mc-heads.net/avatar/${encodeURIComponent(finalMCUsername)}/100`;
    let embedColor = 0x339eff; // fallback

    try {
      embedColor = await getDominantColor(avatarURL);
    } catch (err) {
      console.warn("[member.js] Failed to get dominant color:", err);
    }

    // ============================================================
    // 5) CREATE EMBED
    // ============================================================
    const embed = createMemberEmbed(
      discordDisplay, 
      finalMemberData || { minecraftUser: finalMCUsername }, 
      embedColor
    );

    return interaction.reply({ embeds: [embed] });
  },
};