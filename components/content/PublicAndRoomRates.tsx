"use client";
import Link from "next/link";
import { useResortRates } from "@/lib/booking/use-resort-rates";
import { formatManilaTime } from "@/lib/booking/manila-date";
import Skeleton, { SkeletonGroup } from "@/components/ui/Skeleton";

const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(amount));
const price = (amount: number) => Number.isFinite(Number(amount)) && Number(amount) > 0 ? money(amount) : "Contact the resort";

export default function PublicAndRoomRates() {
  const { rates, error } = useResortRates();
  const loading = (label: string) => <SkeletonGroup label={label}><div className="grid gap-5 md:grid-cols-2">{[0, 1].map(n => <div key={n} className="rounded-2xl border border-neutral/10 bg-base p-6"><Skeleton className="h-7 w-48 max-w-full" /><Skeleton className="mt-4 h-32 w-full" /></div>)}</div></SkeletonGroup>;
  const link = (label: string) => <Link href="/booking" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-primary px-6 py-3 font-semibold text-white hover:bg-primary/90">{label}</Link>;
  return <>
    <section id="public-swimming-rates" aria-labelledby="public-rates-heading" className="scroll-mt-28 border-t border-neutral/10 py-10 sm:py-12">
      <h3 id="public-rates-heading" className="text-2xl font-bold text-neutral sm:text-3xl">Public Swimming</h3>
      <p className="mb-6 mt-3 max-w-3xl text-neutral/75">Enjoy a shared swimming session with admission charged per person. Choose Day or Night swimming; available dates and sessions are shown when you book.</p>
      {rates ? rates.publicSwimming.length ? <div className="grid gap-5 md:grid-cols-2">{rates.publicSwimming.map(session => <article key={session.type_id} className="rounded-2xl border border-neutral/10 bg-base p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-neutral/60">{session.mode === "day" ? "Day swimming" : "Night swimming"}</p>
        <h4 className="mt-1 text-xl font-bold text-primary">{session.name}</h4>
        <p className="mt-2 text-neutral/70">{formatManilaTime(`2030-01-01T${session.start_time}+08:00`)} – {formatManilaTime(`2030-01-01T${session.end_time}+08:00`)}{session.end_day_offset > 0 ? " (next day)" : ""} · Philippine time</p>
        <dl className="mt-5 grid grid-cols-2 gap-3">{[["Adult", session.adult_rate], ["Child", session.child_rate]].map(([label, amount]) => <div key={label} className="rounded-xl bg-white p-4"><dt className="font-semibold text-neutral">{label}</dt><dd className="mt-2 text-2xl font-bold text-neutral">{money(Number(amount))}<span className="mt-1 block text-sm font-normal text-neutral/65">per person</span></dd></div>)}</dl>
      </article>)}</div> : <p className="rounded-xl bg-base p-5 text-neutral/70">Public swimming is currently unavailable. Please contact the resort for upcoming sessions.</p> : error ? <p role="alert" className="rounded-xl bg-base p-5 text-neutral/70">{error}</p> : loading("Loading public swimming prices")}
      <p className="mt-5 text-sm leading-relaxed text-neutral/70">Full payment is required for public swimming bookings. Rooms are optional and charged separately. The booking form calculates applicable PWD/senior or promo discounts.</p>
      {link("Check public swimming dates")}
    </section>
    <section id="room-accommodation-rates" aria-labelledby="room-rates-heading" className="scroll-mt-28 border-t border-neutral/10 pt-10 sm:pt-12">
      <h3 id="room-rates-heading" className="text-2xl font-bold text-neutral sm:text-3xl">Room Accommodation Only</h3>
      <p className="mb-6 mt-3 max-w-3xl text-neutral/75">Book a room without a private swimming package. Choose a 3-hour or 12-hour stay, with guest capacity and extra charges shown for each room type.</p>
      {rates ? rates.rooms.length ? <div className="grid gap-5 md:grid-cols-2">{rates.rooms.map(room => <article key={room.classification_id} className="rounded-2xl border border-neutral/10 bg-base p-5 shadow-sm sm:p-6">
        <h4 className="text-xl font-bold text-primary">{room.name}</h4>
        <p className="mt-2 text-neutral/70">{room.included_capacity} guests included · Up to {room.maximum_capacity} guests per room</p>
        <dl className="mt-5 grid grid-cols-2 gap-3">{[[3, room.rate_3_hours], [12, room.rate_12_hours]].map(([hours, amount]) => <div key={hours} className="rounded-xl bg-white p-4"><dt className="font-semibold text-neutral">{hours}-hour stay</dt><dd className="mt-2 text-2xl font-bold text-neutral">{price(amount)}<span className="mt-1 block text-sm font-normal text-neutral/65">per room</span></dd></div>)}</dl>
        <dl className="mt-5 space-y-3 text-sm text-neutral/75"><div className="flex flex-wrap justify-between gap-2"><dt>Extra guest per room stay</dt><dd className="font-semibold">{room.maximum_capacity > room.included_capacity ? price(room.additional_guest_rate) : "No extra guest places"}</dd></div><div className="flex flex-wrap justify-between gap-2"><dt>Room extension per hour</dt><dd className="font-semibold">{price(room.extension_hourly_rate)}</dd></div></dl>
      </article>)}</div> : <p className="rounded-xl bg-base p-5 text-neutral/70">Room accommodation is currently unavailable. Please contact the resort.</p> : error ? <p role="alert" className="rounded-xl bg-base p-5 text-neutral/70">{error}</p> : loading("Loading room accommodation prices")}
      <p className="mt-5 text-sm leading-relaxed text-neutral/70">Extra guests must stay within the room capacity. Extensions depend on room availability and staff approval. Choose your dates to check available rooms and review the final bill.</p>
      {link("Check room availability")}
    </section>
  </>;
}
