import { Context, Next } from 'hono';
import { verifyJWT } from '../utils/jwt.js';

export async function jwtMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyJWT(token);
  if (!payload) {
    console.error('Invalid token');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', payload);
  await next();
}
