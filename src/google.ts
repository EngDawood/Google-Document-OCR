import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./config";
import { HttpError } from "./errors";
import type { OcrOptions } from "./options";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new HttpError(500, "GCP_SERVICE_ACCOUNT_JSON secret is missing or not valid JSON");
  }
  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new HttpError(502, `Google auth failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function buildProcessRequest(content: string, mimeType: string, opts: OcrOptions, imagelessMode: boolean) {
  const premiumFeatures = {
    ...(opts.mathOcr && { enableMathOcr: true }),
    ...(opts.selectionMarks && { enableSelectionMarkDetection: true }),
    ...(opts.styleInfo && { computeStyleInfo: true }),
  };
  return {
    rawDocument: { content, mimeType },
    imagelessMode,
    processOptions: {
      ...(opts.pages && { individualPageSelector: { pages: opts.pages } }),
      ocrConfig: {
        enableNativePdfParsing: opts.nativePdfParsing,
        enableImageQualityScores: opts.imageQualityScores,
        ...(opts.languageHints.length > 0 && { hints: { languageHints: opts.languageHints } }),
        ...(Object.keys(premiumFeatures).length > 0 && { premiumFeatures }),
      },
    },
  };
}

export async function processDocument(
  env: Env,
  bytes: Uint8Array,
  mimeType: string,
  opts: OcrOptions,
  imagelessMode: boolean,
): Promise<DocAiDocument> {
  const location = env.GCP_LOCATION || "us";
  const version = opts.processorVersion ?? (env.DOCAI_PROCESSOR_VERSION || null);
  const name =
    `projects/${env.GCP_PROJECT_ID}/locations/${location}/processors/${env.DOCAI_PROCESSOR_ID}` +
    (version ? `/processorVersions/${version}` : "");
  const url = `https://${location}-documentai.googleapis.com/v1/${name}:process`;

  const token = await getAccessToken(env);
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(buildProcessRequest(toBase64(bytes), mimeType, opts, imagelessMode)),
  });
  if (!res.ok) {
    let message = await res.text();
    try {
      message = (JSON.parse(message) as { error?: { message?: string } }).error?.message ?? message;
    } catch {}
    throw new HttpError(502, `Document AI error (${res.status}): ${message}`);
  }
  const data = (await res.json()) as { document: DocAiDocument };
  return data.document;
}

// Subset of the Document AI `Document` resource that we read.
export interface TextAnchor {
  textSegments?: { startIndex?: string; endIndex?: string }[];
}
export interface Layout {
  textAnchor?: TextAnchor;
  confidence?: number;
}
export interface DocAiPage {
  pageNumber?: number;
  layout?: Layout;
  paragraphs?: { layout?: Layout }[];
  detectedLanguages?: { languageCode?: string; confidence?: number }[];
  imageQualityScores?: { qualityScore?: number; detectedDefects?: { type?: string; confidence?: number }[] };
}
export interface DocAiDocument {
  text?: string;
  pages?: DocAiPage[];
}
