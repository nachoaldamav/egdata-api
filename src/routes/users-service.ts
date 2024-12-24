import { Hono } from "hono";
import { createMiddleware } from 'hono/factory'
import jwt from 'jsonwebtoken';

const app = new Hono();

const middleware = createMiddleware(async (c, next) => {
    // Check if the user is authenticated
    if (!c.req.header('Authorization')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const authorization = c.req.header('Authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return c.json({ error: 'Invalid authorization header' }, 401);
    }

    const token = authorization.replace('Bearer ', '').replace('eg1~', '');

    const decoded = jwt.decode(token) as {
      sub: string;
      iss: string;
      dn: string;
      nonce: string;
      pfpid: string;
      sec: number;
      aud: string;
      t: string;
      scope: string;
      appid: string;
      exp: number;
      iat: number;
      jti: string;
    };

    if (!decoded || !decoded.sub) {
      console.error('Invalid JWT');
      return c.json({ error: 'Invalid JWT' }, 401);
    }

    console.log('JWT decoded', decoded);

    await next()
  })

app.use(middleware);

app.get('/', async (c) => {
  return c.json({ message: 'Hello, World!' });
});

export default app;