"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function BookingForm() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    guests: 2,
    roomType: "deluxe",
    specialRequests: "",
  });

  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  const roomTypes = [
    { id: "standard", name: "Standard Room", price: 16450, description: "Comfortable room with garden view" },
    { id: "deluxe", name: "Deluxe Ocean View", price: 24700, description: "Spacious room with ocean view" },
    { id: "suite", name: "Executive Suite", price: 38450, description: "Luxurious suite with private balcony" },
    { id: "villa", name: "Beach Villa", price: 54950, description: "Private villa steps from the beach" },
  ];

  const amenities = [
    { id: "breakfast", name: "Daily Breakfast", price: 1950 },
    { id: "spa", name: "Spa Package", price: 8250 },
    { id: "airport", name: "Airport Transfer", price: 4125 },
    { id: "excursion", name: "Island Excursion", price: 6600 },
    { id: "dining", name: "Fine Dining Package", price: 11000 },
    { id: "activities", name: "Water Sports Package", price: 9900 },
  ];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const toggleAmenity = (amenityId: string) => {
    if (selectedAmenities.includes(amenityId)) {
      setSelectedAmenities(selectedAmenities.filter((id) => id !== amenityId));
    } else {
      setSelectedAmenities([...selectedAmenities, amenityId]);
    }
  };

  // Calculate pricing
  const nights = 3; // This would come from selected dates
  const selectedRoom = roomTypes.find((room) => room.id === formData.roomType);
  const roomTotal = (selectedRoom?.price || 0) * nights;
  const amenitiesTotal = selectedAmenities.reduce((total, id) => {
    const amenity = amenities.find((a) => a.id === id);
    return total + (amenity?.price || 0);
  }, 0);
  const subtotal = roomTotal + amenitiesTotal;
  const tax = subtotal * 0.12; // 12% tax
  const total = subtotal + tax;
  const downPayment = total * 0.3; // 30% down payment

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Progress Indicator */}
      <div className="mt-20 bg-white border-b border-neutral/10">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">1</div>
              <span className="text-sm font-medium text-neutral">Select Dates</span>
            </div>
            <div className="w-12 h-0.5 bg-primary"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">2</div>
              <span className="text-sm font-medium text-primary">Guest Details</span>
            </div>
            <div className="w-12 h-0.5 bg-neutral/20"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-neutral/20 text-neutral/50 flex items-center justify-center font-semibold">3</div>
              <span className="text-sm font-medium text-neutral/50">Payment</span>
            </div>
          </div>
        </div>
      </div>

      {/* Form Section */}
      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-8">
                <h2 className="text-3xl font-bold text-neutral mb-8">Reservation Details</h2>

                {/* Personal Information */}
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Personal Information</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">First Name *</label>
                      <input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Last Name *</label>
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Email Address *</label>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Phone Number *</label>
                      <input
                        type="tel"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Address</label>
                      <input
                        type="text"
                        name="address"
                        value={formData.address}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Booking Details */}
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Booking Details</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Number of Guests *</label>
                      <select
                        name="guests"
                        value={formData.guests}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                          <option key={num} value={num}>
                            {num} {num === 1 ? "Guest" : "Guests"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Room Type *</label>
                      <select
                        name="roomType"
                        value={formData.roomType}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      >
                        {roomTypes.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name} - ₱{room.price.toLocaleString()}/night
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {selectedRoom && (
                    <div className="mt-4 p-4 bg-primary/5 rounded-lg">
                      <p className="text-sm text-neutral/80">{selectedRoom.description}</p>
                    </div>
                  )}
                </div>

                {/* Additional Services */}
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Additional Services & Amenities</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    {amenities.map((amenity) => (
                      <div
                        key={amenity.id}
                        onClick={() => toggleAmenity(amenity.id)}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          selectedAmenities.includes(amenity.id)
                            ? "border-primary bg-primary/5"
                            : "border-neutral/20 hover:border-primary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-neutral">{amenity.name}</p>
                            <p className="text-sm text-primary">${amenity.price}</p>
                          </div>
                          {selectedAmenities.includes(amenity.id) && (
                            <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Special Requests */}
                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Special Requests</h3>
                  <textarea
                    name="specialRequests"
                    value={formData.specialRequests}
                    onChange={handleInputChange}
                    rows={4}
                    placeholder="Any special requests or dietary requirements?"
                    className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                  ></textarea>
                </div>

                <div className="flex gap-4">
                  <Link href="/booking" className="flex-1">
                    <button className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                      Back
                    </button>
                  </Link>
                  <Link href="/booking/payment" className="flex-1">
                    <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                      Continue to Payment
                    </button>
                  </Link>
                </div>
              </div>
            </div>

            {/* Billing Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl p-8 sticky top-28">
                <h3 className="text-2xl font-bold text-neutral mb-6">Billing Summary</h3>

                <div className="space-y-4 mb-6">
                  <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-2">
                      <span className="text-neutral/70">Check-in</span>
                      <span className="font-semibold text-neutral">Mar 10, 2026</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">Check-out</span>
                      <span className="font-semibold text-neutral">Mar 13, 2026</span>
                    </div>
                  </div>

                  <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-2">
                      <span className="text-neutral/70">{selectedRoom?.name}</span>
                      <span className="font-semibold text-neutral">₱{selectedRoom?.price.toLocaleString()}/night</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">{nights} nights</span>
                      <span className="font-semibold text-neutral">₱{roomTotal.toLocaleString()}</span>
                    </div>
                  </div>

                  {selectedAmenities.length > 0 && (
                    <div className="pb-4 border-b border-neutral/10">
                      <p className="text-sm font-semibold text-neutral mb-2">Additional Services</p>
                      {selectedAmenities.map((id) => {
                        const amenity = amenities.find((a) => a.id === id);
                        return (
                          <div key={id} className="flex justify-between text-sm mb-1">
                            <span className="text-neutral/70">{amenity?.name}</span>
                            <span className="text-neutral">₱{amenity?.price.toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-2">
                      <span className="text-neutral/70">Subtotal</span>
                      <span className="font-semibold text-neutral">₱{subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">Tax (12%)</span>
                      <span className="font-semibold text-neutral">₱{tax.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-xl font-bold">
                    <span className="text-neutral">Total</span>
                    <span className="text-primary">₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="bg-accent/10 p-4 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold text-neutral">Down Payment (30%)</span>
                      <span className="text-lg font-bold text-accent">₱{downPayment.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <p className="text-xs text-neutral/60 mt-2">Required to confirm reservation</p>
                  </div>
                </div>

                <div className="bg-highlight/10 p-4 rounded-lg">
                  <p className="text-sm text-neutral/80">
                    <span className="font-semibold">Note:</span> This is a preliminary estimate. Final charges will be calculated upon checkout based on your actual stay and services used.
                  </p>
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
