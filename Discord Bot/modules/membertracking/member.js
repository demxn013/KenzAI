const {
  getMemberByDiscordId,
  getMemberByMinecraftUser,
  getDominantColor,
  getProperMinecraftName,
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
    // DETERMINE TARGET USER (defaults to command invoker)
    // ============================================================
    const targetDiscordUser = discordArg || interaction.user;
    
    console.log(`[/member] Command invoked by: ${interaction.user.tag}`);
    console.log(`[/member] Target Discord User: ${targetDiscordUser.tag} (${targetDiscordUser.id})`);
    console.log(`[/member] MC Arg: ${mcArg || 'none'}`);

    // ============================================================
    // SEARCH BY DISCORD ID (unless MC username explicitly provided)
    // ============================================================
    if (!mcArg) {
      console.log(`[/member] No MC arg, searching by Discord ID...`);
      
      // ✅ PASS CLIENT FOR ROLE DETECTION
      const result = await getMemberByDiscordId(targetDiscordUser.id, interaction.client);
      console.log(`[/member] getMemberByDiscordId result:`, result);

      if (result && result.member) {
        finalMemberData = result.member;
        finalMCUsername = result.member.minecraftUser;
        discordDisplay = targetDiscordUser;
        
        console.log(`[/member] ✅ Found via Discord ID - MC: ${finalMCUsername}`);
        console.log(`[/member] Rank: ${finalMemberData.YazanakiRank}, Status: ${finalMemberData.Status}`);
      } else {
        // Not found in linking.json
        console.log(`[/member] ❌ No link found for Discord ID: ${targetDiscordUser.id}`);
        return interaction.reply({
          content: discordArg 
            ? `❌ <@${discordArg.id}> is not linked. They need to use \`/link <minecraft_username>\` first.`
            : `❌ You are not linked. Use \`/link <minecraft_username>\` to link your account.`,
          ephemeral: true,
        });
      }
    }

    // ============================================================
    // SEARCH BY MINECRAFT USERNAME (if explicitly provided)
    // ============================================================
    if (mcArg) {
      console.log(`[/member] Searching by MC username: ${mcArg}`);
      
      // ✅ PASS CLIENT FOR ROLE DETECTION
      const mcResult = await getMemberByMinecraftUser(mcArg, interaction.client);
      console.log(`[/member] getMemberByMinecraftUser result:`, mcResult);

      if (mcResult && mcResult.member) {
        finalMemberData = mcResult.member;
        finalMCUsername = mcResult.member.minecraftUser || mcResult.exactUsername || mcArg;
        
        console.log(`[/member] ✅ Found via MC username`);
        console.log(`[/member] Rank: ${finalMemberData.YazanakiRank}, Status: ${finalMemberData.Status}`);
        
        // Try to get discord user from member data
        if (mcResult.member.discordId) {
          try {
            discordDisplay = await interaction.client.users.fetch(mcResult.member.discordId);
            console.log(`[/member] ✅ Found Discord user for MC: ${discordDisplay.tag}`);
          } catch (err) {
            console.warn("[/member] Could not fetch discord user:", err);
          }
        }
      } else {
        // MC username not found in linking or members
        finalMCUsername = mcResult?.exactUsername || mcArg;
        console.log(`[/member] ⚠️ MC username not linked, showing basic info for: ${finalMCUsername}`);
      }
    }

    // ============================================================
    // ENSURE MC USERNAME EXISTS
    // ============================================================
    if (!finalMCUsername) {
      console.log(`[/member] ❌ No MC username found at all`);
      return interaction.reply({
        content: "❌ Could not find Minecraft username. Please provide a valid username or link your account.",
        ephemeral: true,
      });
    }

    console.log(`[/member] Final MC Username (before Mojang): ${finalMCUsername}`);

    // ============================================================
    // GET PROPER CAPITALIZATION FROM MOJANG
    // ============================================================
    const properMCUsername = await getProperMinecraftName(finalMCUsername);
    console.log(`[/member] Proper MC Username (from Mojang): ${properMCUsername}`);
    
    // Update the MC username in member data if it exists
    if (finalMemberData) {
      finalMemberData.minecraftUser = properMCUsername;
    }

    console.log(`[/member] Final Member Data:`, finalMemberData);
    console.log(`[/member] Discord Display: ${discordDisplay?.tag || 'none'}`);

    // ============================================================
    // CALCULATE DOMINANT COLOR FROM PLAYER HEAD
    // ============================================================
    const avatarURL = `https://mc-heads.net/avatar/${encodeURIComponent(properMCUsername)}/100`;
    let embedColor = 0x339eff; // fallback

    try {
      embedColor = await getDominantColor(avatarURL);
    } catch (err) {
      console.warn("[/member] Failed to get dominant color:", err);
    }

    // ============================================================
    // CREATE EMBED (unchanged - uses data as-is)
    // ============================================================
    const embed = createMemberEmbed(
      discordDisplay, 
      finalMemberData || { minecraftUser: properMCUsername }, 
      embedColor
    );

    return interaction.reply({ embeds: [embed] });
  },
};