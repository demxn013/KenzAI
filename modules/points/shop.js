// modules/points/shop.js
// /shop — buy BADGES and COSMETICS (capes, pets) with points.
// Catalog is DB-driven (see /catalog admin command); spending reuses the
// existing points logic. Owned items are managed/equipped via /profile.

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");
const { getBalance, isMember } = require("./pointslogic");
const repo = require("../cosmetics/cosmeticsRepository");
const { TYPE_LABELS } = require("../cosmetics/cosmeticsConfig");
const cosmeticsService = require("../cosmetics/cosmeticsService");

// Shop tabs → catalog filters.
const TABS = [
  { id: "shop_badge", label: "Badges", kind: "badge",    type: null,   style: ButtonStyle.Primary },
  { id: "shop_cape",  label: "Capes",  kind: "cosmetic", type: "cape", style: ButtonStyle.Success },
  { id: "shop_pet",   label: "Pets",   kind: "cosmetic", type: "pet",  style: ButtonStyle.Secondary },
];

function ensureReady(interaction) {
  if (!isMember(interaction.user.id)) {
    return { ok: false, message: "You must be a Yazanaki Empire member to use the shop." };
  }
  if (!repo.isAvailable()) {
    return { ok: false, message: "🛠️ The shop is temporarily unavailable. Please try again later or contact staff." };
  }
  return { ok: true };
}

/** Safely resolve a stored emoji string into a select-menu emoji, or undefined. */
function safeEmoji(str) {
  if (!str || typeof str !== "string") return undefined;
  const custom = str.match(/^<(a)?:(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { animated: !!custom[1], name: custom[2], id: custom[3] };
  if ([...str].length <= 3) return str; // short unicode emoji (allow variation selector)
  return undefined;
}

function buildTabRow() {
  return new ActionRowBuilder().addComponents(
    TABS.map((t) => new ButtonBuilder().setCustomId(t.id).setLabel(t.label).setStyle(t.style))
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Buy badges and cosmetics with your points"),

  async execute(interaction) {
    const check = ensureReady(interaction);
    if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });

    const balance = getBalance(interaction.user.id);
    const embed = new EmbedBuilder()
      .setTitle("Yazanaki Shop")
      .setDescription(
        `Your balance: **${balance}** points.\n` +
        "Spend points on **badges** and **cosmetics**. Choose a category below.\n" +
        "Manage and equip what you own with `/profile`.\n\n" +
        "__**Ways to earn points (in-game):**__\n" +
        "- Recruiting a member: `5 contribution points`\n" +
        "- Every 1mil given to leadership: `30 development points`\n" +
        "- Killing a non Yazanaki member wearing maxed neth: `100 skill points`\n" +
        "- Building a farm: `150 development points`"
      )
      .setColor(0x339eff);

    return interaction.reply({ embeds: [embed], components: [buildTabRow()], ephemeral: false });
  },

  async buttonHandler(interaction) {
    const tab = TABS.find((t) => t.id === interaction.customId);
    if (!tab) return;

    const check = ensureReady(interaction);
    if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });

    const balance = getBalance(interaction.user.id);
    const [items, ownedIds] = await Promise.all([
      repo.listItems({ kind: tab.kind, type: tab.type || undefined, enabledOnly: true, purchasableOnly: true }),
      repo.getOwnedIds(interaction.user.id),
    ]);

    // Hide permanent items the member already owns (temporary ones can be re-bought).
    const available = items.filter((it) => !(ownedIds.has(it.item_id) && it.duration_days == null));

    const embed = new EmbedBuilder()
      .setTitle(`Shop — ${tab.label}`)
      .setColor(0x339eff);

    if (available.length === 0) {
      embed.setDescription(
        `Balance: **${balance}** pts.\n\n_No ${tab.label.toLowerCase()} are available right now._`
      );
      return interaction.update({ embeds: [embed], components: [buildTabRow()] });
    }

    embed.setDescription(`Balance: **${balance}** pts. Select an item to buy.`);

    const options = available.slice(0, 25).map((it) => {
      const dur = it.duration_days ? ` · ${it.duration_days}d` : "";
      const opt = {
        label: `${it.name} (${it.cost} pts)`.slice(0, 100),
        value: `shop_buy_${it.item_id}`,
        description: (it.description || `${TYPE_LABELS[it.type] || it.type}${dur}`).slice(0, 100),
      };
      const emoji = safeEmoji(it.emoji);
      if (emoji) opt.emoji = emoji;
      return opt;
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("shop_buy_select")
        .setPlaceholder("Choose an item to buy…")
        .addOptions(options)
    );

    return interaction.update({ embeds: [embed], components: [buildTabRow(), selectRow] });
  },

  async selectMenuHandler(interaction) {
    if (interaction.customId !== "shop_buy_select") return;
    const value = interaction.values[0] || "";
    if (!value.startsWith("shop_buy_")) return;
    const itemId = value.replace("shop_buy_", "");

    const check = ensureReady(interaction);
    if (!check.ok) return interaction.reply({ content: check.message, ephemeral: true });

    // Single shared purchase path (same one the launcher uses via the API).
    const result = await cosmeticsService.purchase(interaction.user.id, itemId);
    if (!result.ok) {
      return interaction.reply({ content: result.message || "❌ Purchase failed.", ephemeral: true });
    }

    return interaction.reply({
      content: `✅ You bought **${result.item.name}**! New balance: **${result.newBalance}** pts. Equip it with \`/profile\`.`,
      ephemeral: true,
    });
  },
};
