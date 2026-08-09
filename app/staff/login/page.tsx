import type { Metadata } from "next";
import AdminLoginPage from "@/components/admin/auth/AdminLoginPage";

export const metadata: Metadata = {
  title: "Staff Login | MarVille Resort Complex",
  description: "Secure login for MarVille Resort staff.",
};

export default function Page() {
  return <AdminLoginPage />;
}