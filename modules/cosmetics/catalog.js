// modules/cosmetics/catalog.js
// /catalog — admin-only management of the badges & cosmetics catalog and of
// manual/earned grants. Catalog data lives in MySQL (shop_items); ownership in
// member_cosmetics. All writes go through cosmeticsRepository.

const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const repo = require("./cosmeticsRepository");
const { COSMETIC_TYPES, parseCategoryMap } = require("./cosmeticsConfig");
const { isMember } = require("../points/pointslogic");

function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

function normalizeId(raw) {
  return (raw || "").trim().toLowerCase();
}
const ID_RE = /^[a-z0-9_]{2,60}$/;

/** "clear"/"none" → null, otherwise parse "cat:amt,cat:amt". */
function readCategoryOption(value) {
  if (value == null) return undefined; // not provided → leave unchanged
  const v = value.trim().toLowerCase();
  if (v === "" || v === "clear" || v === "none") return null;
  return parseCategoryMap(value);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("catalog")
    .setDescription("Manage badges & cosmetics (admin only)")
    .addSubcommand((s) =>
      s.setName("create-cosmetic").setDescription("Create a cosmetic (cape/pet)")
        .addStringOption((o) => o.setName("id").setDescription("Unique id, e.g. cape_dragon").setRequired(true))
        .addStringOption((o) => o.setName("name").setDescription("Display name").setRequired(true))
        .addStringOption((o) => o.setName("type").setDescription("Cosmetic type").setRequired(true)
          .addChoices(...COSMETIC_TYPES.map((t) => ({ name: t, value: t }))))
        .addIntegerOption((o) => o.setName("cost").setDescription("Point cost").setRequired(true).setMinValue(0))
        .addIntegerOption((o) => o.setName("duration_days").setDescription("Temporary: days until it expires").setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName("description").setDescription("Short description").setRequired(false))
        .addStringOption((o) => o.setName("asset_key").setDescription("Stable key the mod maps to a texture/model").setRequired(false))
        .addStringOption((o) => o.setName("emoji").setDescription("Display emoji").setRequired(false))
    )
    .addSubcommand((s) =>
      s.setName("create-badge").setDescription("Create a badge (emblem)")
        .addStringOption((o) => o.setName("id").setDescription("Unique id, e.g. badge_founder").setRequired(true))
        .addStringOption((o) => o.setName("name").setDescription("Display name").setRequired(true))
        .addIntegerOption((o) => o.setName("cost").setDescription("Point cost (0 if earn-only)").setRequired(false).setMinValue(0))
        .addBooleanOption((o) => o.setName("purchasable").setDescription("Can it be bought in /shop? (default true)").setRequired(false))
        .addIntegerOption((o) => o.setName("duration_days").setDescription("Temporary: days until it expires").setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName("description").setDescription("Short description").setRequired(false))
        .addStringOption((o) => o.setName("emoji").setDescription("Display emoji").setRequired(false))
    )
    .addSubcommand((s) =>
      s.setName("edit").setDescription("Edit an existing item")
        .addStringOption((o) => o.setName("id").setDescription("Item id").setRequired(true))
        .addStringOption((o) => o.setName("name").setDescription("Display name").setRequired(false))
        .addIntegerOption((o) => o.setName("cost").setDescription("Point cost").setRequired(false).setMinValue(0))
        .addStringOption((o) => o.setName("description").setDescription("Short description").setRequired(false))
        .addIntegerOption((o) => o.setName("duration_days").setDescription("Days until expiry (0 = permanent)").setRequired(false).setMinValue(0))
        .addBooleanOption((o) => o.setName("purchasable").setDescription("Buyable in /shop?").setRequired(false))
        .addBooleanOption((o) => o.setName("enabled").setDescription("Visible/active?").setRequired(false))
        .addStringOption((o) => o.setName("asset_key").setDescription("Mod asset key").setRequired(false))
        .addStringOption((o) => o.setName("emoji").setDescription("Display emoji").setRequired(false))
        .addStringOption((o) => o.setName("gate").setDescription("Hidden category gate, e.g. skill:100,development:50 (or 'clear')").setRequired(false))
        .addStringOption((o) => o.setName("deduct").setDescription("Per-category cost, e.g. skill:200,activity:100 (or 'clear')").setRequired(false))
    )
    .addSubcommand((s) => s.setName("enable").setDescription("Enable an item")
      .addStringOption((o) => o.setName("id").setDescription("Item id").setRequired(true)))
    .addSubcommand((s) => s.setName("disable").setDescription("Disable an item")
      .addStringOption((o) => o.setName("id").setDescription("Item id").setRequired(true)))
    .addSubcommand((s) => s.setName("delete").setDescription("Delete an item (and all ownership of it)")
      .addStringOption((o) => o.setName("id").setDescription("Item id").setRequired(true)))
    .addSubcommand((s) => s.setName("list").setDescription("List catalog items")
      .addStringOption((o) => o.setName("kind").setDescription("Filter").setRequired(false)
        .addChoices({ name: "badge", value: "badge" }, { name: "cosmetic", value: "cosmetic" })))
    .addSubcommand((s) => s.setName("grant").setDescription("Give an item to a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("item_id").setDescription("Item id").setRequired(true))
      .addIntegerOption((o) => o.setName("duration_days").setDescription("Override expiry in days").setRequired(false).setMinValue(1)))
    .addSubcommand((s) => s.setName("revoke").setDescription("Remove an item from a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("item_id").setDescription("Item id").setRequired(true))),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: "❌ You need Administrator permission to manage the catalog.", ephemeral: true });
    }
    if (!repo.isAvailable()) {
      return interaction.reply({ content: "🛠️ The catalog database is unavailable. Enable MySQL and run `/db migrate`.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ── create-cosmetic ──────────────────────────────────────
    if (sub === "create-cosmetic") {
      const id = normalizeId(interaction.options.getString("id"));
      if (!ID_RE.test(id)) return interaction.reply({ content: "❌ Invalid id. Use lowercase letters, numbers, underscores (2–60).", ephemeral: true });
      if (await repo.getItem(id)) return interaction.reply({ content: `❌ An item with id \`${id}\` already exists. Use \`/catalog edit\`.`, ephemeral: true });

      await repo.upsertItem({
        item_id: id,
        kind: "cosmetic",
        type: interaction.options.getString("type"),
        name: interaction.options.getString("name"),
        cost: interaction.options.getInteger("cost"),
        duration_days: interaction.options.getInteger("duration_days") ?? null,
        description: interaction.options.getString("description") ?? "",
        asset_key: interaction.options.getString("asset_key") ?? null,
        emoji: interaction.options.getString("emoji") ?? null,
        purchasable: true,
        enabled: true,
      });
      return interaction.reply({ content: `✅ Created cosmetic \`${id}\`.`, ephemeral: true });
    }

    // ── create-badge ─────────────────────────────────────────
    if (sub === "create-badge") {
      const id = normalizeId(interaction.options.getString("id"));
      if (!ID_RE.test(id)) return interaction.reply({ content: "❌ Invalid id. Use lowercase letters, numbers, underscores (2–60).", ephemeral: true });
      if (await repo.getItem(id)) return interaction.reply({ content: `❌ An item with id \`${id}\` already exists. Use \`/catalog edit\`.`, ephemeral: true });

      const purchasable = interaction.options.getBoolean("purchasable");
      await repo.upsertItem({
        item_id: id,
        kind: "badge",
        type: "badge",
        name: interaction.options.getString("name"),
        cost: interaction.options.getInteger("cost") ?? 0,
        duration_days: interaction.options.getInteger("duration_days") ?? null,
        description: interaction.options.getString("description") ?? "",
        emoji: interaction.options.getString("emoji") ?? null,
        purchasable: purchasable == null ? true : purchasable,
        enabled: true,
      });
      return interaction.reply({ content: `✅ Created badge \`${id}\`.`, ephemeral: true });
    }

    // ── edit ─────────────────────────────────────────────────
    if (sub === "edit") {
      const id = normalizeId(interaction.options.getString("id"));
      const existing = await repo.getItem(id);
      if (!existing) return interaction.reply({ content: `❌ No item with id \`${id}\`.`, ephemeral: true });

      const fields = { item_id: id };
      const name = interaction.options.getString("name");
      const cost = interaction.options.getInteger("cost");
      const description = interaction.options.getString("description");
      const durationDays = interaction.options.getInteger("duration_days");
      const purchasable = interaction.options.getBoolean("purchasable");
      const enabled = interaction.options.getBoolean("enabled");
      const assetKey = interaction.options.getString("asset_key");
      const emoji = interaction.options.getString("emoji");
      const gate = readCategoryOption(interaction.options.getString("gate"));
      const deduct = readCategoryOption(interaction.options.getString("deduct"));

      if (name != null) fields.name = name;
      if (cost != null) fields.cost = cost;
      if (description != null) fields.description = description;
      if (durationDays != null) fields.duration_days = durationDays === 0 ? null : durationDays;
      if (purchasable != null) fields.purchasable = purchasable;
      if (enabled != null) fields.enabled = enabled;
      if (assetKey != null) fields.asset_key = assetKey;
      if (emoji != null) fields.emoji = emoji;
      if (gate !== undefined) fields.category_requirements = gate;
      if (deduct !== undefined) fields.deduct_map = deduct;

      await repo.upsertItem(fields);
      return interaction.reply({ content: `✅ Updated \`${id}\`.`, ephemeral: true });
    }

    // ── enable / disable ─────────────────────────────────────
    if (sub === "enable" || sub === "disable") {
      const id = normalizeId(interaction.options.getString("id"));
      const res = await repo.setEnabled(id, sub === "enable");
      if (!res.ok) return interaction.reply({ content: `❌ No item with id \`${id}\`.`, ephemeral: true });
      return interaction.reply({ content: `✅ \`${id}\` ${sub}d.`, ephemeral: true });
    }

    // ── delete ───────────────────────────────────────────────
    if (sub === "delete") {
      const id = normalizeId(interaction.options.getString("id"));
      const res = await repo.deleteItem(id);
      if (!res.ok) return interaction.reply({ content: `❌ No item with id \`${id}\`.`, ephemeral: true });
      return interaction.reply({ content: `🗑️ Deleted \`${id}\` and removed it from all inventories.`, ephemeral: true });
    }

    // ── list ─────────────────────────────────────────────────
    if (sub === "list") {
      const kind = interaction.options.getString("kind") || undefined;
      const items = await repo.listItems({ kind });
      if (!items.length) return interaction.reply({ content: "_No catalog items yet._", ephemeral: true });

      const lines = items.map((i) => {
        const flags = [];
        if (!i.enabled) flags.push("disabled");
        if (!i.purchasable) flags.push("not-buyable");
        if (i.duration_days) flags.push(`${i.duration_days}d`);
        const tag = flags.length ? ` _(${flags.join(", ")})_` : "";
        return `\`${i.item_id}\` — ${i.emoji ? i.emoji + " " : ""}${i.name} · ${i.kind}/${i.type} · ${i.cost} pts${tag}`;
      });
      const embed = new EmbedBuilder()
        .setTitle("Catalog")
        .setDescription(lines.join("\n").slice(0, 4000))
        .setColor(0x339eff);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ── grant ────────────────────────────────────────────────
    if (sub === "grant") {
      const user = interaction.options.getUser("user");
      const itemId = normalizeId(interaction.options.getString("item_id"));
      const durationDays = interaction.options.getInteger("duration_days") ?? undefined;

      if (!isMember(user.id)) return interaction.reply({ content: `❌ ${user.tag} is not a registered member.`, ephemeral: true });
      const res = await repo.grant(user.id, itemId, "grant", durationDays);
      if (!res.ok) {
        return interaction.reply({ content: res.reason === "no_such_item" ? `❌ No item with id \`${itemId}\`.` : "❌ Grant failed.", ephemeral: true });
      }
      const exp = res.expiresAt ? ` (expires ${res.expiresAt} UTC)` : "";
      return interaction.reply({ content: `✅ Granted **${res.item.name}** to ${user.tag}${exp}.`, ephemeral: true });
    }

    // ── revoke ───────────────────────────────────────────────
    if (sub === "revoke") {
      const user = interaction.options.getUser("user");
      const itemId = normalizeId(interaction.options.getString("item_id"));
      const res = await repo.revoke(user.id, itemId);
      if (!res.ok) return interaction.reply({ content: `❌ ${user.tag} doesn't own \`${itemId}\`.`, ephemeral: true });
      return interaction.reply({ content: `✅ Revoked \`${itemId}\` from ${user.tag}.`, ephemeral: true });
    }
  },
};
