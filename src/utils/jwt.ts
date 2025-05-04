import * as jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";

const { sign, verify } = jwt;

const JWT_SECRET = process.env.JWT_SECRET as string;

export function generateJWT(payload: object): string {
  return sign(payload, JWT_SECRET, {
    expiresIn: "365d",
  });
}

export function verifyJWT(token: string): JwtPayload | string | null {
  try {
    return verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}
