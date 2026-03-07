// modules/yazanaki/yazanaki.js
// ✅ Yazanaki Empire information command

const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { createYazanakiEmbed } = require("./yazanakiembed");
const { getEmpireStatsAndLeaders } = require("./yazanakilogic");
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
      // ✅ STEP 1: GET EMPIRE STATISTICS AND LEADERS IN ONE CALL
      // ============================================================
      console.log(`[/yazanaki] 📊 Fetching empire data...`);
      
      const empireData = await getEmpireStatsAndLeaders(interaction.client);
      
      console.log(`[/yazanaki] ✅ Stats: ${empireData.totalUniquePeople} unique, ${empireData.totalResidents} residents`);
      console.log(`[/yazanaki] ✅ Emperor: ${empireData.emperor}`);
      console.log(`[/yazanaki] ✅ Empress: ${empireData.empress}`);

      // ============================================================
      // STEP 2: PREPARE EMPIRE DATA FOR EMBED
      // ============================================================
      const empireEmbedData = {
        totalUniquePeople: empireData.totalUniquePeople,
        totalResidents: empireData.totalResidents,
        inviteLink: `[Join Yazanaki Empire](${EMPIRE_INVITE_LINK})`
      };

      // ============================================================
      // STEP 3: PREPARE EMBLEM AND FLAG
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
      // STEP 4: CREATE EMBED
      // ============================================================
      console.log(`[/yazanaki] 📝 Creating embed...`);

      const embed = createYazanakiEmbed(
        empireEmbedData,
        empireData.emperor,    // ✅ From combined fetch
        empireData.empress,    // ✅ From combined fetch
        emblemUrl,
        flagFileName,
        0x000000 // Black color
      );

      // ============================================================
      // STEP 5: SEND EMBED
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