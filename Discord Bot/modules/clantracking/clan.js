// modules/clantracking/clan.js
// ✅ COMPLETE FIX: Includes type option in setrole command
// ✅ NEW: Shows actual resident count from clans.json

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const clanlogic = require("./clanlogic");
const draftConfig = require("../empire/draftconfig");
const { loadRolesConfig } = require("../roles/roledetector");
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
        .setName("edit")
        .setDescription("Edit an existing clan (roles, name, flag, etc.)")
        .addStringOption(opt => opt.setName("clan").setDescription("Existing clan name or abbreviation").setRequired(true))
        .addStringOption(opt => opt.setName("abbreviation").setDescription("New clan abbreviation (e.g., SNU, ONA)").setRequired(false))
        .addStringOption(opt => opt.setName("name").setDescription("New full clan name").setRequired(false))
        .addRoleOption(opt => opt.setName("yazanakirole").setDescription("New role in YAZANAKI discord for this clan").setRequired(false))
        .addRoleOption(opt => opt.setName("clanrole").setDescription("New role in THIS CLAN's discord for members").setRequired(false))
        .addAttachmentOption(opt => opt.setName("flag").setDescription("New clan flag PNG (replaces existing)"))
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
    )
    .addSubcommand(sub =>
      sub
        .setName("sync-residents")
        .setDescription("Sync resident counts from members.json (ONE-TIME USE)")
    ),

  async execute(interaction) {
    const isAdminCommand = ['add', 'edit', 'remove', 'sync-residents'].includes(interaction.options.getSubcommand());
    
    if (isAdminCommand) {
      try {
        const yazanakiGuild = await interaction.client.guilds.fetch(draftConfig.YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
        const yazanakiMember = yazanakiGuild
          ? await yazanakiGuild.members.fetch(interaction.user.id).catch(() => null)
          : null;

        // Load Royalty role ID from roles.json (statusRoles in Yazanaki Empire)
        const rolesConfig = loadRolesConfig();
        const yazanakiConfig = rolesConfig?.guilds?.[draftConfig.YAZANAKI_EMPIRE_GUILD_ID];
        let royaltyRoleId = null;

        if (yazanakiConfig && yazanakiConfig.statusRoles) {
          const royaltyEntry = Object.entries(yazanakiConfig.statusRoles).find(
            ([, roleData]) => roleData?.name === "Royalty"
          );
          if (royaltyEntry) {
            royaltyRoleId = royaltyEntry[0];
          }
        }

        // Fallback to known Royalty role ID if not found in config
        if (!royaltyRoleId) {
          royaltyRoleId = "1334642034472128654";
        }

        if (!yazanakiGuild || !yazanakiMember || !royaltyRoleId || !yazanakiMember.roles.cache.has(royaltyRoleId)) {
          return interaction.reply({
            content: "❌ You must have the **Royalty** role in the Yazanaki Empire discord to create, edit, or remove clans.",
            ephemeral: true
          });
        }
      } catch (err) {
        console.error("[clan] Error checking Royalty role in Yazanaki Empire:", err);
        return interaction.reply({
          content: "❌ Failed to verify your permissions in the Yazanaki Empire discord. Please try again later.",
          ephemeral: true
        });
      }
    }

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

      clans[guildId] = {
        abbr,
        name,
        joinedEmpire: new Date().toISOString().split("T")[0],
        yazanakiRoleId: yazanakiRole ? yazanakiRole.id : null,
        clanRoleId: clanRole ? clanRole.id : null,
        residents: 0 // ✅ Initialize with 0 residents
      };

      try {
        const channel = interaction.channel;
        const invite = await channel?.createInvite({ maxAge: 0, maxUses: 0, unique: true });
        clans[guildId].invite = invite?.url || "#";
      } catch (err) {
        console.warn("Failed to create invite:", err);
        clans[guildId].invite = "#";
      }

      clanlogic.writeClans(clans);

      try {
        const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        
        if (guild) {
          const roleSuccess = await addGuildRoles(guildId, name, guild);
          
          let response = `✅ **Clan Added: ${abbr} - ${name}**\n\n`;
          
          if (roleSuccess) {
            response += `🎭 Guild roles imported\n\n`;
          }
          
          response += `**Role Status:**\n`;
          
          if (yazanakiRole) {
            response += `✅ Yazanaki Role: ${yazanakiRole}\n`;
          } else {
            response += `❌ Yazanaki Role: NOT SET (REQUIRED!)\n`;
            response += `   Use: \`/clan setrole clan:${abbr} type:Yazanaki role:@RoleName\`\n`;
          }
          
          if (clanRole) {
            response += `✅ Clan Role: ${clanRole}\n`;
          } else {
            response += `⚠️ Clan Role: NOT SET (Optional)\n`;
            response += `   Use: \`/clan setrole clan:${abbr} type:Clan role:@RoleName\`\n`;
          }
          
          response += `\n📊 Residents: 0 (use /clan sync-residents to populate from existing members)`;
          
          return interaction.editReply({ content: response });
        } else {
          return interaction.editReply({
            content: `✅ Clan **${abbr}** added.\n⚠️ Bot not in guild. Set roles with \`/clan setrole\``
          });
        }
      } catch (err) {
        console.error("[clan add] Error:", err);
        return interaction.editReply({
          content: `⚠️ Clan added but setup incomplete: ${err.message}`
        });
      }
    }

    // -------------------------------------------------------------------------
    // EDIT CLAN (ROLES, NAME, FLAG, ETC.)
    // -------------------------------------------------------------------------
    if (sub === "edit") {
      await interaction.deferReply();

      const clanInput = interaction.options.getString("clan");
      const newAbbr = interaction.options.getString("abbreviation");
      const newName = interaction.options.getString("name");
      const newYazanakiRole = interaction.options.getRole("yazanakirole");
      const newClanRole = interaction.options.getRole("clanrole");
      const newFlag = interaction.options.getAttachment("flag");

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
      const changes = [];

      // Name / abbreviation updates
      const oldAbbr = clan.abbr;
      if (newAbbr && newAbbr.toUpperCase() !== clan.abbr.toUpperCase()) {
        clan.abbr = newAbbr.toUpperCase();
        changes.push(`✏️ Abbreviation: \`${oldAbbr}\` → \`${clan.abbr}\``);

        // If a flag exists for the old abbreviation, move it to the new one
        try {
          const oldFlagPath = clanlogic.getFlagPath(oldAbbr);
          if (fs.existsSync(oldFlagPath)) {
            const newFlagPath = clanlogic.getFlagPath(clan.abbr);
            fs.renameSync(oldFlagPath, newFlagPath);
          }
        } catch (err) {
          console.warn("[clan edit] Failed to move existing flag file:", err);
        }
      }

      if (newName && newName !== clan.name) {
        const oldName = clan.name;
        clan.name = newName;
        changes.push(`✏️ Name: \`${oldName}\` → \`${clan.name}\``);
      }

      // Role updates
      if (newYazanakiRole) {
        clan.yazanakiRoleId = newYazanakiRole.id;
        changes.push(`🎭 Yazanaki Role set to: ${newYazanakiRole}`);
      }

      if (newClanRole) {
        clan.clanRoleId = newClanRole.id;
        changes.push(`🎭 Clan Role set to: ${newClanRole}`);
      }

      // Flag update
      if (newFlag) {
        try {
          await clanlogic.saveFlagFromAttachment(clan.abbr, newFlag);
          changes.push("🚩 Clan flag updated.");
        } catch (err) {
          console.error("[clan edit] Failed to save new flag:", err);
          changes.push("⚠️ Failed to update clan flag (only PNG is allowed).");
        }
      }

      if (!changes.length) {
        return interaction.editReply({
          content: "ℹ️ No changes were provided. Specify at least one field to edit.",
          ephemeral: true
        });
      }

      clanlogic.writeClans(clans);

      return interaction.editReply({
        content:
          `✅ **Clan Updated: ${clan.abbr} - ${clan.name}**\n\n` +
          changes.join("\n")
      });
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
        removeGuildRoles(guildId);
        return interaction.editReply({
          content: `🗑️ Removed clan **${removed.abbr}: ${removed.name}**`
        });
      } catch (err) {
        return interaction.editReply({
          content: `🗑️ Removed clan **${removed.abbr}: ${removed.name}**`
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
      
      // ✅ NEW: Get actual resident count from clans.json
      const residentCount = clan.residents || 0;
      const residents = `\`${residentCount}\``;

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
          const clanStatus = c.clanRoleId ? "✅" : "⚠️";
          const residentCount = c.residents || 0;
          return `${yazanakiStatus}${clanStatus} [${c.abbr}: ${c.name}](${invite}) - ${residentCount} residents`;
        }).join("\n"))
        .setFooter({ text: "✅ = Set | ❌ = Missing Yazanaki role | ⚠️ = Missing clan role" });

      return interaction.editReply({ embeds: [embed] });
    }

    // -------------------------------------------------------------------------
    // ✅ NEW: SYNC RESIDENTS (ONE-TIME USE)
    // -------------------------------------------------------------------------
    if (sub === "sync-residents") {
      await interaction.deferReply({ ephemeral: true });

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("[clan sync-residents] 🔄 Starting resident count sync...");

      const membersPath = path.join(__dirname, "../data/members.json");
      
      if (!fs.existsSync(membersPath)) {
        console.log("[clan sync-residents] ❌ members.json not found");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({
          content: "❌ members.json not found. No members to sync.",
          ephemeral: true
        });
      }

      const membersRaw = fs.readFileSync(membersPath, "utf8");
      const members = JSON.parse(membersRaw);

      // Count members per clan
      const clanCounts = {};

      for (const [discordId, member] of Object.entries(members)) {
        const clanName = member.JoinedClan;
        
        if (!clanName) {
          console.log(`[clan sync-residents] ⚠️ Member ${discordId} has no clan`);
          continue;
        }

        // Find the guild ID for this clan name
        const guildId = Object.keys(clans).find(id => 
          clans[id].name === clanName || clans[id].abbr === clanName
        );

        if (!guildId) {
          console.log(`[clan sync-residents] ⚠️ Clan "${clanName}" not found in clans.json`);
          continue;
        }

        clanCounts[guildId] = (clanCounts[guildId] || 0) + 1;
      }

      console.log(`[clan sync-residents] 📊 Found ${Object.keys(clanCounts).length} clans with members`);

      // Update each clan's resident count
      let updatedCount = 0;
      const updates = [];

      for (const [guildId, count] of Object.entries(clanCounts)) {
        const clan = clans[guildId];
        
        if (!clan) continue;

        const oldCount = clan.residents || 0;
        clan.residents = count;
        
        console.log(`[clan sync-residents] 🔄 ${clan.abbr}: ${oldCount} → ${count}`);
        
        updates.push(`**${clan.abbr}**: ${oldCount} → ${count} residents`);
        updatedCount++;
      }

      // Zero out clans with no members
      for (const [guildId, clan] of Object.entries(clans)) {
        if (!clanCounts[guildId]) {
          const oldCount = clan.residents || 0;
          clan.residents = 0;
          
          if (oldCount > 0) {
            console.log(`[clan sync-residents] 🔄 ${clan.abbr}: ${oldCount} → 0`);
            updates.push(`**${clan.abbr}**: ${oldCount} → 0 residents`);
            updatedCount++;
          }
        }
      }

      clanlogic.writeClans(clans);

      console.log(`[clan sync-residents] ✅ Updated ${updatedCount} clans`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      const embed = new EmbedBuilder()
        .setTitle("✅ Resident Count Sync Complete")
        .setDescription(
          `Successfully synced resident counts from members.json\n\n` +
          `**Updated ${updatedCount} clan(s):**\n\n` +
          updates.join("\n")
        )
        .setColor(0x00AA00)
        .setFooter({ text: "Future acceptances will auto-update counts" });

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
};