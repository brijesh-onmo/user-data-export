"use strict";

// epoch ms (or a Date) -> "YYYY-MM-DD HH:MM:SS" (UTC), same format as the SQL DATE_FORMAT in other files
function formatUtc(ms) {
  if (ms === null || ms === undefined || ms === "") return null;
  const d = new Date(ms instanceof Date ? ms.getTime() : Number(ms));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// LEGAL -> Legal, AGE_DECLARATION -> Age Declaration, COOKIE_BANNER -> Cookie Banner
function label(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value)
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// coin types: label() would give "Gz Tokens"
const COIN_LABELS = {
  gz_tokens: "GZ Tokens",
  spendable_gz_tokens: "Spendable GZ Tokens",
};
const coinLabel = (coinType) => COIN_LABELS[coinType] ?? label(coinType);

// ConsentSource values (consents + notification preferences): label() would give "Wa Unsubscribe Link"
const SOURCE_LABELS = { WA_UNSUBSCRIBE_LINK: "WhatsApp Unsubscribe Link" };
const sourceLabel = (source) => SOURCE_LABELS[source] ?? label(source);

module.exports = { formatUtc, label, coinLabel, sourceLabel };
