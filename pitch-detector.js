/* Original normalized square difference (McLeod) detector; no dependencies. */
(() => {
  'use strict';
  const frequency = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
  function note(f, a4 = 440) {
    if (!(f > 0) || !Number.isFinite(f) || !(a4 > 0)) return null;
    const value = 69 + 12 * Math.log2(f / a4), midi = Math.round(value);
    return { midi, cents: (value - midi) * 100 };
  }
  function rms(buffer) {
    let sum = 0;
    for (const x of buffer) sum += x * x;
    return Math.sqrt(sum / buffer.length);
  }
  function detector() {
    let signal = new Float64Array(0), nsdf = new Float64Array(0);
    return (buffer, sampleRate) => {
      // Box-filter decimation reduces work on mobile; retain > 8 samples at C6.
      const step = Math.max(1, Math.floor(sampleRate / 12000));
      const size = Math.floor(buffer.length / step), rate = sampleRate / step;
      if (signal.length !== size) { signal = new Float64Array(size); nsdf = new Float64Array(size); }
      let mean = 0;
      for (let i = 0; i < size; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += buffer[i * step + j];
        signal[i] = sum / step; mean += signal[i];
      }
      mean /= size;
      for (let i = 0; i < size; i++) signal[i] -= mean;
      const maxLag = Math.min(size >> 1, Math.ceil(rate / 55));
      const minLag = Math.max(2, Math.floor(rate / 1400));
      for (let lag = 0; lag <= maxLag; lag++) {
        let product = 0, energy = 0;
        for (let i = 0; i < size - lag; i++) {
          const a = signal[i], b = signal[i + lag];
          product += a * b; energy += a * a + b * b;
        }
        nsdf[lag] = energy > 1e-15 ? 2 * product / energy : 0;
      }
      const peaks = [];
      let crossed = false, maximum = 0;
      for (let lag = 1; lag < maxLag; lag++) {
        if (nsdf[lag] < 0) crossed = true;
        if (crossed && lag >= minLag && nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1]) {
          peaks.push(lag); maximum = Math.max(maximum, nsdf[lag]);
        }
      }
      const lag = peaks.find(i => nsdf[i] >= Math.max(.5, maximum * .93));
      if (lag === undefined) return { frequency: 0, clarity: 0 };
      const a = nsdf[lag - 1], b = nsdf[lag], c = nsdf[lag + 1];
      const denominator = a - 2 * b + c;
      const offset = denominator ? .5 * (a - c) / denominator : 0;
      return { frequency: rate / (lag + offset), clarity: Math.min(1, b - .25 * (a - c) * offset) };
    };
  }
  function stability() {
    let midi = null, center = 0, count = 0;
    const reset = () => { midi = null; count = 0; };
    return {
      reset,
      update(pitch, level, threshold, a4 = 440) {
        const n = note(pitch.frequency, a4);
        if (!n || pitch.clarity < .90 || level <= threshold) { reset(); return null; }
        if (n.midi !== midi || Math.abs(n.cents - center) > 20) {
          midi = n.midi; center = n.cents; count = 1;
        } else count++;
        return count >= 3 ? n : null;
      }
    };
  }
  function onset() {
    let blockedUntil = 0, waiting = false, dipped = false, dipAt = null, peak = 0, low = 0;
    return {
      block(now, level, duration = 700) {
        blockedUntil = now + duration; waiting = true; dipped = false; dipAt = null; peak = level;
      },
      update(now, level, floor) {
        if (now < blockedUntil) return false;
        if (!waiting) return true;
        const dip = Math.max(floor * 1.4, peak * .18);
        if (!dipped) {
          if (level <= dip) {
            if (dipAt === null) dipAt = now;
            if (now - dipAt >= 80) { dipped = true; low = Math.max(level, floor); }
          } else { dipAt = null; peak = Math.max(peak, level); }
          return false;
        }
        if (level >= Math.max(floor * 2, low * 2.2)) { waiting = false; return true; }
        low = Math.min(low, Math.max(level, floor));
        return false;
      }
    };
  }
  function noiseFloor() {
    let floor = .001;
    return {
      get threshold() { return Math.max(.003, floor * 3); },
      update(level, clarity) {
        // Never learn a sustained, clear piano tone as room noise.
        if (level < floor * 2 || clarity < .5) floor += (Math.min(level, .012) - floor) * .025;
        return this.threshold;
      }
    };
  }
  window.PitchDetector = Object.freeze({ frequency, note, rms, detector, stability, onset, noiseFloor });
})();
