// POST /api/auth/logout
// Clears the session cookie and redirects to /.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  const session = await getSession();
  session.destroy();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
