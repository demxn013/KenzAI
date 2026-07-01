// modules/stock/stockembed.js
// Embed builders for the clan stock market (/stock post, /stock portfolio).

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { formatMoney } = require("../servers/serverembed");

const DEMXN13_IGN = "DEMXN13";
const EMBED_COLOR = 0xffd700;

/**
 * Public market post: current price, treasury availability, and the
 * explicit "pay DEMXN13 in-game" payment instructions.
 */
function createMarketEmbed(clan, stock, chartAttachmentName) {
  const currencyLabel = stock.server === "donutsmp" ? "DonutSMP money" : stock.server;

  const embed = new EmbedBuilder()
    .setTitle(`📈 ${clan.abbr} Stock Market`)
    .setColor(EMBED_COLOR)
    .setDescription(
      `**${clan.name}** trades its own clan stock! Every accepted member adds ` +
      `${1000} new shares to the treasury. Prices move over time based on market activity.`
    )
    .addFields(
      { name: "💰 Price per share", value: `\`${formatMoney(stock.currentPrice)}\` ${currencyLabel}`, inline: true },
      { name: "🏦 Shares available", value: `\`${stock.treasuryShares.toLocaleString()}\``, inline: true },
      { name: "📊 Total shares outstanding", value: `\`${stock.outstandingShares.toLocaleString()}\``, inline: true },
      { name: "🌐 Server", value: `\`${currencyLabel}\``, inline: true },
      {
        name: "💳 How to pay",
        value:
          `All payments must be sent **in-game** to **${DEMXN13_IGN}**. ` +
          `Click **Buy**, enter your Minecraft IGN and share count, then send the ` +
          `exact amount to ${DEMXN13_IGN} (e.g. \`/pay ${DEMXN13_IGN} <amount>\`) within 60 seconds ` +
          `— the bot verifies the payment by watching your own in-game balance drop by that amount.`,
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

function createMarketButtons(guildId) {
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
      .setEmoji("📉")
  );
}

/** Ephemeral portfolio view for a member's holdings across all clans. */
function createPortfolioEmbed(discordId, holdings, clansById) {
  const embed = new EmbedBuilder()
    .setTitle("📊 Your Stock Portfolio")
    .setColor(EMBED_COLOR);

  if (!holdings.length) {
    embed.setDescription("You don't own any clan stock yet. Find a clan's `/stock` post to invest!");
    return embed;
  }

  const fields = holdings.map((h) => {
    const clan = clansById[h.guildId];
    const label = clan ? `${clan.abbr}: ${clan.name}` : h.guildId;
    return { name: label, value: `\`${h.shares.toLocaleString()}\` shares`, inline: true };
  });

  embed.addFields(fields);
  return embed;
}

module.exports = {
  DEMXN13_IGN,
  createMarketEmbed,
  createMarketButtons,
  createPortfolioEmbed,
};
