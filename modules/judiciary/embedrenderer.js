// modules/judiciary/embedrenderer.js
// ✅ Embed generation and synchronization

const { EmbedBuilder } = require("discord.js");
const { getStateDescription } = require('./statemachine');

/**
 * Render inquisitor embed (working view)
 * @param {Object} caseData - Case data
 * @returns {EmbedBuilder} Discord embed
 */
function renderInquisitorEmbed(caseData) {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 INVESTIGATION: ${caseData.case_id}`)
    .setColor(getColorForState(caseData.metadata.state))
    .setDescription(getStateDescription(caseData.metadata.state))
    .setTimestamp();
  
  // Case Classification
  embed.addFields({
    name: "📋 Classification",
    value: 
      `**Type:** ${caseData.classification.type}\n` +
      `**Severity:** ${caseData.classification.severity}\n` +
      `**Constitutional:** ${caseData.classification.is_constitutional ? "✅ Yes" : "❌ No"}`,
    inline: false
  });
  
  // Charges
  if (caseData.classification.charges.length > 0) {
    embed.addFields({
      name: "⚖️ Charges",
      value: caseData.classification.charges.map(c => `• ${c}`).join("\n"),
      inline: false
    });
  }
  
  // Accused
  embed.addFields({
    name: "👤 Accused",
    value: 
      `<@${caseData.parties.accused.discord_id}>\n` +
      `**MC:** ${caseData.parties.accused.minecraft_username || "n/d"}\n` +
      `**Empire ID:** ${caseData.parties.accused.empire_id || "n/d"}`,
    inline: true
  });
  
  // Plaintiff
  embed.addFields({
    name: "🏛️ Plaintiff",
    value: `<@${caseData.parties.plaintiff.discord_id}>`,
    inline: true
  });
  
  // Assigned Inquisitors
  if (caseData.investigation.assigned_inquisitors.length > 0) {
    const inquisitorsList = caseData.investigation.assigned_inquisitors
      .map(inv => `• <@${inv.discord_id}> (${inv.role})`)
      .join("\n");
    
    embed.addFields({
      name: "🕵️ Assigned Inquisitors",
      value: inquisitorsList,
      inline: false
    });
  }
  
  // Investigation Findings (ALL findings for inquisitor view)
  if (caseData.investigation.findings.length > 0) {
    const findingsList = caseData.investigation.findings
      .map(f => {
        if (f.redacted_by) {
          return `**${f.finding_id}:** [REDACTED]`;
        }
        
        const verifiedBadge = f.verified_by ? "✅" : "⚠️";
        const editedBadge = f.edited_at ? "✏️" : "";
        
        return `**${f.finding_id}** ${verifiedBadge}${editedBadge}: ${f.title}\n` +
               `└ *${f.severity} severity* • By <@${f.submitted_by}>`;
      })
      .join("\n\n");
    
    embed.addFields({
      name: `📝 Findings (${caseData.investigation.findings.length})`,
      value: findingsList.length > 1024 ? findingsList.substring(0, 1020) + "..." : findingsList,
      inline: false
    });
  }
  
  // Investigation Summary
  if (caseData.investigation.summary) {
    embed.addFields({
      name: "📄 Investigation Summary",
      value: caseData.investigation.summary.length > 1024 
        ? caseData.investigation.summary.substring(0, 1020) + "..." 
        : caseData.investigation.summary,
      inline: false
    });
  }
  
  // Investigation Status
  if (caseData.investigation.completed_at) {
    embed.addFields({
      name: "✅ Investigation Completed",
      value: `<t:${Math.floor(new Date(caseData.investigation.completed_at).getTime() / 1000)}:F>\nBy <@${caseData.investigation.completed_by}>`,
      inline: false
    });
  }
  
  embed.setFooter({ text: `Created ${new Date(caseData.metadata.created_at).toLocaleDateString()}` });
  
  return embed;
}

/**
 * Render judiciary embed (official record)
 * @param {Object} caseData - Case data
 * @returns {EmbedBuilder} Discord embed
 */
function renderJudiciaryEmbed(caseData) {
  const embed = new EmbedBuilder()
    .setTitle(`⚖️ CASE RECORD: ${caseData.case_id}`)
    .setColor(getColorForState(caseData.metadata.state))
    .setDescription(`**${getStateDescription(caseData.metadata.state)}**`)
    .setTimestamp();
  
  // Case Classification
  embed.addFields({
    name: "📋 Classification",
    value: 
      `**Type:** ${caseData.classification.type}\n` +
      `**Severity:** ${caseData.classification.severity}\n` +
      `**Constitutional:** ${caseData.classification.is_constitutional ? "✅ Yes" : "❌ No"}`,
    inline: false
  });
  
  // Charges
  if (caseData.classification.charges.length > 0) {
    embed.addFields({
      name: "⚖️ Formal Charges",
      value: caseData.classification.charges.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      inline: false
    });
  }
  
  // Parties
  embed.addFields({
    name: "👤 Accused",
    value: 
      `<@${caseData.parties.accused.discord_id}>\n` +
      `**Minecraft:** ${caseData.parties.accused.minecraft_username || "n/d"}\n` +
      `**Empire ID:** ${caseData.parties.accused.empire_id || "n/d"}\n` +
      `**Rank:** ${caseData.parties.accused.current_rank || "n/d"}`,
    inline: true
  });
  
  embed.addFields({
    name: "🏛️ Plaintiff",
    value: `<@${caseData.parties.plaintiff.discord_id}>`,
    inline: true
  });
  
  // ONLY VERIFIED FINDINGS for judiciary record
  const verifiedFindings = caseData.investigation.findings.filter(f => f.verified_by && !f.redacted_by);
  
  if (verifiedFindings.length > 0) {
    const findingsList = verifiedFindings
      .map(f => `**${f.finding_id}** ✅: ${f.title}\n└ *${f.severity} severity*`)
      .join("\n\n");
    
    embed.addFields({
      name: `📝 Verified Evidence (${verifiedFindings.length})`,
      value: findingsList.length > 1024 ? findingsList.substring(0, 1020) + "..." : findingsList,
      inline: false
    });
  }
  
  // Investigation Summary (only if completed)
  if (caseData.investigation.completed_at && caseData.investigation.summary) {
    embed.addFields({
      name: "📄 Official Investigation Summary",
      value: caseData.investigation.summary.length > 1024 
        ? caseData.investigation.summary.substring(0, 1020) + "..." 
        : caseData.investigation.summary,
      inline: false
    });
  }
  
  // Hearing Information
  if (caseData.hearing.scheduled_at) {
    embed.addFields({
      name: "⏰ Hearing Scheduled",
      value: `<t:${Math.floor(new Date(caseData.hearing.scheduled_at).getTime() / 1000)}:F>\n` +
             `**Presiding:** <@${caseData.hearing.presiding_magistrate}>`,
      inline: false
    });
  }
  
  // Verdict (only if finalized)
  if (caseData.verdict.decision) {
    embed.addFields({
      name: "⚖️ Verdict",
      value: 
        `**Decision:** ${caseData.verdict.decision}\n` +
        `**Reasoning:** ${caseData.verdict.reasoning}\n` +
        `**Punishment:** ${caseData.verdict.punishment || "n/d"}`,
      inline: false
    });
  }
  
  // Signoff Status
  if (caseData.signoff.required_authorities.length > 0) {
    const signoffStatus = caseData.signoff.required_authorities
      .map(auth => {
        const signed = caseData.signoff.signatures.find(s => s.authority === auth);
        return signed 
          ? `✅ ${auth} - <@${signed.signed_by}>`
          : `⏳ ${auth} - Pending`;
      })
      .join("\n");
    
    embed.addFields({
      name: "📜 Required Signoffs",
      value: signoffStatus,
      inline: false
    });
  }
  
  // Enforcement Status
  if (caseData.enforcement.executed_at) {
    embed.addFields({
      name: "⚔️ Enforcement",
      value: 
        `**Executed:** <t:${Math.floor(new Date(caseData.enforcement.executed_at).getTime() / 1000)}:F>\n` +
        `**Executor:** <@${caseData.enforcement.executed_by}>\n` +
        `**Verified:** ${caseData.enforcement.verified_by ? `✅ <@${caseData.enforcement.verified_by}>` : "⏳ Pending"}`,
      inline: false
    });
  }
  
  embed.setFooter({ 
    text: `Case ${caseData.case_id} • Official Record • ${caseData.metadata.state}` 
  });
  
  return embed;
}

/**
 * Get color for case state
 * @param {string} state - Case state
 * @returns {number} Color hex
 */
function getColorForState(state) {
  const colors = {
    REQUESTED: 0x808080,          // Gray
    INTAKE_REVIEW: 0x3498db,      // Blue
    INVESTIGATION: 0xf39c12,      // Orange
    PRE_HEARING: 0xe67e22,        // Dark Orange
    HEARING_SCHEDULED: 0x9b59b6,  // Purple
    HEARING_COMPLETED: 0x8e44ad,  // Dark Purple
    VERDICT_PENDING: 0xe74c3c,    // Red
    SIGNED_OFF: 0x2ecc71,         // Green
    ENFORCED: 0x27ae60,           // Dark Green
    CLOSED: 0x000000,             // Black
    DISMISSED: 0x95a5a6,          // Light Gray
    PARDONED: 0xf1c40f            // Gold
  };
  
  return colors[state] || 0x000000;
}

/**
 * Update embeds in both threads
 * @param {Object} caseData - Case data
 * @param {Client} client - Discord client
 * @returns {Promise<boolean>} Success
 */
async function updateCaseEmbeds(caseData, client) {
  console.log(`[embedrenderer] 🔄 Updating embeds for ${caseData.case_id}`);
  
  try {
    const inquisitorEmbed = renderInquisitorEmbed(caseData);
    const judiciaryEmbed = renderJudiciaryEmbed(caseData);
    
    // Update inquisitor thread
    if (caseData.threads.inquisitor_thread_id) {
      const inquisitorThread = await client.channels.fetch(caseData.threads.inquisitor_thread_id).catch(() => null);
      
      if (inquisitorThread) {
        // Find the pinned embed message and update it
        const pinnedMessages = await inquisitorThread.messages.fetchPinned();
        const embedMessage = pinnedMessages.find(msg => 
          msg.author.id === client.user.id && 
          msg.embeds.length > 0 &&
          msg.embeds[0].title?.includes(caseData.case_id)
        );
        
        if (embedMessage) {
          await embedMessage.edit({ embeds: [inquisitorEmbed] });
          console.log(`[embedrenderer] ✅ Updated inquisitor embed`);
        } else {
          // Create new embed if not found
          const msg = await inquisitorThread.send({ embeds: [inquisitorEmbed] });
          await msg.pin();
          console.log(`[embedrenderer] ✅ Created new inquisitor embed`);
        }
      }
    }
    
    // Update judiciary thread
    if (caseData.threads.judiciary_thread_id) {
      const judiciaryThread = await client.channels.fetch(caseData.threads.judiciary_thread_id).catch(() => null);
      
      if (judiciaryThread) {
        const pinnedMessages = await judiciaryThread.messages.fetchPinned();
        const embedMessage = pinnedMessages.find(msg => 
          msg.author.id === client.user.id && 
          msg.embeds.length > 0 &&
          msg.embeds[0].title?.includes(caseData.case_id)
        );
        
        if (embedMessage) {
          await embedMessage.edit({ embeds: [judiciaryEmbed] });
          console.log(`[embedrenderer] ✅ Updated judiciary embed`);
        } else {
          const msg = await judiciaryThread.send({ embeds: [judiciaryEmbed] });
          await msg.pin();
          console.log(`[embedrenderer] ✅ Created new judiciary embed`);
        }
      }
    }
    
    return true;
    
  } catch (err) {
    console.error(`[embedrenderer] ❌ Error updating embeds:`, err);
    return false;
  }
}

module.exports = {
  renderInquisitorEmbed,
  renderJudiciaryEmbed,
  getColorForState,
  updateCaseEmbeds
};