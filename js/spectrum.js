export function normalize(values) {
  const norm = Math.hypot(...values);
  return Array.from(values, value => norm > 1e-12 ? value / norm : 0);
}

// Small radix-2 FFT, shared by live windows and teaching. No external DSP library.
function powerSpectrum(input, offset, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = (input[offset + i] || 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / (size - 1)));
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < size; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const c = Math.cos(angle * j), s = Math.sin(angle * j);
        const a = start + j, b = a + length / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  return re.slice(0, size / 2).map((r, i) => (r * r + im[i] * im[i]) / (size * size));
}

export function spectrumProfile(samples, sampleRate) {
  const size = 2048, energy = new Float64Array(32);
  const upper = Math.min(8000, sampleRate / 2);
  let frames = 0;
  for (let start = 0; start < samples.length; start += size / 2) {
    const power = powerSpectrum(samples, start, size);
    for (let bin = 1; bin < power.length; bin++) {
      const hz = bin * sampleRate / size;
      if (hz < 60 || hz > upper) continue;
      const band = Math.min(31, Math.floor(32 * Math.log(hz / 60) / Math.log(upper / 60)));
      energy[band] += power[bin];
    }
    frames++;
  }
  return normalize(Array.from(energy, value => Math.log1p(100 * value / Math.max(1, frames))));
}

export function featureVector(scores, samples, sampleRate) {
  return [...normalize(scores).map(v => .5 * v), ...spectrumProfile(samples, sampleRate).map(v => .5 * v)];
}

export function rms(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / Math.max(1, samples.length));
}

export function drawSpectrum(analyser, canvas, meter) {
  const context = canvas.getContext('2d');
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  let id, last = 0;
  function draw(time) {
    id = requestAnimationFrame(draw);
    if (time - last < 65) return;
    last = time;
    analyser.getByteFrequencyData(bins);
    analyser.getFloatTimeDomainData(wave);
    meter.value = Math.min(1, rms(wave) * 4);
    if (!context) return;
    const w = canvas.width, h = canvas.height;
    context.drawImage(canvas, -3, 0);
    context.fillStyle = '#101e27'; context.fillRect(w - 3, 0, 3, h);
    for (let y = 0; y < h; y += 2) {
      const bin = Math.min(bins.length - 1, Math.floor(Math.pow(y / h, 2) * bins.length));
      const strength = bins[bin] / 255;
      context.fillStyle = `rgba(146,224,198,${strength * .92})`;
      context.fillRect(w - 3, h - y - 2, 3, 2);
    }
  }
  id = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(id); meter.value = 0; };
}
