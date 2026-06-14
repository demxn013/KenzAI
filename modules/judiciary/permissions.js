// modules/judiciary/permissions.js
// ✅ Role-based access control for judiciary system

const JUDICIARY_ROLES = {
    EMPEROR: "1220847062011351175",
    EMPRESS: "1345701150933909604",
    GRAND_VIZIER: "1334899326853582920",
    GRAND_MAGISTRATE: "1334903559963021382",
    DEMXN06: "1334899020270665861",  // Master of Laws
    DEMXN01: "1334898961114202263",  // Record Keeper
    HIGH_INQUISITOR: "1345398004894535763",
    INQUISITOR: "1334641887017177141"  // Military status
  };
  
  const ROLE_HIERARCHY = [
    "EMPEROR",
    "EMPRESS",
    "GRAND_VIZIER",
    "DEMXN06",
    "GRAND_MAGISTRATE",
    "DEMXN01",
    "HIGH_INQUISITOR",
    "INQUISITOR"
  ];
  
  /**
   * Get the highest judiciary role a member has
   * @param {GuildMember} member - Discord guild member
   * @returns {string|null} Highest role name or null
   */
  function getUserHighestRole(member) {
    for (const roleName of ROLE_HIERARCHY) {
      if (member.roles.cache.has(JUDICIARY_ROLES[roleName])) {
        return roleName;
      }
    }
    return null;
  }
  
  /**
   * Check if member has authority level
   * @param {GuildMember} member - Discord guild member
   * @param {string} requiredRole - Minimum required role
   * @returns {boolean} Has authority
   */
  function hasAuthority(member, requiredRole) {
    const userRole = getUserHighestRole(member);
    
    if (!userRole) return false;
    
    const requiredIndex = ROLE_HIERARCHY.indexOf(requiredRole);
    const userIndex = ROLE_HIERARCHY.indexOf(userRole);
    
    // Lower index = higher authority
    return userIndex <= requiredIndex;
  }
  
  /**
   * Check if member is assigned to a case
   * @param {Object} caseData - Case data object
   * @param {string} discordId - Discord user ID
   * @returns {boolean} Is assigned
   */
  function isAssignedInquisitor(caseData, discordId) {
    return caseData.investigation.assigned_inquisitors.some(
      inv => inv.discord_id === discordId
    );
  }
  
  /**
   * Check if member is a required signoff authority for a case
   * @param {Object} caseData - Case data object
   * @param {GuildMember} member - Discord guild member
   * @returns {boolean} Is required authority
   */
  function isRequiredSignoffAuthority(caseData, member) {
    const userRole = getUserHighestRole(member);
    
    if (!userRole) return false;
    
    return caseData.signoff.required_authorities.includes(userRole);
  }
  
  /**
   * Get required authority for a state transition
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {string} Required role
   */
  function getRequiredAuthorityForTransition(fromState, toState) {
    const transitionAuthority = {
      "REQUESTED_TO_INTAKE_REVIEW": "HIGH_INQUISITOR",
      "INTAKE_REVIEW_TO_INVESTIGATION": "HIGH_INQUISITOR",
      "INVESTIGATION_TO_PRE_HEARING": "HIGH_INQUISITOR",
      "PRE_HEARING_TO_HEARING_SCHEDULED": "GRAND_MAGISTRATE",
      "HEARING_SCHEDULED_TO_HEARING_COMPLETED": "GRAND_MAGISTRATE",
      "HEARING_COMPLETED_TO_VERDICT_PENDING": "GRAND_MAGISTRATE",
      "VERDICT_PENDING_TO_SIGNED_OFF": "GRAND_VIZIER",
      "SIGNED_OFF_TO_ENFORCED": "DEMXN06",
      "ENFORCED_TO_CLOSED": "GRAND_VIZIER",
      "ANY_TO_DISMISSED": "GRAND_MAGISTRATE",
      "ANY_TO_PARDONED": "EMPEROR"
    };
    
    const key = `${fromState}_TO_${toState}`;
    
    if (transitionAuthority[key]) {
      return transitionAuthority[key];
    }
    
    if (toState === "DISMISSED") {
      return "GRAND_MAGISTRATE";
    }
    
    if (toState === "PARDONED") {
      return "EMPEROR";
    }
    
    return "GRAND_VIZIER";
  }
  
  module.exports = {
    JUDICIARY_ROLES,
    ROLE_HIERARCHY,
    getUserHighestRole,
    hasAuthority,
    isAssignedInquisitor,
    isRequiredSignoffAuthority,
    getRequiredAuthorityForTransition
  };