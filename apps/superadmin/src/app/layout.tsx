import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-poppins" });

export const metadata: Metadata = {
  title: "CargoSense AI Admin",
  description: "Platform administration for the CargoSense AI cargo and shipment monitoring service.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body suppressHydrationWarning className="min-h-screen font-sans bg-white text-ink antialiased">{children}</body>
    </html>
  );
}
