const { linkMember } = require('./linklogic');
const applicants = require('../applications/applicants');

/**
 * Autolink a single applicant by discordId.
 * Runs with a slight buffer (1s) to let the application flow finish.
 *
 * Always returns the linkMember result object:
 * {
 *   success: boolean,
 *   reason?: string,
 *   discordId?: string,
 *   minecraftUser?: string
 * }
 */
function processApplicant(discordId, delayMs = 1000) {
  return new Promise((resolve) => {
    setTimeout(() => {
      try {
        const applicant = applicants.getApplicant(discordId);

        if (!applicant || !applicant.minecraftName) {
          return resolve({
            success: false,
            reason: 'no_applicant_or_no_mc',
            discordId
          });
        }

        const mcName = applicant.minecraftName;

        // linkMember already returns the normalized unified object
        const result = linkMember(discordId, mcName);

        resolve(result);

      } catch (err) {
        console.error('processApplicant error:', err);
        resolve({
          success: false,
          reason: 'exception',
          error: err.message,
          discordId
        });
      }
    }, delayMs);
  });
}

/**
 * Autolink all applicants
 * Returns an array of:
 * {
 *   discordId: "<id>",
 *   success: true/false,
 *   reason?: "...",
 *   minecraftUser?: "..."
 * }
 */
async function autolinkAll(delayMsEach = 200) {
  const results = [];
  const all = applicants.getAllApplicants();
  const ids = Object.keys(all || {});

  for (const id of ids) {
    // Process the applicant
    // eslint-disable-next-line no-await-in-loop
    const res = await processApplicant(id, 0);

    results.push({
      discordId: id,
      ...res
    });

    // slight delay to avoid FS contention
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, delayMsEach));
  }

  return results;
}

module.exports = {
  processApplicant,
  autolinkAll
};
