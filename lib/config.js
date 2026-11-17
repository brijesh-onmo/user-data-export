"use strict";

const REQUIRED = ["MYSQL_HOST", "REDIS_CONFIG_ENDPOINT"];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);

module.exports = {
  // Secrets Manager secret (JSON) holding credentials
  secretName: process.env.SECRET_NAME || "secrets-dev-backend",
  // key names inside that secret — change here if they differ
  secretKeys: {
    mongoUri: "MONGO_URI",
    mysqlUser: "MYSQL_USERNAME",
    mysqlPassword: "MYSQL_PASSWORD",
    mysqlDatabase: "MYSQL_DATABASE",
  },

  mysqlHost: process.env.MYSQL_HOST,
  mysqlPort: Number(process.env.MYSQL_PORT) || 3306,

  redisHost: process.env.REDIS_CONFIG_ENDPOINT, // cluster configuration endpoint, host only
  redisPort: Number(process.env.REDIS_PORT) || 6379,

  bucket: process.env.EXPORT_BUCKET || "bp-temp-bucket-1",
  batchSize: 1000, // rows handed to enrich() at a time
  linkExpirySeconds: 24 * 3600,
};
