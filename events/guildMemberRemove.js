// events/guildMemberRemove.js
// Auto-archive a member when they leave the MAIN Yazanaki Empire Discord.
//
// Without this, members who leave the server stayed registered in members.json,
// which falsely inflated clan resident counts and broke draft/eligibility logic.
// Leaving the server now runs the same archival path as the "Leave Yazanaki"
// draft button: removes them from members.json, deactivates their Empire ID,
// decrements their clan's resident count, and flags draft deserters.
//
// Only fires for the Yazanaki Empire guild — leaving a CLAN discord does not
// remove someone from the empire.

"use strict";

const { archiveMember } = require("../modules/empire/draftlogic");

const YAZANAKI_EMPIRE_GUILD_ID = "1220847061797179524";

module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    try {
      // Only the main empire server counts as "leaving the empire".
      if (member.guild?.id !== YAZANAKI_EMPIRE_GUILD_ID) return;
      if (member.user?.bot) return;

      const tag = member.user?.tag || member.id;
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[guildMemberRemove] 👋 ${tag} (${member.id}) left the Yazanaki Empire`);

      const result = await archiveMember(member.id, "left_yazanaki_guild", member.client);

      if (result.success) {
        console.log(
          `[guildMemberRemove] ✅ Archived ${tag} (Empire ID: ${result.empireId || "n/d"})` +
          (result.desertedDraft ? " — flagged as draft deserter" : "")
        );
      } else if (result.reason === "member_not_found") {
        // Not a registered empire member (visitor, already removed, etc.) — nothing to do.
        console.log(`[guildMemberRemove] ℹ️ ${tag} was not a registered empire member — no archival needed`);
      } else {
        console.warn(`[guildMemberRemove] ⚠️ Could not archive ${tag}: ${result.reason || "unknown"}`);
      }
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    } catch (err) {
      console.error(`[guildMemberRemove] ❌ Error handling member leave for ${member?.id}:`, err);
    }
  },
};
