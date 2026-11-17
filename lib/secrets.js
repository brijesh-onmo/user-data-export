"use strict";
// Reads the JSON secret once per Lambda container.
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const config = require("./config");

let cached;

async function getSecrets() {
  if (cached) return cached;
  const client = new SecretsManagerClient({});
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: config.secretName }),
  );
  cached = JSON.parse(res.SecretString);
  return cached;
}

function pick(secrets, key) {
  const value = secrets[key];
  if (value === undefined || value === "") {
    throw new Error(`Key "${key}" missing in secret "${config.secretName}"`);
  }
  return value;
}

module.exports = { getSecrets, pick };
