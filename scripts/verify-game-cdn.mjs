#!/usr/bin/env node
/**
 * ArcadeX Unity / R2 CDN header verification
 *
 * Usage:
 *   node scripts/verify-game-cdn.mjs <gameBaseUrl> [assetPath...]
 *   node scripts/verify-game-cdn.mjs https://games.example.com/MyGame/
 *
 * Checklist (manual + this script):
 * [ ] Custom domain on R2 (not r2.dev) for production builds
 * [ ] Cloudflare proxied DNS for the game asset host
 * [ ] Cache Rule for /Build/* and /StreamingAssets/*
 * [ ] Fingerprinted/versioned build folders → Cache-Control: public, max-age=31536000, immutable
 * [ ] index.html / loader → no-cache or short TTL
 * [ ] .wasm.br → Content-Type: application/wasm + Content-Encoding: br
 * [ ] .framework.js.br → JavaScript type + Content-Encoding: br
 * [ ] .data.br → application/octet-stream + Content-Encoding: br
 * [ ] Second request shows CF-Cache-Status: HIT (first may be MISS)
 * [ ] CORS allows only real shell origins
 * [ ] Runtime R2 token is read-only and not embedded in browser/Unity
 *
 * This script cannot configure Cloudflare — it only verifies live responses.
 */

const DEFAULT_ASSETS = [
  "Build",
  "StreamingAssets",
  "index.html",
];

function normalizeBase(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function checkUrl(url, { expectSecondHit = false } = {}) {
  const results = [];

  for (let i = 0; i < (expectSecondHit ? 2 : 1); i++) {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    // Drain body so connection can close cleanly; only need headers.
    await res.arrayBuffer().catch(() => {});

    results.push({
      pass: i + 1,
      status: res.status,
      contentType: res.headers.get("content-type"),
      contentEncoding: res.headers.get("content-encoding"),
      cacheControl: res.headers.get("cache-control"),
      cfCacheStatus: res.headers.get("cf-cache-status"),
      age: res.headers.get("age"),
      server: res.headers.get("server"),
    });
  }

  return results;
}

function guessExpectations(pathname) {
  const lower = pathname.toLowerCase();
  const expectations = [];

  if (lower.endsWith(".wasm") || lower.endsWith(".wasm.br")) {
    expectations.push({
      header: "content-type",
      includes: "wasm",
      label: "WASM Content-Type",
    });
  }
  if (lower.endsWith(".br")) {
    expectations.push({
      header: "contentEncoding",
      equals: "br",
      label: "Brotli Content-Encoding",
    });
  }
  if (lower.includes("/build/") || lower.includes("/streamingassets/")) {
    expectations.push({
      header: "cfCacheStatus",
      note: "prefer HIT on 2nd request",
      label: "Cloudflare cache",
    });
  }
  return expectations;
}

function printResult(url, passes) {
  console.log(`\n=== ${url}`);
  for (const p of passes) {
    console.log(
      `  pass ${p.pass}: status=${p.status} cf=${p.cfCacheStatus ?? "-"} encoding=${p.contentEncoding ?? "-"} type=${p.contentType ?? "-"} cache=${p.cacheControl ?? "-"} age=${p.age ?? "-"}`
    );
  }

  const last = passes[passes.length - 1];
  const expectations = guessExpectations(new URL(url).pathname);
  for (const exp of expectations) {
    if (exp.equals) {
      const ok = (last[exp.header] || "").toLowerCase() === exp.equals;
      console.log(`  ${ok ? "OK" : "WARN"} ${exp.label}: got ${last[exp.header] ?? "missing"}`);
    } else if (exp.includes) {
      const ok = (last[exp.header] || "").toLowerCase().includes(exp.includes);
      console.log(`  ${ok ? "OK" : "WARN"} ${exp.label}: got ${last[exp.header] ?? "missing"}`);
    } else if (exp.note) {
      const hit = passes.some((p) => (p.cfCacheStatus || "").toUpperCase() === "HIT");
      console.log(`  ${hit ? "OK" : "WARN"} ${exp.label}: ${exp.note} (seen ${passes.map((p) => p.cfCacheStatus ?? "-").join(" → ")})`);
    }
  }
}

async function main() {
  const baseArg = process.argv[2];
  if (!baseArg) {
    console.error(
      "Usage: node scripts/verify-game-cdn.mjs <gameBaseUrl> [assetUrl...]"
    );
    process.exit(1);
  }

  const extra = process.argv.slice(3);
  const targets = [];

  if (extra.length > 0) {
    for (const path of extra) {
      targets.push(path.startsWith("http") ? path : new URL(path, normalizeBase(baseArg)).href);
    }
  } else {
    const base = normalizeBase(baseArg);
    targets.push(base);
    for (const rel of DEFAULT_ASSETS) {
      targets.push(new URL(rel, base).href);
    }
  }

  let warnings = 0;
  for (const url of targets) {
    try {
      const passes = await checkUrl(url, { expectSecondHit: true });
      printResult(url, passes);
      const hit = passes.some((p) => (p.cfCacheStatus || "").toUpperCase() === "HIT");
      const isAsset =
        /\/(build|streamingassets)\//i.test(url) ||
        /\.(wasm|data|js|br)(\?|$)/i.test(url);
      if (isAsset && !hit) warnings += 1;
    } catch (err) {
      warnings += 1;
      console.log(`\n=== ${url}`);
      console.log(`  ERROR ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\nDone. ${warnings > 0 ? `${warnings} warning(s) — review Cloudflare Cache Rules / R2 metadata.` : "No cache warnings on probed assets."}`
  );
  process.exit(warnings > 0 ? 2 : 0);
}

main();
