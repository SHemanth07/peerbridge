import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="hero">
      <div className="badge open">PostgreSQL + pgvector</div>
      <h1>Get your doubt answered by someone who just figured it out.</h1>
      <p className="muted">
        PeerBridge matches your question by <b>meaning</b>, not by batch or section, to peers who recently
        mastered the same concept, and books a slot with them.
      </p>
      <div className="row" style={{ marginTop: 20 }}>
        <Link href="/login" className="btn">Log in</Link>
        <Link href="/register" className="btn" style={{ background: "#fff", color: "var(--brand)", border: "1px solid var(--line)" }}>
          Create account
        </Link>
      </div>
    </div>
  );
}
