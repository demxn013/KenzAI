/**
 * Loads MySQL → memory when read sources are switched to mysql.
 */

const config = require("./dbConfig");

module.exports = async function hydrateCaches() {
  if (config.readMembersSource === "mysql") {
    await require("./membersPersistence").hydrateMembersFromMysql();
  }
  if (config.readClansSource === "mysql") {
    await require("./clansPersistence").hydrateClansFromMysql();
  }
  if (config.readEmpireRegistrySource === "mysql") {
    await require("./empireRegistryPersistence").hydrateEmpireRegistryFromMysql();
  }
};
