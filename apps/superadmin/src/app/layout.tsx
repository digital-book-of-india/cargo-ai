import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CargoSense AI Admin",
  description: "After-hours shutter and gate monitoring for shop owners.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
