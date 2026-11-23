"use strict";
/**
 * Streaming settings from user_metadata, per non-disabled profile.
 *
 * preferred_eon_cluster -> one "Profile" row: Preferred Streaming Location (value as stored)
 * streaming_config      -> JSON { <device signature>: { id: <preset>, config?: { resolution, fps, bitrate } } }
 *                          one "Device" row for the preset + one per config field present.
 *                          adaptiveQuality is ignored. Make & model come from devices.signature;
 *                          unknown signatures show the raw signature.
 * updated_on is the user_metadata row's updated_at, so all devices in streaming_config share it.
 */

const CONFIG_FIELDS = [
  ["resolution", "Resolution"],
  ["fps", "FPS"],
  ["bitrate", "Bitrate"],
];

// low -> Low
const presetLabel = (id) =>
  typeof id === "string" && id
    ? id[0].toUpperCase() + id.slice(1)
    : (id ?? null);

async function* source({ knex, userId }) {
  const [settings] = await knex.raw(
    `SELECT p.username AS profile_name, um.name, um.value,
            DATE_FORMAT(um.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_on
       FROM user_metadata um
       JOIN profiles p ON p.id = um.profile_id AND p.user_id = um.user_id AND p.disabled = 0
      WHERE um.user_id = ? AND um.name IN ('preferred_eon_cluster', 'streaming_config')
      ORDER BY p.created_at, p.id, FIELD(um.name, 'preferred_eon_cluster', 'streaming_config')`,
    [userId],
  );

  // parse streaming_config values once; collect every signature for one devices lookup
  for (const s of settings) {
    if (s.name !== "streaming_config") continue;
    try {
      s.parsed = JSON.parse(s.value);
    } catch (err) {
      console.warn("device_settings: malformed streaming_config, skipped", {
        userId,
        error: err.message,
      });
      s.parsed = null;
    }
  }
  const signatures = [
    ...new Set(
      settings.flatMap((s) => (s.parsed ? Object.keys(s.parsed) : [])),
    ),
  ];

  const deviceName = new Map();
  if (signatures.length) {
    const [devices] = await knex.raw(
      `SELECT signature, make, model FROM devices WHERE signature IN (${signatures.map(() => "?").join(",")})`,
      signatures,
    );
    for (const d of devices)
      deviceName.set(d.signature, `${d.make} ${d.model}`);
  }

  for (const s of settings) {
    const base = { profile_name: s.profile_name, updated_on: s.updated_on };

    if (s.name === "preferred_eon_cluster") {
      yield {
        scope: "Profile",
        ...base,
        device: null,
        setting: "Preferred Streaming Location",
        value: s.value,
      };
      continue;
    }
    if (!s.parsed) continue;

    for (const [signature, entry] of Object.entries(s.parsed)) {
      const row = {
        scope: "Device",
        ...base,
        device: deviceName.get(signature) ?? signature,
      };
      yield {
        ...row,
        setting: "Streaming Quality Preset",
        value: presetLabel(entry?.id),
      };
      for (const [key, label] of CONFIG_FIELDS) {
        const v = entry?.config?.[key];
        if (v !== undefined && v !== null)
          yield { ...row, setting: label, value: v };
      }
    }
  }
}

module.exports = {
  name: "device_settings.csv",
  columns: [
    "scope",
    "profile_name",
    "device",
    "setting",
    "value",
    "updated_on",
  ],
  source,
};
