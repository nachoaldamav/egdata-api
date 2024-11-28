import { createClient } from 'redis';

const REDISHOST = process.env.REDISHOST || '127.0.0.1';
const REDISPORT = process.env.REDISPORT || '6379';
const tls = process.env.REDISTLS === 'true';

const client = createClient({
  url: !tls
    ? `redis://${REDISHOST}:${REDISPORT}`
    : `rediss://${REDISHOST}:${REDISPORT}`,
  username: process.env.REDISUSER || undefined,
  password: process.env.REDISPASSWORD || undefined,
});

client.connect();

export default client;
