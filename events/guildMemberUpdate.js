// events/guildMemberUpdate.js
// Auto-create a military squadron (chain-of-command tree) when a member gains
// the High General role in the MAIN Yazanaki Empire Discord.
//
// High Generals lead their own tree, so the moment someone is promoted to High
// General they should get an (empty) tree to start filling with Generals. This
// saves an officer from having to run `/squadron add` just to bootstrap it.
//
// Idempotent and non-destructive: it skips if the member already leads a tree,
// and it will not clobber an existing placement (e.g. someone promoted from
// within another High General's tree). Best-effort — never throws into the
// client. Only fires for the Yazanaki Empire guild.

"use strict";

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

module.exports = {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember) {
    try {
      if (!newMember?.guild || newMember.guild.id !== YAZANAKI_EMPIRE_GUILD_ID) return;
      if (newMember.user?.bot) return;

      const { getGovRoleIds, findMemberTree, createTree } = require("../modules/yazanaki/squadronlogic");

      const { highGeneralRoleId } = getGovRoleIds();
      if (!highGeneralRoleId) return;

      const hasNow = newMember.roles.cache.has(highGeneralRoleId);
      if (!hasNow) return;

      // Only react to the transition INTO the role. If we can read the old
      // member's roles and they already had it, this update is about something
      // else (nickname, another role, etc.) and we should do nothing.
      const hadBefore = oldMember?.roles?.cache?.has?.(highGeneralRoleId) === true;
      if (hadBefore) return;

      // Idempotent: don't create a second tree for someone who already leads one,
      // and don't auto-create if they're currently placed inside another tree —
      // that promotion needs manual handling so we don't orphan their old unit.
      const existing = findMemberTree(newMember.id);
      if (existing) {
        if (existing.highGeneralId !== newMember.id) {
          console.log(
            `[guildMemberUpdate] ℹ️ ${newMember.user.tag} gained High General but is already placed ` +
              `in another tree (${existing.id}); skipping auto-create (needs manual move).`
          );
        }
        return;
      }

      const res = createTree(newMember.id, null, newMember.id);
      if (res.ok) {
        console.log(
          `[guildMemberUpdate] 🎖️ Auto-created squadron ${res.id} for new High General ` +
            `${newMember.user.tag} (${newMember.id})`
        );
      } else {
        console.warn(`[guildMemberUpdate] ⚠️ Could not auto-create squadron for ${newMember.id}: ${res.error}`);
      }
    } catch (err) {
      console.warn("[guildMemberUpdate] ⚠️ squadron auto-create failed:", err.message);
    }
  },
};
