"use strict";
/**
 * Streaming / device settings from user_metadata. The profile_name and device columns show the scope:
 *
 * preferred_eon_cluster  profile-scoped: profile filled, device empty
 *                        -> Preferred Streaming Location (value as stored)
 * streaming_config       device-scoped: device filled, profile empty
 *                        JSON { <signature>: { id: <preset>, config?: { resolution, fps, bitrate } } }
 *                        -> Streaming Quality Preset + one row per config field present (adaptiveQuality ignored)
 * device_preferences     device + profile: both filled
 *                        JSON { <signature>: { adaptiveQuality, keyboardLayout } }
 *                        -> Adaptive Quality (Yes/No), Keyboard Layout
 *
 * Order: profile settings first, then per device: its streaming_config rows, then its
 * device_preferences rows per profile. Disabled profiles are left out.
 * Make & model come from devices.signature. Unknown signatures show UNKNOWN_DEVICE: the raw
 * signature is a device fingerprint and is never exported.
 * updated_on is the user_metadata row's updated_at, so all devices in one JSON value share it.
 */

const UNKNOWN_DEVICE = "Unknown device";

const STREAM_CONFIG_FIELDS = [
  ["resolution", "Resolution"],
  ["fps", "FPS"],
  ["bitrate", "Bitrate"],
];

// low -> Low
const presetLabel = (id) =>
  typeof id === "string" && id
    ? id[0].toUpperCase() + id.slice(1)
    : (id ?? null);
const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : v);
const present = (v) => v !== undefined && v !== null;

function parseJson(value, name, userId) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") return parsed;
    throw new Error("not an object");
  } catch (err) {
    console.warn(`device_settings: malformed ${name}, skipped`, {
      userId,
      error: err.message,
    });
    return null;
  }
}

async function* source({ knex, userId }) {
  // profile-bound keys (non-disabled profiles only)
  const [profileSettings] = await knex.raw(
    `SELECT p.username AS profile_name, um.name, um.value,
            DATE_FORMAT(um.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_on
       FROM user_metadata um
       JOIN profiles p ON p.id = um.profile_id AND p.user_id = um.user_id AND p.disabled = 0
      WHERE um.user_id = ? AND um.name IN ('preferred_eon_cluster', 'device_preferences')
      ORDER BY p.created_at, p.id`,
    [userId],
  );

  // device-only key: always stored on the account row (profile_id = user_id)
  const [streamSettings] = await knex.raw(
    `SELECT um.value, DATE_FORMAT(um.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_on
       FROM user_metadata um
      WHERE um.user_id = ? AND um.profile_id = um.user_id AND um.name = 'streaming_config'
      ORDER BY um.updated_at`,
    [userId],
  );

  // device -> { stream: [rows], prefs: [rows] }, in order of first appearance
  const devices = new Map();
  const forDevice = (sig) => {
    if (!devices.has(sig)) devices.set(sig, { stream: [], prefs: [] });
    return devices.get(sig);
  };

  for (const s of streamSettings) {
    const json = parseJson(s.value, "streaming_config", userId);
    if (!json) continue;
    for (const [sig, entry] of Object.entries(json)) {
      const rows = forDevice(sig).stream;
      rows.push({
        setting: "Streaming Quality Preset",
        value: presetLabel(entry?.id),
        updated_on: s.updated_on,
      });
      for (const [key, label] of STREAM_CONFIG_FIELDS) {
        if (present(entry?.config?.[key]))
          rows.push({
            setting: label,
            value: entry.config[key],
            updated_on: s.updated_on,
          });
      }
    }
  }

  const profileRows = [];
  for (const s of profileSettings) {
    if (s.name === "preferred_eon_cluster") {
      profileRows.push({
        profile_name: s.profile_name,
        setting: "Preferred Streaming Location",
        value: s.value,
        updated_on: s.updated_on,
      });
      continue;
    }
    const json = parseJson(s.value, "device_preferences", userId);
    if (!json) continue;
    for (const [sig, p] of Object.entries(json)) {
      const rows = forDevice(sig).prefs;
      const base = { profile_name: s.profile_name, updated_on: s.updated_on };
      if (present(p?.adaptiveQuality))
        rows.push({
          ...base,
          setting: "Adaptive Quality",
          value: yesNo(p.adaptiveQuality),
        });
      if (present(p?.keyboardLayout))
        rows.push({
          ...base,
          setting: "Keyboard Layout",
          value: p.keyboardLayout,
        });
    }
  }

  // make & model for every signature, one query
  const deviceName = new Map();
  if (devices.size) {
    const list = [...devices.keys()];
    const [found] = await knex.raw(
      `SELECT signature, make, model FROM devices WHERE signature IN (${list.map(() => "?").join(",")})`,
      list,
    );
    for (const d of found) deviceName.set(d.signature, `${d.make} ${d.model}`);
  }

  for (const r of profileRows) {
    yield {
      profile_name: r.profile_name,
      device: null,
      setting: r.setting,
      value: r.value,
      updated_on: r.updated_on,
    };
  }

  for (const [sig, { stream, prefs }] of devices) {
    const device = deviceName.get(sig) ?? UNKNOWN_DEVICE;
    for (const r of stream) {
      yield {
        profile_name: null,
        device,
        setting: r.setting,
        value: r.value,
        updated_on: r.updated_on,
      };
    }
    for (const r of prefs) {
      yield {
        profile_name: r.profile_name,
        device,
        setting: r.setting,
        value: r.value,
        updated_on: r.updated_on,
      };
    }
  }
}

module.exports = {
  name: "device_settings.csv",
  columns: ["profile_name", "device", "setting", "value", "updated_on"],
  source,
};
