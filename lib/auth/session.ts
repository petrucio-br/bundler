// iron-session config and helpers.
// Sessions are signed cookies, stored client-side, verified server-side.
// No DB lookup needed for "is this user signed in" checks - the cookie is the truth.

import type { SessionOptions } from "iron-session";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  steamId?: string;        // SteamID64 as string. Source of truth for identity.
  userId?: string;         // Internal users.id (uuid). Set after first sign-in upserts the user.
  signedInAt?: number;     // Unix epoch ms. Used to detect very old sessions if we want to enforce expiry later.
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "bundler_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
