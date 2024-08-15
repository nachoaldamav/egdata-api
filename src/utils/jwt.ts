import { type JwtPayload, sign, verify } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  throw new Error('Missing environment variable: JWT_SECRET');
}

export function generateJWT(payload: object): string {
  return sign(payload, JWT_SECRET, {
    expiresIn: '365d',
  });
}

export function verifyJWT(token: string): JwtPayload | string | null {
  try {
    return verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}
