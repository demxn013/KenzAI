// modules/admin/relinkCore.js
// Pure, dependency-free transform used by /relink. Kept separate from the
// Discord command shell (relink.js) so it can be unit-tested in isolation.
//
// A Discord ID is a 17-19 digit snowflake, so the old id is matched by EXACT
// string equality — it can never collide with clan names, Minecraft names, etc.

// Fields that, when equal to the NEW id, mark an object as "this is the user" —
// only then is the username refreshed on that object (so we don't rewrite the
// username of, say, the moderator referenced in someone else's record).
const SUBJECT_ID_FIELDS = ["discordId", "discord_id", "userId", "user_id"];
const USERNAME_FIELDS = ["discordUser", "discordTag", "discordUsername"];

function objectIsSubject(obj, newId) {
  for (const f of SUBJECT_ID_FIELDS) {
    if (obj[f] === newId) return true;
  }
  return false;
}

/** Recursively replace the exact old id and refresh subject usernames. Mutates. */
function relinkValue(node, oldId, newId, newUsername, stats) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === "string") {
        if (v === oldId) {
          node[i] = newId;
          stats.changes++;
        }
      } else if (v && typeof v === "object") {
        relinkValue(v, oldId, newId, newUsername, stats);
      }
    }
    return;
  }

  if (node && typeof node === "object") {
    // 1) replace the exact old id anywhere it appears as a direct value
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === "string") {
        if (v === oldId) {
          node[k] = newId;
          stats.changes++;
        }
      } else if (v && typeof v === "object") {
        relinkValue(v, oldId, newId, newUsername, stats);
      }
    }

    // 2) refresh the username, but only on records that ARE this user
    if (newUsername && objectIsSubject(node, newId)) {
      for (const uk of USERNAME_FIELDS) {
        if (
          Object.prototype.hasOwnProperty.call(node, uk) &&
          typeof node[uk] === "string" &&
          node[uk] !== newUsername
        ) {
          node[uk] = newUsername;
          stats.changes++;
        }
      }
    }
  }
}

/**
 * Transform a `{ [id]: value }` map. Mutates `map`.
 * @returns {{changes:number, keyMoved:boolean, conflict:boolean}}
 */
function relinkMap(map, { oldId, newId, newUsername, remapKeys }) {
  const stats = { changes: 0, keyMoved: false, conflict: false };
  if (!map || typeof map !== "object") return stats;

  for (const key of Object.keys(map)) {
    relinkValue(map[key], oldId, newId, newUsername, stats);
  }

  if (remapKeys && Object.prototype.hasOwnProperty.call(map, oldId)) {
    if (Object.prototype.hasOwnProperty.call(map, newId)) {
      stats.conflict = true; // new id already had a record — old data wins
    }
    map[newId] = map[oldId];
    delete map[oldId];
    stats.keyMoved = true;
  }

  return stats;
}

module.exports = {
  SUBJECT_ID_FIELDS,
  USERNAME_FIELDS,
  objectIsSubject,
  relinkValue,
  relinkMap,
};
