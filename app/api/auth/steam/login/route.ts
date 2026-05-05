// GET /api/auth/steam/login
// Redirects the user to Steam to start the OpenID handshake.

import { NextResponse } from "next/server";
import { buildSteamLoginUrl } from "@/lib/auth/steam";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  if (!baseUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_BASE_URL is not configured" },
      { status: 500 }
    );
  }
  return NextResponse.redirect(buildSteamLoginUrl(baseUrl));
}
