import { Context, Next } from 'hono';
import { verifyJWT } from '../utils/jwt';

export async function jwtMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyJWT(token);
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', payload);
  await next();
}
