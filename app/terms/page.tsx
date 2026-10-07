import type { Metadata } from "next";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import LegalDocument from "@/components/legal/LegalDocument";
import { termsSections } from "@/lib/legal/policies";

export const metadata: Metadata = { title: "Terms and Conditions | MarVille Resort Complex" };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-base">
      <Navigation />
      <main className="mx-auto max-w-4xl px-4 pb-20 pt-32">
        <article className="rounded-2xl bg-white p-6 shadow-sm sm:p-10">
          <h1 className="text-3xl font-bold text-neutral">Terms and Conditions</h1>
          <p className="mb-8 mt-2 text-sm text-neutral/60">MarVille Resort Complex · Last updated October 2026</p>
          <LegalDocument sections={termsSections} />
        </article>
      </main>
      <Footer />
    </div>
  );
}
