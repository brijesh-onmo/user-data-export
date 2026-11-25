"use strict";
/**
 * Communication preferences for the input product (account level: profile_id = user_id).
 *
 * user_metadata 'notification_preferences' JSON:
 *   { <productId>: { <CHANNEL>: {
 *       categories:  { <CATEGORY>: { enabled, source, updatedAt } },
 *       optInPrompt: { dismissCount, lastDismissedAt } } } }
 *
 * - One row per channel + stored category. A category that isn't stored = not receiving it -> no row.
 * - ACCOUNT is on by default for every account and isn't stored, so every channel always gets an
 *   Account row: opted_in = Yes, changed_via = "Default" (unless something was actually stored).
 * - DEFAULT_CHANNELS_BY_PRODUCT: channels always present for a product, even with nothing stored,
 *   so the user still gets their Account row (aaa: WhatsApp). Other products only show channels
 *   that have stored data.
 * - optInPrompt is per channel, so its values repeat on every row of that channel.
 */
const { formatUtc, label, sourceLabel } = require("../lib/format");

const DEFAULT_CHANNELS_BY_PRODUCT = { aaa: ["WHATSAPP"] };
const CHANNEL_LABELS = { WHATSAPP: "WhatsApp" };
const CATEGORY_ORDER = ["ACCOUNT", "UPDATES", "ENGAGEMENT"];
const DEFAULT_SOURCE_LABEL = "Default";

const channelLabel = (c) => CHANNEL_LABELS[c] ?? label(c);
const isoToUtc = (iso) => (iso ? formatUtc(Date.parse(iso)) : null);
// accepts booleans and "true"/"false" stored as text
function yesNo(v) {
  if (v === true || v === "true") return "Yes";
  if (v === false || v === "false") return "No";
  return null;
}

function sortCategories(names) {
  const rank = (n) =>
    CATEGORY_ORDER.includes(n)
      ? CATEGORY_ORDER.indexOf(n)
      : CATEGORY_ORDER.length;
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// the product's stored channels, or {} when nothing usable is stored
async function storedChannels(knex, userId, productId) {
  const [rows] = await knex.raw(
    `SELECT value FROM user_metadata
      WHERE user_id = ? AND profile_id = ? AND name = 'notification_preferences'`,
    [userId, userId],
  );
  if (!rows.length) return {};
  try {
    const channels = JSON.parse(rows[0].value)?.[productId];
    return channels && typeof channels === "object" ? channels : {};
  } catch (err) {
    console.warn(
      "communication_preferences: malformed notification_preferences, using defaults",
      {
        userId,
        error: err.message,
      },
    );
    return {};
  }
}

async function* source({ knex, userId, productId }) {
  const channels = { ...(await storedChannels(knex, userId, productId)) };
  for (const c of DEFAULT_CHANNELS_BY_PRODUCT[productId] ?? [])
    if (!channels[c]) channels[c] = {};

  for (const [channel, data] of Object.entries(channels)) {
    const categories = { ...(data?.categories ?? {}) };

    const prompt = {
      times_prompt_dismissed: data?.optInPrompt?.dismissCount ?? null,
      last_dismissed_on: isoToUtc(data?.optInPrompt?.lastDismissedAt),
    };

    // Account: always on, never a user choice
    const account = categories.ACCOUNT ?? {};
    delete categories.ACCOUNT;
    yield {
      channel: channelLabel(channel),
      category: label("ACCOUNT"),
      opted_in: "Yes",
      changed_via: sourceLabel(account.source) ?? DEFAULT_SOURCE_LABEL,
      last_updated_at: isoToUtc(account.updatedAt),
      ...prompt,
    };

    for (const category of sortCategories(Object.keys(categories))) {
      const c = categories[category] ?? {};
      yield {
        channel: channelLabel(channel),
        category: label(category),
        opted_in: yesNo(c.enabled),
        changed_via: sourceLabel(c.source),
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
