"use strict";

// epoch ms -> "YYYY-MM-DD HH:MM:SS" (UTC), same format as the SQL DATE_FORMAT in other files
function formatUtc(ms) {
  if (ms === null || ms === undefined || ms === "") return null;
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

module.exports = { formatUtc };
