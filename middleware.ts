import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Page-level guard: no valid session cookie -> /login. Role checks for admin pages happen here too.
// (API routes re-check the session themselves in lib/auth.ts - never rely on middleware alone.)
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("pb_session")?.value;
  const login = new URL("/login", req.url);
  if (!token || !process.env.JWT_SECRET) return NextResponse.redirect(login);
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET));
    if (req.nextUrl.pathname.startsWith("/admin") && payload.role !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(login);
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/doubts/:path*", "/browse/:path*", "/expertise/:path*", "/sessions/:path*", "/admin/:path*"],
};
