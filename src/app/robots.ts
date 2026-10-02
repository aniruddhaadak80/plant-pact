import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Pacts are per-session and meaningful only to their owner.
        disallow: ["/pacts/", "/api/pacts/", "/api/mcp", "/api/score"],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
    host: siteOrigin(),
  };
}