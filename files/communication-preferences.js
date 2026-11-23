"use strict";
/**
 * Communication preferences for the input product (account level: profile_id = user_id).
 *
 * user_metadata 'notification_preferences' JSON:
 *   { <productId>: { <CHANNEL>: {
 *       categories:  { <CATEGORY>: { enabled, source, updatedAt } },
 *       optInPrompt: { dismissCount, lastDismissedAt } } } }
 *
 * - One row per channel + category. ACCOUNT is mandatory, so every channel gets an
 *   Account row with opted_in = Yes (source / updatedAt filled if stored).
 * - optInPrompt is per channel, so its values repeat on every row of that channel.
 * - A channel with a prompt but no categories still gets its Account row, so dismissals aren't lost.
 */
const { formatUtc } = require("../lib/format");

const CHANNEL_LABELS = { WHATSAPP: "WhatsApp" };
const CATEGORY_ORDER = ["ACCOUNT", "UPDATES", "ENGAGEMENT"];

// UPDATES -> Updates, SOME_THING -> Some Thing
function label(value) {
  if (!value) return null;
  return String(value)
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
const channelLabel = (c) => CHANNEL_LABELS[c] ?? label(c);
const isoToUtc = (iso) => (iso ? formatUtc(Date.parse(iso)) : null);
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : null);

function sortCategories(names) {
  const rank = (n) =>
    CATEGORY_ORDER.includes(n)
      ? CATEGORY_ORDER.indexOf(n)
      : CATEGORY_ORDER.length;
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function* source({ knex, userId, productId }) {
  const [rows] = await knex.raw(
    `SELECT value FROM user_metadata
      WHERE user_id = ? AND profile_id = ? AND name = 'notification_preferences'`,
    [userId, userId],
  );
  if (!rows.length) return;

  let prefs;
  try {
    prefs = JSON.parse(rows[0].value);
  } catch (err) {
    console.warn(
      "communication_preferences: malformed notification_preferences, skipped",
      { userId, error: err.message },
    );
    return;
  }

  const channels = prefs?.[productId];
  if (!channels || typeof channels !== "object") return;

  for (const [channel, data] of Object.entries(channels)) {
    const categories = { ...(data?.categories ?? {}) };
    if (!categories.ACCOUNT) categories.ACCOUNT = {}; // mandatory, always opted in

    const prompt = {
      times_prompt_dismissed: data?.optInPrompt?.dismissCount ?? null,
      last_dismissed_on: isoToUtc(data?.optInPrompt?.lastDismissedAt),
    };

    for (const category of sortCategories(Object.keys(categories))) {
      const c = categories[category] ?? {};
      yield {
        channel: channelLabel(channel),
        category: label(category),
        opted_in: category === "ACCOUNT" ? "Yes" : yesNo(c.enabled),
        changed_via: label(c.source),
        last_updated_at: isoToUtc(c.updatedAt),
        ...prompt,
      };
    }
  }
}

module.exports = {
  name: "communication_preferences.csv",
  columns: [
    "channel",
    "category",
    "opted_in",
    "changed_via",
    "last_updated_at",
    "times_prompt_dismissed",
    "last_dismissed_on",
  ],
  source,
};
