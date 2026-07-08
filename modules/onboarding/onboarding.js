// modules/onboarding/onboarding.js
// /onboarding — Royalty-gated admin command to configure the application
// onboarding channel tours (a per-clan list + a shared Yazanaki Empire list).
// Also exports buttonHandler, which routes `onb|...` clicks to the flow engine.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} = require("discord.js");

const draftConfig = require("../empire/draftconfig");
const { loadRolesConfig } = require("../roles/roledetector");
const { readClans } = require("../database/clansPersistence");
const config = require("./onboardingconfig");
const defaults = require("./onboardingdefaults");
const flow = require("./onboardingflow");

const YAZANAKI_EMPIRE_GUILD_ID = draftConfig.YAZANAKI_EMPIRE_GUILD_ID;
const ROYALTY_ROLE_FALLBACK = "1334642034472128654";

// ------------------------------------------------------------
// Royalty gate (same pattern as /clan and /application)
// ------------------------------------------------------------
async function hasRoyaltyRole(interaction) {
  try {
    const guild = await interaction.client.guilds.fetch(YAZANAKI_EMPIRE_GUILD_ID).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) return false;

    const rolesConfig = loadRolesConfig();
    const yazanakiConfig = rolesConfig?.guilds?.[YAZANAKI_EMPIRE_GUILD_ID];
    let royaltyRoleId = null;
    if (yazanakiConfig && yazanakiConfig.statusRoles) {
      const entry = Object.entries(yazanakiConfig.statusRoles).find(
        ([, r]) => r?.name === "Royalty"
      );
      if (entry) royaltyRoleId = entry[0];
    }
    if (!royaltyRoleId) royaltyRoleId = ROYALTY_ROLE_FALLBACK;

    return member.roles.cache.has(royaltyRoleId);
  } catch (err) {
    console.error("[onboarding] Error checking Royalty role:", err);
    return false;
  }
}

/**
 * Resolve which tour a scope maps to and whether it's valid in this guild.
 * - empire → must be run in the Yazanaki Empire guild.
 * - clan   → must be run in a registered clan guild.
 */
function resolveScope(interaction, scope) {
  if (scope === "empire") {
    const ok = interaction.guild?.id === YAZANAKI_EMPIRE_GUILD_ID;
    return {
      ok,
      guildId: YAZANAKI_EMPIRE_GUILD_ID,
      label: "Yazanaki Empire",
      error: ok
        ? null
        : "❌ Run this in the **Yazanaki Empire** server to manage the Empire onboarding tour.",
    };
  }
  const guildId = interaction.guild?.id;
  const clans = readClans();
  const clan = clans[guildId];
  return {
    ok: !!clan,
    guildId,
    clan,
    label: clan ? `${clan.abbr} (${clan.name})` : "this clan",
    error: clan
      ? null
      : "❌ This server isn't a registered clan. Register it first with `/clan add`.",
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("onboarding")
    .setDescription("Configure the application onboarding channel tours")
    .addSubcommand((sub) =>
      sub
        .setName("add-channel")
        .setDescription("Add (or update) a channel in an onboarding tour")
        .addStringOption((opt) =>
          opt
            .setName("scope")
            .setDescription("Which tour to add to")
            .setRequired(true)
            .addChoices(
              { name: "This clan's server", value: "clan" },
              { name: "Yazanaki Empire (shared)", value: "empire" }
            )
        )
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("The channel to feature").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Short title for this step").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("What this channel is for / why it matters")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove-channel")
        .setDescription("Remove a channel from an onboarding tour")
        .addStringOption((opt) =>
          opt
            .setName("scope")
            .setDescription("Which tour to remove from")
            .setRequired(true)
            .addChoices(
              { name: "This clan's server", value: "clan" },
              { name: "Yazanaki Empire (shared)", value: "empire" }
            )
        )
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("The channel to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Show a configured onboarding tour")
        .addStringOption((opt) =>
          opt
            .setName("scope")
            .setDescription("Which tour to show")
            .setRequired(true)
            .addChoices(
              { name: "This clan's server", value: "clan" },
              { name: "Yazanaki Empire (shared)", value: "empire" }
            )
        )
    ),

  async execute(interaction) {
    const royalty = await hasRoyaltyRole(interaction);
    if (!royalty) {
      return interaction.reply({
        content: "❌ You need the **Royalty** role in the Yazanaki Empire discord to use this command.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();
    const scope = interaction.options.getString("scope");
    const resolved = resolveScope(interaction, scope);
    if (!resolved.ok) {
      return interaction.reply({ content: resolved.error, ephemeral: true });
    }

    // --------------------------------------------------------
    // add-channel
    // --------------------------------------------------------
    if (sub === "add-channel") {
      const channel = interaction.options.getChannel("channel");
      const title = interaction.options.getString("title");
      const description = interaction.options.getString("description");

      const entry = { channelId: channel.id, title, description };
      const { updated } = config.addChannel(scope, resolved.guildId, entry);

      // Soft warnings — never block configuration.
      const notes = [];
      const isPostable =
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement;
      if (!isPostable) {
        notes.push(
          "⚠️ This isn't a standard text channel, so onboarding will show it as a **jump link** in the applicant's ticket instead of posting a message inside it."
        );
      } else {
        const me = interaction.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        if (perms && !perms.has(PermissionsBitField.Flags.SendMessages)) {
          notes.push(
            "⚠️ I don't have **Send Messages** permission in that channel — grant it or onboarding will fall back to a jump link in the ticket."
          );
        }
      }

      return interaction.reply({
        content:
          `✅ ${updated ? "Updated" : "Added"} <#${channel.id}> in the **${resolved.label}** onboarding tour.` +
          (notes.length ? `\n\n${notes.join("\n")}` : ""),
        ephemeral: true,
      });
    }

    // --------------------------------------------------------
    // remove-channel
    // --------------------------------------------------------
    if (sub === "remove-channel") {
      const channel = interaction.options.getChannel("channel");
      const { removed } = config.removeChannel(scope, resolved.guildId, channel.id);
      return interaction.reply({
        content: removed
          ? `✅ Removed <#${channel.id}> from the **${resolved.label}** onboarding tour.`
          : `ℹ️ <#${channel.id}> wasn't in the **${resolved.label}** onboarding tour.`,
        ephemeral: true,
      });
    }

    // --------------------------------------------------------
    // list
    // --------------------------------------------------------
    if (sub === "list") {
      const tour = config.getTour(scope, resolved.guildId);
      const embed = new EmbedBuilder()
        .setTitle(`Onboarding tour — ${resolved.label}`)
        .setColor(defaults.EMBED_COLOR);

      if (!tour.length) {
        embed.setDescription(
          "_No channels configured yet._\nAdd some with `/onboarding add-channel`."
        );
      } else {
        embed.setDescription(
          tour
            .map(
              (e, i) =>
                `**${i + 1}. ${e.title}** — <#${e.channelId}>\n> ${e.description || "_(no description)_"}`
            )
            .join("\n\n")
        );
      }

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  // Route onboarding button clicks (onb|...) to the flow engine.
  async buttonHandler(interaction) {
    return flow.handleButton(interaction);
  },
};
