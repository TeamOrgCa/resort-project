export default function BookingPromoDiscount({ code, amount }: { code: string | null; amount: number }) {
  if (!code || amount <= 0) return null;
  return <div aria-label="Applied promo discount" className="flex items-start justify-between gap-4 text-primary">
    <span className="min-w-0 break-words">Promo discount ({code})</span>
    <span className="shrink-0 whitespace-nowrap font-semibold">-{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount)}</span>
  </div>;
}
