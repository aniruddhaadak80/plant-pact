import { NextResponse } from "next/server";
import { currentStoreKind } from "./db";

/**
 * Stable error envelopes and small HTTP helpers.
 *
 * Every failure path in the application returns { error: { code, message } }
 * with a meaningful 4xx status. Internal messages, stack traces and environment
 * values never cross the wire: unexpected errors become a generic code with a
 * request id, and the detail is logged server-side only.
 */

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    status: 200,
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function jsonCreated<T>(data: T): NextResponse {
  return NextResponse.json(data, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(code: string, message: string, status: number, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return jsonError(error.code, error.message, error.status, error.details);
  }
  const message = error instanceof Error ? error.message : String(error);
  // Server-side only: never leak internals to the client.
  console.error("[plant-pact] unhandled route error:", message);
  return jsonError(
    "internal_error",
    "Something went wrong handling that request. The failure has been logged server-side.",
    500,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ServiceError("invalid_json", "Request body must be valid JSON.", 400);
  }
}

export function meta() {
  return { store: currentStoreKind(), sessionScoped: true };
}