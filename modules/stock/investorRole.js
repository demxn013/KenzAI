// modules/stock/investorRole.js
// Find-or-create the "INVESTOR" role in a clan's own Discord server, and
// grant/revoke it for individual investors. Every clan guild is expected to
// eventually have a role literally named "INVESTOR"; if it doesn't exist yet
// we create it defensively (mirrors the auto-create-if-missing pattern used
// for clan roles in modules/clantracking/clan.js).

const ROLE_NAME = "INVESTOR";

/** Find the INVESTOR role by name (case-insensitive), or null. */
function findInvestorRole(guild) {
  if (!guild) return null;
  return (
    guild.roles.cache.find((r) => r && r.name && r.name.toUpperCase() === ROLE_NAME) || null
  );
}

/** Find the INVESTOR role, creating it if missing. */
async function ensureInvestorRole(guild) {
  const existing = findInvestorRole(guild);
  if (existing) return { success: true, role: existing, created: false };

  try {
    const role = await guild.roles.create({
      name: ROLE_NAME,
      mentionable: true,
      reason: "Auto-created for the clan stock market (/stock)",
    });
    return { success: true, role, created: true };
  } catch (err) {
    console.error(`[investorRole] ❌ Failed to create INVESTOR role in ${guild.id}:`, err.message);
    return { success: false, reason: "create_failed", error: err.message };
  }
}

/** Grant the INVESTOR role to a member in the clan's Discord server. */
async function grantInvestorRole(guild, discordId) {
  const ensured = await ensureInvestorRole(guild);
  if (!ensured.success) return ensured;

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return { success: false, reason: "not_in_guild" };

  if (member.roles.cache.has(ensured.role.id)) {
    return { success: true, alreadyHad: true };
  }

  try {
    await member.roles.add(ensured.role.id);
    console.log(`[investorRole] 🎖️ Granted INVESTOR role to ${discordId} in guild ${guild.id}${ensured.created ? " (role auto-created)" : ""}`);
    return { success: true, alreadyHad: false };
  } catch (err) {
    console.error(`[investorRole] ❌ Failed to grant INVESTOR role to ${discordId}:`, err.message);
    return { success: false, reason: "grant_failed", error: err.message };
  }
}

/** Remove the INVESTOR role from a member (e.g. once their holdings hit 0). */
async function revokeInvestorRoleIfZero(guild, discordId, remainingShares) {
  if (remainingShares > 0) return { success: true, skipped: true };

  const role = findInvestorRole(guild);
  if (!role) return { success: true, skipped: true };

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member || !member.roles.cache.has(role.id)) return { success: true, skipped: true };

  try {
    await member.roles.remove(role.id);
    console.log(`[investorRole] 🗑️ Revoked INVESTOR role from ${discordId} in guild ${guild.id} (holdings hit 0)`);
    return { success: true, skipped: false };
  } catch (err) {
    console.error(`[investorRole] ❌ Failed to revoke INVESTOR role from ${discordId}:`, err.message);
    return { success: false, reason: "revoke_failed", error: err.message };
  }
}

module.exports = {
  ROLE_NAME,
  findInvestorRole,
  ensureInvestorRole,
  grantInvestorRole,
  revokeInvestorRoleIfZero,
};
