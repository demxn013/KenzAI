// modules/judiciary/verdictlogic.js
// ✅ Verdict management and signoff system

const { getCase, updateCase, auditLog } = require('./caselogic');
const { hasAuthority, isRequiredSignoffAuthority, getUserHighestRole } = require('./permissions');
const { transitionState } = require('./statemachine');

/**
 * Propose a verdict (Grand Vizier only)
 * @param {string} caseId - Case ID
 * @param {Object} verdictData - Verdict data
 * @param {GuildMember} proposer - Member proposing verdict
 * @returns {Object} Result
 */
function proposeVerdict(caseId, verdictData, proposer) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[verdict] ⚖️ Proposing verdict for ${caseId}`);
  console.log(`[verdict] 👤 Proposer: ${proposer.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Grand Vizier or higher
  if (!hasAuthority(proposer, "GRAND_VIZIER")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Grand Vizier can propose verdicts"
    };
  }
  
  // Validate state
  const validStates = ["HEARING_COMPLETED", "VERDICT_PENDING"];
  if (!validStates.includes(caseData.metadata.state)) {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in HEARING_COMPLETED or VERDICT_PENDING state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Set verdict
  caseData.verdict = {
    decision: verdictData.decision,
    reasoning: verdictData.reasoning,
    proposed_by: proposer.id,
    proposed_at: new Date().toISOString(),
    punishment: verdictData.punishment || null
  };
  
  // Transition to VERDICT_PENDING if not already
  if (caseData.metadata.state === "HEARING_COMPLETED") {
    const transitionResult = transitionState(caseData, "VERDICT_PENDING", proposer);
    if (!transitionResult.success) {
      return transitionResult;
    }
  }
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("VERDICT_PROPOSED", caseId, proposer.id, {
      decision: verdictData.decision
    });
    console.log(`[verdict] ✅ Verdict proposed successfully`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Edit verdict (Grand Vizier only, before signoff)
 * @param {string} caseId - Case ID
 * @param {Object} updates - Verdict updates
 * @param {GuildMember} editor - Member editing verdict
 * @returns {Object} Result
 */
function editVerdict(caseId, updates, editor) {
  console.log(`[verdict] ✏️ Editing verdict for ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Grand Vizier
  if (!hasAuthority(editor, "GRAND_VIZIER")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Grand Vizier can edit verdicts"
    };
  }
  
  // Cannot edit after signoff has started
  if (caseData.signoff.signatures.length > 0) {
    return {
      success: false,
      reason: "signoff_in_progress",
      message: "Cannot edit verdict after signoff has begun"
    };
  }
  
  // Apply updates
  if (updates.decision) caseData.verdict.decision = updates.decision;
  if (updates.reasoning) caseData.verdict.reasoning = updates.reasoning;
  if (updates.punishment !== undefined) caseData.verdict.punishment = updates.punishment;
  
  caseData.verdict.edited_at = new Date().toISOString();
  caseData.verdict.edited_by = editor.id;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("VERDICT_EDITED", caseId, editor.id);
    console.log(`[verdict] ✅ Verdict edited successfully`);
  }
  
  return { success };
}

/**
 * Finalize verdict (Grand Vizier only)
 * Transitions case to SIGNED_OFF if all signoffs are complete
 * @param {string} caseId - Case ID
 * @param {GuildMember} finalizer - Member finalizing verdict
 * @returns {Object} Result
 */
function finalizeVerdict(caseId, finalizer) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[verdict] ✅ Finalizing verdict for ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be Grand Vizier
  if (!hasAuthority(finalizer, "GRAND_VIZIER")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only Grand Vizier can finalize verdicts"
    };
  }
  
  // Validate state
  if (caseData.metadata.state !== "VERDICT_PENDING") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in VERDICT_PENDING state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Check if verdict exists
  if (!caseData.verdict.decision) {
    return {
      success: false,
      reason: "no_verdict",
      message: "No verdict has been proposed yet"
    };
  }
  
  // Check if all required signoffs are complete
  const signoffStatus = checkSignoffStatus(caseData);
  
  if (!signoffStatus.complete) {
    return {
      success: false,
      reason: "incomplete_signoffs",
      message: "All required signoffs must be complete before finalizing",
      pending: signoffStatus.pending
    };
  }
  
  // Transition to SIGNED_OFF
  const transitionResult = transitionState(caseData, "SIGNED_OFF", finalizer);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  caseData.verdict.finalized_at = new Date().toISOString();
  caseData.verdict.finalized_by = finalizer.id;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("VERDICT_FINALIZED", caseId, finalizer.id);
    console.log(`[verdict] ✅ Verdict finalized successfully`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Sign off on verdict
 * @param {string} caseId - Case ID
 * @param {GuildMember} signer - Member signing off
 * @returns {Object} Result
 */
function signOffVerdict(caseId, signer) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[verdict] 📜 Signing off on ${caseId}`);
  console.log(`[verdict] 👤 Signer: ${signer.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Check if user is a required signoff authority
  if (!isRequiredSignoffAuthority(caseData, signer)) {
    const userRole = getUserHighestRole(signer);
    return { 
      success: false, 
      reason: "not_required_authority",
      message: `Your role (${userRole}) is not required for signoff on this case`,
      required: caseData.signoff.required_authorities
    };
  }
  
  const signerRole = getUserHighestRole(signer);
  
  // Check if already signed
  const existingSignature = caseData.signoff.signatures.find(s => s.authority === signerRole);
  
  if (existingSignature) {
    return {
      success: false,
      reason: "already_signed",
      message: `${signerRole} has already signed off on this case`
    };
  }
  
  // Add signature
  caseData.signoff.signatures.push({
    authority: signerRole,
    signed_by: signer.id,
    signed_at: new Date().toISOString()
  });
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("VERDICT_SIGNED", caseId, signer.id, {
      authority: signerRole
    });
    console.log(`[verdict] ✅ ${signerRole} signed off successfully`);
    
    // Check if all signoffs are now complete
    const signoffStatus = checkSignoffStatus(caseData);
    if (signoffStatus.complete) {
      console.log(`[verdict] 🎉 All required signoffs complete!`);
    } else {
      console.log(`[verdict] ⏳ Still waiting for: ${signoffStatus.pending.join(", ")}`);
    }
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Reject verdict (required authority only)
 * @param {string} caseId - Case ID
 * @param {string} reason - Rejection reason
 * @param {GuildMember} rejector - Member rejecting verdict
 * @returns {Object} Result
 */
function rejectVerdict(caseId, reason, rejector) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[verdict] ❌ Rejecting verdict for ${caseId}`);
  console.log(`[verdict] 👤 Rejector: ${rejector.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Check if user is a required signoff authority
  if (!isRequiredSignoffAuthority(caseData, rejector)) {
    return { 
      success: false, 
      reason: "not_required_authority",
      message: "You are not a required signoff authority for this case"
    };
  }
  
  const rejectorRole = getUserHighestRole(rejector);
  
  // Record rejection
  caseData.signoff.rejected_by = rejector.id;
  caseData.signoff.rejected_at = new Date().toISOString();
  caseData.signoff.rejection_reason = reason;
  caseData.signoff.rejected_authority = rejectorRole;
  
  // Clear any existing signatures
  caseData.signoff.signatures = [];
  
  // Transition back to HEARING_SCHEDULED for re-deliberation
  const transitionResult = transitionState(caseData, "HEARING_SCHEDULED", rejector);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("VERDICT_REJECTED", caseId, rejector.id, {
      authority: rejectorRole,
      reason: reason
    });
    console.log(`[verdict] ✅ Verdict rejected by ${rejectorRole}`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Check signoff completion status
 * @param {Object} caseData - Case data
 * @returns {Object} Status
 */
function checkSignoffStatus(caseData) {
  const required = caseData.signoff.required_authorities;
  const signed = caseData.signoff.signatures.map(s => s.authority);
  const pending = required.filter(auth => !signed.includes(auth));
  
  return {
    complete: pending.length === 0,
    pending: pending,
    signed: signed,
    required: required
  };
}

/**
 * Get signoff status for display
 * @param {string} caseId - Case ID
 * @returns {Object} Result
 */
function getSignoffStatus(caseId) {
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  const status = checkSignoffStatus(caseData);
  
  return {
    success: true,
    status: status,
    caseData: caseData
  };
}

module.exports = {
  proposeVerdict,
  editVerdict,
  finalizeVerdict,
  signOffVerdict,
  rejectVerdict,
  checkSignoffStatus,
  getSignoffStatus
};