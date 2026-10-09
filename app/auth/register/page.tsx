"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sanitizeName } from "@/lib/helper/validation";
import { validateGuestRegistration } from "@/lib/auth/guest-registration";

export default function Register() {
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phoneNumber: "",
    address: "",
    password: "",
    confirmPassword: "",
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [isResending, setIsResending] = useState(false);

  const resendConfirmation = async () => {
    if (isResending) return;
    setIsResending(true);
    setResendMessage("");
    try {
      const response = await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email }),
      });
      const result = await response.json() as { message?: string };
      setResendMessage(result.message ?? (response.ok ? "Confirmation email requested." : "Unable to resend confirmation email."));
    } catch {
      setResendMessage("Unable to resend right now. Please try again later.");
    } finally {
      setIsResending(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name } = e.target;
    let value = e.target.value;

    if (name === "firstName" || name === "lastName" || name === "middleName") {
      value = sanitizeName(value);
    }
    if (name === "phoneNumber") {
      value = `${value.startsWith("+") ? "+" : ""}${value.replace(/\D/g, "")}`.slice(0, 16);
    }
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    const validation = validateGuestRegistration(formData);
    if (validation.error) {
      setError(validation.error);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = (await response.json()) as { success?: boolean; message?: string; needsEmailConfirmation?: boolean };
      if (!response.ok || !result.success) {
        setError(result.message || "Unable to create your account. Please try again.");
        return;
      }
      setNeedsEmailConfirmation(Boolean(result.needsEmailConfirmation));
      setSuccess(true);
      if (!result.needsEmailConfirmation) {
        setTimeout(() => router.push("/auth/login"), 2000);
      }
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-neutral mb-2">{needsEmailConfirmation ? "Check your email" : "Registration Successful!"}</h2>
          <p className="text-neutral/70 mb-4">
            {needsEmailConfirmation
              ? "If the address can be registered, you will receive a confirmation link. Confirm your email before signing in."
              : "Your account has been created. Redirecting to login..."}
          </p>
          {needsEmailConfirmation && <div className="space-y-3">
            <p className="text-sm text-neutral/70">Check your inbox and spam folder. The link may take a few minutes to arrive.</p>
            <button type="button" onClick={resendConfirmation} disabled={isResending} className="block w-full text-sm font-semibold text-primary underline disabled:opacity-50">{isResending ? "Sending..." : "Resend confirmation email"}</button>
            {resendMessage && <p role="status" className="text-sm text-neutral">{resendMessage}</p>}
            <Link href="/auth/login" className="inline-block text-primary font-semibold hover:underline">Go to sign in</Link>
          </div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <Image 
              src="/website_logo_transparent.png" 
              alt="MarVille Resort" 
              width={200} 
              height={80} 
              className="mx-auto mb-4"
            />
          </Link>
          <h1 className="text-3xl font-bold text-neutral mb-2">Create Account</h1>
          <p className="text-neutral/70">Join us for an unforgettable experience</p>
        </div>

        {/* Registration Form */}
        <div className="bg-white rounded-3xl shadow-xl p-8">
          <form onSubmit={handleRegister} className="space-y-6">
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Personal Information */}
            <div>
              <h3 className="text-lg font-semibold text-neutral mb-4">Personal Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="firstName" className="block text-sm font-medium text-neutral mb-2">
                    First Name *
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                    maxLength={100}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label htmlFor="lastName" className="block text-sm font-medium text-neutral mb-2">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                    maxLength={100}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="middleName" className="block text-sm font-medium text-neutral mb-2">
                    Middle Name <span className="text-neutral/50">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    id="middleName"
                    name="middleName"
                    value={formData.middleName}
                    onChange={handleChange}
                    maxLength={100}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div>
              <h3 className="text-lg font-semibold text-neutral mb-4">Contact Information</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-neutral mb-2">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    maxLength={254}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                  <label htmlFor="phoneNumber" className="block text-sm font-medium text-neutral mb-2">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    id="phoneNumber"
                    name="phoneNumber"
                    value={formData.phoneNumber}
                    onChange={handleChange}
                    required
                    inputMode="tel"
                    maxLength={16}
                    pattern="[+]?[0-9]{7,15}"
                    title="Use 7 to 15 digits, optionally starting with +"
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="+63 XXX XXX XXXX"
                  />
                </div>

                <div>
                  <label htmlFor="address" className="block text-sm font-medium text-neutral mb-2">
                    Address *
                  </label>
                  <textarea
                    id="address"
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    required
                    rows={3}
                    maxLength={500}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="Street Address, City, Province, Postal Code"
                  />
                </div>
              </div>
            </div>

            {/* Password */}
            <div>
              <h3 className="text-lg font-semibold text-neutral mb-4">Security</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-neutral mb-2">
                    Password *
                  </label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={6}
                    maxLength={128}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Min. 6 characters"
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral mb-2">
                    Confirm Password *
                  </label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-base py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-neutral/70">
              Already have an account?{" "}
              <Link href="/auth/login" className="text-primary font-semibold hover:underline">
                Sign in
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-neutral/60 text-sm hover:text-primary transition-colors">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
