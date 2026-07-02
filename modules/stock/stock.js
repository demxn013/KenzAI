// modules/stock/stock.js
// /stock command: clan owners post a market embed (with a generated price
// chart) that lets investors buy/sell shares, paid for with real in-game
// Minecraft money sent to DEMXN13. See modules/stock/stocklogic.js for the
// treasury/holdings math and modules/stock/pendingOrders.js for the 60s
// buy-verification window.

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const { readClans } = require("../database/clansPersistence");
const stocklogic = require("./stocklogic");
const pendingOrders = require("./pendingOrders");
const investorRole = require("./investorRole");
const { renderStockChart, renderStockLineChart, MAX_VISIBLE_CANDLES } = require("./chart");
const donutsmp = require("../servers/donutsmp");
const {
  DEMXN13_IGN,
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
} = require("./stockembed");

const CHART_ATTACHMENT_NAME = "stockchart.png";

const REASON_MESSAGES = {
  clan_not_registered: "This server isn't a registered Yazanaki Empire clan. Use `/clan add` first.",
  no_server_linked: "This clan isn't linked to a Minecraft server yet. Use `/clan edit server:donutsmp` first.",
  no_server_price_configured: "The linked server has no share price configured yet — ask staff to set one.",
};

function replyReason(interaction, reason, fallback = "Something went wrong.") {
  return interaction.reply({
    content: `❌ ${REASON_MESSAGES[reason] || fallback}`,
    flags: MessageFlags.Ephemeral,
  });
}

// ---- Shared market view builder (used by /stock post and the toggle button) ----

/**
 * Build the { embeds, files, components } payload for a clan's market post
 * in the given chart mode. Shared by handlePost and the toggle button so
 * both render from the exact same data/embed/button logic.
 * @param {object} clan
 * @param {object} stock
 * @param {"ohlc"|"line"} mode
 */
function buildMarketView(clan, stock, mode) {
  const visible = (stock.candles || []).slice(-MAX_VISIBLE_CANDLES);
  const priceChange = stocklogic.computePriceChange(visible);

  const chartOpts = {
    title: `${clan.abbr} — ${stock.server}`,
    subtitle: `Current: ${stock.currentPrice.toLocaleString()} per share`,
  };
  const chartBuffer = mode === "line"
    ? renderStockLineChart(stock.candles, chartOpts)
    : renderStockChart(stock.candles, chartOpts);

  const attachment = new AttachmentBuilder(chartBuffer, { name: CHART_ATTACHMENT_NAME });
  const embed = createMarketEmbed(clan, stock, CHART_ATTACHMENT_NAME, priceChange);
  const buttons = createMarketButtons(stock.guildId, mode);

  return { embeds: [embed], files: [attachment], components: [buttons] };
}

// ---- /stock post ---------------------------------------------------------

async function handlePost(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: "❌ This command only works in a clan's Discord server.", flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({ content: "❌ Only this clan's Discord owner can post the stock market.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.getOrCreateStockRecord(interaction.guild.id);
  if (!result.success) return replyReason(interaction, result.reason);

  const payload = buildMarketView(result.clan, result.stock, "ohlc");
  return interaction.reply(payload);
}

// ---- Toggle chart style ---------------------------------------------------

async function handleToggle(interaction, mode, guildId) {
  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);

  if (!clan || !stock) {
    return interaction.reply({ content: "❌ This clan's stock market isn't set up yet.", flags: MessageFlags.Ephemeral });
  }

  const payload = buildMarketView(clan, stock, mode);
  return interaction.update(payload);
}

// ---- /stock portfolio -----------------------------------------------------

async function handlePortfolio(interaction) {
  const holdings = stocklogic.getPortfolio(interaction.user.id);
  const clans = readClans();
  const embed = createPortfolioEmbed(interaction.user.id, holdings, clans);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ---- Buttons --------------------------------------------------------------

function buildOrderModal(kind, guildId) {
  const modal = new ModalBuilder()
    .setCustomId(`stock_${kind}_modal_${guildId}`)
    .setTitle(kind === "buy" ? "Buy Clan Stock" : "Sell Clan Stock")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ign")
          .setLabel("Your Minecraft Username (IGN)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g., Notch")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("shares")
          .setLabel(kind === "buy" ? "How many shares to buy" : "How many shares to sell")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("e.g., 5")
      )
    );
  return modal;
}

async function buttonHandler(interaction) {
  // Button customIds only (modal SUBMISSIONS are routed to modalHandler by
  // interactionCreate.js's isModalSubmit() branch, never here).
  if (interaction.customId.startsWith("stock_markpaid_")) {
    return handleMarkPaid(interaction);
  }

  const toggleMatch = interaction.customId.match(/^stock_toggle_(ohlc|line)_(\d+)$/);
  if (toggleMatch) {
    return handleToggle(interaction, toggleMatch[1], toggleMatch[2]);
  }

  if (interaction.customId.startsWith("stock_buy_")) {
    const guildId = interaction.customId.slice("stock_buy_".length);
    return interaction.showModal(buildOrderModal("buy", guildId));
  }

  if (interaction.customId.startsWith("stock_sell_")) {
    const guildId = interaction.customId.slice("stock_sell_".length);
    return interaction.showModal(buildOrderModal("sell", guildId));
  }
}

async function handleMarkPaid(interaction) {
  const rest = interaction.customId.slice("stock_markpaid_".length);
  const sepIndex = rest.indexOf("_");
  const guildId = rest.slice(0, sepIndex);
  const txId = rest.slice(sepIndex + 1);

  const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!clanGuild) {
    return interaction.reply({ content: "❌ Couldn't find that clan's Discord server anymore.", flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== clanGuild.ownerId) {
    return interaction.reply({ content: "❌ Only this clan's Discord owner can confirm a sell payout.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.markSellPaid(txId);
  if (!result.success) {
    return interaction.reply({ content: "❌ This sell order was already confirmed or no longer exists.", flags: MessageFlags.Ephemeral });
  }

  const pending = stocklogic.getPendingSell(txId);
  await investorRole.revokeInvestorRoleIfZero(clanGuild, pending?.discordId, result.remainingHoldings);

  await interaction.reply({ content: "✅ Sell order marked as paid. Shares returned to the treasury.", flags: MessageFlags.Ephemeral });

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [] }).catch(() => {});
  }
}

// ---- Modals -----------------------------------------------------------

function parseShares(raw) {
  const n = parseInt(String(raw).trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function handleBuyModal(interaction, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ign = interaction.fields.getTextInputValue("ign").trim();
  const shares = parseShares(interaction.fields.getTextInputValue("shares"));

  if (!shares) {
    return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });
  }

  if (pendingOrders.hasPendingBuy(guildId, interaction.user.id)) {
    return interaction.editReply({ content: "⏳ You already have a pending buy order — wait for it to resolve or expire (60s)." });
  }

  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);
  if (!clan || !stock) {
    return interaction.editReply({ content: "❌ This clan's stock isn't set up yet." });
  }

  const cost = shares * stock.currentPrice;

  const reserve = stocklogic.reserveTreasuryShares(guildId, shares);
  if (!reserve.success) {
    return interaction.editReply({ content: `❌ Only ${stock.treasuryShares.toLocaleString()} share(s) are available in the treasury.` });
  }

  const statsRes = await donutsmp.getPlayerStats(ign).catch(() => ({ ok: false }));
  if (!statsRes.ok) {
    stocklogic.refundTreasuryShares(guildId, shares);
    return interaction.editReply({ content: `❌ Couldn't find \`${ign}\` on DonutSMP. Double-check the spelling and try again.` });
  }

  const baselineMoney = Number(statsRes.stats?.money) || 0;

  await interaction.editReply({
    content:
      `💳 Send exactly \`${cost.toLocaleString()}\` to **${DEMXN13_IGN}** in-game ` +
      `(e.g. \`/pay ${DEMXN13_IGN} ${cost}\`) within **60 seconds**. ` +
      `Don't make any other purchases or payments during this window — the bot confirms ` +
      `your order by watching \`${ign}\`'s own balance drop by that amount.`,
  });

  pendingOrders.startBuyWatch(
    { guildId, discordId: interaction.user.id, ign, shares, cost, baselineMoney },
    {
      onConfirmed: async () => {
        stocklogic.completeBuy({ guildId, discordId: interaction.user.id, ign, shares, pricePerShare: stock.currentPrice });

        let roleNote = "";
        const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
        if (clanGuild) {
          const granted = await investorRole.grantInvestorRole(clanGuild, interaction.user.id);
          if (!granted.success && granted.reason === "not_in_guild") {
            roleNote = clan.invite
              ? `\n\nJoin ${clan.abbr}'s Discord to receive your INVESTOR role: ${clan.invite}`
              : `\n\nAsk a ${clan.abbr} officer for a Discord invite to receive your INVESTOR role.`;
          } else if (!granted.success) {
            roleNote = "\n\n⚠️ Couldn't grant the INVESTOR role automatically — ask a clan officer.";
          }
        }

        await interaction.editReply({
          content: `✅ Payment confirmed! You now own **${shares}** more share(s) of **${clan.abbr}**.${roleNote}`,
        }).catch(() => {});
      },
      onTimeout: async () => {
        stocklogic.refundTreasuryShares(guildId, shares);
        await interaction.editReply({
          content: "⌛ No matching payment detected within 60 seconds. No shares were purchased — feel free to try again.",
        }).catch(() => {});
      },
    }
  );
}

async function handleSellModal(interaction, guildId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ign = interaction.fields.getTextInputValue("ign").trim();
  const shares = parseShares(interaction.fields.getTextInputValue("shares"));

  if (!shares) {
    return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });
  }

  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);
  if (!clan || !stock) {
    return interaction.editReply({ content: "❌ This clan's stock isn't set up yet." });
  }

  const result = stocklogic.createPendingSell({
    guildId,
    discordId: interaction.user.id,
    ign,
    shares,
    pricePerShare: stock.currentPrice,
  });

  if (!result.success) {
    return interaction.editReply({ content: "❌ You don't have enough unreserved shares to sell that many." });
  }

  await interaction.editReply({
    content:
      `📉 Sell order placed for **${shares}** share(s) of **${clan.abbr}** ` +
      `(payout: \`${result.payout.toLocaleString()}\`). ${clan.abbr}'s clan owner has been notified ` +
      `to pay you in-game — they'll confirm once it's sent.`,
  });

  const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  const owner = clanGuild ? await clanGuild.fetchOwner().catch(() => null) : null;
  if (owner) {
    const embed = new EmbedBuilder()
      .setTitle(`📉 Pending Sell — ${clan.abbr}`)
      .setColor(0xed4245)
      .setDescription(
        `**${interaction.user.tag}** (IGN: \`${ign}\`) wants to sell **${shares}** share(s).\n` +
        `Pay them \`${result.payout.toLocaleString()}\` in-game, then click below to confirm.`
      );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stock_markpaid_${guildId}_${result.txId}`)
        .setLabel("Mark Paid")
        .setStyle(ButtonStyle.Success)
    );
    await owner.send({ embeds: [embed], components: [row] }).catch(() => {
      console.warn(`[stock] ⚠️ Could not DM clan owner ${owner.id} about pending sell ${result.txId}`);
    });
  }
}

async function modalHandler(interaction) {
  if (interaction.customId.startsWith("stock_buy_modal_")) {
    const guildId = interaction.customId.slice("stock_buy_modal_".length);
    return handleBuyModal(interaction, guildId);
  }
  if (interaction.customId.startsWith("stock_sell_modal_")) {
    const guildId = interaction.customId.slice("stock_sell_modal_".length);
    return handleSellModal(interaction, guildId);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stock")
    .setDescription("Clan stock market")
    .addSubcommand((sub) =>
      sub.setName("post").setDescription("Post this clan's stock market (clan Discord owner only)")
    )
    .addSubcommand((sub) =>
      sub.setName("portfolio").setDescription("View your stock holdings across all clans")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "post") return handlePost(interaction);
    if (sub === "portfolio") return handlePortfolio(interaction);
  },

  buttonHandler,
  modalHandler,
};
