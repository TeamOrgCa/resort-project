"use client";

import Image from "next/image";
import { useState } from "react";
import { isContentImageUrl } from "@/lib/settings/public-content";

export default function ServicePhoto({ src, enlarged = false }: { src: string | null; enlarged?: boolean }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = src && src !== failedSource && isContentImageUrl(src) ? src : "/images/service-placeholder.svg";
  return <div className="bg-stone-100" style={{ width: "100%", height: "100%" }}><Image src={source} alt="" width={960} height={640} unoptimized style={{ display: "block", width: "100%", height: "100%", objectFit: enlarged ? "contain" : "cover" }} onError={() => { if (src) setFailedSource(src); }} /></div>;
}
