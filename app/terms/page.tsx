import type { Metadata } from "next";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import PublishedLegalPage from "@/components/legal/PublishedLegalPage";

export const metadata: Metadata = { title: "Terms and Conditions | MarVille Resort Complex" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-32">
        <PublishedLegalPage documentType="terms" />
      </main>
      <Footer />
    </div>
  );
}
