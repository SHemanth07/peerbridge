"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import { Me, UserContext } from "@/components/UserContext";

const STUDENT_NAV = [
  ["/dashboard", "Dashboard"], ["/doubts", "My doubts"], ["/browse", "Browse doubts"],
  ["/expertise", "My expertise"], ["/sessions", "Sessions"],
];
const ADMIN_NAV = [["/admin", "Admin dashboard"], ["/sessions", "All sessions"]];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();

  useEffect(() => {
    api<{ user: Me }>("/api/auth/me").then((r) => setMe(r.user)).catch(() => { window.location.href = "/login"; });
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} });
    window.location.href = "/login";
  }

  if (!me) return <div className="main muted">Loading...</div>;
  const nav = me.role === "admin" ? ADMIN_NAV : STUDENT_NAV;

  return (
    <UserContext.Provider value={me}>
      <div className="shell">
        <aside className="side">
          <div className="logo">PeerBridge</div>
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className={path === href || path.startsWith(href + "/") ? "active" : ""}>{label}</Link>
          ))}
          <div className="spacer" />
          <div className="who">
            {me.full_name}<br />
            <span className="badge">{me.role}</span>
            {me.role === "student" && <> <span className="badge">{me.reputation} rep</span></>}
          </div>
          <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Log out</a>
        </aside>
        <main className="main">{children}</main>
      </div>
    </UserContext.Provider>
  );
}
