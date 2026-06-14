// modules/judiciary/enforcementlogic.js
// ✅ Enforcement tracking and verification system

const { getCase, updateCase, auditLog, archiveCase } = require('./caselogic');
const { hasAuthority, getUserHighestRole } = require('./permissions');
const { transitionState } = require('./statemachine');

/**
 * Execute enforcement (DEMXN06 only)
 * @param {string} caseId - Case ID
 * @param {string[]} actionsTaken - List of actions taken
 * @param {GuildMember} executor - Member executing enforcement
 * @returns {Object} Result
 */
function executeEnforcement(caseId, actionsTaken, executor) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[enforcement] ⚔️ Executing enforcement for ${caseId}`);
  console.log(`[enforcement] 👤 Executor: ${executor.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be DEMXN06 (Master of Laws)
  if (!hasAuthority(executor, "DEMXN06")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only DEMXN06 (Master of Laws) can execute enforcement"
    };
  }
  
  // Validate state
  if (caseData.metadata.state !== "SIGNED_OFF") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in SIGNED_OFF state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Record enforcement
  caseData.enforcement.executed_by = executor.id;
  caseData.enforcement.executed_at = new Date().toISOString();
  caseData.enforcement.actions_taken = actionsTaken;
  
  // Transition to ENFORCED
  const transitionResult = transitionState(caseData, "ENFORCED", executor);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("ENFORCEMENT_EXECUTED", caseId, executor.id, {
      actions: actionsTaken
    });
    console.log(`[enforcement] ✅ Enforcement executed successfully`);
    console.log(`[enforcement] 📋 Actions: ${actionsTaken.join(", ")}`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Verify enforcement (DEMXN01 only)
 * @param {string} caseId - Case ID
 * @param {GuildMember} verifier - Member verifying enforcement
 * @returns {Object} Result
 */
function verifyEnforcement(caseId, verifier) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[enforcement] ✅ Verifying enforcement for ${caseId}`);
  console.log(`[enforcement] 👤 Verifier: ${verifier.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be DEMXN01 (Record Keeper)
  if (!hasAuthority(verifier, "DEMXN01")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only DEMXN01 (Record Keeper) can verify enforcement"
    };
  }
  
  // Validate state
  if (caseData.metadata.state !== "ENFORCED") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in ENFORCED state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Check if enforcement has been executed
  if (!caseData.enforcement.executed_at) {
    return {
      success: false,
      reason: "not_executed",
      message: "Enforcement has not been executed yet"
    };
  }
  
  // Check if already verified
  if (caseData.enforcement.verified_at) {
    return {
      success: false,
      reason: "already_verified",
      message: "Enforcement has already been verified"
    };
  }
  
  // Record verification
  caseData.enforcement.verified_by = verifier.id;
  caseData.enforcement.verified_at = new Date().toISOString();
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("ENFORCEMENT_VERIFIED", caseId, verifier.id);
    console.log(`[enforcement] ✅ Enforcement verified successfully`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Add enforcement action
 * @param {string} caseId - Case ID
 * @param {string} action - Action description
 * @param {GuildMember} actor - Member adding action
 * @returns {Object} Result
 */
function addEnforcementAction(caseId, action, actor) {
  console.log(`[enforcement] 📝 Adding enforcement action to ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be DEMXN06
  if (!hasAuthority(actor, "DEMXN06")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only DEMXN06 can add enforcement actions"
    };
  }
  
  // Add action
  caseData.enforcement.actions_taken.push({
    action: action,
    added_by: actor.id,
    added_at: new Date().toISOString()
  });
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("ENFORCEMENT_ACTION_ADDED", caseId, actor.id, { action });
    console.log(`[enforcement] ✅ Action added successfully`);
  }
  
  return { success };
}

/**
 * Close case (Grand Vizier only, after enforcement)
 * @param {string} caseId - Case ID
 * @param {GuildMember} closer - Member closing case
 * @returns {Object} Result
 */
function closeCase(caseId, closer) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[enforcement] 🔒 Closing case ${caseId}`);
  console.log(`[enforcement] 👤 Closer: ${closer.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Grand Vizier or higher
  if (!hasAuthority(closer, "GRAND_VIZIER")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Grand Vizier can close cases"
    };
  }
  
  // Validate state
  if (caseData.metadata.state !== "ENFORCED") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in ENFORCED state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Verify enforcement is complete
  if (!caseData.enforcement.verified_at) {
    return {
      success: false,
      reason: "enforcement_not_verified",
      message: "Enforcement must be verified by DEMXN01 before closing"
    };
  }
  
  // Transition to CLOSED
  const transitionResult = transitionState(caseData, "CLOSED", closer);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  caseData.metadata.closed_at = new Date().toISOString();
  caseData.metadata.closed_by = closer.id;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("CASE_CLOSED", caseId, closer.id);
    console.log(`[enforcement] ✅ Case closed successfully`);
    
    // Archive the case
    archiveCase(caseId);
    console.log(`[enforcement] 📦 Case archived`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Dismiss case (Grand Magistrate or higher)
 * @param {string} caseId - Case ID
 * @param {string} reason - Dismissal reason
 * @param {GuildMember} dismisser - Member dismissing case
 * @returns {Object} Result
 */
function dismissCase(caseId, reason, dismisser) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[enforcement] ❌ Dismissing case ${caseId}`);
  console.log(`[enforcement] 👤 Dismisser: ${dismisser.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Grand Magistrate or higher
  if (!hasAuthority(dismisser, "GRAND_MAGISTRATE")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Grand Magistrate or higher can dismiss cases"
    };
  }
  
  // Cannot dismiss after SIGNED_OFF
  const protectedStates = ["SIGNED_OFF", "ENFORCED", "CLOSED"];
  if (protectedStates.includes(caseData.metadata.state)) {
    return {
      success: false,
      reason: "case_too_advanced",
      message: "Cannot dismiss cases that have been signed off or enforced"
    };
  }
  
  // Transition to DISMISSED
  const transitionResult = transitionState(caseData, "DISMISSED", dismisser);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  caseData.metadata.dismissed_at = new Date().toISOString();
  caseData.metadata.dismissed_by = dismisser.id;
  caseData.metadata.dismissal_reason = reason;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("CASE_DISMISSED", caseId, dismisser.id, { reason });
    console.log(`[enforcement] ✅ Case dismissed successfully`);
    
    // Archive the case
    archiveCase(caseId);
    console.log(`[enforcement] 📦 Case archived`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Pardon case (Emperor/Empress only)
 * @param {string} caseId - Case ID
 * @param {string} reason - Pardon reason
 * @param {GuildMember} pardoner - Member pardoning case
 * @returns {Object} Result
 */
function pardonCase(caseId, reason, pardoner) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[enforcement] 🕊️ Pardoning case ${caseId}`);
  console.log(`[enforcement] 👤 Pardoner: ${pardoner.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Emperor or Empress
  const pardonerRole = getUserHighestRole(pardoner);
  if (pardonerRole !== "EMPEROR" && pardonerRole !== "EMPRESS") {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Emperor or Empress can pardon cases"
    };
  }
  
  // Can only pardon from SIGNED_OFF or ENFORCED states
  const validStates = ["SIGNED_OFF", "ENFORCED"];
  if (!validStates.includes(caseData.metadata.state)) {
    return {
      success: false,
      reason: "invalid_state",
      message: "Can only pardon cases in SIGNED_OFF or ENFORCED state"
    };
  }
  
  // Transition to PARDONED
  const transitionResult = transitionState(caseData, "PARDONED", pardoner);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  caseData.metadata.pardoned_at = new Date().toISOString();
  caseData.metadata.pardoned_by = pardoner.id;
  caseData.metadata.pardon_reason = reason;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("CASE_PARDONED", caseId, pardoner.id, { 
      reason,
      authority: pardonerRole
    });
    console.log(`[enforcement] ✅ Case pardoned by ${pardonerRole}`);
    
    // Archive the case
    archiveCase(caseId);
    console.log(`[enforcement] 📦 Case archived`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

module.exports = {
  executeEnforcement,
  verifyEnforcement,
  addEnforcementAction,
  closeCase,
  dismissCase,
  pardonCase
};