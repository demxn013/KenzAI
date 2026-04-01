"use strict";

const { BaseProfile } = require("./BaseProfile");
const { HungerHandler } = require("../behavior/HungerHandler");

/**
 * ElementalMCProfile
 *
 * Profile for ElementalMC (play.elementalmc.live).
 * Vanilla-like behavior with gentle idle movement and automatic hunger management.
 */
class ElementalMCProfile extends BaseProfile {
  constructor() {
    super("elementalmc", ["1.21.4", "1.21.1", "1.21", "1.20.4"]);
    this._hungerHandler = null;
    this._lastMoveAt = 0;
  }

  buildClientOptions(baseOptions, session) {
    return {
      ...baseOptions,
      brand: "vanilla",
    };
  }

  attachHandlers(client, session) {
    const version = (session && session.version) ? String(session.version) : "1.21.4";
    this._hungerHandler = new HungerHandler(version);
    this._hungerHandler.attach(client);

    client.on("plugin_message", () => {
      // Future: handle ElementalMC-specific plugin channels if necessary.
    });

    client.on("login", () => {
      console.log(`[ElementalMCProfile] ✅ Logged into ElementalMC (v${session?.version || "unknown"})`);
    });
  }

  tick(session, client, nowMs) {
    if (session.state !== "online") return;

    // Gentle random-look behavior every 12–20 seconds to avoid looking frozen.
    if (!this._lastMoveAt || nowMs - this._lastMoveAt > 12000) {
      this._lastMoveAt = nowMs;
      try {
        const yaw = (Math.random() * Math.PI * 2) - Math.PI;
        const pitch = (Math.random() * 0.5) - 0.25;
        client.write("look", {
          yaw,
          pitch,
          onGround: true,
        });
      } catch {
        // Ignore movement errors.
      }
    }

    if (this._hungerHandler) {
      this._hungerHandler.tick(client);
    }
  }
}

module.exports = {
  ElementalMCProfile,
};