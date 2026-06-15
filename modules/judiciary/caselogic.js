// modules/judiciary/caselogic.js
// ✅ Core case management logic

// Persistence via dual-write MapStores (JSON + MySQL: judiciary_cases,
// judiciary_archived_cases, judiciary_audit_log).
const { stores } = require("../database/stores");

/**
 * Read cases
 * @returns {Object} Cases object
 */
function readCases() {
  try {
    return stores.judiciary_cases.readMap();
  } catch (err) {
    console.error("[caselogic] ❌ Error reading cases:", err);
    return {};
  }
}

/**
 * Write cases (JSON + MySQL)
 * @param {Object} data - Cases data
 * @returns {boolean} Success
 */
function writeCases(data) {
  try {
    stores.judiciary_cases.writeMap(data);
    console.log("[caselogic] ✅ Cases saved successfully");
    return true;
  } catch (err) {
    console.error("[caselogic] ❌ Error writing cases:", err);
    return false;
  }
}

/**
 * Read archived cases
 * @returns {Object} Archived cases
 */
function readArchivedCases() {
  try {
    return stores.judiciary_archived_cases.readMap();
  } catch (err) {
    console.error("[caselogic] ❌ Error reading archived cases:", err);
    return {};
  }
}

/**
 * Write archived cases (JSON + MySQL)
 * @param {Object} data - Archived cases data
 * @returns {boolean} Success
 */
function writeArchivedCases(data) {
  try {
    stores.judiciary_archived_cases.writeMap(data);
    return true;
  } catch (err) {
    console.error("[caselogic] ❌ Error writing archived cases:", err);
    return false;
  }
}

/**
 * Log action to audit trail
 * @param {string} action - Action type
 * @param {string} caseId - Case ID
 * @param {string} actorId - Discord ID of actor
 * @param {Object} details - Additional details
 */
function auditLog(action, caseId, actorId, details = {}) {
  try {
    const logs = stores.judiciary_audit_log.readMap();

    const logEntry = {
      log_id: `AL-${new Date().getFullYear()}-${String(Object.keys(logs).length + 1).padStart(5, '0')}`,
      timestamp: new Date().toISOString(),
      case_id: caseId,
      action: action,
      actor: {
        discord_id: actorId
      },
      details: details
    };

    logs[logEntry.log_id] = logEntry;
    stores.judiciary_audit_log.writeMap(logs);
    console.log(`[caselogic] 📋 Audit log: ${action} by ${actorId} on ${caseId}`);
  } catch (err) {
    console.error("[caselogic] ❌ Error writing audit log:", err);
  }
}

/**
 * Generate case ID
 * @param {string} clanAbbr - Clan abbreviation
 * @param {string} caseType - Case type (CRIMINAL, CIVIL, CONSTITUTIONAL)
 * @returns {string} Case ID
 */
function generateCaseId(clanAbbr, caseType) {
  const year = new Date().getFullYear();
  const cases = readCases();
  
  // Count existing cases for this year and type
  const existingCases = Object.keys(cases).filter(id => {
    const parts = id.split('-');
    return parts[1] === caseType && parts[2] === String(year);
  });
  
  const sequence = existingCases.length + 1;
  
  return `${clanAbbr.toUpperCase()}-${caseType}-${year}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Create a new case
 * @param {Object} params - Case creation parameters
 * @param {GuildMember} creator - Member creating the case
 * @returns {Object} Created case data
 */
function createCase(params, creator) {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[caselogic] 🆕 Creating new case`);
  console.log(`[caselogic] 📊 Type: ${params.caseType}`);
  console.log(`[caselogic] 🏷️ Clan: ${params.clanAbbr}`);
  
  const caseId = generateCaseId(params.clanAbbr, params.caseType);
  console.log(`[caselogic] 🆔 Case ID: ${caseId}`);
  
  const cases = readCases();
  
  // Determine required signoff authorities
  const requiredAuthorities = ["GRAND_VIZIER"];
  
  if (params.isConstitutional || params.severity === "SEVERE") {
    requiredAuthorities.push("EMPEROR");
    requiredAuthorities.push("DEMXN06");
  } else if (params.severity === "MODERATE") {
    requiredAuthorities.push("DEMXN06");
  }
  
  const caseData = {
    case_id: caseId,
    case_number: parseInt(caseId.split('-')[3]),
    year: new Date().getFullYear(),
    clan_abbr: params.clanAbbr,
    
    metadata: {
      created_at: new Date().toISOString(),
      created_by: creator.id,
      last_updated: new Date().toISOString(),
      state: "REQUESTED",
      previous_states: []
    },
    
    classification: {
      type: params.caseType,
      is_constitutional: params.isConstitutional || false,
      severity: params.severity,
      requires_emperor_signoff: params.isConstitutional || params.severity === "SEVERE",
      requires_demxn06_signoff: params.severity !== "MINOR",
      charges: params.charges || []
    },
    
    parties: {
      accused: {
        discord_id: params.accusedId,
        minecraft_username: params.accusedMC || null,
        empire_id: params.accusedEmpireId || null,
        current_rank: params.accusedRank || null
      },
      plaintiff: {
        discord_id: params.plaintiffId || creator.id,
        minecraft_username: params.plaintiffMC || null,
        empire_id: params.plaintiffEmpireId || null
      },
      witnesses: []
    },
    
    investigation: {
      assigned_inquisitors: [],
      findings: [],
      summary: null,
      completed_at: null,
      completed_by: null
    },
    
    hearing: {
      scheduled_at: null,
      scheduled_by: null,
      location: null,
      presiding_magistrate: null,
      attendees: [],
      notes: [],
      completed_at: null
    },
    
    verdict: {
      decision: null,
      reasoning: null,
      proposed_by: null,
      proposed_at: null,
      punishment: null
    },
    
    signoff: {
      required_authorities: requiredAuthorities,
      signatures: [],
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null
    },
    
    enforcement: {
      executed_by: null,
      executed_at: null,
      verified_by: null,
      verified_at: null,
      actions_taken: []
    },
    
    threads: {
      inquisitor_thread_id: null,
      judiciary_thread_id: null
    }
  };
  
  cases[caseId] = caseData;
  writeCases(cases);
  
  auditLog("CASE_CREATED", caseId, creator.id, {
    caseType: params.caseType,
    severity: params.severity
  });
  
  console.log(`[caselogic] ✅ Case created successfully`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  
  return caseData;
}

/**
 * Get case by ID
 * @param {string} caseId - Case ID
 * @returns {Object|null} Case data or null
 */
function getCase(caseId) {
  const cases = readCases();
  return cases[caseId] || null;
}

/**
 * Update case data
 * @param {string} caseId - Case ID
 * @param {Object} updates - Updates to apply
 * @returns {boolean} Success
 */
function updateCase(caseId, updates) {
  const cases = readCases();
  
  if (!cases[caseId]) {
    console.error(`[caselogic] ❌ Case not found: ${caseId}`);
    return false;
  }
  
  // Deep merge updates
  cases[caseId] = {
    ...cases[caseId],
    ...updates,
    metadata: {
      ...cases[caseId].metadata,
      last_updated: new Date().toISOString()
    }
  };
  
  return writeCases(cases);
}

/**
 * Archive a case (move to archived_cases.json)
 * @param {string} caseId - Case ID
 * @returns {boolean} Success
 */
function archiveCase(caseId) {
  console.log(`[caselogic] 📦 Archiving case: ${caseId}`);
  
  const cases = readCases();
  const archivedCases = readArchivedCases();
  
  if (!cases[caseId]) {
    console.error(`[caselogic] ❌ Case not found: ${caseId}`);
    return false;
  }
  
  // Move to archived
  archivedCases[caseId] = {
    ...cases[caseId],
    archived_at: new Date().toISOString()
  };
  
  delete cases[caseId];
  
  writeCases(cases);
  writeArchivedCases(archivedCases);
  
  console.log(`[caselogic] ✅ Case archived successfully`);
  return true;
}

/**
 * Get all cases with optional filters
 * @param {Object} filters - Filter criteria
 * @returns {Object[]} Array of cases
 */
function getAllCases(filters = {}) {
  const cases = readCases();
  let caseList = Object.values(cases);
  
  // Apply filters
  if (filters.state) {
    caseList = caseList.filter(c => c.metadata.state === filters.state);
  }
  
  if (filters.caseType) {
    caseList = caseList.filter(c => c.classification.type === filters.caseType);
  }
  
  if (filters.clanAbbr) {
    caseList = caseList.filter(c => c.clan_abbr === filters.clanAbbr);
  }
  
  if (filters.assignedTo) {
    caseList = caseList.filter(c => 
      c.investigation.assigned_inquisitors.some(inv => inv.discord_id === filters.assignedTo)
    );
  }
  
  // Sort by creation date (newest first)
  caseList.sort((a, b) => 
    new Date(b.metadata.created_at) - new Date(a.metadata.created_at)
  );
  
  return caseList;
}

module.exports = {
  readCases,
  writeCases,
  readArchivedCases,
  writeArchivedCases,
  auditLog,
  generateCaseId,
  createCase,
  getCase,
  updateCase,
  archiveCase,
  getAllCases
};