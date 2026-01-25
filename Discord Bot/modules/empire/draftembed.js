// modules/empire/draftembed.js
// ✅ All draft-related embeds and buttons

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const config = require("./draftconfig");

/**
 * Create reminder DM embed (2 weeks before expiry)
 */
function createReminderEmbed(memberData) {
  const expiryTimestamp = Math.floor(new Date(memberData.draftExpiryDate).getTime() / 1000);
  const timeframe = config.TESTING_MODE ? "2 minutes" : "2 weeks";
  
  return new EmbedBuilder()
    .setTitle("⏰ Draft Reminder")
    .setDescription(
      `Your draft period in the **Yazanaki Empire** will end in **${timeframe}**!\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**Expiry Date:** <t:${expiryTimestamp}:F>\n\n` +
      `Start thinking about your next step!`
    )
    .setColor(0xFFAA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create expiry DM embed with choice buttons
 */
function createExpiryEmbed(discordId, memberData) {
  const timeframe = config.TESTING_MODE ? "1 minute" : "24 hours";
  
  const embed = new EmbedBuilder()
    .setTitle("⏰ Your Draft Period Has Ended")
    .setDescription(
      `Congratulations on completing your 3-month draft in the **Yazanaki Empire**!\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n\n` +
      `Please choose your next step below. **If you don't respond within ${timeframe}, you will automatically become a Citizen.**`
    )
    .setColor(0x000000)
    .setFooter({ text: `You have ${timeframe} to make your choice` });
  
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`draft_army_${discordId}`)
      .setLabel("🎖️ Join Imperial Army")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`draft_citizen_${discordId}`)
      .setLabel("🏛️ Become Citizen")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`draft_leave_${discordId}`)
      .setLabel("👋 Leave Yazanaki")
      .setStyle(ButtonStyle.Danger)
  );
  
  return { embed, buttons };
}

/**
 * Create auto-citizen notification embed
 */
function createAutoCitizenEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("✅ Draft Completed - Citizen Status Assigned")
    .setDescription(
      `Your draft period has ended and you didn't make a choice within the time limit.\n\n` +
      `You have been **automatically assigned as a Citizen** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**Status:** Citizen\n\n` +
      `Welcome to the empire! 🏛️`
    )
    .setColor(0x00AA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create confirmation embed for joining Imperial Army
 */
function createArmyConfirmationEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("🎖️ Welcome to the Imperial Army!")
    .setDescription(
      `Congratulations! You have joined the **Imperial Army** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**New Rank:** Imperial Army\n` +
      `**Status:** Military\n\n` +
      `Your duty to the empire begins now! 🎖️`
    )
    .setColor(0x00AA00)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create confirmation embed for becoming Citizen
 */
function createCitizenConfirmationEmbed(memberData) {
  return new EmbedBuilder()
    .setTitle("🏛️ Welcome as a Citizen!")
    .setDescription(
      `You are now a **Citizen** of the Yazanaki Empire.\n\n` +
      `**Empire ID:** \`${memberData.EmpireID}\`\n` +
      `**Clan:** ${memberData.JoinedClan}\n` +
      `**New Rank:** Citizen\n` +
      `**Status:** Citizen\n\n` +
      `Enjoy your life in the empire! 🏛️`
    )
    .setColor(0x0099FF)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

/**
 * Create farewell embed for leaving empire
 */
function createFarewellEmbed(empireId) {
  return new EmbedBuilder()
    .setTitle("👋 Farewell from the Yazanaki Empire")
    .setDescription(
      `You have chosen to leave the Yazanaki Empire.\n\n` +
      `**Former Empire ID:** \`${empireId}\` *(deactivated)*\n\n` +
      `All your roles have been removed. Your Empire ID has been archived.\n\n` +
      `If you wish to return in the future, you may reapply and your Empire ID will be restored.\n\n` +
      `Farewell, and may your journeys be prosperous. 🌟`
    )
    .setColor(0xFF0000)
    .setFooter({ text: "Yazanaki Empire • Draft System" });
}

module.exports = {
  createReminderEmbed,
  createExpiryEmbed,
  createAutoCitizenEmbed,
  createArmyConfirmationEmbed,
  createCitizenConfirmationEmbed,
  createFarewellEmbed
};