"use strict";
/**
 * Communication preferences across ALL products (account level: profile_id = user_id),
 * with a `product` column.
 *
 * user_metadata 'notification_preferences' JSON:
 *   { <productId>: { <CHANNEL>: {
 *       categories:  { <CATEGORY>: { enabled, source, updatedAt } },
 *       optInPrompt: { dismissCount, lastDismissedAt } } } }
 *
 * - Every product section in the JSON is exported.
 * - One row per channel + stored category. A category that isn't stored = not receiving it -> no row.
 * - ACCOUNT is on by default for every account and isn't stored, so every channel always gets an
 *   Account row: opted_in = Yes, changed_via = "Default" (unless something was actually stored).
 * - DEFAULT_CHANNELS_BY_PRODUCT: channels always present for a product, even with nothing stored
 *   (aaa: WhatsApp). So every export has an Onmoplus WhatsApp Account row.
 * - optInPrompt is per channel, so its values repeat on every row of that channel.
 */
const {
  formatUtc,
  label,
  sourceLabel,
  productLabel,
} = require("../lib/format");

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
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function sortCategories(names) {
  const rank = (n) =>
    CATEGORY_ORDER.includes(n)
      ? CATEGORY_ORDER.indexOf(n)
      : CATEGORY_ORDER.length;
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// { <productId>: { <CHANNEL>: {...} } } as stored, or {} when nothing usable is stored
async function storedPreferences(knex, userId) {
  const [rows] = await knex.raw(
    `SELECT value FROM user_metadata
      WHERE user_id = ? AND profile_id = ? AND name = 'notification_preferences'`,
    [userId, userId],
  );
  if (!rows.length) return {};
  try {
    const prefs = JSON.parse(rows[0].value);
    return isObj(prefs) ? prefs : {};
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

function* channelRows(productId, channel, data) {
  const base = {
    product: productLabel(productId),
    channel: channelLabel(channel),
  };
  const categories = { ...(data?.categories ?? {}) };
  const prompt = {
    times_prompt_dismissed: data?.optInPrompt?.dismissCount ?? null,
    last_dismissed_on: isoToUtc(data?.optInPrompt?.lastDismissedAt),
  };

  // Account: always on, never a user choice
  const account = categories.ACCOUNT ?? {};
  delete categories.ACCOUNT;
  yield {
    ...base,
    category: label("ACCOUNT"),
    opted_in: "Yes",
    changed_via: sourceLabel(account.source) ?? DEFAULT_SOURCE_LABEL,
    last_updated_at: isoToUtc(account.updatedAt),
    ...prompt,
  };

  for (const category of sortCategories(Object.keys(categories))) {
    const c = categories[category] ?? {};
    yield {
      ...base,
      category: label(category),
      opted_in: yesNo(c.enabled),
      changed_via: sourceLabel(c.source),
      last_updated_at: isoToUtc(c.updatedAt),
      ...prompt,
    };
  }
}

async function* source({ knex, userId }) {
  const prefs = await storedPreferences(knex, userId);

  // stored product sections + default channels
  const products = {};
  for (const [productId, channels] of Object.entries(prefs)) {
    if (isObj(channels)) products[productId] = { ...channels };
  }
  for (const [productId, defaults] of Object.entries(
    DEFAULT_CHANNELS_BY_PRODUCT,
  )) {
    products[productId] ??= {};
    for (const c of defaults) products[productId][c] ??= {};
  }

  for (const productId of Object.keys(products).sort()) {
    for (const [channel, data] of Object.entries(products[productId])) {
      yield* channelRows(productId, channel, data);
    }
  }
}

module.exports = {
  name: "communication_preferences.csv",
  columns: [
    "product",
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
