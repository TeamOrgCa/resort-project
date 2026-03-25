"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function ManageBooking() {
  const [bookingRef, setBookingRef] = useState("");
  const [bookingFound, setBookingFound] = useState(false);
  const [activeTab, setActiveTab] = useState<"view" | "edit" | "reschedule" | "cancel">("view");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [bookingCancelled, setBookingCancelled] = useState(false);

  // Mock booking data
  const [bookingData, setBookingData] = useState({
    reference: "SR-ABC12345",
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@email.com",
    phone: "+1-555-123-4567",
    checkIn: "March 10, 2026",
    checkOut: "March 13, 2026",
    roomType: "Deluxe Ocean View",
    guests: 2,
    amenities: ["Daily Breakfast", "Spa Package"],
    totalAmount: 1799.10,
    paidAmount: 539.73,
    status: "Confirmed",
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // In real app, search for booking
    setBookingFound(true);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    alert("Booking details updated successfully!");
    setActiveTab("view");
  };

  const handleCancellation = () => {
    setBookingCancelled(true);
    setShowCancelConfirm(false);
  };

  if (bookingCancelled) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-12 text-center">
          <div className="w-20 h-20 bg-neutral/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-neutral" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Booking Cancelled</h1>
          <p className="text-xl text-neutral/70 mb-8">Your reservation has been cancelled</p>

          <div className="bg-base p-8 rounded-2xl mb-8">
            <div className="space-y-4 text-left">
              <div className="flex justify-between">
                <span className="text-neutral/70">Booking Reference</span>
                <span className="font-bold text-neutral">{bookingData.reference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Refund Amount</span>
                <span className="font-bold text-secondary">₱{bookingData.paidAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Processing Time</span>
                <span className="font-semibold text-neutral">5-7 business days</span>
              </div>
            </div>
          </div>

          <div className="bg-accent/10 p-6 rounded-2xl mb-8 text-left">
            <p className="text-sm text-neutral/80">
              Your down payment will be refunded to your original payment method within 5-7 business days. 
              You will receive a confirmation email shortly.
            </p>
          </div>

          <Link href="/">
            <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
              Return to Home
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Hero Section */}
      <section className="relative h-80 flex items-center justify-center overflow-hidden mt-20">
        <Image 
          src="/website_cover.jpg" 
          alt="Manage Booking" 
          fill 
          className="object-cover brightness-75" 
          priority
        />
        <div className="absolute inset-0 bg-neutral/40"></div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-6xl font-bold text-base mb-4">Manage Booking</h1>
          <p className="text-xl text-base/90">View, edit, or cancel your reservation</p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          {!bookingFound ? (
            <div className="bg-white rounded-3xl shadow-xl p-12 max-w-2xl mx-auto">
              <h2 className="text-3xl font-bold text-neutral mb-8 text-center">Find Your Booking</h2>
              <form onSubmit={handleSearch}>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-neutral/70 mb-2">Booking Reference Number</label>
                  <input
                    type="text"
                    value={bookingRef}
                    onChange={(e) => setBookingRef(e.target.value)}
                    placeholder="SR-XXXXXXXX"
                    className="w-full px-4 py-4 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none text-lg"
                    required
                  />
                  <p className="text-sm text-neutral/60 mt-2">
                    Enter the booking reference number from your confirmation email
                  </p>
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-base px-6 py-4 rounded-full text-lg font-semibold hover:bg-primary/90 transition-all transform hover:scale-105"
                >
                  Search Booking
                </button>
              </form>

              <div className="mt-8 pt-8 border-t border-neutral/10">
                <p className="text-sm text-neutral/70 text-center mb-4">Need help finding your booking?</p>
                <Link href="/about" className="block text-center text-primary hover:text-primary/80 font-semibold">
                  Contact Support
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-4 gap-8">
              {/* Tabs */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-3xl shadow-xl p-6 sticky top-28">
                  <h3 className="text-lg font-bold text-neutral mb-4">Options</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => setActiveTab("view")}
                      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${
                        activeTab === "view" ? "bg-primary text-base" : "text-neutral hover:bg-neutral/5"
                      }`}
                    >
                      View Details
                    </button>
                    <button
                      onClick={() => setActiveTab("edit")}
                      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${
                        activeTab === "edit" ? "bg-primary text-base" : "text-neutral hover:bg-neutral/5"
                      }`}
                    >
                      Edit Details
                    </button>
                    <button
                      onClick={() => setActiveTab("reschedule")}
                      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${
                        activeTab === "reschedule" ? "bg-primary text-base" : "text-neutral hover:bg-neutral/5"
                      }`}
                    >
                      Reschedule
                    </button>
                    <button
                      onClick={() => setActiveTab("cancel")}
                      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${
                        activeTab === "cancel" ? "bg-primary text-base" : "text-neutral hover:bg-neutral/5"
                      }`}
                    >
                      Cancel Booking
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="lg:col-span-3">
                <div className="bg-white rounded-3xl shadow-xl p-8">
                  {activeTab === "view" && (
                    <>
                      <h2 className="text-3xl font-bold text-neutral mb-8">Booking Details</h2>
                      
                      <div className="bg-primary/5 p-6 rounded-xl mb-8">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm text-neutral/70">Booking Reference</p>
                            <p className="text-2xl font-bold text-primary">{bookingData.reference}</p>
                          </div>
                          <div className="px-4 py-2 bg-secondary/20 text-secondary font-semibold rounded-full">
                            {bookingData.status}
                          </div>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-6 mb-8">
                        <div className="space-y-4">
                          <div>
                            <p className="text-sm text-neutral/70">Guest Name</p>
                            <p className="font-semibold text-neutral">{bookingData.firstName} {bookingData.lastName}</p>
                          </div>
                          <div>
                            <p className="text-sm text-neutral/70">Email</p>
                            <p className="font-semibold text-neutral">{bookingData.email}</p>
                          </div>
                          <div>
                            <p className="text-sm text-neutral/70">Phone</p>
                            <p className="font-semibold text-neutral">{bookingData.phone}</p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <p className="text-sm text-neutral/70">Check-in</p>
                            <p className="font-semibold text-neutral">{bookingData.checkIn}</p>
                          </div>
                          <div>
                            <p className="text-sm text-neutral/70">Check-out</p>
                            <p className="font-semibold text-neutral">{bookingData.checkOut}</p>
                          </div>
                          <div>
                            <p className="text-sm text-neutral/70">Room Type</p>
                            <p className="font-semibold text-neutral">{bookingData.roomType}</p>
                          </div>
                          <div>
                            <p className="text-sm text-neutral/70">Number of Guests</p>
                            <p className="font-semibold text-neutral">{bookingData.guests} Guests</p>
                          </div>
                        </div>
                      </div>

                      {bookingData.amenities.length > 0 && (
                        <div className="mb-8">
                          <p className="text-sm text-neutral/70 mb-2">Additional Services</p>
                          <div className="flex flex-wrap gap-2">
                            {bookingData.amenities.map((amenity, index) => (
                              <span key={index} className="px-4 py-2 bg-accent/10 text-accent rounded-full text-sm font-medium">
                                {amenity}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="border-t border-neutral/10 pt-6">
                        <div className="flex justify-between mb-2">
                          <span className="text-neutral/70">Total Amount</span>
                          <span className="font-semibold text-neutral">₱{bookingData.totalAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between mb-2">
                          <span className="text-neutral/70">Paid</span>
                          <span className="font-semibold text-secondary">₱{bookingData.paidAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-lg">
                          <span className="font-semibold text-neutral">Balance Due</span>
                          <span className="font-bold text-primary">₱{(bookingData.totalAmount - bookingData.paidAmount).toFixed(2)}</span>
                        </div>
                      </div>
                    </>
                  )}

                  {activeTab === "edit" && (
                    <>
                      <h2 className="text-3xl font-bold text-neutral mb-8">Edit Booking Details</h2>
                      <form onSubmit={handleUpdate}>
                        <div className="space-y-6">
                          <div className="grid md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text- font-medium text-neutral/70 mb-2">First Name</label>
                              <input
                                type="text"
                                value={bookingData.firstName}
                                onChange={(e) => setBookingData({ ...bookingData, firstName: e.target.value })}
                                className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-neutral/70 mb-2">Last Name</label>
                              <input
                                type="text"
                                value={bookingData.lastName}
                                onChange={(e) => setBookingData({ ...bookingData, lastName: e.target.value })}
                                className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-neutral/70 mb-2">Email Address</label>
                            <input
                              type="email"
                              value={bookingData.email}
                              onChange={(e) => setBookingData({ ...bookingData, email: e.target.value })}
                              className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-neutral/70 mb-2">Phone Number</label>
                            <input
                              type="tel"
                              value={bookingData.phone}
                              onChange={(e) => setBookingData({ ...bookingData, phone: e.target.value })}
                              className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-neutral/70 mb-2">Number of Guests</label>
                            <select
                              value={bookingData.guests}
                              onChange={(e) => setBookingData({ ...bookingData, guests: parseInt(e.target.value) })}
                              className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                                <option key={num} value={num}>{num} {num === 1 ? "Guest" : "Guests"}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="mt-8 bg-highlight/10 p-4 rounded-lg">
                          <p className="text-sm text-neutral/80">
                            <span className="font-semibold">Note:</span> Changes to dates and room type can be made through the Reschedule option. Additional charges may apply for certain modifications.
                          </p>
                        </div>

                        <button
                          type="submit"
                          className="w-full mt-8 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105"
                        >
                          Save Changes
                        </button>
                      </form>
                    </>
                  )}

                  {activeTab === "reschedule" && (
                    <>
                      <h2 className="text-3xl font-bold text-neutral mb-8">Reschedule Booking</h2>
                      <div className="bg-accent/10 p-6 rounded-xl mb-8">
                        <p className="text-neutral/80">
                          To reschedule your booking dates, please contact our reservations team directly. 
                          Rescheduling is subject to availability and may incur additional charges.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="p-6 border-2 border-neutral/10 rounded-xl">
                          <h3 className="font-semibold text-neutral mb-2">Current Dates</h3>
                          <p className="text-neutral/70">Check-in: {bookingData.checkIn}</p>
                          <p className="text-neutral/70">Check-out: {bookingData.checkOut}</p>
                        </div>

                        <div className="bg-primary/5 p-6 rounded-xl">
                          <h3 className="font-semibold text-neutral mb-4">Contact Reservations</h3>
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              <span className="text-neutral">+1 (555) 123-4567</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <span className="text-neutral">reservations@marvilleresort.com</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activeTab === "cancel" && (
                    <>
                      <h2 className="text-3xl font-bold text-neutral mb-8">Cancel Booking</h2>
                      
                      <div className="bg-neutral/5 p-6 rounded-xl mb-8">
                        <h3 className="font-semibold text-neutral mb-3">Cancellation Policy</h3>
                        <ul className="space-y-2 text-sm text-neutral/80">
                          <li className="flex items-start gap-2">
                            <svg className="w-5 h-5 text-secondary mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Free cancellation up to 48 hours before check-in
                          </li>
                          <li className="flex items-start gap-2">
                            <svg className="w-5 h-5 text-secondary mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Full refund of down payment
                          </li>
                          <li className="flex items-start gap-2">
                            <svg className="w-5 h-5 text-secondary mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Refund processed in 5-7 business days
                          </li>
                        </ul>
                      </div>

                      <div className="p-6 border-2 border-neutral/10 rounded-xl mb-8">
                        <h3 className="font-semibold text-neutral mb-4">Booking Summary</h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-neutral/70">Booking Reference</span>
                            <span className="font-semibold text-neutral">{bookingData.reference}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral/70">Check-in Date</span>
                            <span className="font-semibold text-neutral">{bookingData.checkIn}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral/70">Refund Amount</span>
                            <span className="font-semibold text-secondary">₱{bookingData.paidAmount.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {!showCancelConfirm ? (
                        <button
                          onClick={() => setShowCancelConfirm(true)}
                          className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors"
                        >
                          Cancel This Booking
                        </button>
                      ) : (
                        <div className="bg-primary/5 p-6 rounded-xl">
                          <p className="text-neutral mb-6 font-semibold">Are you sure you want to cancel this booking?</p>
                          <div className="flex gap-4">
                            <button
                              onClick={() => setShowCancelConfirm(false)}
                              className="flex-1 bg-neutral/10 text-neutral px-6 py-3 rounded-full font-semibold hover:bg-neutral/20 transition-colors"
                            >
                              No, Keep Booking
                            </button>
                            <button
                              onClick={handleCancellation}
                              className="flex-1 bg-primary text-base px-6 py-3 rounded-full font-semibold hover:bg-primary/90 transition-colors"
                            >
                              Yes, Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
