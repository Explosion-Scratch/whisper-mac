// Simple, pure canvas audio visualizer.
// Usage:
//   const visualizer = createAudioVisualizer(canvas, { getLevel: () => currentLevel });
//   visualizer.start();
//   visualizer.stop();
//   visualizer.resize();

(function () {
  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function createAudioVisualizer(canvas, options) {
    const ctx = canvas.getContext("2d");
    const getLevel =
      typeof options?.getLevel === "function"
        ? options.getLevel
        : function () {
            return 0;
          };
    const bars =
      options?.bars && options.bars > 4 ? Math.min(options.bars, 256) : 48;
    const smoothing =
      typeof options?.smoothing === "number"
        ? Math.max(0, Math.min(0.99, options.smoothing))
        : 0.6;
    const maxHeightRatio =
      typeof options?.maxHeightRatio === "number"
        ? Math.max(0.1, Math.min(1, options.maxHeightRatio))
        : 0.95;

    let rafId = null;
    let heights = new Array(bars).fill(0);

    function drawFrame() {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      const isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)";

      const unitWidth = Math.max(2, Math.floor(width / bars));
      const barWidth = Math.max(1, Math.floor(unitWidth * 0.45));
      const minBarHeight = 2;

      // Shift history to the left
      for (let i = 0; i < bars - 1; i++) {
        heights[i] = heights[i + 1];
      }

      // Calculate new value from level
      const level = clamp01(getLevel());
      const curved = Math.pow(level, 0.5);
      const targetHeight = Math.max(
        minBarHeight,
        curved * height * maxHeightRatio
      );
      const last = heights[bars - 2] || 0;
      heights[bars - 1] = last + (targetHeight - last) * (1 - smoothing);

      for (let i = 0; i < bars; i++) {
        const h = heights[i];
        const x = Math.floor(i * unitWidth);
        const y = centerY - h / 2;
        ctx.fillRect(x, y, barWidth, h);
      }

      rafId = window.requestAnimationFrame(drawFrame);
    }

    function start() {
      if (rafId == null) rafId = window.requestAnimationFrame(drawFrame);
    }

    function stop() {
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function resize() {
      // Consumers should set canvas.width/height before calling
      // Here we simply restart to ensure a fresh frame
      if (rafId == null) return;
      stop();
      start();
    }

    return { start, stop, resize };
  }

  if (typeof window !== "undefined") {
    window.createAudioVisualizer = createAudioVisualizer;
  }
})();
