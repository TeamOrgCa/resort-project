"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { contentText, useSiteContent } from "./SiteContent";
import { isContentImageUrl, publicContentDefaults } from "@/lib/settings/public-content";
import { logoBounds, type LogoBounds } from "@/lib/settings/logo-bounds";

interface Artwork { source: string; width: number; height: number; bounds: LogoBounds }

export default function SiteLogo() {
  const content = useSiteContent();
  const configured = contentText(content, "content.branding.logo");
  const source = isContentImageUrl(configured) ? configured : String(publicContentDefaults["content.branding.logo"]);
  const alt = `${contentText(content, "resort.name")} logo`;
  const [artwork, setArtwork] = useState<Artwork | null>(null);

  useEffect(() => {
    let active = true;
    // Probe separately so images hosted without CORS still display normally.
    const probe = new window.Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (!active) return;
      try {
        const scale = Math.min(1, 512 / Math.max(probe.naturalWidth, probe.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(probe.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(probe.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(probe, 0, 0, canvas.width, canvas.height);
        const bounds = logoBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (bounds) setArtwork({ source, width: canvas.width, height: canvas.height, bounds });
      } catch { /* Keep the uncropped image if its pixels cannot be inspected. */ }
    };
    probe.src = source;
    return () => { active = false; probe.onload = null; };
  }, [source]);

  if (artwork?.source === source) {
    const { bounds } = artwork;
    // The viewport crops only empty margins; the full original asset is retained.
    return <svg role="img" aria-label={alt} viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full overflow-hidden">
      <image href={source} width={artwork.width} height={artwork.height} />
    </svg>;
  }
  return <Image src={source} alt={alt} width={240} height={72} unoptimized priority className="h-full w-full object-contain" />;
}
