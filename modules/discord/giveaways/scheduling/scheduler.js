// modules/discord/giveaways/scheduling/scheduler.js
// Polls for giveaways whose end time has passed and ends them. Modeled on
// modules/stock/stockScheduler.js: an initial delay to let caches settle, then
// a recurring interval with a re-entrancy guard.

const store = require("../giveawayStore");
const logic = require("../giveawaylogic");

const DEFAULT_TICK_SECONDS = 30;
const INITIAL_DELAY_MS = 15 * 1000;

let intervalTimer = null;
let initialTimer = null;
let started = false;
let running = false;

function getIntervalMs() {
  const s = parseFloat(process.env.DISCORD_GIVEAWAY_TICK_SECONDS);
  return (Number.isFinite(s) && s > 0 ? s : DEFAULT_TICK_SECONDS) * 1000;
}

async function tick(client) {
  if (running) return;
  running = true;
  try {
    const due = store.dueGiveaways(Date.now());
    if (!due.length) return;
    console.log(`[discord/giveaways] 🎉 Ending ${due.length} due giveaway(s)`);
    for (const record of due) {
      try {
        await logic.endGiveaway(client, record);
      } catch (err) {
        console.error(`[discord/giveaways] ❌ ending ${record.messageId}:`, err.message);
      }
    }
  } finally {
    running = false;
  }
}

function startGiveawayScheduler(client) {
  if (started) return;
  started = true;
  const interval = getIntervalMs();
  console.log(`[discord/giveaways] 🚀 Giveaway scheduler enabled — every ${Math.round(interval / 1000)}s`);
  initialTimer = setTimeout(() => {
    tick(client);
    intervalTimer = setInterval(() => tick(client), interval);
  }, INITIAL_DELAY_MS);
}

function stopGiveawayScheduler() {
  if (initialTimer) clearTimeout(initialTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  initialTimer = intervalTimer = null;
  started = false;
}

module.exports = { startGiveawayScheduler, stopGiveawayScheduler, tick };
