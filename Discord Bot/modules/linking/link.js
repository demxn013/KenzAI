// modules/linking/link.js
// ✅ FIXED: Corrected parameter order when calling linkMember()

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

        console.log(`[/link] 🔗 Linking attempt by ${interaction.user.tag} (${discordId})`);
        console.log(`[/link] 🎮 MC Username provided: ${mcName}`);

        // ✅ FIXED: Correct parameter order - linkMember(discordId, mcName, opts)
        const result = linklogic.linkMember(discordId, mcName);

        console.log(`[/link] 📊 Result:`, result);

        // ---------------------------------------------------------
        // ERROR: already linked
        // ---------------------------------------------------------
        if (!result.success && result.reason === "already_linked") {
            console.log(`[/link] ❌ User already linked to: ${result.details?.minecraftUser}`);
            return interaction.reply({
                content: `❌ You are already linked to Minecraft account: \`${result.details?.minecraftUser}\``,
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // ERROR: username already linked
        // ---------------------------------------------------------
        if (!result.success && result.reason === "username_used") {
            console.log(`[/link] ❌ MC username already in use: ${mcName}`);
            return interaction.reply({
                content: `❌ That Minecraft username is already linked to another Discord user.`,
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // ERROR: invalid arguments
        // ---------------------------------------------------------
        if (!result.success && result.reason === "invalid_arguments") {
            console.log(`[/link] ❌ Invalid arguments`);
            return interaction.reply({
                content: "⚠️ Invalid arguments. Please provide a valid Minecraft username.",
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // ERROR: no MC name provided
        // ---------------------------------------------------------
        if (!result.success && result.reason === "no_mcname_provided") {
            console.log(`[/link] ❌ No MC name provided`);
            return interaction.reply({
                content: "⚠️ Please provide a Minecraft username.",
                ephemeral: true
            });
        }

        // ---------------------------------------------------------
        // SUCCESS
        // ---------------------------------------------------------
        if (result.success) {
            console.log(`[/link] ✅ Successfully linked: ${discordId} -> ${result.minecraftUser}`);
            return interaction.reply({
                content:
                    `✅ **Linked successfully!**\n` +
                    `**Discord:** ${interaction.user.tag}\n` +
                    `**Minecraft:** \`${result.minecraftUser}\``,
                ephemeral: false
            });
        }

        // ---------------------------------------------------------
        // FALLBACK ERROR (should never happen)
        // ---------------------------------------------------------
        console.error(`[/link] ⚠️ Unexpected result:`, result);
        return interaction.reply({
            content: "⚠️ An unexpected error occurred while linking your account.",
            ephemeral: true
        });
    }
};