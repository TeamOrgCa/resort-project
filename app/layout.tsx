import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import SessionWatcher from "@/components/SessionWatcher";
import { SiteContentProvider } from "@/components/content/SiteContent";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MarVille Resort Complex - Where the Sun Never Sets",
  description: "Plan a pool day, family celebration or barkada outing at MarVille Resort Complex in Taytay, Rizal. Explore day, night and whole-day private swimming packages.",
};

export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${montserrat.variable} antialiased`}
        style={{ fontFamily: "var(--font-montserrat)" }}
      >
        <SiteContentProvider>{children}</SiteContentProvider>
        <SessionWatcher />
      </body>
    </html>
  );
}
