"use strict";
// Created once per Lambda container, reused across warm invocations.
const Redis = require("ioredis");
const mongoose = require("mongoose");
const knexLib = require("knex");
const { S3Client } = require("@aws-sdk/client-s3");
const config = require("./config");
const { getSecrets, pick } = require("./secrets");

let conns;

// ElastiCache with cluster mode; REDIS_CONFIG_ENDPOINT = configuration endpoint
function createRedisCluster() {
  const redis = new Redis.Cluster(
    [{ host: config.redisHost, port: config.redisPort }],
    {
      lazyConnect: true,
      enableAutoPipelining: true, // parallel GETs are batched per node automatically
      slotsRefreshTimeout: 5000,
      dnsLookup: (address, callback) => callback(null, address), // needed for ElastiCache TLS
      redisOptions: {
        tls: config.redisTls ? {} : undefined,
        maxRetriesPerRequest: 2,
      },
    },
  );
  // The cluster client hides the real cause ("None of startup nodes is available"); log it.
  redis.on("node error", (err, address) =>
    console.error("redis node error", address, err.message),
  );
  redis.on("error", (err) => console.error("redis error", err.message));
  return redis;
}

async function getConnections() {
  if (conns) return conns;
  const secrets = await getSecrets();
  const { secretKeys: k } = config;

  const knex = knexLib({
    client: "mysql2",
    connection: {
      host: config.mysqlHost,
      port: config.mysqlPort,
      user: pick(secrets, k.mysqlUser),
      password: pick(secrets, k.mysqlPassword),
      database: pick(secrets, k.mysqlDatabase),
      timezone: "Z", // DATETIME columns are UTC; read them as UTC regardless of Lambda's timezone
    },
    pool: { min: 0, max: 2 },
  });

  const redis = createRedisCluster();
  await redis.connect();

  const mongo = await mongoose
    .createConnection(pick(secrets, k.mongoUri), {
      dbName: config.mongoDbName,
      maxPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    })
    .asPromise();

  conns = { knex, redis, mongo, s3: new S3Client({}) };
  return conns;
}

module.exports = { getConnections };
