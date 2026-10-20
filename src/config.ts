export interface Env {
  DB: D1Database;
  RESULTS: R2Bucket;

  GCP_PROJECT_ID: string;
  GCP_LOCATION: string;
  DOCAI_PROCESSOR_ID: string;
  DOCAI_PROCESSOR_VERSION?: string;
  GCP_SERVICE_ACCOUNT_JSON: string;

  API_TOKENS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  MONTHLY_PAGE_LIMIT?: string;
  DAILY_PAGE_LIMIT?: string;
  MAX_PAGES_PER_FILE?: string;
  MAX_FILE_MB?: string;

  IMAGELESS_MODE?: string;
  DEFAULT_LANGUAGE_HINTS?: string;
  DEFAULT_NATIVE_PDF_PARSING?: string;
  ALLOW_PREMIUM_FEATURES?: string;

  RETENTION_DAYS?: string;
  MAX_RETENTION_DAYS?: string;
}

export interface Config {
  monthlyPageLimit: number;
  dailyPageLimit: number;
  maxPagesPerFile: number;
  maxFileBytes: number;
  imagelessMode: boolean;
  defaultLanguageHints: string[];
  defaultNativePdfParsing: boolean;
  allowPremiumFeatures: boolean;
  retentionDays: number;
  maxRetentionDays: number;
}

// Google's online (synchronous) page limit per request.
export const GOOGLE_PAGE_LIMIT = 15;
export const GOOGLE_PAGE_LIMIT_IMAGELESS = 30;
export const GOOGLE_MAX_FILE_MB = 40;

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: Env): Config {
  const imagelessMode = bool(env.IMAGELESS_MODE, true);
  const googleLimit = imagelessMode ? GOOGLE_PAGE_LIMIT_IMAGELESS : GOOGLE_PAGE_LIMIT;
  const retentionDays = Math.max(1, int(env.RETENTION_DAYS, 7));
  return {
    monthlyPageLimit: int(env.MONTHLY_PAGE_LIMIT, 900),
    dailyPageLimit: int(env.DAILY_PAGE_LIMIT, 0),
    maxPagesPerFile: Math.min(int(env.MAX_PAGES_PER_FILE, googleLimit) || googleLimit, googleLimit),
    maxFileBytes: Math.min(int(env.MAX_FILE_MB, 20) || 20, GOOGLE_MAX_FILE_MB) * 1024 * 1024,
    imagelessMode,
    defaultLanguageHints: list(env.DEFAULT_LANGUAGE_HINTS),
    defaultNativePdfParsing: bool(env.DEFAULT_NATIVE_PDF_PARSING, false),
    allowPremiumFeatures: bool(env.ALLOW_PREMIUM_FEATURES, false),
    retentionDays,
    maxRetentionDays: Math.max(retentionDays, int(env.MAX_RETENTION_DAYS, 30)),
  };
}
