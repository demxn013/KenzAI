// modules/clantracking/clan.js
// ✅ UPDATED: Now automatically adds guilds to role detection when adding clans

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const clanlogic = require("./clanlogic");
const { createClanEmbed } = require("./clanembed");
const { addGuildRoles, removeGuildRoles } = require("../roles/roledetector");
const path = require("path");
const fs = require("fs");
const https = require("https");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clan")
    .setDescription("Manage or view clan information")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add a clan")
        .addStringOption(opt => opt.setName("guildid").setDescription("Discord Guild ID").setRequired(true))
        .addStringOption(opt => opt.setName("abbreviation").setDescription("Clan abbreviation").setRequired(true))
        .addStringOption(opt => opt.setName("name").setDescription("Clan name").setRequired(true))
        .addAttachmentOption(opt => opt.setName("flag").setDescription("Optional clan flag PNG (must be PNG)"))
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a clan")
        .addStringOption(opt => opt.setName("guildid").setDescription("Discord Guild ID").setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View clan info")
        .addStringOption(opt => opt.setName("clan").setDescription("Clan name or abbreviation"))
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription("List all registered clans")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const clans = clanlogic.readClans();

    // -------------------------------------------------------------------------
    // ADD CLAN
    // -------------------------------------------------------------------------
    if (sub === "add") {
      await interaction.deferReply();

      const guildId = interaction.options.getString("guildid");
      const abbr = interaction.options.getString("abbreviation").toUpperCase();
      const name = interaction.options.getString("name");
      const flagAttachment = interaction.options.getAttachment("flag");

      if (clans[guildId]) {
        return interaction.editReply({
          content: "❌ That guild is already registered as a clan.",
          ephemeral: true
        });
      }

      clans[guildId] = {
        abbr,
        name,
        joinedEmpire: new Date().toISOString().split("T")[0]
      };

      // Create a new invite in the channel the command was used in
      try {
        const channel = interaction.channel;
        const invite = await channel?.createInvite({ maxAge: 0, maxUses: 0, unique: true });
        clans[guildId].invite = invite?.url || "#";
      } catch (err) {
        console.warn("Failed to create invite:", err);
        clans[guildId].invite = "#";
      }

      clanlogic.writeClans(clans);

      // ✅ AUTOMATICALLY ADD GUILD TO ROLE DETECTION
      console.log(`[clan add] 🎭 Adding guild to role detection: ${name} (${guildId})`);
      
      try {
        const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        
        if (guild) {
          const roleSuccess = await addGuildRoles(guildId, name, guild);
          
          if (roleSuccess) {
            console.log(`[clan add] ✅ Successfully added guild roles for ${name}`);
            
            return interaction.editReply({
              content: 
                `✅ Clan **${abbr}: ${name}** added.\n` +
                `🎭 Guild roles automatically imported to \`modules/data/roles.json\`\n\n` +
                `⚠️ **Next Step:** Edit \`modules/data/roles.json\` to organize roles into:\n` +
                `  • \`statusRoles\` - Enemy, Ally, Citizen, Draft, Military, Council, Royalty\n` +
                `  • \`rankRoles\` - Citizen, Recruit, Captain, General, etc.\n\n` +
                `All roles are currently in \`rankRoles\` by default.`,
              ephemeral: false
            });
          } else {
            console.warn(`[clan add] ⚠️ Failed to add guild roles for ${name}`);
            
            return interaction.editReply({
              content: 
                `✅ Clan **${abbr}: ${name}** added.\n` +
                `⚠️ Could not auto-import roles. Manually add them to \`modules/data/roles.json\``,
              ephemeral: false
            });
          }
        } else {
          console.warn(`[clan add] ⚠️ Could not fetch guild ${guildId} for role detection`);
          
          return interaction.editReply({
            content: 
              `✅ Clan **${abbr}: ${name}** added.\n` +
              `⚠️ Bot is not in that guild. Add bot to guild, then manually import roles.`,
            ephemeral: false
          });
        }
      } catch (err) {
        console.error(`[clan add] ❌ Error adding guild roles:`, err);
        
        return interaction.editReply({
          content: `⚠️ Clan added, but role import failed: ${err.message}`,
          ephemeral: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // REMOVE CLAN
    // -------------------------------------------------------------------------
    if (sub === "remove") {
      await interaction.deferReply();
      const guildId = interaction.options.getString("guildid");

      if (!clans[guildId]) {
        return interaction.editReply({ content: "❌ No clan found.", ephemeral: true });
      }

      const removed = clans[guildId];
      delete clans[guildId];
      clanlogic.writeClans(clans);

      try {
        clanlogic.deleteFlag(removed.abbr);
      } catch {}

      // ✅ OPTIONALLY REMOVE FROM ROLE DETECTION
      try {
        const roleRemoved = removeGuildRoles(guildId);
        
        if (roleRemoved) {
          return interaction.editReply({
            content: 
              `🗑 Removed clan **${removed.abbr}: ${removed.name}**.\n` +
              `🎭 Also removed from role detection.`
          });
        } else {
          return interaction.editReply({
            content: 
              `🗑 Removed clan **${removed.abbr}: ${removed.name}**.\n` +
              `⚠️ Guild was not in role detection config.`
          });
        }
      } catch (err) {
        return interaction.editReply({
          content: 
            `🗑 Removed clan **${removed.abbr}: ${removed.name}**.\n` +
            `⚠️ Could not remove from role detection: ${err.message}`
        });
      }
    }

    // -------------------------------------------------------------------------
    // VIEW CLAN
    // -------------------------------------------------------------------------
    if (sub === "view") {
      await interaction.deferReply();

      let input = interaction.options.getString("clan");
      let guildId;

      if (!input) {
        guildId = interaction.guildId;
      } else {
        guildId = Object.keys(clans).find(id =>
          clans[id].abbr.toLowerCase() === input.toLowerCase() ||
          clans[id].name.toLowerCase() === input.toLowerCase()
        );
      }

      if (!guildId || !clans[guildId]) {
        return interaction.editReply({ content: "❌ Clan not found.", ephemeral: true });
      }

      const clan = clans[guildId];
      const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);

      if (!guild) {
        return interaction.editReply({
          content: "⚠️ Bot cannot access that guild.",
          ephemeral: true
        });
      }

      const owner = await guild.fetchOwner().catch(() => null);
      const leader = owner ? `<@${owner.id}>` : "`n/d`";
      const residents = "`n/d`";

      const jd = clan.joinedEmpire?.split("-");
      const joinedDateText = jd?.length === 3 ? `\`${jd[2]}/${jd[1]}/${jd[0]}\`` : "`n/d`";

      const size = `\`${guild.memberCount}\``;

      // Always create or validate invite in current channel
      let invite = clan.invite || "#";
      try {
        const channel = interaction.channel;
        const currentInvites = await guild.invites.fetch().catch(() => null);
        let existing = currentInvites?.find(i => i.url === invite);
        if (!existing) {
          const newInvite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true });
          invite = newInvite?.url || "#";
          clan.invite = invite;
          clanlogic.writeClans(clans);
        }
      } catch (err) {
        console.warn("Failed to fetch/create invite:", err);
      }

      const inviteTxt = `[Join ${clan.abbr}](${invite})`;

      const iconURL = guild.iconURL({ size: 256, extension: "png" });

      // --- IMAGE PRIORITY SYSTEM ---
      // 1) downloaded guild banner
      // 2) ABBR.png from /clanflags
      // 3) nothing
      const bannerPath = clanlogic.getFlagPath(clan.abbr);
      let useBannerPath = false;

      const bannerURL = guild.bannerURL({ size: 512, extension: "png" });
      if (bannerURL) {
        // always download latest banner
        await new Promise((resolve) => {
          const file = fs.createWriteStream(bannerPath);
          https.get(bannerURL, (res) => {
            if (res.statusCode === 200) {
              res.pipe(file);
              file.on("finish", () => { file.close(); useBannerPath = true; resolve(); });
            } else resolve();
          }).on("error", () => resolve());
        });
      }

      const flagExists = clanlogic.flagExists(clan.abbr);
      const flagFileName = `${clan.abbr.toUpperCase()}.png`;
      const flagPath = clanlogic.getFlagPath(clan.abbr);

      let embedColor = 0x000000;
      try {
        if (useBannerPath) embedColor = await clanlogic.getDominantColor(bannerPath);
        else if (flagExists) embedColor = await clanlogic.getDominantColor(flagPath);
        else if (iconURL) embedColor = await clanlogic.getDominantColor(iconURL);
      } catch {}

      const embed = createClanEmbed(
        clan,
        leader,
        residents,
        joinedDateText,
        size,
        inviteTxt,
        iconURL,
        useBannerPath || flagExists ? flagFileName : null,
        embedColor
      );

      if (useBannerPath || flagExists) {
        const attachment = new AttachmentBuilder(useBannerPath ? bannerPath : flagPath, { name: flagFileName });
        return interaction.editReply({ embeds: [embed], files: [attachment] });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // -------------------------------------------------------------------------
    // LIST CLANS
    // -------------------------------------------------------------------------
    if (sub === "list") {
      await interaction.deferReply();
      const arr = Object.entries(clans);
      if (!arr.length) return interaction.editReply({ content: "No clans registered.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle("__Registered Clans__")
        .setColor(0x000000)
        .setDescription(arr.map(([id, c]) => {
          const invite = c.invite || "n/d";
          return `[${c.abbr}: ${c.name}](${invite})`;
        }).join("\n"));

      return interaction.editReply({ embeds: [embed] });
    }
  }
};