import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const routes: { path: string; priority: number; changeFrequency: "daily" | "weekly" }[] = [
    { path: "/", priority: 1, changeFrequency: "daily" },
    { path: "/advisor", priority: 0.9, changeFrequency: "daily" },
    { path: "/pacts", priority: 0.7, changeFrequency: "daily" },
    { path: "/cards", priority: 0.6, changeFrequency: "weekly" },
    { path: "/agent", priority: 0.6, changeFrequency: "weekly" },
    { path: "/method", priority: 0.6, changeFrequency: "weekly" },
    { path: "/verify", priority: 0.4, changeFrequency: "weekly" },
  ];

  return routes.map((route) => ({
    url: `${origin}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}