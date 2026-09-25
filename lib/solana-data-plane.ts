/**
 * ArcadeX Solana must never read or write ArcadeX Celo D1, KV, Firestore, or RTDB.
 * Allowed Cloudflare ids are the databases and namespaces created for this app.
 */

export const SOLANA_D1_DATABASE_IDS = new Set([
  "251e9f61-6c6e-4cb6-980a-f489feb43a70", // arcadex-solana-preview
  "b167f6b7-3228-4537-a68e-cbdca4194502", // arcadex-solana-prod
]);

export const SOLANA_KV_NAMESPACE_IDS = new Set([
  "403653bebdd24f1c8c8b50ff52b61709", // arcadex-solana-rate-limit-preview
  "d2e29af34e3541df9fdde0b527544ded", // arcadex-solana-rate-limit
]);

const CELO_D1_DATABASE_IDS = new Set([
  "81f8cd4f-6927-4561-861b-e5aa12eba7a6", // arcadex-celo-preview
  "71aee228-0f98-412f-a5eb-6119c39cb5c3", // arcadex-celo-prod
]);

const CELO_KV_NAMESPACE_IDS = new Set([
  "afc93dfed6514875924b2511a39412cb", // RATE_LIMIT_KV_preview
  "55bfb54188784fac966da56f42c9fce6", // RATE_LIMIT_KV
]);

const CELO_MARKER = "arcadex-celo";

export class CeloDataPlaneError extends Error {
  constructor(store: "D1" | "KV" | "Firestore") {
    super(
      `ArcadeX Solana refuses ArcadeX Celo ${store}. Use the Solana D1, KV, and Firebase project only.`
    );
    this.name = "CeloDataPlaneError";
  }
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function assertSolanaD1Id(databaseId: unknown): void {
  const id = normalizeId(databaseId);
  if (!id || CELO_D1_DATABASE_IDS.has(id) || !SOLANA_D1_DATABASE_IDS.has(id)) {
    throw new CeloDataPlaneError("D1");
  }
}

export function assertSolanaKvId(namespaceId: unknown): void {
  const id = normalizeId(namespaceId);
  if (!id || CELO_KV_NAMESPACE_IDS.has(id) || !SOLANA_KV_NAMESPACE_IDS.has(id)) {
    throw new CeloDataPlaneError("KV");
  }
}

/** Throws when any Firebase env var points at the ArcadeX Celo project. */
export function assertNotCeloFirebase(): void {
  const fields = [
    process.env.FIREBASE_PROJECT_ID,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.FIREBASE_DATABASE_URL,
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    process.env.FIREBASE_CLIENT_EMAIL,
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  ];

  for (const value of fields) {
    if ((value ?? "").toLowerCase().includes(CELO_MARKER)) {
      throw new CeloDataPlaneError("Firestore");
    }
  }
}
