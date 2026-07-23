// modules/discord/boosters/boostEvents.js
// Reacts to boost start/stop via guildMemberUpdate. When a member stops
// boosting and removeOnUnboost is set, their custom role is deleted.

const { getGuildSettings } = require("../settings/settingsStore");
const boostStore = require("./boostRoleStore");
const { makeEmbed } = require("../common/embeds");

async function log(guild, settings, embed) {
  if (!settings.logChannelId) return;
  const ch = guild.channels.cache.get(settings.logChannelId);
  if (ch?.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => {});
}

async function handleGuildMemberUpdate(oldMember, newMember) {
  try {
    if (oldMember.partial) await oldMember.fetch().catch(() => {});
    const guild = newMember.guild;
    const settings = getGuildSettings(guild.id).boosterRoles;
    if (!settings.enabled) return;

    const was = oldMember.premiumSinceTimestamp;
    const now = newMember.premiumSinceTimestamp;

    // Stopped boosting.
    if (was && !now) {
      const rec = boostStore.get(guild.id, newMember.id);
      if (rec && settings.removeOnUnboost) {
        const role = guild.roles.cache.get(rec.roleId);
        if (role) await role.delete("Member stopped boosting").catch(() => {});
        boostStore.remove(guild.id, newMember.id);
        await log(guild, settings, makeEmbed({ color: "warn", description: `💔 <@${newMember.id}> stopped boosting — their booster role was removed.` }));
      }
    }
    // Started boosting.
    else if (!was && now) {
      await log(guild, settings, makeEmbed({ color: "success", description: `💜 <@${newMember.id}> started boosting! They can now use \`/boostrole create\`.` }));
    }
  } catch (err) {
    console.error("[discord/boosters] ❌ member update:", err.message);
  }
}

module.exports = { handleGuildMemberUpdate };
