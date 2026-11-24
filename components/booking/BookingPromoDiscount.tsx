export default function BookingPromoDiscount({ code, amount, kind = "promo" }: { code: string | null; amount: number; kind?: string }) {
  if (amount <= 0 || kind !== "pwd_senior" && !code) return null;
  return <div aria-label={kind === "pwd_senior" ? "Applied PWD / senior discount" : "Applied promo discount"} className="flex items-start justify-between gap-4 text-primary">
    <span className="min-w-0 break-words">{kind === "pwd_senior" ? "PWD / senior discount" : `Promo discount (${code})`}</span>
    <span className="shrink-0 whitespace-nowrap font-semibold">-{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount)}</span>
  </div>;
}
