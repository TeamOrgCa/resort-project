"use client";

import Image from "next/image";
import { useState } from "react";
import { isContentImageUrl } from "@/lib/settings/public-content";

export default function UnitPhoto({ src }: { src: string | null }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = src && src !== failedSource && isContentImageUrl(src) ? src : "/images/unit-placeholder.svg";
  return <Image src={source} alt="" width={960} height={640} unoptimized
    style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
    onError={() => { if (src) setFailedSource(src); }} />;
}
