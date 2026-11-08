const steps = ["Select Dates", "Guest Details", "Review & Save", "Payment"];

export default function BookingProgress({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Booking progress" className="mt-20 border-b border-neutral/10 bg-white">
      <ol className="mx-auto grid max-w-4xl grid-cols-4 gap-2 px-4 py-5 sm:gap-4 sm:py-6">
        {steps.map((label, index) => {
          const step = index + 1;
          const active = step === currentStep;
          const reached = step <= currentStep;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-col items-center gap-2 text-center sm:flex-row sm:justify-center">
              <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold ${reached ? "bg-primary text-base" : "bg-neutral/20 text-neutral/50"}`}>{step}</span>
              <span className={`text-xs font-medium sm:text-sm ${active ? "text-primary" : reached ? "text-neutral" : "text-neutral/50"}`}>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
