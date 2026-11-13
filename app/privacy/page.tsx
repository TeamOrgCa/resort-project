import type { Metadata } from "next";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import PublishedLegalPage from "@/components/legal/PublishedLegalPage";

export const metadata: Metadata = { title: "Privacy Policy | MarVille Resort Complex" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-32">
        <PublishedLegalPage documentType="privacy" />
      </main>
      <Footer />
    </div>
  );
}
