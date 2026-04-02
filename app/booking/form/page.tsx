"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useBookingStore } from "@/lib/stores/booking-store";

interface UnitOption {
  id: string;
  name: string;
  price: number;
  description: string;
}

interface ServiceOption {
  id: string;
  name: string;
  price: number;
}

interface GuestProfile {
  first_name: string;
  last_name: string;
  phone_number: string;
  address: string;
}

const parseDateFromQuery = (value: string | null) => {
  if (!value) return null;

  const parts = value.split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function BookingForm() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <BookingFormContent />
    </Suspense>
  );
}

function BookingFormContent() {
  const searchParams = useSearchParams();
  const bookingDraft = useBookingStore((state) => state.bookingDraft);
  const setBookingDates = useBookingStore((state) => state.setBookingDates);
  const setBookingDraft = useBookingStore((state) => state.setBookingDraft);
  const [formData, setFormData] = useState({
    firstName: bookingDraft.firstName || "",
    lastName: bookingDraft.lastName || "",
    email: bookingDraft.email || "",
    phone: bookingDraft.phone || "",
    address: bookingDraft.address || "",
    guests: bookingDraft.guests || 2,
    roomType: bookingDraft.unitId || "",
    specialRequests: "",
  });

  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(bookingDraft.services.map((service) => service.id));
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);

      const supabase = createClient();

      const [unitsResult, servicesResult, authResult] = await Promise.all([
        supabase
          .from("units")
          .select("unit_id, name, description, base_price, is_active, archived_at")
          .eq("is_active", true)
          .is("archived_at", null)
          .order("name", { ascending: true }),
        supabase
          .from("services")
          .select("service_id, name, price, is_active")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase.auth.getUser(),
      ]);

      if (unitsResult.error || servicesResult.error) {
        setCatalogError(unitsResult.error?.message || servicesResult.error?.message || "Failed to load booking catalog");
        setCatalogLoading(false);
        return;
      }

      const mappedUnits: UnitOption[] = (unitsResult.data ?? []).map((unit) => ({
        id: unit.unit_id,
        name: unit.name,
        price: Number(unit.base_price),
        description: unit.description ?? "",
      }));

      const mappedServices: ServiceOption[] = (servicesResult.data ?? []).map((service) => ({
        id: service.service_id,
        name: service.name,
        price: Number(service.price),
      }));

      const authUser = authResult.data.user;
      let guestProfile: GuestProfile | null = null;

      if (authUser) {
        const { data } = await supabase
          .from("guests")
          .select("first_name, last_name, phone_number, address")
          .eq("id", authUser.id)
          .maybeSingle<GuestProfile>();

        guestProfile = data ?? null;
      }

      setUnits(mappedUnits);
      setServices(mappedServices);
      setFormData((prev) => ({
        ...prev,
        roomType: prev.roomType || mappedUnits[0]?.id || "",
        firstName: prev.firstName || guestProfile?.first_name || authUser?.user_metadata?.first_name || "",
        lastName: prev.lastName || guestProfile?.last_name || authUser?.user_metadata?.last_name || "",
        email: prev.email || authUser?.email || "",
        phone: prev.phone || guestProfile?.phone_number || authUser?.user_metadata?.phone_number || "",
        address: prev.address || guestProfile?.address || authUser?.user_metadata?.address || "",
      }));
      setCatalogLoading(false);
    };

    loadCatalog();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.name === "guests" ? Number(e.target.value) : e.target.value,
    });
  };

  const toggleAmenity = (amenityId: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenityId) ? prev.filter((id) => id !== amenityId) : [...prev, amenityId]
    );
  };

  const fallbackCheckInDate = useMemo(() => new Date("2026-03-10"), []);
  const fallbackCheckOutDate = useMemo(() => new Date("2026-03-13"), []);

  const queryCheckInDate = parseDateFromQuery(searchParams.get("checkIn"));
  const queryCheckOutDate = parseDateFromQuery(searchParams.get("checkOut"));
  const storeCheckInDate = parseDateFromQuery(bookingDraft.checkIn || null);
  const storeCheckOutDate = parseDateFromQuery(bookingDraft.checkOut || null);

  useEffect(() => {
    const checkInValue = searchParams.get("checkIn");
    const checkOutValue = searchParams.get("checkOut");

    if (checkInValue && checkOutValue) {
      setBookingDates(checkInValue, checkOutValue);
    }
  }, [searchParams, setBookingDates]);

  const effectiveCheckInDate = storeCheckInDate ?? queryCheckInDate ?? fallbackCheckInDate;
  const effectiveCheckOutDate = storeCheckOutDate ?? queryCheckOutDate ?? fallbackCheckOutDate;

  // Calculate pricing
  const nights = Math.max(
    1,
    Math.ceil((effectiveCheckOutDate.getTime() - effectiveCheckInDate.getTime()) / (1000 * 60 * 60 * 24))
  );
  const selectedRoom = units.find((room) => room.id === formData.roomType);
  const roomTotal = (selectedRoom?.price || 0) * nights;
  const amenitiesTotal = selectedAmenities.reduce((total, id) => {
    const amenity = services.find((a) => a.id === id);
    return total + (amenity?.price || 0);
  }, 0);
  const selectedServiceItems = services.filter((service) => selectedAmenities.includes(service.id));
  const subtotal = roomTotal + amenitiesTotal;
  const tax = subtotal * 0.12; // 12% tax
  const total = subtotal + tax;
  const downPayment = total * 0.3; // 30% down payment

  const handleContinueToPayment = () => {
    if (!selectedRoom) {
      return;
    }

    setBookingDraft({
      checkIn: effectiveCheckInDate.toISOString().slice(0, 10),
      checkOut: effectiveCheckOutDate.toISOString().slice(0, 10),
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      guests: formData.guests,
      unitId: selectedRoom.id,
      roomName: selectedRoom.name,
      roomPrice: selectedRoom.price,
      nights,
      subtotal,
      tax,
      total,
      downPayment,
      services: selectedServiceItems,
    });
  };

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
                        disabled={catalogLoading || units.length === 0}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      >
                        {units.map((room) => (
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
                  {catalogError && (
                    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                      {catalogError}
                    </div>
                  )}
                  {catalogLoading && (
                    <p className="mb-4 text-sm text-neutral/70">Loading available units and services...</p>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    {services.map((amenity) => (
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
                            <p className="text-sm text-primary">₱{amenity.price.toLocaleString()}</p>
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
                  <Link href="/booking/payment" className="flex-1" onClick={handleContinueToPayment}>
                    <button
                      disabled={catalogLoading || units.length === 0 || !formData.roomType}
                      className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
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
                      <span className="font-semibold text-neutral">{effectiveCheckInDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">Check-out</span>
                      <span className="font-semibold text-neutral">{effectiveCheckOutDate.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span>
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
                        const amenity = services.find((a) => a.id === id);
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
