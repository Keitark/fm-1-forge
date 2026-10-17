import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FM-1 Forge",
  description: "Install diagnostics, test FM-1 hardware, and configure your own firmware project with Codex.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
