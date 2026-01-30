// modules/linking/autolink-test.js
// ✅ Diagnostic command to test and debug autolink system

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const { processApplicant, autolinkAll } = require("./autolink");
const { getApplicant, getAllApplicants } = require("../applications/applicants");
const { getMCFromDiscord } = require("./linklogic");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autolink-test")
    .setDescription("Test and diagnose autolink system")
    .addSubcommand(sub =>
      sub
        .setName("check")
        .setDescription("Check if a user can be autolinked")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("Discord user to check")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("force")
        .setDescription("Force autolink for a user")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("Discord user to force autolink")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("bulk")
        .setDescription("Autolink all unlinked applicants")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Show autolink system status")
    ),

  async execute(interaction) {
    // Check permissions
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
      return interaction.reply({
        content: "❌ You need the **Kick Members** permission to use this command.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();

    // ============================================================
    // CHECK USER
    // ============================================================
    if (sub === "check") {
      await interaction.deferReply({ ephemeral: true });

      const user = interaction.options.getUser("user");
      const applicant = getApplicant(user.id);

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Autolink Check: ${user.tag}`)
        .setThumbnail(user.displayAvatarURL())
        .setColor(0x000000);

      if (!applicant) {
        embed.setDescription("❌ **Not an applicant**\n\nThis user has no application data.")
          .setColor(0xFF0000);
        return interaction.editReply({ embeds: [embed], ephemeral: true });
      }

      // Check if already linked
      const existingLink = getMCFromDiscord(user.id);
      
      const mcName = applicant.minecraftUser || applicant.minecraftName;

      embed.addFields(
        { name: "Application Status", value: applicant.accepted ? "✅ Accepted" : "⏳ Pending", inline: true },
        { name: "Already Linked", value: existingLink ? `✅ Yes: \`${existingLink}\`` : "❌ No", inline: true },
        { name: "Minecraft Username (from app)", value: mcName ? `\`${mcName}\`` : "❌ **MISSING**", inline: false }
      );

      if (mcName && !existingLink) {
        embed.setDescription("✅ **Can be autolinked**\n\nThis user has all required data and is not yet linked.")
          .setColor(0x00AA00);
      } else if (existingLink) {
        embed.setDescription("⚠️ **Already linked**\n\nThis user is already linked. Autolink not needed.")
          .setColor(0xFFAA00);
      } else {
        embed.setDescription("❌ **Cannot be autolinked**\n\nMissing Minecraft username in application data.")
          .setColor(0xFF0000);
      }

      // Show applicant data for debugging
      embed.addFields({
        name: "Debug Data",
        value: `\`\`\`json\n${JSON.stringify({
          minecraftUser: applicant.minecraftUser || null,
          minecraftName: applicant.minecraftName || null,
          minecraftVersion: applicant.minecraftVersion || null,
          accepted: applicant.accepted || false,
          closedAt: applicant.closedAt || null
        }, null, 2)}\n\`\`\``,
        inline: false
      });

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // FORCE AUTOLINK
    // ============================================================
    if (sub === "force") {
      await interaction.deferReply({ ephemeral: true });

      const user = interaction.options.getUser("user");

      const embed = new EmbedBuilder()
        .setTitle(`🔗 Force Autolink: ${user.tag}`)
        .setThumbnail(user.displayAvatarURL());

      console.log(`[autolink-test] 🔧 Force autolink triggered for ${user.tag} (${user.id})`);

      const result = await processApplicant(user.id, 0);

      if (result.success) {
        embed.setDescription(`✅ **Successfully linked!**\n\nDiscord: ${user.tag}\nMinecraft: \`${result.minecraftUser}\``)
          .setColor(0x00AA00);
      } else {
        const reasons = {
          'no_applicant_or_no_mc': 'User has no application data or missing Minecraft username',
          'already_linked': 'User is already linked to a Minecraft account',
          'username_used': 'This Minecraft username is already linked to another Discord account',
          'exception': `An error occurred: ${result.error || 'Unknown error'}`
        };

        embed.setDescription(`❌ **Autolink failed**\n\nReason: ${reasons[result.reason] || result.reason}`)
          .setColor(0xFF0000);
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // BULK AUTOLINK
    // ============================================================
    if (sub === "bulk") {
      await interaction.deferReply({ ephemeral: true });

      await interaction.editReply({
        content: "🔄 Starting bulk autolink process...\nThis may take a while depending on the number of applicants.",
        ephemeral: true
      });

      const results = await autolinkAll();

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      const embed = new EmbedBuilder()
        .setTitle("🔗 Bulk Autolink Complete")
        .setColor(0x000000)
        .addFields(
          { name: "Total Processed", value: `\`${results.length}\``, inline: true },
          { name: "✅ Successful", value: `\`${successful.length}\``, inline: true },
          { name: "❌ Failed", value: `\`${failed.length}\``, inline: true }
        );

      if (successful.length > 0) {
        const successList = successful
          .slice(0, 10)
          .map(r => `• <@${r.discordId}> → \`${r.minecraftUser}\``)
          .join("\n");
        
        embed.addFields({
          name: "✅ Successfully Linked",
          value: successList + (successful.length > 10 ? `\n*...and ${successful.length - 10} more*` : ""),
          inline: false
        });
      }

      if (failed.length > 0) {
        const failureReasons = {};
        failed.forEach(r => {
          failureReasons[r.reason] = (failureReasons[r.reason] || 0) + 1;
        });

        const failList = Object.entries(failureReasons)
          .map(([reason, count]) => `• ${reason}: ${count}`)
          .join("\n");

        embed.addFields({
          name: "❌ Failure Breakdown",
          value: failList,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }

    // ============================================================
    // STATUS
    // ============================================================
    if (sub === "status") {
      await interaction.deferReply({ ephemeral: true });

      const allApplicants = getAllApplicants();
      const applicantIds = Object.keys(allApplicants);

      let totalApplicants = applicantIds.length;
      let withMC = 0;
      let withoutMC = 0;
      let alreadyLinked = 0;
      let canAutolink = 0;

      for (const id of applicantIds) {
        const app = allApplicants[id];
        const mcName = app.minecraftUser || app.minecraftName;
        const existingLink = getMCFromDiscord(id);

        if (mcName) {
          withMC++;
          if (existingLink) {
            alreadyLinked++;
          } else {
            canAutolink++;
          }
        } else {
          withoutMC++;
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("📊 Autolink System Status")
        .setColor(0x000000)
        .addFields(
          { name: "Total Applicants", value: `\`${totalApplicants}\``, inline: true },
          { name: "With MC Username", value: `\`${withMC}\``, inline: true },
          { name: "Without MC Username", value: `\`${withoutMC}\``, inline: true },
          { name: "Already Linked", value: `\`${alreadyLinked}\``, inline: true },
          { name: "Can Be Autolinked", value: `\`${canAutolink}\``, inline: true },
          { name: "‎", value: "‎", inline: true }
        );

      if (canAutolink > 0) {
        embed.addFields({
          name: "💡 Tip",
          value: `You have ${canAutolink} applicant(s) that can be autolinked.\nUse \`/autolink-test bulk\` to link them all.`,
          inline: false
        });
      }

      return interaction.editReply({ embeds: [embed], ephemeral: true });
    }
  }
};