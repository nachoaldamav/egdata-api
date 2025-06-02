import { betterAuth } from "better-auth";
import pg from "pg";

const { Pool } = pg;

export const auth = betterAuth({
  logger: {
    level: "debug",
  },
  database: new Pool({
    connectionString: process.env.NEON_CONNECTION_URI,
  }),
  plugins: [],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // Cache duration in seconds
    },
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: false,
      domain: import.meta.env.PROD ? ".egdata.app" : "localhost",
    },
    crossSubDomainCookies: {
      enabled: true,
      domain: import.meta.env.PROD ? ".egdata.app" : "localhost",
    },
  },
});
