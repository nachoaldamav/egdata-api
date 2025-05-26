import { Redis as IORedis } from "ioredis";

const REDISHOST = process.env.REDISHOST || '127.0.0.1';
const REDISPORT = process.env.REDISPORT || '6379';
const tls = process.env.REDISTLS === 'true';

const client = new IORedis({
  host: REDISHOST,
  port: parseInt(REDISPORT),
  tls: tls ? {} : undefined,
  username: process.env.REDISUSER || undefined,
  password: process.env.REDISPASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const ioredis = new IORedis(process.env.BULL_REDIS_URI || "", {
  maxRetriesPerRequest: null,
});

export default client;
export { ioredis };
