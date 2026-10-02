import type { NextRequest } from "next/server";
import { jsonOk, handleError, ServiceError } from "@/lib/api-helpers";
import { fetchSky } from "@/lib/weather/open-meteo";
import { SITE } from "@/lib/config";
import { checkRate } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Live weather for a coordinate pair, normalized into SkyBundle.
 *
 * The response always states its own origin. A sealed offline sample is
 * returned with origin="fallback", its real capture date and a note explaining
 * that it does not describe the requested place, so no client can present it as
 * a current forecast.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const params = request.nextUrl.searchParams;
    const latitude = Number(params.get("lat"));
    const longitude = Number(params.get("lon"));
    const placeLabel = (params.get("place") ?? SITE.defaultCity.label).slice(0, 80);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new ServiceError("invalid_field", "lat must be a number between -90 and 90.", 400, {
        field: "lat",
      });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ServiceError("invalid_field", "lon must be a number between -180 and 180.", 400, {
        field: "lon",
      });
    }

    const rate = checkRate(`sky:${placeLabel}`, 120);
    if (!rate.allowed) {
      throw new ServiceError(
        "rate_limited",
        `Too many weather requests for this place. Retry in ${rate.retryAfterSeconds}s.`,
        429,
      );
    }

    const sky = await fetchSky({ latitude, longitude, placeLabel });
    return jsonOk({ sky });
  } catch (error) {
    return handleError(error);
  }
}