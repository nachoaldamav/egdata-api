import { createClient } from 'redis';

const REDISHOST = process.env.REDISHOST || '127.0.0.1';
const REDISPORT = process.env.REDISPORT || '6379';

const client = createClient({
  url: `redis://${REDISHOST}:${REDISPORT}`,
  username: process.env.REDISUSER || undefined,
  password: process.env.REDISPASSWORD || undefined,
});

client.connect();

export default client;
