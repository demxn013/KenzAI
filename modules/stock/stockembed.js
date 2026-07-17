// modules/stock/stockembed.js
// Embed builders for the clan stock market (/stock post, /stock portfolio).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { formatMoney } = require("../servers/serverembed");
const { TAX_RATE, SELL_COOLDOWN_MS } = require("./stocklogic");

function holdPeriodLabel() {
  const min = Math.round(SELL_COOLDOWN_MS / 60000);
  if (min <= 0) return null;
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

const DEMXN13_IGN = "DEMXN13";
const UP_EMBED_COLOR = 0x0a0a0a;   // near-black (pure 0x000000 is treated as "no color" by Discord)
const DOWN_EMBED_COLOR = 0xd40000; // red

/**
 * Public market post: current price, treasury availability, price change,
 * and the explicit "pay DEMXN13 in-game" payment instructions.
 * @param {object} clan
 * @param {object} stock
 * @param {string} chartAttachmentName
 * @param {{ absolute: number, percent: number, direction: "up"|"down"|"flat" }} priceChange
 */
function createMarketEmbed(clan, stock, chartAttachmentName, priceChange) {
  const currencyLabel = stock.server === "donutsmp" ? "DonutSMP money" : stock.server;

  const change = priceChange || { absolute: 0, percent: 0, direction: "flat" };
  const arrow = change.direction === "down" ? "🔻" : change.direction === "up" ? "🔺" : "▪️";
  const sign = change.absolute > 0 ? "+" : "";
  const changeText = `${arrow} ${sign}${formatMoney(change.absolute)} (${sign}${change.percent.toFixed(2)}%)`;

  const embed = new EmbedBuilder()
    .setTitle(`📈 ${clan.abbr} Stock Market`)
    .setColor(change.direction === "down" ? DOWN_EMBED_COLOR : UP_EMBED_COLOR)
    .setDescription(
      `**${clan.name}** trades its own clan stock! Every accepted member adds ` +
      `${1000} new shares to the treasury. Prices move over time based on market activity.`
    )
    .addFields(
      { name: "💰 Price per share", value: `\`${formatMoney(stock.currentPrice)}\` ${currencyLabel}`, inline: false },
      { name: "📈 Price change", value: changeText, inline: false },
      { name: "🏦 Shares available", value: `\`${stock.treasuryShares.toLocaleString()}\``, inline: false },
      { name: "📊 Total shares outstanding", value: `\`${stock.outstandingShares.toLocaleString()}\``, inline: false },
      { name: "🌐 Server", value: `\`${currencyLabel}\``, inline: false },
      {
        name: "💳 How to pay",
        value:
          `All payments must be sent **in-game** to **${DEMXN13_IGN}**. ` +
          `Click **Buy**, enter your Minecraft IGN and share count, then send the ` +
          `exact amount to ${DEMXN13_IGN} (e.g. \`/pay ${DEMXN13_IGN} <amount>\`) within 60 seconds ` +
          `— the bot verifies the payment by watching your own in-game balance drop by that amount.\n` +
          `A **${(TAX_RATE * 100).toFixed(0)}%** transaction fee applies to buys and sells` +
          (holdPeriodLabel() ? `, and shares must be held for **${holdPeriodLabel()}** before they can be sold.` : "."),
        inline: false,
      },
      {
        name: "🎖️ Investor perks",
        value: `Confirmed investors receive the **INVESTOR** role in ${clan.abbr}'s Discord server.`,
        inline: false,
      }
    )
    .setFooter({ text: "Prices fluctuate over time — use /stock portfolio to check your holdings." });

  if (chartAttachmentName) {
    embed.setImage(`attachment://${chartAttachmentName}`);
  }

  return embed;
}

/**
 * @param {string} guildId
 * @param {"ohlc"|"line"} mode - the chart style currently being displayed
 */
function createMarketButtons(guildId, mode = "ohlc") {
  const nextMode = mode === "ohlc" ? "line" : "ohlc";
  const toggleLabel = mode === "ohlc" ? "View Line Chart" : "View OHLC Chart";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stock_buy_${guildId}`)
      .setLabel("Buy")
      .setStyle(ButtonStyle.Success)
      .setEmoji("📈"),
    new ButtonBuilder()
      .setCustomId(`stock_sell_${guildId}`)
      .setLabel("Sell")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("📉"),
    new ButtonBuilder()
      .setCustomId(`stock_toggle_${nextMode}_${guildId}`)
      .setLabel(toggleLabel)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄")
  );
}

function clanLabel(clansById, guildId) {
  const clan = clansById[guildId];
  return clan ? `${clan.abbr}` : guildId;
}

function durationLabel(ms) {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Ephemeral view of a member's positions (each buy is its own line). Shared by
 * /stock portfolio (all clans) and the market Sell button (one clan).
 * @param {Array} positions - enriched positions from stocklogic.getUserPositions
 * @param {object} clansById
 * @param {{ title?: string, scopeNote?: string }} [opts]
 */
function createPortfolioEmbed(positions, clansById, opts = {}) {
  const embed = new EmbedBuilder()
    .setTitle(opts.title || "📊 Your Stock Portfolio")
    .setColor(UP_EMBED_COLOR);

  if (!positions.length) {
    embed.setDescription(opts.scopeNote || "You don't own any clan stock yet. Find a clan's `/stock` post to invest!");
    return embed;
  }

  let totalPaid = 0;
  let totalNet = 0;

  const fields = positions.slice(0, 25).map((p, i) => {
    totalPaid += p.buyCost;
    totalNet += p.netIfSold;

    const up = p.pnl >= 0;
    const arrow = up ? "🔺" : "🔻";
    const sign = p.pnl > 0 ? "+" : "";
    const statusNote = p.status === "pending" ? " ⏳ *pending sale*" : "";

    const value = [
      `\`${p.shares.toLocaleString()}\` shares · bought @ \`${formatMoney(p.buyPricePerShare)}\``,
      `Paid: \`${formatMoney(p.buyCost)}\``,
      `Now @ \`${formatMoney(p.currentPrice)}\` → if sold: \`${formatMoney(p.netIfSold)}\``,
      `P/L: ${arrow} \`${sign}${formatMoney(p.pnl)}\` (${sign}${p.pnlPercent.toFixed(2)}%)`,
    ].join("\n");

    return { name: `#${i + 1} · Buy · ${clanLabel(clansById, p.guildId)}${statusNote}`, value, inline: false };
  });

  embed.addFields(fields);

  const totalPnl = totalNet - totalPaid;
  const tUp = totalPnl >= 0;
  const tSign = totalPnl > 0 ? "+" : "";
  embed.setDescription(
    `**Total paid:** \`${formatMoney(totalPaid)}\`\n` +
    `**Value if all sold:** \`${formatMoney(totalNet)}\`\n` +
    `**Total P/L:** ${tUp ? "🔺" : "🔻"} \`${tSign}${formatMoney(totalPnl)}\``
  );

  return embed;
}

/**
 * A select menu to close (sell) a specific position. Only positions that are
 * open and past their hold cooldown are offered.
 * @param {Array} positions - enriched positions
 * @param {object} clansById
 * @returns {ActionRowBuilder|null} null if nothing is sellable right now
 */
function createSellPositionMenu(positions, clansById) {
  const sellable = positions.filter((p) => p.status === "open" && p.cooldownMs <= 0).slice(0, 25);
  if (!sellable.length) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId("stock_sellpos")
    .setPlaceholder("Sell a position…")
    .addOptions(
      sellable.map((p, i) => ({
        label: `Sell ${p.shares.toLocaleString()} × ${clanLabel(clansById, p.guildId)} (@ ${formatMoney(p.buyPricePerShare)})`.slice(0, 100),
        description: `Now worth ${formatMoney(p.netIfSold)} · P/L ${p.pnl >= 0 ? "+" : ""}${formatMoney(p.pnl)}`.slice(0, 100),
        value: p.positionId,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

/** Short note listing positions still in their hold cooldown (for context). */
function cooldownNote(positions) {
  const cooling = positions.filter((p) => p.status === "open" && p.cooldownMs > 0);
  if (!cooling.length) return null;
  return `⏳ ${cooling.length} position(s) still in their hold period and can't be sold yet (earliest in ${durationLabel(Math.min(...cooling.map((p) => p.cooldownMs)))}).`;
}

module.exports = {
  DEMXN13_IGN,
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
  createSellPositionMenu,
  cooldownNote,
};
