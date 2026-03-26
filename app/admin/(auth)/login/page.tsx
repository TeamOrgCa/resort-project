import type { Metadata } from "next";
import AdminLoginPage from "@/components/admin/auth/AdminLoginPage";

export const metadata: Metadata = {
  title: "Admin Login | MarVille Resort Complex",
  description: "Secure login for MarVille Resort administrative staff.",
};

export default function Page() {
  return <AdminLoginPage />;
}
