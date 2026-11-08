"use client";

import Image from "next/image";
import { useState } from "react";
import { isContentImageUrl } from "@/lib/settings/public-content";

export default function ServicePhoto({ src, enlarged = false }: { src: string | null; enlarged?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = src && src !== failedSource && isContentImageUrl(src) ? src : "/images/service-placeholder.svg";
  return <div className="relative h-full w-full bg-stone-100"><Image src={source} alt="" fill unoptimized sizes={enlarged ? "90vw" : "96px"} className={enlarged ? "object-contain" : "object-cover"} onError={() => { if (src) setFailedSource(src); }} /></div>;
}
