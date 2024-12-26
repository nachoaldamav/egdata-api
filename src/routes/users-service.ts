import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";

interface Playtime {
  accountId: string;
  artifactId: string;
  totalTime: number;
}

const app = new Hono();

const middleware = createMiddleware<{
  Variables: {
    jwt: {
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
  };
}>(async (c, next) => {
  // Check if the user is authenticated
  if (!c.req.header("Authorization")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const authorization = c.req.header("Authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    return c.json({ error: "Invalid authorization header" }, 401);
  }

  const token = authorization.replace("Bearer ", "").replace("eg1~", "");

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
    console.error("Invalid JWT");
    return c.json({ error: "Invalid JWT" }, 401);
  }

  // Check if it's expired
  const expirationDate = new Date(decoded.exp * 1000);

  if (expirationDate < new Date()) {
    console.error("JWT is expired");
    return c.json({ error: "JWT is expired" }, 401);
  }

  c.set("jwt", decoded);

  await next();
});

app.get("/", middleware, async (c) => {
  return c.json({ message: "Hello, World!" });
});

app.post("/playtime", middleware, async (c) => {
  const body = await c.req.json<Playtime[]>();

  const jwt = c.var.jwt;

  const id = jwt.sub;

  const correctEntries = body.filter(
    (p) => p.accountId === id && p.artifactId
  );

  await Promise.all(
    correctEntries.map(async (p) => {
      await db.db.collection("playtime").updateOne(
        {
          accountId: p.accountId,
          artifactId: p.artifactId,
        },
        {
          $set: {
            totalTime: p.totalTime,
          },
        },
        {
          upsert: true,
        }
      );
    })
  );

  return c.json({ message: "ok" });
});

export default app;
