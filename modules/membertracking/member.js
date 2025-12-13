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
    let discordDisplay = discordArg || null;

    // ============================================================
    // 1) SEARCH BY DISCORD ID
    // ============================================================
    if (discordArg) {
      const result = getMemberByDiscordId(discordArg.id);

      if (result && result.member) {
        finalMemberData = result.member;
        finalMCUsername = result.member.minecraftUser || null;
      } else {
        return interaction.reply({
          content: `❌ This Discord user isn't linked to the Empire.`,
          ephemeral: true,
        });
      }
    }

    // ============================================================
    // 2) SEARCH BY MINECRAFT USERNAME
    // ============================================================
    if (!finalMCUsername && mcArg) {
      const result = getMemberByMinecraftUser(mcArg);

      if (result && result.member) {
        finalMemberData = result.member;
        finalMCUsername = result.member.minecraftUser || result.exactUsername || mcArg;
      } else if (result && result.exactUsername) {
        finalMCUsername = result.exactUsername;
      } else {
        finalMCUsername = mcArg; // always show MC username
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
    const embed = createMemberEmbed(discordDisplay, finalMemberData || { minecraftUser: finalMCUsername }, embedColor);

    return interaction.reply({ embeds: [embed] });
  },
};
