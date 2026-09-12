/** Decode an image into the browser cache. Resolves true on success. */
export function preloadImage(
  src: string,
  priority: "high" | "low" | "auto" = "auto"
): Promise<boolean> {
  if (typeof window === "undefined" || !src) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.fetchPriority = priority;
    img.decoding = "async";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/** Hint the browser to fetch an image before React paints it. */
export function injectImagePreload(
  src: string,
  priority: "high" | "low" = "high"
): void {
  if (typeof document === "undefined" || !src) return;
  if (document.head.querySelector(`link[rel="preload"][as="image"][href="${src}"]`)) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = src;
  link.fetchPriority = priority;
  document.head.appendChild(link);
}
