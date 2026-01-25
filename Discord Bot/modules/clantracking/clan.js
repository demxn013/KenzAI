// modules/clantracking/clan.js
// ✅ UPDATED: Now supports BOTH Yazanaki role ID AND clan's own role ID

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
        .addStringOption(opt => opt.setName("guildid").setDescription("Discord Guild ID of the clan").setRequired(true))
        .addStringOption(opt => opt.setName("abbreviation").setDescription("Clan abbreviation (e.g., SNU, ONA)").setRequired(true))
        .addStringOption(opt => opt.setName("name").setDescription("Full clan name").setRequired(true))
        .addRoleOption(opt => opt.setName("yazanakirole").setDescription("Role in YAZANAKI discord for this clan").setRequired(false))
        .addRoleOption(opt => opt.setName("clanrole").setDescription("Role in THIS CLAN's discord for members").setRequired(false))
        .addAttachmentOption(opt => opt.setName("flag").setDescription("Optional clan flag PNG"))
    )
    .addSubcommand(sub =>
      sub
        .setName("setrole")
        .setDescription("Set roles for a clan")
        .addStringOption(opt => opt.setName("clan").setDescription("Clan name or abbreviation").setRequired(true))
        .addStringOption(opt => 
          opt
            .setName("type")
            .setDescription("Which role to set")
            .setRequired(true)
            .addChoices(
              { name: "Yazanaki Role (role in Yazanaki discord)", value: "yazanaki" },
              { name: "Clan Role (role in clan's own discord)", value: "clan" }
            )
        )
        .addRoleOption(opt => opt.setName("role").setDescription("The role to set").setRequired(true))
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
      const yazanakiRole = interaction.options.getRole("yazanakirole");
      const clanRole = interaction.options.getRole("clanrole");

      if (clans[guildId]) {
        return interaction.editReply({
          content: "❌ That guild is already registered as a clan.",
          ephemeral: true
        });
      }

      // ✅ Store BOTH role IDs
      clans[guildId] = {
        abbr,  // Critical for Empire ID format: ABBR-XXXXXX
        name,
        joinedEmpire: new Date().toISOString().split("T")[0],
        yazanakiRoleId: yazanakiRole ? yazanakiRole.id : null,  // Role in Yazanaki discord
        clanRoleId: clanRole ? clanRole.id : null  // Role in clan's own discord
      };

      // Create invite
      try {
        const channel = interaction.channel;
        const invite = await channel?.createInvite({ maxAge: 0, maxUses: 0, unique: true });
        clans[guildId].invite = invite?.url || "#";
      } catch (err) {
        console.warn("Failed to create invite:", err);
        clans[guildId].invite = "#";
      }

      clanlogic.writeClans(clans);

      // Auto-add guild to role detection
      console.log(`[clan add] 🎭 Adding guild to role detection: ${name} (${guildId})`);
      
      try {
        const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        
        if (guild) {
          const roleSuccess = await addGuildRoles(guildId, name, guild);
          
          let response = `✅ Clan **${abbr}: ${name}** added.\n\n`;
          
          if (roleSuccess) {
            response += `🎭 Guild roles automatically imported to \`roles.json\`\n`;
          }
          
          // Role status
          if (yazanakiRole) {
            response += `✅ Yazanaki role: ${yazanakiRole}\n`;
          } else {
            response += `⚠️ Yazanaki role: NOT SET\n`;
          }
          
          if (clanRole) {
            response += `✅ Clan role: ${clanRole}\n`;
          } else {
            response += `⚠️ Clan role: NOT SET\n`;
          }
          
          response += `\n**Next Steps:**\n`;
          
          if (!yazanakiRole) {
            response += `• Use \`/clan setrole clan:${abbr} type:Yazanaki role:<role>\` to set Yazanaki discord role\n`;
          }
          
          if (!clanRole) {
            response += `• Use \`/clan setrole clan:${abbr} type:Clan role:<role>\` to set clan discord role\n`;
          }
          
          return interaction.editReply({
            content: response,
            ephemeral: false
          });
        } else {
          return interaction.editReply({
            content: 
              `✅ Clan **${abbr}: ${name}** added.\n` +
              `⚠️ Bot is not in that guild. Add bot to guild first.`,
            ephemeral: false
          });
        }
      } catch (err) {
        console.error(`[clan add] ❌ Error:`, err);
        return interaction.editReply({
          content: `⚠️ Clan added, but setup incomplete: ${err.message}`,
          ephemeral: false
        });
      }
    }

    // -------------------------------------------------------------------------
    // SET ROLE
    // -------------------------------------------------------------------------
    if (sub === "setrole") {
      await interaction.deferReply();

      const clanInput = interaction.options.getString("clan");
      const roleType = interaction.options.getString("type");
      const role = interaction.options.getRole("role");

      // Find clan by abbr or name
      const guildId = Object.keys(clans).find(id =>
        clans[id].abbr.toLowerCase() === clanInput.toLowerCase() ||
        clans[id].name.toLowerCase() === clanInput.toLowerCase()
      );

      if (!guildId || !clans[guildId]) {
        return interaction.editReply({
          content: `❌ Clan **${clanInput}** not found.`,
          ephemeral: true
        });
      }

      const clan = clans[guildId];
      
      // Update the appropriate role
      if (roleType === "yazanaki") {
        clan.yazanakiRoleId = role.id;
        clanlogic.writeClans(clans);
        
        return interaction.editReply({
          content: 
            `✅ Updated **${clan.abbr}: ${clan.name}**\n` +
            `🎭 Yazanaki Empire role set to: ${role}\n\n` +
            `ℹ️ When users apply to this clan and get accepted, they will receive this role in the Yazanaki Empire discord.`,
          ephemeral: false
        });
      } else {
        clan.clanRoleId = role.id;
        clanlogic.writeClans(clans);
        
        return interaction.editReply({
          content: 
            `✅ Updated **${clan.abbr}: ${clan.name}**\n` +
            `🎭 Clan member role set to: ${role}\n\n` +
            `ℹ️ When users apply to this clan and get accepted, they will receive this role in the clan's own discord.`,
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

      const bannerPath = clanlogic.getFlagPath(clan.abbr);
      let useBannerPath = false;

      const bannerURL = guild.bannerURL({ size: 512, extension: "png" });
      if (bannerURL) {
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
          const yazanakiStatus = c.yazanakiRoleId ? "✅" : "❌";
          const clanStatus = c.clanRoleId ? "✅" : "❌";
          return `${yazanakiStatus}${clanStatus} [${c.abbr}: ${c.name}](${invite})`;
        }).join("\n"))
        .setFooter({ text: "✅✅ = Both roles configured | ❌ = Missing role" });

      return interaction.editReply({ embeds: [embed] });
    }
  }
};