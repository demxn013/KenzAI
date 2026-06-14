// modules/judiciary/statemachine.js
// ✅ State machine for case lifecycle management

const STATES = {
    REQUESTED: "REQUESTED",
    INTAKE_REVIEW: "INTAKE_REVIEW",
    INVESTIGATION: "INVESTIGATION",
    PRE_HEARING: "PRE_HEARING",
    HEARING_SCHEDULED: "HEARING_SCHEDULED",
    HEARING_COMPLETED: "HEARING_COMPLETED",
    VERDICT_PENDING: "VERDICT_PENDING",
    SIGNED_OFF: "SIGNED_OFF",
    ENFORCED: "ENFORCED",
    CLOSED: "CLOSED",
    DISMISSED: "DISMISSED",
    PARDONED: "PARDONED"
  };
  
  const TERMINAL_STATES = ["CLOSED", "DISMISSED", "PARDONED"];
  
  const VALID_TRANSITIONS = {
    REQUESTED: ["INTAKE_REVIEW", "DISMISSED"],
    INTAKE_REVIEW: ["INVESTIGATION", "DISMISSED"],
    INVESTIGATION: ["PRE_HEARING", "DISMISSED"],
    PRE_HEARING: ["HEARING_SCHEDULED", "INVESTIGATION", "DISMISSED"],
    HEARING_SCHEDULED: ["HEARING_COMPLETED", "PRE_HEARING", "DISMISSED"],
    HEARING_COMPLETED: ["VERDICT_PENDING", "DISMISSED"],
    VERDICT_PENDING: ["SIGNED_OFF", "HEARING_SCHEDULED", "DISMISSED"],
    SIGNED_OFF: ["ENFORCED", "PARDONED"],
    ENFORCED: ["CLOSED"],
    CLOSED: [],
    DISMISSED: [],
    PARDONED: []
  };
  
  /**
   * Check if a state is terminal
   * @param {string} state - State to check
   * @returns {boolean} Is terminal
   */
  function isTerminalState(state) {
    return TERMINAL_STATES.includes(state);
  }
  
  /**
   * Validate state transition
   * @param {string} currentState - Current state
   * @param {string} newState - Target state
   * @returns {boolean} Is valid transition
   */
  function isValidTransition(currentState, newState) {
    if (!STATES[currentState] || !STATES[newState]) {
      return false;
    }
    
    return VALID_TRANSITIONS[currentState].includes(newState);
  }
  
  /**
   * Get all possible transitions from current state
   * @param {string} currentState - Current state
   * @returns {string[]} Possible next states
   */
  function getPossibleTransitions(currentState) {
    return VALID_TRANSITIONS[currentState] || [];
  }
  
  /**
   * Attempt state transition with validation
   * @param {Object} caseData - Case data object
   * @param {string} newState - Target state
   * @param {GuildMember} actor - Member performing transition
   * @returns {Object} Success/failure result
   */
  function transitionState(caseData, newState, actor) {
    const currentState = caseData.metadata.state;
    
    console.log(`[statemachine] Attempting transition: ${currentState} -> ${newState}`);
    
    // Check if already in terminal state
    if (isTerminalState(currentState)) {
      return {
        success: false,
        reason: "case_already_closed",
        message: `Case is in terminal state: ${currentState}`
      };
    }
    
    // Check if transition is valid
    if (!isValidTransition(currentState, newState)) {
      return {
        success: false,
        reason: "invalid_transition",
        message: `Cannot transition from ${currentState} to ${newState}`,
        validTransitions: getPossibleTransitions(currentState)
      };
    }
    
    // Check if actor has authority
    const permissions = require('./permissions');
    const requiredAuthority = permissions.getRequiredAuthorityForTransition(currentState, newState);
    
    if (!permissions.hasAuthority(actor, requiredAuthority)) {
      return {
        success: false,
        reason: "insufficient_authority",
        message: `Required authority: ${requiredAuthority}`,
        requiredAuthority
      };
    }
    
    // Perform transition
    caseData.metadata.previous_states.push(currentState);
    caseData.metadata.state = newState;
    caseData.metadata.last_updated = new Date().toISOString();
    
    console.log(`[statemachine] ✅ Transition successful: ${currentState} -> ${newState}`);
    
    return {
      success: true,
      previousState: currentState,
      newState: newState
    };
  }
  
  /**
   * Get human-readable state description
   * @param {string} state - State code
   * @returns {string} Description
   */
  function getStateDescription(state) {
    const descriptions = {
      REQUESTED: "📋 Case Requested - Awaiting intake review",
      INTAKE_REVIEW: "🔍 Under Intake Review - Determining validity",
      INVESTIGATION: "🕵️ Under Investigation - Gathering evidence",
      PRE_HEARING: "📝 Pre-Hearing - Preparing for court",
      HEARING_SCHEDULED: "⏰ Hearing Scheduled - Date set",
      HEARING_COMPLETED: "✅ Hearing Completed - Awaiting verdict",
      VERDICT_PENDING: "⚖️ Verdict Pending - Under deliberation",
      SIGNED_OFF: "📜 Signed Off - Awaiting enforcement",
      ENFORCED: "⚔️ Enforced - Punishment executed",
      CLOSED: "🔒 Closed - Case archived",
      DISMISSED: "❌ Dismissed - Case rejected",
      PARDONED: "🕊️ Pardoned - Forgiven by Emperor"
    };
    
    return descriptions[state] || state;
  }
  
  module.exports = {
    STATES,
    TERMINAL_STATES,
    VALID_TRANSITIONS,
    isTerminalState,
    isValidTransition,
    getPossibleTransitions,
    transitionState,
    getStateDescription
  };