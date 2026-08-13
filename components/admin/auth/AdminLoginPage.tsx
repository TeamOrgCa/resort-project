import Link from "next/link";
import AdminLoginForm from "@/components/admin/auth/AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen bg-base px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-6xl">
        <section className="rounded-3xl border border-neutral/10 bg-white p-8 mx-auto max-w-md">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Staff Portal
          </p>

          <h1 className="mt-3 text-3xl font-bold text-neutral">
            MarVille Staff Login
          </h1>

          <p className="mt-3 text-sm text-neutral/70">
            Authorized staff can sign in to access reservations, billing, reports, and system controls.
          </p>

          <div className="mt-6">
            <AdminLoginForm />
          </div>

          <div className="mt-6 text-sm">
            <Link href="/" className="font-medium text-primary hover:underline">
              ← Return to website
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}