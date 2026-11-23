"use strict";

const REQUIRED = ["ENVIRONMENT", "MYSQL_HOST", "REDIS_CONFIG_ENDPOINT"];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);

const environment = process.env.ENVIRONMENT; // e.g. dev, prod

module.exports = {
  environment,

  // Secrets Manager secret (JSON) holding credentials
  secretName: process.env.SECRET_NAME || `secrets-${environment}-backend`,
  // key names inside that secret — change here if they differ
  secretKeys: {
    mongoUri: "MONGO_URI",
    mysqlUser: "MYSQL_USERNAME",
    mysqlPassword: "MYSQL_PASSWORD",
    mysqlDatabase: "MYSQL_DATABASE",
  },

  mongoDbName: process.env.MONGO_DB_NAME,

  mysqlHost: process.env.MYSQL_HOST,
  mysqlPort: Number(process.env.MYSQL_PORT) || 3306,

  redisHost: process.env.REDIS_CONFIG_ENDPOINT, // cluster configuration endpoint, host only
  redisPort: Number(process.env.REDIS_PORT) || 6379,

  // EON (linked accounts). EON_BASE_URL is JSON: {"EON_BASE_URL":"https://..."} (a plain URL also works)
  eonBaseUrlRaw: process.env.EON_BASE_URL,
  eonClientIds: { dev: "simfonyin", stg: "gambonin", prod: "onmoplusgl" },
  eonTimeoutMs: 10000,

  bucket: process.env.EXPORT_BUCKET || `onmo-${environment}-data`,
  exportPrefix: "private/user-data-export", // no leading slash: S3 keys starting with / get an empty folder
  batchSize: 1000, // rows handed to enrich() at a time
  linkExpirySeconds: 24 * 3600,
};
