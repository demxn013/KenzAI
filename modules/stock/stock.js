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
  PermissionsBitField,
} = require("discord.js");

const path = require("path");
const fs = require("fs");
const { readClans } = require("../database/clansPersistence");
const stocklogic = require("./stocklogic");
const pendingOrders = require("./pendingOrders");
const investorRole = require("./investorRole");
const { renderStockChart, renderStockLineChart, MAX_VISIBLE_CANDLES } = require("./chart");
const { serverDisplayName, hasStatsApi, getServerClient } = require("../servers/serverRegistry");
const {
  DEMXN13_IGN,
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
} = require("./stockembed");

/** Staff = Discord Administrator (the DEMXN13 operators who confirm payments). */
function isAdmin(interaction) {
  return interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}

const CHART_ATTACHMENT_NAME = "stockchart.png";
const EMBLEMS_DIR = path.join(__dirname, "..", "images", "clanemblems");

/** Absolute path to a clan's emblem PNG, or null if it doesn't exist. */
function getEmblemPath(abbr) {
  if (!abbr) return null;
  const p = path.join(EMBLEMS_DIR, `${abbr.toUpperCase()}.png`);
  return fs.existsSync(p) ? p : null;
}

const REASON_MESSAGES = {
  clan_not_registered: "This server isn't a registered Yazanaki Empire clan. Use `/clan add` first.",
  no_server_linked: "This clan isn't linked to a Minecraft server yet. Use `/clan edit` with a server (e.g. `donutsmp`, `elementalmc`, `freshsmp`) first.",
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
async function buildMarketView(clan, stock, mode) {
  const visible = (stock.candles || []).slice(-MAX_VISIBLE_CANDLES);
  const priceChange = stocklogic.computePriceChange(visible);
  const serverLabel = serverDisplayName(stock.server);

  const chartOpts = {
    clanAbbr: clan.abbr,
    serverLabel,
    currentPrice: stock.currentPrice,
    priceChange,
    emblemPath: getEmblemPath(clan.abbr),
  };
  const chartBuffer = mode === "line"
    ? await renderStockLineChart(stock.candles, chartOpts)
    : await renderStockChart(stock.candles, chartOpts);

  const attachment = new AttachmentBuilder(chartBuffer, { name: CHART_ATTACHMENT_NAME });
  const embed = createMarketEmbed(clan, stock, CHART_ATTACHMENT_NAME, priceChange);
  const buttons = createMarketButtons(stock.guildId, mode);

  return { embeds: [embed], files: [attachment], components: [buttons] };
}

/**
 * Re-render an already-posted market message in place so it reflects fresh
 * stock state (new price, reduced treasury, updated chart) right after a
 * trade. Preserves whichever chart mode the message is currently showing.
 * @param {import("discord.js").Message} message - the market post message
 * @param {string} guildId
 */
async function refreshMarketMessage(message, guildId) {
  if (!message) return;
  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);
  if (!clan || !stock) return;

  // The toggle button's customId is stock_toggle_<nextMode>_<guildId>, so the
  // mode currently on screen is the opposite of that "next" mode.
  let mode = "ohlc";
  for (const row of message.components || []) {
    for (const comp of row.components || []) {
      const cid = comp.customId || comp.custom_id || "";
      if (cid.startsWith("stock_toggle_")) {
        const nextMode = cid.slice("stock_toggle_".length).split("_")[0];
        mode = nextMode === "line" ? "ohlc" : "line";
      }
    }
  }

  const payload = await buildMarketView(clan, stock, mode);
  // attachments: [] drops the stale chart image so the new one replaces it.
  await message.edit({ ...payload, attachments: [] })
    .then(() => console.log(`[stock] 🔄 Refreshed market message for ${clan.abbr} (${guildId}) after trade`))
    .catch((err) => console.warn(`[stock] ⚠️ Could not refresh market message: ${err.message}`));
}

// ---- /stock post ---------------------------------------------------------

async function handlePost(interaction) {
  console.log(`[stock] 📊 /stock post by ${interaction.user.tag} (${interaction.user.id}) in guild ${interaction.guild?.id}`);

  if (!interaction.guild) {
    return interaction.reply({ content: "❌ This command only works in a clan's Discord server.", flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== interaction.guild.ownerId) {
    console.log(`[stock] 🚫 /stock post denied — ${interaction.user.id} is not owner of ${interaction.guild.id}`);
    return interaction.reply({ content: "❌ Only this clan's Discord owner can post the stock market.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.getOrCreateStockRecord(interaction.guild.id);
  if (!result.success) {
    console.log(`[stock] ⚠️ /stock post could not build market for ${interaction.guild.id}: ${result.reason}`);
    return replyReason(interaction, result.reason);
  }

  const payload = await buildMarketView(result.clan, result.stock, "ohlc");
  console.log(`[stock] ✅ Posted ${result.clan.abbr} market (price ${result.stock.currentPrice}, treasury ${result.stock.treasuryShares})`);
  await interaction.reply(payload);

  // Remember where this post lives so trades can refresh it in place later
  // (e.g. a sell confirmed from the owner's DM, which has no direct handle).
  try {
    const msg = await interaction.fetchReply();
    const stock = stocklogic.getStockRecord(interaction.guild.id);
    if (stock && msg) {
      stock.lastPost = { channelId: msg.channelId, messageId: msg.id };
      stocklogic.saveStockRecord(interaction.guild.id, stock);
    }
  } catch (err) {
    console.warn(`[stock] ⚠️ Could not record market post location: ${err.message}`);
  }
}

/** Refresh the last-posted market message for a guild via its stored ref. */
async function refreshMarketByRef(client, guildId) {
  const stock = stocklogic.getStockRecord(guildId);
  if (!stock || !stock.lastPost) return;
  const { channelId, messageId } = stock.lastPost;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.messages) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await refreshMarketMessage(message, guildId);
  } catch (err) {
    console.warn(`[stock] ⚠️ Could not refresh stored market message for ${guildId}: ${err.message}`);
  }
}

// ---- Toggle chart style ---------------------------------------------------

async function handleToggle(interaction, mode, guildId) {
  console.log(`[stock] 🔄 Chart toggle to "${mode}" for ${guildId} by ${interaction.user.tag}`);
  const clans = readClans();
  const clan = clans[guildId];
  const stock = stocklogic.getStockRecord(guildId);

  if (!clan || !stock) {
    return interaction.reply({ content: "❌ This clan's stock market isn't set up yet.", flags: MessageFlags.Ephemeral });
  }

  const payload = await buildMarketView(clan, stock, mode);
  return interaction.update(payload);
}

// ---- /stock portfolio -----------------------------------------------------

async function handlePortfolio(interaction) {
  const holdings = stocklogic.getPortfolio(interaction.user.id);
  console.log(`[stock] 📁 /stock portfolio by ${interaction.user.tag} — ${holdings.length} holding(s)`);
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

  if (interaction.customId.startsWith("stock_markbuypaid_")) {
    return handleMarkBuyPaid(interaction);
  }

  if (interaction.customId.startsWith("stock_cancelbuy_")) {
    return handleCancelBuy(interaction);
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

  console.log(`[stock] 💵 Mark-paid clicked by ${interaction.user.tag} (${interaction.user.id}) for tx ${txId} (guild ${guildId})`);

  const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (!clanGuild) {
    return interaction.reply({ content: "❌ Couldn't find that clan's Discord server anymore.", flags: MessageFlags.Ephemeral });
  }

  if (interaction.user.id !== clanGuild.ownerId) {
    console.log(`[stock] 🚫 Mark-paid denied — ${interaction.user.id} is not owner of ${guildId}`);
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

  // Refresh the public market post so the returned shares / new price show.
  await refreshMarketByRef(interaction.client, guildId).catch(() => {});
}

// Staff confirm a manual buy (payment landed in DEMXN13) — credit the shares.
async function handleMarkBuyPaid(interaction) {
  const rest = interaction.customId.slice("stock_markbuypaid_".length);
  const sepIndex = rest.indexOf("_");
  const guildId = rest.slice(0, sepIndex);
  const txId = rest.slice(sepIndex + 1);

  console.log(`[stock] 💵 Buy-confirm clicked by ${interaction.user.tag} (${interaction.user.id}) for tx ${txId} (guild ${guildId})`);

  if (!isAdmin(interaction)) {
    console.log(`[stock] 🚫 Buy-confirm denied — ${interaction.user.id} is not staff`);
    return interaction.reply({ content: "❌ Only Yazanaki staff (server admins) can confirm a buy payment.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.markBuyPaid(txId);
  if (!result.success) {
    return interaction.reply({ content: "❌ This buy order was already confirmed/rejected or no longer exists.", flags: MessageFlags.Ephemeral });
  }

  // Grant the INVESTOR role to the buyer (best effort — they may not be in the guild).
  const clanGuild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  if (clanGuild) {
    await investorRole.grantInvestorRole(clanGuild, result.discordId).catch(() => {});
  }

  await interaction.reply({
    content: `✅ Confirmed — credited **${result.shares}** share(s) to <@${result.discordId}> (IGN \`${result.ign}\`).`,
    flags: MessageFlags.Ephemeral,
  });

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [] }).catch(() => {});
  }
  await refreshMarketByRef(interaction.client, guildId).catch(() => {});

  // Best-effort DM the buyer that their shares are credited.
  try {
    const buyer = await interaction.client.users.fetch(result.discordId);
    await buyer.send(`✅ Your purchase of **${result.shares}** share(s) was confirmed by staff — the shares are now in your portfolio.`).catch(() => {});
  } catch {}
}

// Staff reject a manual buy (payment never landed) — release the reserved shares.
async function handleCancelBuy(interaction) {
  const rest = interaction.customId.slice("stock_cancelbuy_".length);
  const sepIndex = rest.indexOf("_");
  const guildId = rest.slice(0, sepIndex);
  const txId = rest.slice(sepIndex + 1);

  console.log(`[stock] ✖️ Buy-reject clicked by ${interaction.user.tag} (${interaction.user.id}) for tx ${txId} (guild ${guildId})`);

  if (!isAdmin(interaction)) {
    return interaction.reply({ content: "❌ Only Yazanaki staff (server admins) can reject a buy.", flags: MessageFlags.Ephemeral });
  }

  const result = stocklogic.cancelPendingBuy(txId);
  if (!result.success) {
    return interaction.reply({ content: "❌ This buy order was already confirmed/rejected or no longer exists.", flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    content: `↩️ Buy rejected — ${result.shares} reserved share(s) returned to the treasury.`,
    flags: MessageFlags.Ephemeral,
  });

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [] }).catch(() => {});
  }
  await refreshMarketByRef(interaction.client, guildId).catch(() => {});
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

  console.log(`[stock] 🛒 BUY request: ${interaction.user.tag} (${interaction.user.id}) wants ${shares ?? "?"} share(s) of ${guildId} as IGN "${ign}"`);

  if (!shares) {
    return interaction.editReply({ content: "❌ Enter a whole number of shares greater than 0." });
  }

  if (pendingOrders.hasPendingBuy(guildId, interaction.user.id)) {
    console.log(`[stock] ⏳ BUY blocked — ${interaction.user.id} already has a pending order on ${guildId}`);
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

  const serverName = serverDisplayName(stock.server);

  // Servers without a stats API (FreshSMP/ElementalMC) can't auto-detect the
  // payment, so the buyer pays DEMXN13 and Yazanaki staff confirm it manually.
  if (!hasStatsApi(stock.server)) {
    const pendingBuy = stocklogic.createPendingBuy({
      guildId, discordId: interaction.user.id, ign, shares, pricePerShare: stock.currentPrice,
    });

    await interaction.editReply({
      content:
        `💳 Send exactly \`${cost.toLocaleString()}\` to **${DEMXN13_IGN}** in-game ` +
        `(e.g. \`/pay ${DEMXN13_IGN} ${cost}\`). Your **${shares}** share(s) of **${clan.abbr}** are ` +
        `reserved — Yazanaki staff will confirm your payment and credit them shortly.`,
    });

    const staffEmbed = new EmbedBuilder()
      .setTitle(`🧾 Pending Buy — ${clan.abbr} (${serverName})`)
      .setColor(0xfaa61a)
      .setDescription(
        `**${interaction.user.tag}** (IGN: \`${ign}\`) wants to buy **${shares}** share(s) for ` +
        `\`${cost.toLocaleString()}\` ${serverName} money.\n` +
        `Confirm once **${DEMXN13_IGN}** has received the payment, or reject to release the reserved shares.`
      );
    const staffRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`stock_markbuypaid_${guildId}_${pendingBuy.txId}`).setLabel("Confirm Payment (staff)").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`stock_cancelbuy_${guildId}_${pendingBuy.txId}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
    );
    if (interaction.channel?.send) {
      await interaction.channel.send({ embeds: [staffEmbed], components: [staffRow] })
        .then(() => console.log(`[stock] 📨 Posted staff buy-confirm for pending buy ${pendingBuy.txId} (guild ${guildId})`))
        .catch((err) => console.warn(`[stock] ⚠️ Could not post staff buy-confirm for ${pendingBuy.txId}:`, err.message));
    } else {
      console.warn(`[stock] ⚠️ No channel to post staff buy-confirm for ${pendingBuy.txId}`);
    }
    return;
  }

  // ── API server (DonutSMP): auto-confirm by watching the buyer's balance ──
  const client = getServerClient(stock.server);
  const statsRes = await client.getPlayerStats(ign).catch(() => ({ ok: false }));
  if (!statsRes.ok) {
    console.log(`[stock] ❌ BUY aborted — could not fetch ${serverName} stats for "${ign}"; refunding ${shares} reserved share(s)`);
    stocklogic.refundTreasuryShares(guildId, shares);
    return interaction.editReply({ content: `❌ Couldn't find \`${ign}\` on ${serverName}. Double-check the spelling and try again.` });
  }

  const baselineMoney = Number(statsRes.stats?.money) || 0;
  console.log(`[stock] ⏱️ BUY watch started for ${interaction.user.id} (${ign}): cost ${cost}, baseline balance ${baselineMoney}, 60s window`);

  await interaction.editReply({
    content:
      `💳 Send exactly \`${cost.toLocaleString()}\` to **${DEMXN13_IGN}** in-game ` +
      `(e.g. \`/pay ${DEMXN13_IGN} ${cost}\`) within **60 seconds**. ` +
      `Don't make any other purchases or payments during this window — the bot confirms ` +
      `your order by watching \`${ign}\`'s own balance drop by that amount.`,
  });

  pendingOrders.startBuyWatch(
    { guildId, discordId: interaction.user.id, ign, shares, cost, baselineMoney, serverId: stock.server },
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

        // Update the public market post in place so the new price / reduced
        // shares available show immediately. interaction.message is the exact
        // post the Buy button lives on; fall back to the stored ref if absent.
        if (interaction.message) {
          await refreshMarketMessage(interaction.message, guildId).catch(() => {});
        } else {
          await refreshMarketByRef(interaction.client, guildId).catch(() => {});
        }
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

  console.log(`[stock] 🧾 SELL request: ${interaction.user.tag} (${interaction.user.id}) wants to sell ${shares ?? "?"} share(s) of ${guildId} as IGN "${ign}"`);

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
    await owner.send({ embeds: [embed], components: [row] })
      .then(() => console.log(`[stock] 📨 DM'd owner ${owner.id} to confirm pending sell ${result.txId}`))
      .catch(() => {
        console.warn(`[stock] ⚠️ Could not DM clan owner ${owner.id} about pending sell ${result.txId}`);
      });
  } else {
    console.warn(`[stock] ⚠️ No owner reachable to notify for pending sell ${result.txId} (guild ${guildId})`);
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
