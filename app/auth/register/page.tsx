"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sanitizeName } from "@/lib/helper/validation";
import { validateGuestRegistration, type GuestRegistrationField } from "@/lib/auth/guest-registration";
import FormErrorToast from "@/components/ui/FormErrorToast";
import PhilippinePhoneInput from "@/components/ui/PhilippinePhoneInput";
import PasswordInput from "@/components/ui/PasswordInput";
import { sanitizeEmailInput } from "@/lib/validation/email";
import PhilippineAddressFields from "@/components/ui/PhilippineAddressFields";
import type { PhilippineAddress } from "@/lib/address/philippine-address";
import PolicyAgreement from "@/components/legal/PolicyAgreement";

export default function Register() {
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [address, setAddress] = useState<PhilippineAddress>({ streetAddress: "", province: "", city: "", zipCode: "" });
  
  const [loading, setLoading] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [legalPolicyVersion, setLegalPolicyVersion] = useState<string | null>(null);
  const [policyReload, setPolicyReload] = useState(0);
  const [error, setError] = useState("");
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [errorField, setErrorField] = useState<GuestRegistrationField | null>(null);
  const [errorAttempt, setErrorAttempt] = useState(0);
  const [errorToast, setErrorToast] = useState<{ message: string } | null>(null);
  const registrationForm = useRef<HTMLFormElement>(null);
  const dismissErrorToast = useCallback(() => setErrorToast(null), []);
  const [success, setSuccess] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");

  useEffect(() => {
    if (!errorField) return;
    const field = registrationForm.current?.elements.namedItem(errorField);
    if (!(field instanceof HTMLElement)) return;
    const previousInvalid = field.getAttribute("aria-invalid");
    const previousDescription = field.getAttribute("aria-describedby");
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", [previousDescription, "registration-error"].filter(Boolean).join(" "));
    field.style.scrollMarginTop = "7rem";
    field.focus({ preventScroll: true });
    field.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    return () => {
      if (previousInvalid === null) field.removeAttribute("aria-invalid"); else field.setAttribute("aria-invalid", previousInvalid);
      if (previousDescription === null) field.removeAttribute("aria-describedby"); else field.setAttribute("aria-describedby", previousDescription);
    };
  }, [errorField, errorAttempt]);

  const showRegistrationError = (message: string, field?: GuestRegistrationField) => {
    setError(message);
    setErrorField(field ?? null);
    setErrorAttempt(attempt => attempt + 1);
    setErrorToast({ message });
  };

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
      if (response.ok) setDeliveryError("");
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
      value = sanitizeName(value).slice(0, 75);
    }
    if (name === "email") value = sanitizeEmailInput(value);
    setFormData((previous) => ({ ...previous, [name]: value }));
    if (name === "email" && emailAlreadyRegistered) { setError(""); setEmailAlreadyRegistered(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setErrorField(null);
    setErrorToast(null);
    setEmailAlreadyRegistered(false);
    const registrationData = { ...formData, addressDetails: address, policyAccepted, legalPolicyVersion };
    const validation = validateGuestRegistration(registrationData);
    if (!validation.value) {
      showRegistrationError(validation.error, validation.field);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...registrationData, address: validation.value.address, phoneNumber: validation.value.phoneNumber }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string; code?: string; field?: GuestRegistrationField; needsEmailConfirmation?: boolean; confirmationEmailSent?: boolean };
      if (!response.ok || !result.success) {
        if (result.code === "LEGAL_POLICY_CHANGED") { setPolicyAccepted(false); setPolicyReload(value => value + 1); }
        setEmailAlreadyRegistered(result.code === "EMAIL_ALREADY_REGISTERED");
        showRegistrationError(result.message || "Unable to create your account. Please try again.", result.code === "EMAIL_ALREADY_REGISTERED" ? "email" : result.field);
        return;
      }
      setNeedsEmailConfirmation(Boolean(result.needsEmailConfirmation));
      setDeliveryError(result.confirmationEmailSent === false ? result.message ?? "Confirmation email could not be sent. Please try resending it." : "");
      setSuccess(true);
      if (!result.needsEmailConfirmation) {
        setTimeout(() => router.push("/auth/login"), 2000);
      }
    } catch {
      showRegistrationError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-4 sm:p-8 text-center">
          <div className="w-16 h-16 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-neutral mb-2">{deliveryError ? "Confirmation email delayed" : needsEmailConfirmation ? "Check your email" : "Registration Successful!"}</h2>
          {deliveryError && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{deliveryError}</p>}
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
        <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8">
          <form ref={registrationForm} noValidate onSubmit={handleRegister} className="space-y-6" onChangeCapture={event => {
            if (event.target instanceof HTMLElement && event.target.getAttribute("name") === errorField) {
              setError(""); setErrorField(null); setErrorToast(null); setEmailAlreadyRegistered(false);
            }
          }}>
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
                    maxLength={75}
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
                    maxLength={75}
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
                    maxLength={75}
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
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
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
                  <PhilippinePhoneInput id="phoneNumber" name="phoneNumber" value={formData.phoneNumber}
                    onChange={phoneNumber => setFormData(current => ({ ...current, phoneNumber }))} />
                </div>

                <PhilippineAddressFields value={address} onChange={setAddress} />
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
                  <PasswordInput
                    autoComplete="new-password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={8}
                    maxLength={128}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="8–128 characters"
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral mb-2">
                    Confirm Password *
                  </label>
                  <PasswordInput
                    autoComplete="new-password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                    minLength={8}
                    maxLength={128}
                    className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            <PolicyAgreement accepted={policyAccepted} onChange={setPolicyAccepted} onLegalVersion={setLegalPolicyVersion} reloadKey={policyReload} name="policyAccepted" required disabled={loading} />

            {error && <div id="registration-error" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>{error}</p>
              {emailAlreadyRegistered && <p className="mt-2 flex flex-wrap gap-4"><Link href="/auth/login" className="font-semibold underline">Sign in</Link><Link href="/auth/forgot" className="font-semibold underline">Reset password</Link></p>}
            </div>}
            <button
              type="submit"
              disabled={loading || !policyAccepted}
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
      {errorToast && <FormErrorToast error={errorToast} onDismiss={dismissErrorToast} />}
    </div>
  );
}
