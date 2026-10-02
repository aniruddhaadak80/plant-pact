import type { Metadata } from "next";
import { CITIES, SITE } from "@/lib/config";
import { listSpecies } from "@/lib/service";
import { AdvisorWorkbench } from "@/components/advisor-workbench";
import { SectionHeading } from "@/components/ui";
import { MODEL_CARD } from "@/lib/model/infer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Place a plant",
  description:
    "Model a gifted houseplant against live Open-Meteo weather for the recipient's city: survival odds, the single largest risk, and the week it is most likely to die.",
  alternates: { canonical: "/advisor" },
};

export default async function AdvisorPage() {
  const species = await listSpecies();
  const defaultCityIndex = Math.max(
    0,
    CITIES.findIndex((city) => city.label === SITE.defaultCity.label),
  );

  return (
    <div className="pb-8">
      <SectionHeading
        label="The workbench"
        title="Place a plant in a specific window, in a specific city"
        lede="Move either rail and the whole model re-runs against live weather. Nothing here is stored until you commit the pact."
      />
      <AdvisorWorkbench
        species={species}
        cities={CITIES.map((city) => ({
          label: city.label,
          latitude: city.latitude,
          longitude: city.longitude,
        }))}
        defaultCityIndex={defaultCityIndex}
      />
      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-loam-faint">
        Every score on this page comes from model{" "}
        <span className="num">{MODEL_CARD.version}</span>, fitted on{" "}
        {MODEL_CARD.corpus.rows.toLocaleString("en-GB")} placements across{" "}
        {MODEL_CARD.corpus.cities} cities with real weather, and running entirely inside the
        serverless function. There is no external model API in this request path.
      </p>
    </div>
  );
}