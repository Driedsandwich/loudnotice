import { FEATURE_FORMAT } from './classifier.js';
export const CUSTOM_KEY = 'soundsense.custom.v1';
export function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? Math.min(1, dot / Math.sqrt(aa * bb)) : 0;
}
export function validateImport(data) {
  if (!data || data.version !== 1 || data.featureFormat !== FEATURE_FORMAT || !Array.isArray(data.sounds) || data.sounds.length > 50) {
    throw new Error('Unsupported file. Choose a SoundSense v1 export (up to 50 sounds).');
  }
  const ids = new Set();
  return data.sounds.map(sound => {
    if (!sound || typeof sound.id !== 'string' || !/^custom-[a-zA-Z0-9-]{1,80}$/.test(sound.id) || ids.has(sound.id) ||
      typeof sound.title !== 'string' || !sound.title.trim() || sound.title.length > 60 ||
      typeof sound.icon !== 'string' || !sound.icon.trim() || sound.icon.length > 16 ||
      typeof sound.color !== 'string' || !/^#[\da-f]{6}$/i.test(sound.color) ||
      typeof sound.threshold !== 'number' || !Number.isFinite(sound.threshold) || sound.threshold < .5 || sound.threshold > .99 ||
      typeof sound.enabled !== 'boolean' || !Array.isArray(sound.prototype) || sound.prototype.length !== 553 ||
      !sound.prototype.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) ||
      Math.hypot(...sound.prototype) < .01) throw new Error('Invalid sound data. No sounds were imported.');
    ids.add(sound.id);
    return { id: sound.id, title: sound.title.trim(), icon: sound.icon, color: sound.color,
      threshold: sound.threshold, enabled: sound.enabled, prototype: [...sound.prototype], urgency: 1 };
  });
}
export class CustomSounds {
  constructor(onWarning) {
    this.onWarning = onWarning; this.sounds = []; this.replays = new Map(); this.cooldowns = new Map();
    try {
      const saved = localStorage.getItem(CUSTOM_KEY);
      if (saved) this.sounds = validateImport(JSON.parse(saved));
    } catch { onWarning('Saved taught sounds could not be read. You can import an exported copy.'); }
  }
  data() { return { version: 1, featureFormat: FEATURE_FORMAT, sounds: this.sounds }; }
  save() {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(this.data())); }
    catch { this.onWarning('Local storage is unavailable or full. Export taught sounds before closing this page.'); }
  }
  add({ title, icon, color }, examples, replay) {
    if (examples.length !== 3) throw new Error('Capture all three examples first.');
    if (this.sounds.length >= 50) throw new Error('You can keep up to 50 taught sounds. Remove one first.');
    const prototype = examples[0].map((_, i) => examples.reduce((sum, example) => sum + example[i], 0) / examples.length);
    const sound = { id: `custom-${crypto.randomUUID?.() || Date.now().toString(36)}`, title: title.trim(), icon: icon.trim(), color, threshold: .85, enabled: true, prototype, urgency: 1 };
    validateImport({ ...this.data(), sounds: [sound] });
    this.sounds.push(sound); if (replay) this.replays.set(sound.id, replay); this.save(); return sound;
  }
  match(feature, now = Date.now()) {
    const ranked = this.sounds.filter(s => s.enabled).map(s => ({ ...s, score: cosine(s.prototype, feature) })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < best.threshold || best.score - (ranked[1]?.score || 0) < .03 || now - (this.cooldowns.get(best.id) || 0) < 6000) return [];
    this.cooldowns.set(best.id, now); return [best];
  }
  remove(id) { this.sounds = this.sounds.filter(s => s.id !== id); this.replays.delete(id); this.cooldowns.delete(id); this.save(); }
  import(data) {
    const sounds = validateImport(data);
    const merged = new Map(this.sounds.map(s => [s.id, s]));
    sounds.forEach(sound => merged.set(sound.id, sound));
    if (merged.size > 50) throw new Error('Import would exceed the limit of 50 sounds.');
    // Validate everything before changing storage. Same IDs update existing entries.
    this.sounds = [...merged.values()]; sounds.forEach(s => this.replays.delete(s.id)); this.save();
    return sounds.length;
  }
}
