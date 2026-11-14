import type { CoachingProfile, ProfileUpdate } from "@mydata/shared";
import { failureMessage } from "./api";

export interface ProfileResponse {
  profile: CoachingProfile;
  isDefault: boolean;
}

export interface ProfileClient {
  get(customerId: string, signal?: AbortSignal): Promise<ProfileResponse>;
  update(customerId: string, update: ProfileUpdate, signal?: AbortSignal): Promise<ProfileResponse>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function createProfileClient(base = "", fetchFn: typeof fetch = (...args) => fetch(...args)): ProfileClient {
  async function call(customerId: string, init: RequestInit = {}): Promise<ProfileResponse> {
    const res = await fetchFn(`${base}/api/customers/${encodeURIComponent(customerId)}/profile`, init).catch((error: unknown) => {
      if (isRecord(error) && error.name === "AbortError") throw error;
      throw new Error("Could not reach the finance API. Is the backend running?");
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(failureMessage(res.status, body));
    if (!isRecord(body) || !isRecord(body.profile) || typeof body.isDefault !== "boolean") {
      throw new Error("The finance API gave an unexpected coaching profile.");
    }
    return body as unknown as ProfileResponse;
  }
  return {
    get: (customerId, signal) => call(customerId, { signal }),
    update: (customerId, update, signal) =>
      call(customerId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update), signal }),
  };
}
