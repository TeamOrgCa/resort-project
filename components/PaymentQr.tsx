"use client";

import Image from "next/image";
import { useState } from "react";

export default function PaymentQr({ src, name, onRetry }: { src: string; name: string; onRetry: () => void }) {
  const [failed, setFailed] = useState(false);
  return <div className="mt-5 rounded-xl border border-neutral/10 bg-white p-3 text-center sm:p-5">
    <p className="font-semibold text-neutral">Scan to pay with {name}</p>
    <p className="mt-1 text-sm text-neutral/60">Check the recipient and amount in your banking or wallet app before paying.</p>
    {failed ? <div role="alert" className="mt-4 text-sm text-red-700">QR image could not be loaded. <button type="button" onClick={onRetry} className="font-semibold underline">Reload QR</button></div> : <>
      <Image src={src} alt={`${name} payment QR code`} width={560} height={560} unoptimized onError={() => setFailed(true)} className="mx-auto mt-5 aspect-square h-auto w-full max-w-[560px] rounded-lg bg-white object-contain" />
      <a href={src} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-primary underline">Open QR image to save</a>
    </>}
    <p className="mt-3 text-xs text-neutral/60">After paying, upload your proof of payment below.</p>
  </div>;
}
