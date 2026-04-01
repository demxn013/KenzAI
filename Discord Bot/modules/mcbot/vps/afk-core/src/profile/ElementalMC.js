"use strict";

const { BaseProfile } = require("./BaseProfile");
const { HungerHandler } = require("../behavior/HungerHandler");

/**
 * ElementalMCProfile
 *
 * Profile for ElementalMC (elementalmc.live).
 * ElementalMC typically runs on 1.20.x or 1.21.x.
 * Includes automatic hunger management and gentle idle movement.
 */
class ElementalMCProfile extends BaseProfile {
  constructor() {
    super("elementalmc", ["1.21.4"]);
    this._lastMoveAt = 0;
    this._hungerHandler = null;
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
      // Future: handle ElementalMC-specific plugin channels if needed.
    });

    client.on("login", () => {
      console.log(`[ElementalMCProfile] ✅ Logged into ElementalMC`);
    });
  }

  tick(session, client, nowMs) {
    if (session.state !== "online") return;

    // Gentle random-look behavior every 15–25 seconds to avoid looking frozen
    if (!this._lastMoveAt || nowMs - this._lastMoveAt > 15000) {
      this._lastMoveAt = nowMs + Math.random() * 10000; // randomize next tick
      try {
        const yaw = (Math.random() * Math.PI * 2) - Math.PI;
        const pitch = (Math.random() * 0.4) - 0.2;
        client.write("look", {
          yaw,
          pitch,
          onGround: true,
        });
      } catch {
        // Ignore movement errors
      }
    }

    // Periodic hunger check
    if (this._hungerHandler) {
      this._hungerHandler.tick(client);
    }
  }
}

module.exports = {
  ElementalMCProfile,
};