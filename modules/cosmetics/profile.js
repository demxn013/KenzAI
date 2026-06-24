// modules/cosmetics/profile.js
// /profile — view points, owned badges/cosmetics, and what's equipped.
// Viewing yourself adds equip/unequip controls (ephemeral). Viewing another
// member is public and read-only.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const { isMember, getBalance, getCategoryBalance } = require("../points/pointslogic");
const repo = require("./cosmeticsRepository");
const { TYPE_LABELS, MAX_EQUIPPED_BADGES } = require("./cosmeticsConfig");

function itemLabel(item) {
  const emoji = item.emoji ? `${item.emoji} ` : "";
  return `${emoji}${item.name}`;
}

function listOrDash(lines) {
  if (!lines.length) return "_None_";
  return lines.join("\n").slice(0, 1024);
}

/** Build the profile embed + (optionally) equip/unequip components. */
async function buildView(discordId, displayName, includeControls) {
  const balance = getBalance(discordId) || 0;
  const cats = getCategoryBalance(discordId) || {};
  const owned = repo.isAvailable() ? await repo.getOwned(discordId) : [];
  const equipped = owned.filter((i) => i.equipped);

  const equippedLines = equipped.map(
    (i) => `${itemLabel(i)} — _${TYPE_LABELS[i.type] || i.type}_`
  );
  const ownedLines = owned.map(
    (i) => `${i.equipped ? "✅ " : "▫️ "}${itemLabel(i)} — _${TYPE_LABELS[i.type] || i.type}_`
  );

  const embed = new EmbedBuilder()
    .setTitle(`${displayName}'s Profile`)
    .setColor(0x339eff)
    .addFields(
      {
        name: "💰 Points",
        value: [
          `**${balance}** total`,
          `🟢 Activity \`${cats.activity || 0}\` · 🔵 Development \`${cats.development || 0}\` · 🟠 Contribution \`${cats.contribution || 0}\``,
          `🟡 Skill \`${cats.skill || 0}\` · 🟣 Leadership \`${cats.leadership || 0}\` · ⭐ Special \`${cats.special || 0}\``,
        ].join("\n"),
      },
      { name: "🎖️ Equipped", value: listOrDash(equippedLines) },
      { name: "🎒 Owned", value: listOrDash(ownedLines) }
    );

  if (!repo.isAvailable()) {
    embed.setFooter({ text: "Badges & cosmetics are temporarily unavailable." });
  }

  const components = [];
  if (includeControls && repo.isAvailable()) {
    const equipable = owned.filter((i) => !i.equipped).slice(0, 25);
    if (equipable.length) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("profile_equip_select")
            .setPlaceholder("Equip an item…")
            .addOptions(
              equipable.map((i) => ({
                label: i.name.slice(0, 100),
                value: `profile_equip_${i.item_id}`,
                description: (TYPE_LABELS[i.type] || i.type).slice(0, 100),
              }))
            )
        )
      );
    }
    if (equipped.length) {
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("profile_unequip_select")
            .setPlaceholder("Unequip an item…")
            .addOptions(
              equipped.slice(0, 25).map((i) => ({
                label: i.name.slice(0, 100),
                value: `profile_unequip_${i.item_id}`,
                description: (TYPE_LABELS[i.type] || i.type).slice(0, 100),
              }))
            )
        )
      );
    }
  }

  return { embeds: [embed], components };
}

function reasonToMessage(reason) {
  switch (reason) {
    case "badge_slots_full":
      return `❌ You can only equip ${MAX_EQUIPPED_BADGES} badges at once. Unequip one first.`;
    case "not_owned":
      return "❌ You don't own that item.";
    case "db_unavailable":
      return "🛠️ Cosmetics are temporarily unavailable. Try again later.";
    default:
      return "❌ Could not update your equipped items.";
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your points, badges and cosmetics")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("View another member's profile").setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const isSelf = target.id === interaction.user.id;

    if (!isMember(target.id)) {
      return interaction.reply({
        content: isSelf
          ? "You must be a Yazanaki Empire member to have a profile."
          : "❌ That user is not a Yazanaki Empire member.",
        ephemeral: true,
      });
    }

    const displayName = isSelf
      ? interaction.member?.displayName || interaction.user.username
      : target.username;

    const view = await buildView(target.id, displayName, isSelf);
    return interaction.reply({ ...view, ephemeral: isSelf });
  },

  async selectMenuHandler(interaction) {
    const id = interaction.customId;
    if (id !== "profile_equip_select" && id !== "profile_unequip_select") return;

    const value = interaction.values[0] || "";
    const equipping = id === "profile_equip_select";
    const itemId = value.replace(equipping ? "profile_equip_" : "profile_unequip_", "");

    const result = equipping
      ? await repo.equip(interaction.user.id, itemId)
      : await repo.unequip(interaction.user.id, itemId);

    if (!result.ok) {
      return interaction.reply({ content: reasonToMessage(result.reason), ephemeral: true });
    }

    const displayName = interaction.member?.displayName || interaction.user.username;
    const view = await buildView(interaction.user.id, displayName, true);
    return interaction.update(view);
  },
};
