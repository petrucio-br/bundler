// GET  /api/profile - returns the signed-in user's contact info.
// PUT  /api/profile - updates email and/or Discord username.
//
// We don't verify email by sending a confirmation - per the V1 cut, we trust the user
// to type it correctly. The match recipient is the one who cares whether the email is
// right; if it's wrong, the bundle conversation just doesn't happen.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISCORD_RE = /^[a-zA-Z0-9._]{2,32}$/;

export async function GET() {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("users")
    .select("email, discord_username")
    .eq("id", session.userId)
    .single();
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  return NextResponse.json({
    email: data.email ?? "",
    discordUsername: data.discord_username ?? "",
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session.steamId || !session.userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const rawDiscord = typeof body?.discordUsername === "string" ? body.discordUsername.trim() : "";

  // Empty string means "clear it." Otherwise must validate.
  if (rawEmail && !EMAIL_RE.test(rawEmail)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (rawDiscord && !DISCORD_RE.test(rawDiscord)) {
    return NextResponse.json({ error: "invalid_discord" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("users")
    .update({
      email: rawEmail || null,
      discord_username: rawDiscord || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.userId);

  if (error) {
    console.error("profile update failed", error);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
