"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { useBookingStore } from "@/lib/stores/booking-store";
import { buildBookingWindow, validateBookingWindow, type BookingMode, type WholeDayVariant } from "@/lib/booking/policy";

export default function Booking() {
  const router = useRouter();
  const setBookingWindow = useBookingStore((state) => state.setBookingWindow);
  const [bookingType, setBookingType] = useState<"stay" | "ocular">("stay");
  const [bookingMode, setBookingMode] = useState<BookingMode>("day");
  const [wholeDayVariant, setWholeDayVariant] = useState<WholeDayVariant>("day_to_night");
  const [selectedStayDate, setSelectedStayDate] = useState<Date | null>(null);
  const [customStartTime, setCustomStartTime] = useState("08:00");
  const [customEndTime, setCustomEndTime] = useState("11:00");
  const [customEndDate, setCustomEndDate] = useState("");
  const [stayError, setStayError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [visitScheduled, setVisitScheduled] = useState(false);
  const [ocularSubmitting, setOcularSubmitting] = useState(false);
  const [ocularError, setOcularError] = useState<string | null>(null);

  const formatDateForStore = (date: Date) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseLocalDateValue = (value: string) => {
    const parts = value.split("-");
    if (parts.length !== 3) return null;

    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) return null;

    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const handleContinueToReservation = () => {
    if (!selectedStayDate) {
      setStayError("Please select a booking date.");
      return;
    }

    const selectedCustomEndDate =
      bookingMode === "custom"
        ? parseLocalDateValue(customEndDate || formatDateForStore(selectedStayDate))
        : null;

    if (bookingMode === "custom" && !selectedCustomEndDate) {
      setStayError("Please select a valid custom end date.");
      return;
    }

    const generatedWindow = buildBookingWindow({
      bookingMode,
      date: selectedStayDate,
      wholeDayVariant,
      customStartTime,
      customEndTime,
      customEndDate: selectedCustomEndDate ?? undefined,
    });

    if ("error" in generatedWindow) {
      setStayError(generatedWindow.error || "Invalid booking window.");
      return;
    }

    const validation = validateBookingWindow({
      bookingMode,
      startDatetime: generatedWindow.startDatetime,
      endDatetime: generatedWindow.endDatetime,
      wholeDayVariant,
      customStartTime,
      customEndTime,
    });

    if (!validation.valid) {
      setStayError(validation.message || "Invalid booking window.");
      return;
    }

    setStayError(null);
    setBookingWindow(bookingMode, generatedWindow.startDatetime, generatedWindow.endDatetime, {
      wholeDayVariant,
      customStartTime,
      customEndTime,
      customEndDate:
        bookingMode === "custom"
          ? formatDateForStore(selectedCustomEndDate ?? selectedStayDate)
          : "",
      customDurationHours: generatedWindow.customDurationHours,
    });
    router.push("/booking/form");
  };

  const availableTimes = ["08:00-09:00", "09:00-10:00", "10:00-11:00", "13:00-14:00", "14:00-15:00"];

  const formatTimeSlot = (slot: string) => {
    if (!slot.includes("-")) return slot;

    const [start, end] = slot.split("-");

    const toLabel = (time: string) => {
      const [hourRaw, minute] = time.split(":");
      const hour = Number(hourRaw);
      if (Number.isNaN(hour) || !minute) return time;

      const period = hour >= 12 ? "PM" : "AM";
      const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
      return `${normalizedHour}:${minute} ${period}`;
    };

    return `${toLabel(start)} - ${toLabel(end)}`;
  };

  // Sample booked dates (in real app, fetch from backend)
  const bookedDates = [
    new Date(2026, 2, 5), // March 5
    new Date(2026, 2, 6), // March 6
    new Date(2026, 2, 15), // March 15
    new Date(2026, 2, 16), // March 16
    new Date(2026, 2, 20), // March 20
  ];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    return { days, firstDay };
  };

  const isDateBooked = (date: Date) => {
    return bookedDates.some(
      (bookedDate) =>
        bookedDate.getDate() === date.getDate() &&
        bookedDate.getMonth() === date.getMonth() &&
        bookedDate.getFullYear() === date.getFullYear()
    );
  };

  const isDateSelected = (date: Date) => {
    if (!selectedStayDate) return false;
    return date.toDateString() === selectedStayDate.toDateString();
  };

  const handleDateClick = (date: Date) => {
    if (bookingType === "ocular") {
      const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
      if (!isPast) {
        setSelectedDate(date);
      }
    } else {
      if (isDateBooked(date)) return;

      const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));
      if (isPast) return;

      setSelectedStayDate(date);
      if (bookingMode === "custom") {
        if (!customEndDate) {
          setCustomEndDate(formatDateForStore(date));
        } else {
          const parsedEnd = parseLocalDateValue(customEndDate);
          if (!parsedEnd || parsedEnd < date) {
            setCustomEndDate(formatDateForStore(date));
          }
        }
      }
      setStayError(null);
    }
  };

  const handleOcularSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedDate || !selectedTime) {
      setOcularError("Please select both date and time for your ocular visit.");
      return;
    }

    setOcularSubmitting(true);
    setOcularError(null);

    try {
      const formattedDate = formatDateForStore(selectedDate);

      const response = await fetch("/api/ocular-visits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduledDate: formattedDate,
          timeSlot: selectedTime,
        }),
      });

      const json = (await response.json()) as {
        success?: boolean;
        message?: string;
        ocularVisit?: { reference?: string };
      };

      if (!response.ok || !json.success) {
        setOcularError(json.message || "Failed to schedule ocular visit.");
        setOcularSubmitting(false);
        return;
      }

      setBookingRef(json.ocularVisit?.reference || "");
      setVisitScheduled(true);
    } catch {
      setOcularError("Unable to schedule ocular visit right now. Please try again.");
    } finally {
      setOcularSubmitting(false);
    }
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const { days, firstDay } = getDaysInMonth(currentMonth);
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Success screen for ocular visit
  if (visitScheduled) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-12 text-center">
          <div className="w-20 h-20 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Visit Scheduled!</h1>
          <p className="text-xl text-neutral/70 mb-8">We look forward to showing you around</p>

          <div className="bg-base p-8 rounded-2xl mb-8">
            <h2 className="text-2xl font-bold text-neutral mb-6">Visit Details</h2>
            <div className="space-y-4 text-left">
              <div className="flex justify-between">
                <span className="text-neutral/70">Booking Reference</span>
                <span className="font-bold text-primary">{bookingRef}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Visit Date</span>
                <span className="font-semibold text-neutral">{selectedDate?.toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Time</span>
                <span className="font-semibold text-neutral">{formatTimeSlot(selectedTime)}</span>
              </div>
            </div>
          </div>

          <div className="bg-accent/10 p-6 rounded-2xl mb-8 text-left">
            <h3 className="font-bold text-neutral mb-3">What to Expect</h3>
            <ul className="space-y-2 text-sm text-neutral/80">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Guided tour of our facilities and amenities
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                View of available room types
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Complimentary refreshments
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Opportunity to ask questions
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
          src={bookingType === "stay" ? "/website_cover.jpg" : "/website_photo.jpg"}
          alt={bookingType === "stay" ? "Book Resort" : "Ocular Visit"}
          fill 
          className="object-cover brightness-75" 
          priority
        />
        <div className="absolute inset-0 bg-neutral/40"></div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-6xl font-bold text-base mb-4">
            {bookingType === "stay" ? "Book Your Stay" : "Schedule a Visit"}
          </h1>
          <p className="text-xl text-base/90">
            {bookingType === "stay" ? "Select your dates and reserve paradise" : "See the resort before your stay"}
          </p>
        </div>
      </section>

      {/* Booking Type Selector */}
      <section className="py-8 px-4 bg-white border-b border-neutral/10">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-center gap-4">
            <button
              onClick={() => {
                setBookingType("stay");
                setSelectedDate(null);
                setSelectedTime("");
                setBookingRef("");
                setStayError(null);
              }}
              className={`px-8 py-4 rounded-full font-semibold transition-all ${
                bookingType === "stay"
                  ? "bg-primary text-base shadow-lg"
                  : "bg-neutral/5 text-neutral hover:bg-neutral/10"
              }`}
            >
              Full Stay Booking
            </button>
            <button
              onClick={() => {
                setBookingType("ocular");
                setSelectedStayDate(null);
              }}
              className={`px-8 py-4 rounded-full font-semibold transition-all ${
                bookingType === "ocular"
                  ? "bg-accent text-base shadow-lg"
                  : "bg-neutral/5 text-neutral hover:bg-neutral/10"
              }`}
            >
              Ocular Visit
            </button>
          </div>
        </div>
      </section>

      {/* Booking Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          {bookingType === "ocular" && (
            <div className="bg-accent/10 p-6 rounded-2xl mb-8">
              <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div>
                  <h3 className="font-bold text-neutral mb-2">For First-Time Guests</h3>
                  <p className="text-neutral/80">Schedule an ocular visit to tour our facilities before your reservation. This optional service helps you familiarize yourself with the resort and plan your stay better.</p>
                </div>
              </div>
            </div>
          )}

          {bookingType === "stay" && (
            <div className="bg-primary/5 p-6 rounded-2xl mb-8">
              <h3 className="font-bold text-neutral mb-4">Select Booking Mode</h3>
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                {[
                  { value: "day", label: "Day", subtitle: "8:00 AM - 4:00 PM" },
                  { value: "night", label: "Night", subtitle: "6:00 PM - 6:00 AM" },
                  { value: "whole_day", label: "Whole-Day", subtitle: "22-hour package" },
                  { value: "custom", label: "Custom", subtitle: "8:00 AM - 10:00 PM" },
                ].map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => {
                      setBookingMode(mode.value as BookingMode);
                      if (mode.value === "custom" && selectedStayDate && !customEndDate) {
                        setCustomEndDate(formatDateForStore(selectedStayDate));
                      }
                      setStayError(null);
                    }}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      bookingMode === mode.value
                        ? "border-primary bg-white"
                        : "border-neutral/20 bg-white/60 hover:border-primary/40"
                    }`}
                  >
                    <p className="font-semibold text-neutral">{mode.label}</p>
                    <p className="text-xs text-neutral/70">{mode.subtitle}</p>
                  </button>
                ))}
              </div>

              {bookingMode === "whole_day" && (
                <div className="grid md:grid-cols-2 gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setWholeDayVariant("day_to_night")}
                    className={`rounded-lg border px-4 py-3 text-sm text-left ${wholeDayVariant === "day_to_night" ? "border-primary bg-white" : "border-neutral/20 bg-white/60"}`}
                  >
                    <p className="font-semibold text-neutral">Variant A</p>
                    <p className="text-neutral/70">8:00 AM - 6:00 AM (next day)</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWholeDayVariant("night_to_day")}
                    className={`rounded-lg border px-4 py-3 text-sm text-left ${wholeDayVariant === "night_to_day" ? "border-primary bg-white" : "border-neutral/20 bg-white/60"}`}
                  >
                    <p className="font-semibold text-neutral">Variant B</p>
                    <p className="text-neutral/70">6:00 PM - 4:00 PM (next day)</p>
                  </button>
                </div>
              )}

              {bookingMode === "custom" && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-neutral/70 mb-1">Custom End Date</label>
                    <input
                      type="date"
                      value={customEndDate}
                      min={selectedStayDate ? formatDateForStore(selectedStayDate) : undefined}
                      onChange={(event) => {
                        setCustomEndDate(event.target.value);
                        setStayError(null);
                      }}
                      disabled={!selectedStayDate}
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 disabled:bg-neutral/10"
                    />
                    <p className="mt-1 text-xs text-neutral/60">Start date comes from the calendar selection.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral/70 mb-1">Custom Start Time</label>
                    <input
                      type="time"
                      value={customStartTime}
                      min="08:00"
                      max="22:00"
                      onChange={(event) => {
                        setCustomStartTime(event.target.value);
                        setStayError(null);
                      }}
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral/70 mb-1">Custom End Time</label>
                    <input
                      type="time"
                      value={customEndTime}
                      min="08:00"
                      max="22:00"
                      onChange={(event) => {
                        setCustomEndTime(event.target.value);
                        setStayError(null);
                      }}
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                    />
                  </div>
                </div>
              )}

              <p className="text-xs text-neutral/70 mt-3">
                Custom bookings must stay within 8:00 AM to 10:00 PM and be at least 3 hours.
              </p>
            </div>
          )}
          

          <form
            onSubmit={(e) => {
              if (bookingType === "ocular") {
                handleOcularSubmit(e);
                return;
              }
              e.preventDefault();
            }}
          >
            <div className="grid lg:grid-cols-3 gap-8">
            {/* Calendar */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-8">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-bold text-neutral">
                    {bookingType === "stay" ? "Select Booking Date" : "Select Visit Date"}
                  </h2>
                  <div className="flex gap-2">
                    <button type="button" onClick={prevMonth} className="p-2 hover:bg-neutral/5 rounded-lg transition-colors">
                      <svg className="w-6 h-6 text-neutral" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button type="button" onClick={nextMonth} className="p-2 hover:bg-neutral/5 rounded-lg transition-colors">
                      <svg className="w-6 h-6 text-neutral" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="mb-6">
                  <h3 className="text-2xl font-semibold text-neutral text-center mb-2">
                    {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                  </h3>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="text-center font-semibold text-neutral/70 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: firstDay }).map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square"></div>
                  ))}
                  {Array.from({ length: days }).map((_, index) => {
                    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), index + 1);
                    const isPast = date < new Date(new Date().setHours(0, 0, 0, 0));

                    if (bookingType === "ocular") {
                      const isSelected = selectedDate?.toDateString() === date.toDateString();
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => handleDateClick(date)}
                          disabled={isPast}
                          className={`aspect-square rounded-lg flex items-center justify-center font-medium transition-all
                            ${isPast ? "text-neutral/30 cursor-not-allowed" : ""}
                            ${isSelected ? "bg-accent text-base" : ""}
                            ${!isPast && !isSelected ? "hover:bg-accent/10 text-neutral" : ""}
                          `}
                        >
                          {index + 1}
                        </button>
                      );
                    } else {
                      const isBooked = isDateBooked(date);
                      const isSelected = isDateSelected(date);

                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => handleDateClick(date)}
                          disabled={isBooked || isPast}
                          className={`aspect-square rounded-lg flex items-center justify-center font-medium transition-all
                            ${isBooked ? "bg-neutral/20 text-neutral/40 cursor-not-allowed" : ""}
                            ${isPast && !isBooked ? "text-neutral/30 cursor-not-allowed" : ""}
                            ${isSelected ? "bg-primary text-base" : ""}
                            ${!isBooked && !isPast && !isSelected ? "hover:bg-primary/10 text-neutral" : ""}
                          `}
                        >
                          {index + 1}
                        </button>
                      );
                    }
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-6 mt-8 pt-6 border-t border-neutral/10">
                  {bookingType === "stay" ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-primary rounded"></div>
                        <span className="text-sm text-neutral/70">Selected</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-neutral/20 rounded"></div>
                        <span className="text-sm text-neutral/70">Booked</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-neutral/30 rounded"></div>
                        <span className="text-sm text-neutral/70">Available</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-accent rounded"></div>
                        <span className="text-sm text-neutral/70">Selected</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-neutral/30 rounded"></div>
                        <span className="text-sm text-neutral/70">Available</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Time Slots for Ocular Visit */}
                {bookingType === "ocular" && selectedDate && (
                  <div className="mt-8 pt-8 border-t border-neutral/10">
                    <h3 className="text-xl font-semibold text-neutral mb-4">Available Times</h3>
                    <div className="grid grid-cols-4 gap-3">
                      {availableTimes.map((time) => (
                        <button
                          key={time}
                          type="button"
                          onClick={() => setSelectedTime(time)}
                          className={`py-3 rounded-lg font-medium transition-all
                            ${selectedTime === time ? "bg-accent text-base" : "bg-neutral/5 text-neutral hover:bg-accent/10"}
                          `}
                        >
                          {formatTimeSlot(time)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Booking Summary / Visit Details */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl p-8 sticky top-28">
                <h3 className="text-2xl font-bold text-neutral mb-6">
                  {bookingType === "stay" ? "Booking Summary" : "Visit Details"}
                </h3>
                
                {bookingType === "stay" ? (
                  <>
                    <div className="space-y-4 mb-6">
                      <div>
                        <label className="text-sm text-neutral/70">Check-in</label>
                        <p className="text-lg font-semibold text-neutral">
                          {selectedStayDate ? selectedStayDate.toLocaleDateString() : "Select date"}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-neutral/70">Check-out</label>
                        <p className="text-lg font-semibold text-neutral">
                          {selectedStayDate
                            ? (() => {
                                const bookingWindow = buildBookingWindow({
                                  bookingMode,
                                  date: selectedStayDate,
                                  wholeDayVariant,
                                  customStartTime,
                                  customEndTime,
                                    customEndDate:
                                      bookingMode === "custom"
                                        ? parseLocalDateValue(customEndDate || formatDateForStore(selectedStayDate)) ?? selectedStayDate
                                        : undefined,
                                });
                                if ("error" in bookingWindow) return "Select date";
                                return new Date(bookingWindow.endDatetime).toLocaleString("en-PH", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                });
                              })()
                            : "Select date"}
                        </p>
                      </div>
                      {selectedStayDate && (
                        <div>
                          <label className="text-sm text-neutral/70">Mode</label>
                          <p className="text-lg font-semibold text-neutral">
                            {bookingMode === "whole_day"
                              ? `Whole-Day (${wholeDayVariant === "day_to_night" ? "Variant A" : "Variant B"})`
                              : bookingMode.charAt(0).toUpperCase() + bookingMode.slice(1)}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-neutral/10 pt-6 mb-6">
                      <h4 className="font-semibold text-neutral mb-3">Rate Information</h4>
                      <p className="text-sm text-neutral/70 mb-2">Starting from</p>
                      <p className="text-3xl font-bold text-primary">₱16,450<span className="text-lg text-neutral/70">/night</span></p>
                      <p className="text-xs text-neutral/60 mt-2">*Final price may vary based on room type and amenities</p>
                    </div>

                    {stayError ? (
                      <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                        {stayError}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={handleContinueToReservation}
                      className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                      disabled={!selectedStayDate}
                    >
                      Continue to Reservation
                    </button>
                    
                    <p className="text-xs text-neutral/60 text-center mt-4">
                      No payment required at this stage
                    </p>
                  </>
                ) : (
                  <>
                    {ocularError ? (
                      <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                        {ocularError}
                      </div>
                    ) : null}

                    <div className="space-y-6 mb-8">

                      <div>
                        <label className="text-sm font-medium text-neutral/70">Selected Date</label>
                        <p className="text-lg font-semibold text-neutral mt-1">
                          {selectedDate ? selectedDate.toLocaleDateString() : "Not selected"}
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-neutral/70">Selected Time</label>
                        <p className="text-lg font-semibold text-neutral mt-1">
                          {selectedTime || "Not selected"}
                        </p>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!selectedDate || !selectedTime || ocularSubmitting}
                      className="w-full bg-accent text-base px-6 py-4 rounded-full font-semibold hover:bg-accent/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {ocularSubmitting ? "Scheduling..." : "Schedule Visit"}
                    </button>

                    <p className="text-xs text-neutral/60 text-center mt-4">
                      This is free of charge but requires approval.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
          </form>
        </div>
      </section>

      {/* Info Section */}
      <section className="py-20 px-4 bg-neutral/5">
        <div className="max-w-6xl mx-auto">
                  <h2 className="text-3xl font-bold text-neutral mb-12 text-center">
            {bookingType === "stay" ? "Booking Information" : "Why Schedule an Ocular Visit?"}
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {bookingType === "stay" ? (
              <>
                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">Reschedule-Friendly</h3>
                  <p className="text-neutral/70">Downpayments are non-refundable, but rescheduling is available within policy windows.</p>
                </div>

                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-secondary/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">Best Price Guarantee</h3>
                  <p className="text-neutral/70">Book directly for the lowest rates available</p>
                </div>

                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-accent/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">24/7 Support</h3>
                  <p className="text-neutral/70">Our team is always here to assist you</p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-accent/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">See Before You Stay</h3>
                  <p className="text-neutral/70">Get a firsthand look at our facilities, rooms, and amenities</p>
                </div>

                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">Ask Questions</h3>
                  <p className="text-neutral/70">Speak with our staff and get all your questions answered</p>
                </div>

                <div className="bg-base p-6 rounded-2xl">
                  <div className="w-12 h-12 bg-secondary/20 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-2">Plan Better</h3>
                  <p className="text-neutral/70">Make informed decisions about room types and activities</p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
