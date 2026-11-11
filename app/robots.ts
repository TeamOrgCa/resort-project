
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/manager/",
        "/cashier/",
        "/api/",
      ],
    },
    sitemap: "https://www.marvilleresort.com/sitemap.xml",
    host: "https://www.marvilleresort.com",
  };
}
