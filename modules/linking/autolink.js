// modules/linking/autolink.js
// ✅ FIXED: Corrected field name from minecraftName to minecraftUser
// ✅ FIXED: Better error handling and logging
// ✅ FIXED: Proper async handling to prevent race conditions

const { linkMember } = require('./linklogic');
const applicants = require('../applications/applicants');

/**
 * Autolink a single applicant by discordId.
 * Runs with a slight buffer to let the application flow finish.
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
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`[autolink] 🔗 Processing autolink for Discord ID: ${discordId}`);
      
      try {
        const applicant = applicants.getApplicant(discordId);

        if (!applicant) {
          console.error(`[autolink] ❌ No applicant found for ${discordId}`);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return resolve({
            success: false,
            reason: 'no_applicant_or_no_mc',
            discordId
          });
        }

        // ✅ FIXED: Check for minecraftUser instead of minecraftName
        const mcName = applicant.minecraftUser || applicant.minecraftName;
        
        if (!mcName) {
          console.error(`[autolink] ❌ No Minecraft username found for ${discordId}`);
          console.error(`[autolink] 📊 Applicant data:`, applicant);
          console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
          return resolve({
            success: false,
            reason: 'no_applicant_or_no_mc',
            discordId
          });
        }

        console.log(`[autolink] 🎮 Minecraft username: ${mcName}`);
        console.log(`[autolink] 📝 Attempting to link...`);

        // linkMember already returns the normalized unified object
        const result = linkMember(discordId, mcName);

        if (result.success) {
          console.log(`[autolink] ✅ Successfully linked ${discordId} -> ${result.minecraftUser}`);
        } else {
          console.warn(`[autolink] ⚠️ Link failed: ${result.reason}`);
        }
        
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        resolve(result);

      } catch (err) {
        console.error('[autolink] ❌ Exception during autolink:', err);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
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
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[autolink] 🔄 Starting bulk autolink process...`);
  
  const results = [];
  const all = applicants.getAllApplicants();
  const ids = Object.keys(all || {});

  console.log(`[autolink] 📊 Found ${ids.length} applicants to process`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[autolink] ✅ Bulk autolink complete`);
  console.log(`[autolink] 📊 Success: ${results.filter(r => r.success).length}`);
  console.log(`[autolink] 📊 Failed: ${results.filter(r => !r.success).length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return results;
}

module.exports = {
  processApplicant,
  autolinkAll
};