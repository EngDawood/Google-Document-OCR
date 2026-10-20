import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { type Env, list } from "./config";

const encoder = new TextEncoder();

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

/** Constant-time comparison against each configured token. */
async function matchesToken(candidate: string, tokens: string[]): Promise<boolean> {
  const a = await sha256(candidate);
  let ok = false;
  for (const token of tokens) {
    const b = await sha256(token);
    if (crypto.subtle.timingSafeEqual(a, b)) ok = true;
  }
  return ok;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function verifyAccessJwt(jwt: string, teamDomain: string, aud: string): Promise<boolean> {
  const issuer = `https://${teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  try {
    await jwtVerify(jwt, jwks, { issuer, audience: aud });
    return true;
  } catch {
    return false;
  }
}

export type AuthMethod = "token" | "access";

/**
 * Accepts either `Authorization: Bearer <API_TOKEN>` or a valid Cloudflare Access JWT
 * (when ACCESS_TEAM_DOMAIN and ACCESS_AUD are set).
 */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { auth: AuthMethod } }> = async (c, next) => {
  const tokens = list(c.env.API_TOKENS);
  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && tokens.length > 0 && (await matchesToken(bearer, tokens))) {
    c.set("auth", "token");
    return next();
  }

  const accessJwt = c.req.header("cf-access-jwt-assertion");
  if (accessJwt && c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) {
    if (await verifyAccessJwt(accessJwt, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD)) {
      c.set("auth", "access");
      return next();
    }
  }

  if (tokens.length === 0 && !(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD)) {
    return c.json({ error: "Server has no auth configured. Set API_TOKENS or Cloudflare Access." }, 500);
  }
  return c.json({ error: "Unauthorized" }, 401);
};
