"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function Payment() {
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "ewallet">("bank");
  const [paymentComplete, setPaymentComplete] = useState(false);
 const bookingReference = "SR-" + Math.random().toString(36).substring(2, 10).toUpperCase();

  const [bankDetails, setBankDetails] = useState({
    accountName: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });

  const [ewalletDetails, setEwalletDetails] = useState({
    provider: "gcash",
    accountNumber: "",
    referenceNumber: "",
  });

  const downPayment = 29685.15; // This would come from previous page
  const totalAmount = 98951;

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In real app, process payment here
    setPaymentComplete(true);
  };

  if (paymentComplete) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-12 text-center">
          <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Payment Successful!</h1>
          <p className="text-xl text-neutral/70 mb-8">Your reservation has been confirmed</p>

          <div className="bg-base p-8 rounded-2xl mb-8">
            <h2 className="text-2xl font-bold text-neutral mb-6">Reservation Summary</h2>
            <div className="space-y-4 text-left">
              <div className="flex justify-between pb-3 border-b border-neutral/10">
                <span className="text-neutral/70">Booking Reference</span>
                <span className="font-bold text-primary text-xl">{bookingReference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Guest Name</span>
                <span className="font-semibold text-neutral">John Doe</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-in</span>
                <span className="font-semibold text-neutral">March 10, 2026</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-out</span>
                <span className="font-semibold text-neutral">March 13, 2026</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Room Type</span>
                <span className="font-semibold text-neutral">Deluxe Ocean View</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Guests</span>
                <span className="font-semibold text-neutral">2 Guests</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-neutral/10">
                <span className="text-neutral/70">Total Amount</span>
                <span className="font-semibold text-neutral">₱{totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Paid (Down Payment)</span>
                <span className="font-semibold text-secondary">₱{downPayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Balance Due at Checkout</span>
                <span className="font-bold text-primary text-lg">₱{(totalAmount - downPayment).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="bg-accent/10 p-6 rounded-2xl mb-8 text-left">
            <h3 className="font-bold text-neutral mb-3">Important Information</h3>
            <ul className="space-y-2 text-sm text-neutral/80">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                A confirmation email has been sent to your registered email address
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Save your booking reference number for future reference
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                The remaining balance is due upon checkout
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Free cancellation available up to 48 hours before check-in
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/" className="flex-1">
              <button className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                Return Home
              </button>
            </Link>
            <Link href="/manage" className="flex-1">
              <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                Manage Booking
              </button>
            </Link>
          </div>

          <div className="mt-6">
            <Link href="/ocular" className="text-accent hover:text-accent/80 font-semibold">
              Schedule an Ocular Visit →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Progress Indicator */}
      <div className="mt-20 bg-white border-b border-neutral/10">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">✓</div>
              <span className="text-sm font-medium text-neutral">Select Dates</span>
            </div>
            <div className="w-12 h-0.5 bg-primary"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">✓</div>
              <span className="text-sm font-medium text-neutral">Guest Details</span>
            </div>
            <div className="w-12 h-0.5 bg-primary"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">3</div>
              <span className="text-sm font-medium text-primary">Payment</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Section */}
      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Payment Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-8">
                <h2 className="text-3xl font-bold text-neutral mb-8">Payment Details</h2>

                {/* Payment Method Selection */}
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Select Payment Method</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <button
                      onClick={() => setPaymentMethod("bank")}
                      className={`p-6 rounded-xl border-2 transition-all ${
                        paymentMethod === "bank"
                          ? "border-primary bg-primary/5"
                          : "border-neutral/20 hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-neutral">Bank Transfer</p>
                          <p className="text-sm text-neutral/70">Direct bank deposit</p>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => setPaymentMethod("ewallet")}
                      className={`p-6 rounded-xl border-2 transition-all ${
                        paymentMethod === "ewallet"
                          ? "border-primary bg-primary/5"
                          : "border-neutral/20 hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-secondary/20 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-neutral">E-Wallet</p>
                          <p className="text-sm text-neutral/70">GCash, PayMaya, etc.</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <form onSubmit={handlePaymentSubmit}>
                  {paymentMethod === "bank" && (
                    <div className="mb-8">
                      <h3 className="text-xl font-semibold text-neutral mb-4">Bank Transfer Details</h3>
                      
                      <div className="bg-neutral/5 p-6 rounded-xl mb-6">
                        <h4 className="font-semibold text-neutral mb-3">Transfer to:</h4>
                        <div className="space-y-2 text-sm">
                          <p><span className="text-neutral/70">Bank:</span> <span className="font-semibold">Paradise National Bank</span></p>
                          <p><span className="text-neutral/70">Account Name:</span> <span className="font-semibold">MarVille Resort Complex</span></p>
                          <p><span className="text-neutral/70">Account Number:</span> <span className="font-semibold">1234-5678-9012</span></p>
                          <p><span className="text-neutral/70">Swift Code:</span> <span className="font-semibold">PNBXPHM1</span></p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Account Name *</label>
                          <input
                            type="text"
                            value={bankDetails.accountName}
                            onChange={(e) => setBankDetails({ ...bankDetails, accountName: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Reference Number *</label>
                          <input
                            type="text"
                            value={bankDetails.referenceNumber}
                            onChange={(e) => setBankDetails({ ...bankDetails, referenceNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Upload Proof of Payment *</label>
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(e) => setBankDetails({ ...bankDetails, uploadProof: e.target.files?.[0] || null })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {paymentMethod === "ewallet" && (
                    <div className="mb-8">
                      <h3 className="text-xl font-semibold text-neutral mb-4">E-Wallet Payment</h3>
                      
                      <div className="space-y-4 mb-6">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Select Provider *</label>
                          <select
                            value={ewalletDetails.provider}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, provider: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                          >
                            <option value="gcash">GCash</option>
                            <option value="paymaya">PayMaya</option>
                            <option value="grabpay">GrabPay</option>
                            <option value="paypal">PayPal</option>
                          </select>
                        </div>
                      </div>

                      <div className="bg-neutral/5 p-6 rounded-xl mb-6">
                        <h4 className="font-semibold text-neutral mb-3">Send payment to:</h4>
                        <div className="space-y-2 text-sm">
                          <p><span className="text-neutral/70">Account Name:</span> <span className="font-semibold">MarVille Resort</span></p>
                          <p><span className="text-neutral/70">Number:</span> <span className="font-semibold">0917-123-4567</span></p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Your Account Number *</label>
                          <input
                            type="text"
                            value={ewalletDetails.accountNumber}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, accountNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Reference Number *</label>
                          <input
                            type="text"
                            value={ewalletDetails.referenceNumber}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, referenceNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4">
                    <Link href="/booking/form" className="flex-1">
                      <button type="button" className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                        Back
                      </button>
                    </Link>
                    <button type="submit" className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                      Confirm Payment
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Payment Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl p-8 sticky top-28">
                <h3 className="text-2xl font-bold text-neutral mb-6">Payment Summary</h3>

                <div className="space-y-4 mb-6">
                  <div className="pb-4 border-b border-neutral/10">
                    <p className="text-sm text-neutral/70 mb-1">Booking Reference</p>
                    <p className="font-mono font-bold text-neutral">{bookingReference}</p>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-neutral/70">Total Amount</span>
                    <span className="font-semibold text-neutral">₱{totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="bg-primary/5 p-4 rounded-lg">
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-neutral">Down Payment (30%)</span>
                      <span className="text-xl font-bold text-primary">₱{downPayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <p className="text-xs text-neutral/60">Required now to confirm booking</p>
                  </div>

                  <div className="flex justify-between pt-4 border-t border-neutral/10">
                    <span className="text-neutral/70">Remaining Balance</span>
                    <span className="font-semibold text-neutral">₱{(totalAmount - downPayment).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <p className="text-xs text-neutral/60">Balance payable upon checkout</p>
                </div>

                <div className="bg-accent/10 p-4 rounded-lg mb-6">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-neutral/80">Your reservation will be confirmed once payment is verified (typically within 2-4 hours)</p>
                  </div>
                </div>

                <div className="bg-highlight/10 p-4 rounded-lg">
                  <h4 className="font-semibold text-neutral mb-2 text-sm">Cancellation Policy</h4>
                  <p className="text-xs text-neutral/70">Free cancellation up to 48 hours before check-in. Down payment will be fully refunded.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
