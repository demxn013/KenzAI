// modules/membertracking/pardon.js
// /pardon — Yazanaki Royalty command that undoes ALL forms of punishment for a user:
//   • Lifts the 3-month kick reapply cooldown
//   • Lifts the 3-month rejected-application cooldown
//   • Lifts a permanent ban (and removes the Empire Enemy role)
//   • Dismisses (pardons) every active court case against them
//
// Only members holding the "Royalty" role in the main Yazanaki Empire Discord may use it.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const {
  liftKickCooldown,
  liftBan,
} = require("./memberkickban");
const { getApplicant, deleteApplicant } = require("../applications/applicants");
const { pardonCasesForUser } = require("../judiciary/caselogic");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";
const ROYALTY_ROLE_ID = "1334642034472128654"; // "Royalty" status role in the Yazanaki Empire server

/**
 * Confirm the invoking user holds the Royalty role in the main Yazanaki guild.
 * Works even when the command is run from a clan discord by checking their
 * membership in the main empire server.
 */
async function isRoyalty(interaction) {
  // Fast path: command used inside the main guild.
  if (interaction.guildId === YAZANAKI_EMPIRE_GUILD_ID && interaction.member?.roles?.cache) {
    return interaction.member.roles.cache.has(ROYALTY_ROLE_ID);
  }
  try {
    const guild = await interaction.client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    return !!member && member.roles.cache.has(ROYALTY_ROLE_ID);
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pardon")
    .setDescription("Undo all punishments for a user (kick/rejection cooldowns, ban, court cases)")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to pardon")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("reason")
        .setDescription("Reason for the pardon (optional)")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!(await isRoyalty(interaction))) {
      return interaction.reply({
        content: "❌ Only **Yazanaki Royalty** may use `/pardon`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") || "No reason provided.";

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`[/pardon] 🕊️ Pardon initiated by ${interaction.user.tag}`);
    console.log(`[/pardon] 🎯 Target: ${target.tag} (${target.id})`);
    console.log(`[/pardon] 📋 Reason: ${reason}`);

    const actions = [];

    // 1. Kick cooldown
    try {
      const kick = liftKickCooldown(target.id);
      if (kick.lifted) actions.push("✅ Lifted **kick reapply cooldown**");
    } catch (err) {
      console.error("[/pardon] ❌ Error lifting kick cooldown:", err);
      actions.push("⚠️ Failed to lift kick cooldown (see logs)");
    }

    // 2. Rejected-application cooldown (delete the rejection record)
    try {
      const applicant = getApplicant(target.id);
      if (applicant && !applicant.accepted && applicant.closedAt) {
        if (deleteApplicant(target.id)) {
          actions.push("✅ Lifted **rejected-application cooldown**");
        }
      }
    } catch (err) {
      console.error("[/pardon] ❌ Error lifting rejection cooldown:", err);
      actions.push("⚠️ Failed to lift rejection cooldown (see logs)");
    }

    // 3. Ban (record + Empire Enemy role)
    try {
      const ban = await liftBan(target.id, interaction.client);
      if (ban.lifted) actions.push("✅ Lifted **permanent ban** (Empire Enemy role removed)");
    } catch (err) {
      console.error("[/pardon] ❌ Error lifting ban:", err);
      actions.push("⚠️ Failed to lift ban (see logs)");
    }

    // 4. Active court cases
    try {
      const { pardoned } = pardonCasesForUser(target.id, interaction.user.id);
      if (pardoned.length > 0) {
        actions.push(`✅ Pardoned **${pardoned.length}** court case(s): ${pardoned.map((c) => `\`${c}\``).join(", ")}`);
      }
    } catch (err) {
      console.error("[/pardon] ❌ Error pardoning court cases:", err);
      actions.push("⚠️ Failed to pardon court cases (see logs)");
    }

    const nothingToDo = actions.length === 0;

    const embed = new EmbedBuilder()
      .setTitle("🕊️ Pardon Issued")
      .setColor(nothingToDo ? 0x888888 : 0x2ecc71)
      .setDescription(
        `${target} has been pardoned by ${interaction.user}.\n\n` +
        `**Reason:** ${reason}\n\n` +
        (nothingToDo
          ? "ℹ️ This user had **no active punishments** to undo."
          : `**Actions taken:**\n${actions.join("\n")}`)
      )
      .setFooter({ text: `Pardoned by ${interaction.user.tag}` })
      .setTimestamp();

    console.log(`[/pardon] ✅ Pardon complete — ${actions.length} action(s)`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    return interaction.editReply({ embeds: [embed] });
  },
};
