// modules/linking/link.js
const { SlashCommandBuilder } = require("discord.js");
const linklogic = require("./linklogic");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("link")
        .setDescription("Link your Discord account to your Minecraft account.")
        .addStringOption(option =>
            option
                .setName("username")
                .setDescription("Your Minecraft username")
                .setRequired(true)
        ),

    async execute(interaction) {
        const mcName = interaction.options.getString("username");
        const discordId = interaction.user.id;
        const discordTag = interaction.user.tag;

        const result = linklogic.linkMember(discordId, discordTag, mcName);

        // ---------------------------------------------------------
        // ERROR: already linked
        // ---------------------------------------------------------
        if (!result.success && result.reason === "already_linked") {
            return interaction.reply({
                content: "❌ You are already linked to a Minecraft account.",
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // ERROR: username already linked
        // ---------------------------------------------------------
        if (!result.success && result.reason === "username_used") {
            return interaction.reply({
                content: "❌ That Minecraft username is already linked to another Discord user.",
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // SUCCESS: brand new applicant created
        // ---------------------------------------------------------
        if (result.success && result.createdNew) {
            return interaction.reply({
                content:
                    `✅ **Linked successfully!**\n` +
                    `**Minecraft:** \`${mcName}\`\n` +
                    `**Discord:** ${discordTag}`,
                ephemeral: false
            });
        }

        // ---------------------------------------------------------
        // SUCCESS: updated existing applicant
        // ---------------------------------------------------------
        if (result.success && result.updatedExisting) {
            return interaction.reply({
                content:
                    `✅ **Linked successfully!**\n` +
                    `Your existing applicant file was found and updated.\n` +
                    `**Minecraft:** \`${mcName}\``,
                ephemeral: false
            });
        }

        // ---------------------------------------------------------
        // FALLBACK ERROR (should never happen)
        // ---------------------------------------------------------
        return interaction.reply({
            content: "⚠️ An unexpected error occurred while linking your account.",
            ephemeral: true
        });
    }
};
