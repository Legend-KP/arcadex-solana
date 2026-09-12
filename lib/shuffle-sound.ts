/** Lightweight procedural shuffle rustle — no audio asset required. */
export function playShuffleSound(): () => void {
  if (typeof window === "undefined") return () => {};

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return () => {};

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const duration = 2.8;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / ctx.sampleRate;
      const envelope =
        Math.sin((Math.PI * t) / duration) * (0.55 + 0.45 * Math.random());
      data[i] = (Math.random() * 2 - 1) * envelope * 0.35;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 0.7;
    noise.connect(filter);
    filter.connect(master);
    noise.start();

    // Soft card “ticks” layered on top
    const tickTimes = [0.15, 0.45, 0.8, 1.15, 1.5, 1.9, 2.3];
    for (const at of tickTimes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 420 + Math.random() * 280;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.08);
      osc.connect(g);
      g.connect(master);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.1);
    }

    const stopAt = window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, duration * 1000 + 200);

    return () => {
      window.clearTimeout(stopAt);
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}
