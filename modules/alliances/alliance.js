// modules/alliances/alliance.js
// /alliance command — lets a Yazanaki clan form and manage an alliance.
// An alliance belongs to exactly ONE Yazanaki clan: a different clan cannot join
// an alliance another clan is already in.

const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const alliancelogic = require("./alliancelogic");
const clanlogic = require("../clantracking/clanlogic");
const { createAllianceEmbed } = require("./allianceembed");
const draftConfig = require("../empire/draftconfig");
const { loadRolesConfig } = require("../roles/roledetector");

// Resolve a user-typed clan reference (abbr or name) to its guild id + clan entry.
function resolveClan(clans, input) {
  if (!input) return null;
  const guildId = Object.keys(clans).find(id =>
    clans[id].abbr?.toLowerCase() === input.toLowerCase() ||
    clans[id].name?.toLowerCase() === input.toLowerCase()
  );
  return guildId ? { guildId, clan: clans[guildId] } : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("alliance")
    .setDescription("Form, leave, or view a clan alliance")
    .addSubcommand(sub =>
      sub
        .setName("join")
        .setDescription("Join (or form) an alliance with your clan")
        .addStringOption(opt => opt.setName("alliance").setDescription("Alliance name").setRequired(true))
        .addStringOption(opt => opt.setName("clan").setDescription("Your clan (abbreviation or name)").setRequired(true))
        .addStringOption(opt => opt.setName("invite").setDescription("Discord invite link for the alliance").setRequired(false))
        .addAttachmentOption(opt => opt.setName("flag").setDescription("Flag for the alliance (PNG)").setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName("leave")
        .setDescription("Leave (dissolve) an alliance")
        .addStringOption(opt => opt.setName("alliance").setDescription("Alliance name").setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View alliance info")
        .addStringOption(opt => opt.setName("alliance").setDescription("Alliance name").setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── Permission gate: join/leave require the Royalty role in the Yazanaki Empire ──
    if (sub === "join" || sub === "leave") {
      try {
        const yazanakiGuild = await interaction.client.guilds.fetch(draftConfig.YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
        const yazanakiMember = yazanakiGuild
          ? await yazanakiGuild.members.fetch(interaction.user.id).catch(() => null)
          : null;

        const rolesConfig = loadRolesConfig();
        const yazanakiConfig = rolesConfig?.guilds?.[draftConfig.YAZANAKI_EMPIRE_GUILD_ID];
        let royaltyRoleId = null;

        if (yazanakiConfig && yazanakiConfig.statusRoles) {
          const royaltyEntry = Object.entries(yazanakiConfig.statusRoles).find(
            ([, roleData]) => roleData?.name === "Royalty"
          );
          if (royaltyEntry) royaltyRoleId = royaltyEntry[0];
        }

        // Fallback to known Royalty role ID if not found in config.
        if (!royaltyRoleId) royaltyRoleId = "1334642034472128654";

        if (!yazanakiGuild || !yazanakiMember || !royaltyRoleId || !yazanakiMember.roles.cache.has(royaltyRoleId)) {
          return interaction.reply({
            content: "❌ You must have the **Royalty** role in the Yazanaki Empire discord to manage alliances.",
            ephemeral: true
          });
        }
      } catch (err) {
        console.error("[alliance] Error checking Royalty role:", err);
        return interaction.reply({
          content: "❌ Failed to verify your permissions in the Yazanaki Empire discord. Please try again later.",
          ephemeral: true
        });
      }
    }

    const alliances = alliancelogic.readAlliances();

    // -------------------------------------------------------------------------
    // JOIN / FORM ALLIANCE
    // -------------------------------------------------------------------------
    if (sub === "join") {
      await interaction.deferReply();

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[/alliance join] 🎯 Invoked by: ${interaction.user.tag} (${interaction.user.id})`);

      const allianceName = interaction.options.getString("alliance").trim();
      const clanInput = interaction.options.getString("clan");
      const invite = interaction.options.getString("invite");
      const flag = interaction.options.getAttachment("flag");

      const slug = alliancelogic.slugify(allianceName);
      if (!slug) {
        return interaction.editReply({ content: "❌ Please provide a valid alliance name.", ephemeral: true });
      }

      // Resolve the clan that wants to join.
      const clans = clanlogic.readClans();
      const resolved = resolveClan(clans, clanInput);
      if (!resolved) {
        console.log(`[/alliance join] ❌ Clan not found: ${clanInput}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({ content: `❌ Clan **${clanInput}** not found.`, ephemeral: true });
      }
      const { guildId: clanGuildId, clan } = resolved;

      const existing = alliances[slug];

      // Enforce one Yazanaki clan per alliance.
      if (existing && existing.clanGuildId && existing.clanGuildId !== clanGuildId) {
        console.log(`[/alliance join] ❌ Alliance "${existing.name}" already owned by ${existing.clanAbbr}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        return interaction.editReply({
          content: `❌ Alliance **${existing.name}** already belongs to clan **${existing.clanAbbr}: ${existing.clanName}**. A different clan can't join an alliance another clan is in.`,
          ephemeral: true
        });
      }

      const isNew = !existing;
      const alliance = existing || {
        name: allianceName,
        invite: null,
        clanGuildId,
        clanAbbr: clan.abbr,
        clanName: clan.name,
        createdAt: new Date().toISOString().split("T")[0],
      };

      // Keep the display name and owning clan details fresh.
      alliance.name = allianceName || alliance.name;
      alliance.clanGuildId = clanGuildId;
      alliance.clanAbbr = clan.abbr;
      alliance.clanName = clan.name;

      const changes = [];
      if (invite) {
        alliance.invite = invite.trim();
        changes.push("🔗 Invite link set.");
      }
      if (flag) {
        try {
          await alliancelogic.saveFlagFromAttachment(slug, flag);
          changes.push("🚩 Flag updated.");
        } catch (err) {
          console.error("[/alliance join] Failed to save flag:", err);
          changes.push("⚠️ Failed to save flag (only PNG is allowed).");
        }
      }

      alliances[slug] = alliance;
      alliancelogic.writeAlliances(alliances);

      console.log(`[/alliance join] ✅ ${clan.abbr} ${isNew ? "formed" : "updated"} alliance "${alliance.name}"`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      const header = isNew
        ? `🤝 **Alliance Formed: ${alliance.name}**\n\nClan **${clan.abbr}: ${clan.name}** now leads this alliance.`
        : `✅ **Alliance Updated: ${alliance.name}**\n\nLed by clan **${clan.abbr}: ${clan.name}**.`;

      return interaction.editReply({
        content: changes.length ? `${header}\n\n${changes.join("\n")}` : header
      });
    }

    // -------------------------------------------------------------------------
    // LEAVE / DISSOLVE ALLIANCE
    // -------------------------------------------------------------------------
    if (sub === "leave") {
      await interaction.deferReply();

      const input = interaction.options.getString("alliance");
      const slug = alliancelogic.findAllianceSlug(alliances, input);

      if (!slug || !alliances[slug]) {
        return interaction.editReply({ content: `❌ Alliance **${input}** not found.`, ephemeral: true });
      }

      const removed = alliances[slug];
      delete alliances[slug];
      alliancelogic.writeAlliances(alliances);

      try { alliancelogic.deleteFlag(slug); } catch {}

      return interaction.editReply({
        content: `🗑️ Clan **${removed.clanAbbr}: ${removed.clanName}** left alliance **${removed.name}** — the alliance has been dissolved.`
      });
    }

    // -------------------------------------------------------------------------
    // VIEW ALLIANCE
    // -------------------------------------------------------------------------
    if (sub === "view") {
      await interaction.deferReply();

      const input = interaction.options.getString("alliance");
      const slug = alliancelogic.findAllianceSlug(alliances, input);

      if (!slug || !alliances[slug]) {
        return interaction.editReply({ content: `❌ Alliance **${input}** not found.`, ephemeral: true });
      }

      const alliance = alliances[slug];
      const clanText = alliance.clanAbbr ? `\`${alliance.clanAbbr}: ${alliance.clanName}\`` : "``n/d``";
      const inviteText = alliance.invite ? `[Join ${alliance.name}](${alliance.invite})` : "``n/d``";

      const hasFlag = alliancelogic.flagExists(slug);
      const flagPath = alliancelogic.getFlagPath(slug);
      const flagFileName = `${slug}.png`;

      let color = 0x000000;
      try {
        if (hasFlag) color = await alliancelogic.getDominantColor(flagPath);
      } catch {}

      const embed = createAllianceEmbed(
        alliance,
        clanText,
        inviteText,
        hasFlag ? flagFileName : null,
        color
      );

      if (hasFlag) {
        const attachment = new AttachmentBuilder(flagPath, { name: flagFileName });
        return interaction.editReply({ embeds: [embed], files: [attachment] });
      }
      return interaction.editReply({ embeds: [embed] });
    }
  }
};
