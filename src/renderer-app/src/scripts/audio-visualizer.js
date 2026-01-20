// Simple, pure canvas audio visualizer.
// Usage:
//   const visualizer = createAudioVisualizer(canvas, { getLevel: () => currentLevel });
//   visualizer.start();
//   visualizer.stop();
//   visualizer.resize();

function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
}

export default function createAudioVisualizer(canvas, options) {
    const ctx = canvas.getContext("2d");
    const getLevel =
      typeof options?.getLevel === "function"
        ? options.getLevel
        : function () {
            return 0;
          };
    
    // Configurable bar width and gap
    const barWidth = typeof options?.barWidth === "number" ? options.barWidth : 3;
    const barGap = typeof options?.barGap === "number" ? options.barGap : 2;
    
    const smoothing =
      typeof options?.smoothing === "number"
        ? Math.max(0, Math.min(0.99, options.smoothing))
        : 0.6;
    const maxHeightRatio =
      typeof options?.maxHeightRatio === "number"
        ? Math.max(0.1, Math.min(1, options.maxHeightRatio))
        : 0.95;

    let rafId = null;
    let heights = [];
    let currentBarsCount = 0;
    function updateBarsCount() {
        const width = canvas.width;
        const dpr = window.devicePixelRatio || 1;
        const scaledBarWidth = barWidth * dpr;
        const scaledGap = barGap * dpr;
        
        // Calculate how many bars fit in the width with the given gap
        const count = Math.max(4, Math.floor(width / (scaledBarWidth + scaledGap)));
        
        if (count !== currentBarsCount) {
            const oldHeights = heights;
            heights = new Array(count).fill(0);
            if (oldHeights.length > 0) {
                const minLen = Math.min(oldHeights.length, count);
                for (let i = 0; i < minLen; i++) {
                    heights[count - 1 - i] = oldHeights[oldHeights.length - 1 - i];
                }
            }
            currentBarsCount = count;
        }
        return currentBarsCount;
    }

    function drawFrame() {
      const width = canvas.width;
      const height = canvas.height;
      const dpr = window.devicePixelRatio || 1;
      const bars = updateBarsCount();
      
      const centerY = height / 2;
      const isDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)";

      const scaledBarWidth = barWidth * dpr;
      const scaledGap = barGap * dpr;
      const unitWidth = scaledBarWidth + scaledGap;
      const minBarHeight = 2 * dpr;

      // Shift history to the left
      for (let i = 0; i < bars - 1; i++) {
        heights[i] = heights[i + 1];
      }

      // Calculate new value from level
      const level = clamp01(getLevel());
      // Logarithmic scaling (approximate dB mapping)
      // Boost input level artificially to help with low volume mics
      const boostedLevel = clamp01(level * 3);
      
      let curved = 0;
      if (boostedLevel > 0.00001) {
          const db = 20 * Math.log10(boostedLevel);
          // Range from -60dB to 0dB
          // We map [-60, 0] to [0, 1]
          const normalizedDb = Math.max(0, (db + 60) / 60);
          
          // Apply a power curve to push mid-tones up (making them "fatter")
          // x^0.6 makes 0.5 -> 0.66, 0.2 -> 0.38
          curved = Math.pow(normalizedDb, 0.6);
      }

      const targetHeight = Math.max(
        minBarHeight,
        curved * height * maxHeightRatio,
      );
      const last = heights[bars - 2] || 0;
      heights[bars - 1] = last + (targetHeight - last) * (1 - smoothing);

      // Center the bars horizontally if they don't fill exactly
      const totalUsedWidth = bars * unitWidth - scaledGap;
      const startX = (width - totalUsedWidth) / 2;

      for (let i = 0; i < bars; i++) {
        const h = heights[i];
        const x = startX + i * unitWidth;
        const y = centerY - h / 2;
        ctx.fillRect(x, y, scaledBarWidth, h);
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
      // Internal state will update on next drawFrame via updateBarsCount
      if (rafId == null) return;
      stop();
      start();
    }

    return { start, stop, resize };
}
