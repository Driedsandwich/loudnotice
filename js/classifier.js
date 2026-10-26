import { featureVector, rms } from './spectrum.js';
const BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/audio_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite';
export const FEATURE_FORMAT = 'yamnet-521-name-sorted+fft32-v1';

export class Classifier {
  async load() {
    const { FilesetResolver, AudioClassifier } = await import(BUNDLE);
    const fileset = await FilesetResolver.forAudioTasks(WASM);
    this.model = await AudioClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL }, maxResults: 521, scoreThreshold: 0,
    });
  }
  classify(samples, sampleRate) {
    // Verified Tasks Audio API: synchronous classify(samples, sampleRate).
    const results = this.model.classify(samples, sampleRate);
    const scores = new Float64Array(521), labels = new Map();
    let count = 0;
    for (const result of results) {
      const categories = result.classifications?.[0]?.categories || [];
      // Stable name ordering also works when an API build omits category.index.
      const sorted = [...categories].sort((a, b) => a.categoryName < b.categoryName ? -1 : a.categoryName > b.categoryName ? 1 : 0);
      if (sorted.length !== 521 || new Set(sorted.map(c => c.categoryName)).size !== 521) {
        throw new Error('YAMNet did not return all 521 categories. Please reload the model.');
      }
      sorted.forEach((category, i) => {
        scores[i] += category.score;
        if (category.categoryName !== 'Silence') labels.set(category.categoryName, Math.max(labels.get(category.categoryName) || 0, category.score));
      });
      count++;
    }
    if (!count) throw new Error('The model returned no audio windows.');
    return { scores: Array.from(scores, score => score / count), labels, level: rms(samples) };
  }
  window(samples, sampleRate) {
    const result = this.classify(samples, sampleRate);
    return { ...result, feature: featureVector(result.scores, samples, sampleRate) };
  }
  async example(samples, sampleRate) {
    const size = Math.round(sampleRate), hop = Math.round(sampleRate / 2);
    const mean = new Float64Array(521);
    let count = 0;
    for (let start = 0; start < samples.length; start += hop) {
      // Match runtime's 1-second frames; don't dilute prototypes with empty tails.
      if (start + size > samples.length && count) break;
      const frame = new Float32Array(size);
      frame.set(samples.subarray(start, start + size));
      const result = this.classify(frame, sampleRate);
      if (result.level > .003) { result.scores.forEach((s, i) => { mean[i] += s; }); count++; }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (!count || rms(samples) < .003) throw new Error('That example was too quiet. Try a closer or louder sound.');
    return featureVector(Array.from(mean, s => s / count), samples, sampleRate);
  }
}
