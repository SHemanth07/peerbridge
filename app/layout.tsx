import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PeerBridge",
  description: "Match your doubts to peers who recently mastered the same concept",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
