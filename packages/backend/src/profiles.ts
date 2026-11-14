import { DatabaseSync } from "node:sqlite";
import {
  applyProfileUpdate,
  COACHING_STYLES,
  DEFAULT_PROFILE,
  parseCategoryList,
  PROFILE_VERSION,
  type CoachingProfile,
  type ProfileUpdate,
} from "@mydata/shared";

export interface ProfileStore {
  get(customerId: string): CoachingProfile | null;
  update(customerId: string, update: ProfileUpdate, now?: string): CoachingProfile;
}

export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, CoachingProfile>();

  get(customerId: string): CoachingProfile | null {
    const profile = this.profiles.get(customerId);
    return profile ? { ...profile, protectedCategories: [...profile.protectedCategories] } : null;
  }

  update(customerId: string, update: ProfileUpdate, now = new Date().toISOString()): CoachingProfile {
    const profile = applyProfileUpdate(this.get(customerId) ?? DEFAULT_PROFILE, update, now);
    this.profiles.set(customerId, profile);
    return { ...profile, protectedCategories: [...profile.protectedCategories] };
  }
}

interface ProfileRow {
  version: number;
  style: string;
  protected_categories: string;
  updated_at: string;
}

/** Separate writable SQLite store for customer-owned coaching choices. */
export class SqliteProfileStore implements ProfileStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS coaching_profile (
      customer_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      style TEXT NOT NULL,
      protected_categories TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  private fromRow(customerId: string, row: ProfileRow): CoachingProfile {
    let style = DEFAULT_PROFILE.style;
    if ((COACHING_STYLES as readonly string[]).includes(row.style)) style = row.style as CoachingProfile["style"];
    else console.warn(`[profiles] invalid style for ${customerId}; using default`);
    let protectedCategories = DEFAULT_PROFILE.protectedCategories;
    try {
      protectedCategories = parseCategoryList(JSON.parse(row.protected_categories), "protected_categories");
    } catch {
      console.warn(`[profiles] invalid protected categories for ${customerId}; using default`);
    }
    return {
      version: PROFILE_VERSION,
      style,
      protectedCategories,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(0).toISOString(),
    };
  }

  get(customerId: string): CoachingProfile | null {
    const row = this.db.prepare("SELECT version, style, protected_categories, updated_at FROM coaching_profile WHERE customer_id = :customerId").get({ customerId }) as ProfileRow | undefined;
    return row ? this.fromRow(customerId, row) : null;
  }

  update(customerId: string, update: ProfileUpdate, now = new Date().toISOString()): CoachingProfile {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const profile = applyProfileUpdate(this.get(customerId) ?? DEFAULT_PROFILE, update, now);
      this.db.prepare(`INSERT INTO coaching_profile (customer_id, version, style, protected_categories, updated_at)
        VALUES (:customerId, :version, :style, :protectedCategories, :updatedAt)
        ON CONFLICT(customer_id) DO UPDATE SET version = excluded.version, style = excluded.style,
          protected_categories = excluded.protected_categories, updated_at = excluded.updated_at`).run({
        customerId,
        version: profile.version,
        style: profile.style,
        protectedCategories: JSON.stringify(profile.protectedCategories),
        updatedAt: profile.updatedAt as string,
      });
      this.db.exec("COMMIT");
      return profile;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
