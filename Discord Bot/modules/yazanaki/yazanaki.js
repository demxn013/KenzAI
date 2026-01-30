// modules/yazanaki/yazanaki.js
// ✅ Yazanaki Empire information command

const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { createYazanakiEmbed } = require("./yazanakiembed");
const { getEmpireStats, getEmpireLeaders } = require("./yazanakilogic");
const path = require("path");
const fs = require("fs");

// Yazanaki Empire Guild ID
const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

// Empire invite link (you can change this)
const EMPIRE_INVITE_LINK = "https://discord.gg/yazanaki-1220847061797179524"; // ✅ REPLACE WITH YOUR ACTUAL INVITE LINK

module.exports = {
  data: new SlashCommandBuilder()
    .setName("yazanaki")
    .setDescription("View Yazanaki Empire information"),

  async execute(interaction) {
    await interaction.deferReply();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/yazanaki] 🏛️ Command invoked by ${interaction.user.tag}`);

    try {
      // ============================================================
      // STEP 1: GET EMPIRE STATISTICS
      // ============================================================
      console.log(`[/yazanaki] 📊 Fetching empire statistics...`);
      
      const empireStats = getEmpireStats();
      
      console.log(`[/yazanaki] ✅ Stats: ${empireStats.totalUniquePeople} unique, ${empireStats.totalResidents} residents`);

      // ============================================================
      // STEP 2: GET EMPEROR AND EMPRESS
      // ============================================================
      console.log(`[/yazanaki] 👑 Fetching empire leaders...`);
      
      let emperorMention = "``n/d``";
      let empressMention = "``n/d``";
      
      try {
        const yazanakiGuild = await interaction.client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
        
        if (yazanakiGuild) {
          const leaders = await getEmpireLeaders(yazanakiGuild);
          emperorMention = leaders.emperor;
          empressMention = leaders.empress;
          
          console.log(`[/yazanaki] ✅ Emperor: ${emperorMention}`);
          console.log(`[/yazanaki] ✅ Empress: ${empressMention}`);
        } else {
          console.warn(`[/yazanaki] ⚠️ Could not fetch Yazanaki Empire guild`);
        }
      } catch (err) {
        console.error(`[/yazanaki] ❌ Error fetching leaders:`, err.message);
      }

      // ============================================================
      // STEP 3: PREPARE EMPIRE DATA
      // ============================================================
      const empireData = {
        totalUniquePeople: empireStats.totalUniquePeople,
        totalResidents: empireStats.totalResidents,
        inviteLink: `[Join Yazanaki Empire](${EMPIRE_INVITE_LINK})`
      };

      // ============================================================
      // STEP 4: PREPARE EMBLEM AND FLAG
      // ============================================================
      const emblemPath = path.join(__dirname, "../images/clanflags/YZNKI.png");
      const flagPath = path.join(__dirname, "../images/clanflags/YAZANAKI.png");

      console.log(`[/yazanaki] 🖼️ Checking for emblem at: ${emblemPath}`);
      console.log(`[/yazanaki] 🏳️ Checking for flag at: ${flagPath}`);

      const emblemExists = fs.existsSync(emblemPath);
      const flagExists = fs.existsSync(flagPath);

      console.log(`[/yazanaki] 🖼️ Emblem exists: ${emblemExists}`);
      console.log(`[/yazanaki] 🏳️ Flag exists: ${flagExists}`);

      let emblemUrl = null;
      let flagAttachment = null;
      let flagFileName = null;

      // If emblem exists, use it as thumbnail
      if (emblemExists) {
        // We'll attach it and reference it
        emblemUrl = "attachment://YZNKI.png";
      }

      // If flag exists, attach it
      if (flagExists) {
        flagFileName = "YAZANAKI.png";
        flagAttachment = new AttachmentBuilder(flagPath, { name: flagFileName });
      }

      // ============================================================
      // STEP 5: CREATE EMBED
      // ============================================================
      console.log(`[/yazanaki] 📝 Creating embed...`);

      const embed = createYazanakiEmbed(
        empireData,
        emperorMention,
        empressMention,
        emblemUrl,
        flagFileName,
        0x000000 // Black color
      );

      // ============================================================
      // STEP 6: SEND EMBED
      // ============================================================
      console.log(`[/yazanaki] 📤 Sending embed...`);

      const attachments = [];

      // Add emblem attachment if it exists
      if (emblemExists) {
        attachments.push(new AttachmentBuilder(emblemPath, { name: "YZNKI.png" }));
      }

      // Add flag attachment if it exists
      if (flagAttachment) {
        attachments.push(flagAttachment);
      }

      if (attachments.length > 0) {
        await interaction.editReply({ 
          embeds: [embed], 
          files: attachments 
        });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }

      console.log(`[/yazanaki] ✅ Embed sent successfully`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    } catch (err) {
      console.error(`[/yazanaki] ❌ Error executing command:`, err);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return interaction.editReply({
        content: "❌ An error occurred while fetching empire information.",
        ephemeral: true
      });
    }
  }
};