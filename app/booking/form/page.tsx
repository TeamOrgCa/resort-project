"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { computeBookingPricing } from "@/lib/booking/pricing";
import { isValidName, sanitizeName } from "@/lib/helper/validation";

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

const parseDateTime = (value: string | null) => {
  if (!value) return null;

  const date = new Date(value);
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
  const bookingDraft = useBookingStore((state) => state.bookingDraft);
  const setBookingDraft = useBookingStore((state) => state.setBookingDraft);
  const [formData, setFormData] = useState({
    firstName: bookingDraft.firstName || "",
    lastName: bookingDraft.lastName || "",
    email: bookingDraft.email || "",
    phone: bookingDraft.phone || "",
    address: bookingDraft.address || "",
    adultCount: bookingDraft.adultCount || 1,
    childCount: bookingDraft.childCount || 0,
    roomType: bookingDraft.unitId || "",
    specialRequests: bookingDraft.specialRequests || "",
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

      const [catalogResponse, authResult] = await Promise.all([
        fetch("/api/catalog", { cache: "no-store" }),
        supabase.auth.getUser(),
      ]);
      const catalogResult = (await catalogResponse.json()) as {
        success?: boolean;
        message?: string;
        catalog?: {
          units: Array<{ unit_id: string; name: string; description: string | null; base_price: number }>;
          services: Array<{ service_id: string; name: string; price: number }>;
        };
      };

      if (!catalogResponse.ok || !catalogResult.success || !catalogResult.catalog) {
        setCatalogError(catalogResult.message || "Failed to load booking catalog");
        setCatalogLoading(false);
        return;
      }

      const mappedUnits: UnitOption[] = catalogResult.catalog.units.map((unit) => ({
        id: unit.unit_id,
        name: unit.name,
        price: Number(unit.base_price),
        description: unit.description ?? "",
      }));

      const mappedServices: ServiceOption[] = catalogResult.catalog.services.map((service) => ({
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

      // If there is a previously saved reservation in the draft, clear the reservation
      // metadata and any calculated billing so a fresh booking doesn't show old totals.
      if (bookingDraft?.reservationId) {
        setBookingDraft({
          reservationId: "",
          reservationReference: "",
          subtotal: 0,
          tax: 0,
          total: 0,
          downPayment: 0,
          paidAmount: 0,
          services: [],
        });
        setSelectedAmenities([]);
      }
    };

    loadCatalog();
  }, []);

 const handleInputChange = (
  e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
) => {
  const { name } = e.target;
  let value: string | number = e.target.value;

  if (name === "firstName" || name === "lastName") {
    value = sanitizeName(String(value));
  }

  if (name === "adultCount" || name === "childCount") {
    value = Number(value);
  }

  setFormData({
    ...formData,
    [name]: value,
  });
};

  const toggleAmenity = (amenityId: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenityId) ? prev.filter((id) => id !== amenityId) : [...prev, amenityId]
    );
  };

  const fallbackStartDate = useMemo(() => new Date(), []);
  const fallbackEndDate = useMemo(() => {
    const date = new Date();
    date.setHours(date.getHours() + 8);
    return date;
  }, []);

  const effectiveStartDate = parseDateTime(bookingDraft.startDatetime || null) ?? fallbackStartDate;
  const effectiveEndDate = parseDateTime(bookingDraft.endDatetime || null) ?? fallbackEndDate;

  const durationHours = Math.max(1, (effectiveEndDate.getTime() - effectiveStartDate.getTime()) / (1000 * 60 * 60));
  const selectedRoom = units.find((room) => room.id === formData.roomType);
  const amenitiesTotal = selectedAmenities.reduce((total, id) => {
    const amenity = services.find((a) => a.id === id);
    return total + (amenity?.price || 0);
  }, 0);
  const selectedServiceItems = services.filter((service) => selectedAmenities.includes(service.id));
  const pricing = computeBookingPricing({
    bookingMode: bookingDraft.bookingMode,
    startDatetime: effectiveStartDate.toISOString(),
    endDatetime: effectiveEndDate.toISOString(),
    adultCount: formData.adultCount,
    childCount: formData.childCount,
    servicesTotal: amenitiesTotal,
  });
  const subtotal = pricing.subtotal;
  const tax = pricing.tax;
  const total = pricing.total;
  const downPayment = pricing.downPaymentMin;

  const handleContinueToPayment = () => {
    if (!selectedRoom || formData.adultCount < 1 || (formData.adultCount + formData.childCount) === 0) {
      return;
    }

      if (
      !isValidName(formData.firstName) ||
      !isValidName(formData.lastName)
    ) {
      alert("Please enter a valid first and last name.");
      return;
    }

    setBookingDraft({
      checkIn: effectiveStartDate.toISOString().slice(0, 10),
      checkOut: effectiveEndDate.toISOString().slice(0, 10),
      startDatetime: effectiveStartDate.toISOString(),
      endDatetime: effectiveEndDate.toISOString(),
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone,
      address: formData.address,
      adultCount: formData.adultCount,
      childCount: formData.childCount,
      unitId: selectedRoom.id,
      roomName: selectedRoom.name,
      roomPrice: pricing.packageRate,
      nights: Math.max(1, Math.ceil(durationHours / 24)),
      subtotal,
      tax,
      total,
      downPayment,
      services: selectedServiceItems,
      specialRequests: formData.specialRequests,
      reservationId: "",
      reservationReference: "",
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
              <span className="text-sm font-medium text-neutral/50">Review & Save</span>
            </div>
            <div className="w-12 h-0.5 bg-neutral/20"></div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-neutral/20 text-neutral/50 flex items-center justify-center font-semibold">4</div>
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
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Number of Adults</label>
                      <input
                        type="number"
                        name="adultCount"
                        value={formData.adultCount}
                        onChange={handleInputChange}
                        min="1"
                        max="10"
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Number of Children</label>
                      <input
                        type="number"
                        name="childCount"
                        value={formData.childCount}
                        onChange={handleInputChange}
                        min="0"
                        max="10"
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="mt-4.5">
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Room Type *</label>
                      <select
                        name="roomType"
                        value={formData.roomType}
                        onChange={handleInputChange}
                        disabled={catalogLoading || units.length === 0}
                        className="w-full px-0 py-3.5 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      >
                        {units.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name} - Unit selection
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
                  <Link href="/booking/details" className="flex-1" onClick={handleContinueToPayment}>
                    <button
                      disabled={catalogLoading || units.length === 0 || !formData.roomType || formData.adultCount < 1 || (formData.adultCount + formData.childCount) === 0}
                      className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      Review Full Details
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
                      <span className="text-neutral/70">Start</span>
                      <span className="font-semibold text-neutral">{effectiveStartDate.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">End</span>
                      <span className="font-semibold text-neutral">{effectiveEndDate.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex justify-between mt-2">
                      <span className="text-neutral/70">Mode</span>
                      <span className="font-semibold text-neutral">{bookingDraft.bookingMode === "whole_day" ? "Whole-Day" : bookingDraft.bookingMode.charAt(0).toUpperCase() + bookingDraft.bookingMode.slice(1)}</span>
                    </div>
                  </div>

                  <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-2">
                      <span className="text-neutral/70">Package ({pricing.rateTier})</span>
                      <span className="font-semibold text-neutral">₱{pricing.packageRate.toLocaleString("en-PH")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">Guests included</span>
                      <span className="font-semibold text-neutral">{pricing.includedGuests} pax</span>
                    </div>
                  </div>

                  <div className="pb-4 border-b border-neutral/10">
                    <p className="text-sm font-semibold text-neutral mb-2">Guest Pricing</p>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-neutral/70">Total guests</span>
                      <span className="text-neutral">{pricing.totalGuests}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-neutral/70">Extra guests ({pricing.addOnPerHead.toLocaleString("en-PH")}/head)</span>
                      <span className="text-neutral">{pricing.extraGuests}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-neutral/70">Extra guest total</span>
                      <span className="text-neutral">₱{pricing.extraGuestTotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                      <span className="text-neutral/70">Tax</span>
                      <span className="font-semibold text-neutral">₱{tax.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-xl font-bold">
                    <span className="text-neutral">Total</span>
                    <span className="text-primary">₱{total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="bg-accent/10 p-4 rounded-lg">
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold text-neutral">Minimum Down Payment (20%)</span>
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
