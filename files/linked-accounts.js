"use strict";
/**
 * Linked accounts per profile (Steam only for now), checked live on EON.
 *
 * One row per non-disabled profile. EON's checkuserlogin takes:
 *   userid    = profile id
 *   accountid = user id (the owning account)
 *   client    = EON client for this environment (config.eonClientIds)
 * A failed call doesn't fail the export: the row says "Check Failed" and a warning is logged.
 * Only generated for product "aaa"; any other product gets a header-only file (no EON calls).
 */
const config = require("../lib/config");
const { formatUtc } = require("../lib/format");

const LINKED_ACCOUNTS_PRODUCT = "aaa";

function eonBaseUrl() {
  const raw = (config.eonBaseUrlRaw || "").trim();
  if (!raw) throw new Error("Missing env var EON_BASE_URL");
  const url = raw.startsWith("{") ? JSON.parse(raw).EON_BASE_URL : raw;
  if (!url) throw new Error('EON_BASE_URL has no "EON_BASE_URL" key');
  return url.replace(/\/+$/, "");
}

function eonClientId() {
  const clientId = config.eonClientIds[config.environment];
  if (!clientId)
    throw new Error(
      `No EON client configured for ENVIRONMENT "${config.environment}"`,
    );
  return clientId;
}

async function checkSteam(baseUrl, clientId, profileId, accountId) {
  const res = await fetch(`${baseUrl}/rm/cda/checkuserlogin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkuserloginreq: {
        client: clientId,
        userid: profileId,
        accountid: accountId,
      },
    }),
    signal: AbortSignal.timeout(config.eonTimeoutMs),
  });
  if (!res.ok) throw new Error(`EON responded ${res.status}`);
  const body = await res.json();
  return body.status === "success" ? "Linked" : "Not Linked";
}

async function* source({ knex, userId, productId }) {
  if (productId !== LINKED_ACCOUNTS_PRODUCT) return;

  const baseUrl = eonBaseUrl();
  const clientId = eonClientId();

  const [profiles] = await knex.raw(
    `SELECT id, username FROM profiles
      WHERE user_id = ? AND disabled = 0
      ORDER BY created_at`,
    [userId],
  );

  const rows = await Promise.all(
    profiles.map(async (p) => {
      const checkedAt = Date.now();
      let status;
      try {
        status = await checkSteam(baseUrl, clientId, p.id, userId);
      } catch (err) {
        console.warn("EON steam check failed", {
          userId,
          profileId: p.id,
          clientId,
          error: err.message,
        });
        status = "Check Failed";
      }
      return {
        profile_name: p.username,
        service: "Steam",
        status,
        checked_at: formatUtc(checkedAt),
      };
    }),
  );

  yield* rows;
}

module.exports = {
  name: "linked_accounts.csv",
  columns: ["profile_name", "service", "status", "checked_at"],
  source,
};
