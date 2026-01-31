// modules/judiciary/investigationlogic.js
// ✅ Investigation workflow management

const { getCase, updateCase, auditLog } = require('./caselogic');
const { isAssignedInquisitor, hasAuthority } = require('./permissions');

/**
 * Assign inquisitor to case
 * @param {string} caseId - Case ID
 * @param {string} inquisitorId - Discord ID
 * @param {GuildMember} assigner - Member performing assignment
 * @returns {Object} Result
 */
function assignInquisitor(caseId, inquisitorId, assigner) {
  console.log(`[investigation] 🔍 Assigning inquisitor ${inquisitorId} to ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Check if already assigned
  if (isAssignedInquisitor(caseData, inquisitorId)) {
    return { success: false, reason: "already_assigned" };
  }
  
  // Add to assigned inquisitors
  caseData.investigation.assigned_inquisitors.push({
    discord_id: inquisitorId,
    assigned_at: new Date().toISOString(),
    role: caseData.investigation.assigned_inquisitors.length === 0 ? "Lead Investigator" : "Investigator"
  });
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("INQUISITOR_ASSIGNED", caseId, assigner.id, { inquisitorId });
    console.log(`[investigation] ✅ Inquisitor assigned successfully`);
  }
  
  return { success };
}

/**
 * Add investigation finding
 * @param {string} caseId - Case ID
 * @param {Object} findingData - Finding data
 * @param {GuildMember} submitter - Member submitting finding
 * @returns {Object} Result
 */
function addFinding(caseId, findingData, submitter) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[investigation] 📝 Adding finding to ${caseId}`);
  console.log(`[investigation] 👤 Submitter: ${submitter.user.tag}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Validate state
  if (caseData.metadata.state !== "INVESTIGATION") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in INVESTIGATION state. Current: ${caseData.metadata.state}`
    };
  }
  
  // Check if user is assigned or has High Inquisitor authority
  const isAssigned = isAssignedInquisitor(caseData, submitter.id);
  const isHighInquisitor = hasAuthority(submitter, "HIGH_INQUISITOR");
  
  if (!isAssigned && !isHighInquisitor) {
    return { 
      success: false, 
      reason: "not_assigned",
      message: "You must be assigned to this case to add findings"
    };
  }
  
  // Generate finding ID
  const findingId = `F${String(caseData.investigation.findings.length + 1).padStart(3, '0')}`;
  
  const finding = {
    finding_id: findingId,
    submitted_by: submitter.id,
    submitted_at: new Date().toISOString(),
    title: findingData.title,
    description: findingData.description,
    evidence_links: findingData.evidenceLinks || [],
    severity: findingData.severity || "MEDIUM",
    verified_by: null,
    edited_at: null,
    redacted_by: null,
    redacted_at: null
  };
  
  caseData.investigation.findings.push(finding);
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("FINDING_ADDED", caseId, submitter.id, {
      findingId,
      title: findingData.title
    });
    console.log(`[investigation] ✅ Finding ${findingId} added successfully`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success, findingId };
}

/**
 * Edit investigation finding
 * @param {string} caseId - Case ID
 * @param {string} findingId - Finding ID
 * @param {Object} updates - Updates to apply
 * @param {GuildMember} editor - Member editing finding
 * @returns {Object} Result
 */
function editFinding(caseId, findingId, updates, editor) {
  console.log(`[investigation] ✏️ Editing finding ${findingId} in ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  const finding = caseData.investigation.findings.find(f => f.finding_id === findingId);
  
  if (!finding) {
    return { success: false, reason: "finding_not_found" };
  }
  
  // Check if finding is redacted
  if (finding.redacted_by) {
    return { 
      success: false, 
      reason: "finding_redacted",
      message: "Cannot edit redacted findings"
    };
  }
  
  // Check edit permissions
  const canEdit = canEditFinding(finding, editor, caseData);
  
  if (!canEdit.allowed) {
    return { 
      success: false, 
      reason: "insufficient_permission",
      message: canEdit.reason
    };
  }
  
  // Apply updates
  if (updates.title) finding.title = updates.title;
  if (updates.description) finding.description = updates.description;
  if (updates.evidenceLinks) finding.evidence_links = updates.evidenceLinks;
  if (updates.severity) finding.severity = updates.severity;
  
  finding.edited_at = new Date().toISOString();
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("FINDING_EDITED", caseId, editor.id, { findingId });
    console.log(`[investigation] ✅ Finding ${findingId} edited successfully`);
  }
  
  return { success };
}

/**
 * Check if user can edit a finding
 * @param {Object} finding - Finding object
 * @param {GuildMember} editor - Member attempting edit
 * @param {Object} caseData - Case data
 * @returns {Object} Permission result
 */
function canEditFinding(finding, editor, caseData) {
  // High Inquisitors can always edit
  if (hasAuthority(editor, "HIGH_INQUISITOR")) {
    return { allowed: true };
  }
  
  // Original submitter can edit within 24 hours
  if (finding.submitted_by === editor.id) {
    const hoursSinceSubmission = (Date.now() - new Date(finding.submitted_at)) / (1000 * 60 * 60);
    if (hoursSinceSubmission <= 24) {
      return { allowed: true };
    } else {
      return { 
        allowed: false, 
        reason: "24-hour edit window expired. Contact a High Inquisitor for changes."
      };
    }
  }
  
  // Assigned inquisitors can edit unverified findings
  const isAssigned = isAssignedInquisitor(caseData, editor.id);
  if (isAssigned && !finding.verified_by) {
    return { allowed: true };
  }
  
  return { 
    allowed: false, 
    reason: "You do not have permission to edit this finding"
  };
}

/**
 * Verify a finding (High Inquisitor only)
 * @param {string} caseId - Case ID
 * @param {string} findingId - Finding ID
 * @param {GuildMember} verifier - Member verifying finding
 * @returns {Object} Result
 */
function verifyFinding(caseId, findingId, verifier) {
  console.log(`[investigation] ✅ Verifying finding ${findingId} in ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be High Inquisitor
  if (!hasAuthority(verifier, "HIGH_INQUISITOR")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only High Inquisitors can verify findings"
    };
  }
  
  const finding = caseData.investigation.findings.find(f => f.finding_id === findingId);
  
  if (!finding) {
    return { success: false, reason: "finding_not_found" };
  }
  
  if (finding.verified_by) {
    return { 
      success: false, 
      reason: "already_verified",
      message: "Finding is already verified"
    };
  }
  
  finding.verified_by = verifier.id;
  finding.verified_at = new Date().toISOString();
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("FINDING_VERIFIED", caseId, verifier.id, { findingId });
    console.log(`[investigation] ✅ Finding ${findingId} verified successfully`);
  }
  
  return { success };
}

/**
 * Set investigation summary
 * @param {string} caseId - Case ID
 * @param {string} summary - Summary text
 * @param {GuildMember} author - Member setting summary
 * @returns {Object} Result
 */
function setSummary(caseId, summary, author) {
  console.log(`[investigation] 📄 Setting summary for ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Validate state
  if (caseData.metadata.state !== "INVESTIGATION") {
    return { 
      success: false, 
      reason: "invalid_state",
      message: `Case must be in INVESTIGATION state`
    };
  }
  
  // Check if user is assigned or has High Inquisitor authority
  const isAssigned = isAssignedInquisitor(caseData, author.id);
  const isHighInquisitor = hasAuthority(author, "HIGH_INQUISITOR");
  
  if (!isAssigned && !isHighInquisitor) {
    return { 
      success: false, 
      reason: "not_assigned",
      message: "You must be assigned to this case"
    };
  }
  
  caseData.investigation.summary = summary;
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("SUMMARY_UPDATED", caseId, author.id);
    console.log(`[investigation] ✅ Summary updated successfully`);
  }
  
  return { success };
}

/**
 * Complete investigation
 * @param {string} caseId - Case ID
 * @param {GuildMember} completer - Member completing investigation
 * @returns {Object} Result
 */
function completeInvestigation(caseId, completer) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[investigation] ✅ Completing investigation for ${caseId}`);
  
  const caseData = getCase(caseId);
  
  if (!caseData) {
    return { success: false, reason: "case_not_found" };
  }
  
  // Must be High Inquisitor
  if (!hasAuthority(completer, "HIGH_INQUISITOR")) {
    return { 
      success: false, 
      reason: "insufficient_authority",
      message: "Only High Inquisitors can complete investigations"
    };
  }
  
  // Validate investigation completeness
  const validation = validateInvestigationCompletion(caseData);
  
  if (!validation.valid) {
    return {
      success: false,
      reason: "incomplete_investigation",
      errors: validation.errors
    };
  }
  
  caseData.investigation.completed_at = new Date().toISOString();
  caseData.investigation.completed_by = completer.id;
  
  // Transition to PRE_HEARING
  const statemachine = require('./statemachine');
  const transitionResult = statemachine.transitionState(caseData, "PRE_HEARING", completer);
  
  if (!transitionResult.success) {
    return transitionResult;
  }
  
  const success = updateCase(caseId, caseData);
  
  if (success) {
    auditLog("INVESTIGATION_COMPLETED", caseId, completer.id);
    console.log(`[investigation] ✅ Investigation completed successfully`);
  }
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return { success };
}

/**
 * Validate investigation completion
 * @param {Object} caseData - Case data
 * @returns {Object} Validation result
 */
function validateInvestigationCompletion(caseData) {
  const errors = [];
  
  if (caseData.investigation.findings.length === 0) {
    errors.push("❌ At least one finding is required");
  }
  
  if (!caseData.investigation.summary) {
    errors.push("❌ Investigation summary is required");
  }
  
  const verifiedFindings = caseData.investigation.findings.filter(f => f.verified_by);
  if (verifiedFindings.length === 0) {
    errors.push("❌ At least one finding must be verified by High Inquisitor");
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  assignInquisitor,
  addFinding,
  editFinding,
  verifyFinding,
  setSummary,
  completeInvestigation,
  canEditFinding,
  validateInvestigationCompletion
};