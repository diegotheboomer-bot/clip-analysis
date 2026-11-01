import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clip Analysis",
  description: "Upload a football clip and get an AI coaching breakdown.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0e1014" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen px-4 py-6 font-sans">{children}</body>
    </html>
  );
}
