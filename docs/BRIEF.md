# SoundSense — build brief (hackathon prototype)

Working name: **SoundSense** (may be renamed). A free, private, browser-only sound alert for Deaf and hard-of-hearing people.
It listens through the microphone, recognizes important household sounds with Google's YAMNet model running
in the browser (MediaPipe Tasks Audio), and turns them into a full-screen visual alert with a big icon and label,
plus vibration on phones. Users can teach it their own sound (e.g. their washing machine's "done" jingle) with a few samples.
Nothing is uploaded: audio is processed on the device.

## Hard constraints

- Static site, no build step: plain HTML + CSS + ES modules (vanilla JS). Must run from GitHub Pages and from `python3 -m http.server`.
- No server, no secret keys, no paid APIs, no analytics, no external requests except the two below.
- Allowed external loads (pin exact versions):
  - `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/audio_bundle.mjs` and its wasm folder `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm`
  - model `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite` (YAMNet, Apache-2.0)
- English UI. Accessible: large text, high contrast, keyboard operable, ARIA live region for alerts, never color-only (icon + text + color).
- Flashing must stay at or under 2 flashes per second (photosensitive safety) and must respect `prefers-reduced-motion` (then use a solid color change, no flashing).
- Do not claim medical-device reliability. Show a short honest note: may miss sounds or false-alarm; not a replacement for certified alarms.

## Verified facts from a local test (YAMNet in headless Chromium, synthesized sounds, max score over windows)

API that worked:
```js
import { FilesetResolver, AudioClassifier } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/audio_bundle.mjs";
const fileset = await FilesetResolver.forAudioTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm");
const clf = await AudioClassifier.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL }, maxResults: 5, scoreThreshold: 0.05 });
const results = clf.classify(float32Samples, sampleRate); // array of per-window results; results[i].classifications[0].categories = [{categoryName, score}]
```
Observed top labels: smoke_alarm.wav → "Beep, bleep" .74, "Smoke detector, smoke alarm" .59, "Buzzer" .59, "Alarm" .50, "Fire alarm" .33.
doorbell.wav → "Music" .74, "Clang" .59, "Ding" .50, "Bell" .20. knock.wav → "Bouncing" .67, "Knock" .33, "Whack, thwack" .26.
microwave.wav → "Beep, bleep" .74. kettle.wav → "Whistle" .99, "Alarm" .99, "Steam whistle" .59. washer_tune.wav → "Beep, bleep" .33, "Ding" .15.
"Silence" scores high in gaps — ignore it. For maxResults use a larger value (e.g. 10) inside the app so group matching sees more labels.

## Features (build in this priority order; each must fully work before the next)

1. **Listen**: Start/Stop button. getUserMedia (echoCancellation/noiseSuppression/autoGainControl off), AudioContext, collect samples
   (AudioWorklet preferred; ScriptProcessor fallback). Every 0.5 s classify the latest ~1.0 s window. Show a live level meter
   and a small scrolling spectrogram (AnalyserNode) so the user sees it is listening. Show the top 3 raw labels live.
2. **Built-in alert groups** (`groups.js`): map YAMNet label names to groups, each with id, title, emoji icon, color, urgency,
   default threshold, enabled flag. At least:
   - Smoke / fire alarm (urgent): "Smoke detector, smoke alarm", "Fire alarm", "Alarm", "Buzzer"
   - Doorbell / bell: "Doorbell", "Ding-dong", "Ding", "Bell", "Chime", "Jingle bell"
   - Knock: "Knock", "Whack, thwack", "Tap"
   - Appliance beep: "Beep, bleep", "Microwave oven"
   - Kettle / whistle: "Whistle", "Steam whistle", "Kettle whistle"
   - Siren (urgent): "Siren", "Civil defense siren", "Police car (siren)", "Ambulance (siren)", "Fire engine, fire truck (siren)"
   - Baby crying (urgent): "Baby cry, infant cry", "Crying, sobbing"
   - Dog: "Dog", "Bark"
   - Glass breaking (urgent): "Shatter", "Glass", "Breaking"
   - Phone ringing: "Telephone bell ringing", "Ringtone"
   - Water running: "Water tap, faucet", "Sink (filling or washing)", "Running water"
   - Clapping (test): "Clapping", "Applause" — lets a judge test by clapping
   Use exact label strings from YAMNet's label list where possible. A group fires when its best label score ≥ threshold in
   2 of the last 3 windows (urgent groups: 1 window ≥ threshold + 0.1 is enough). Per-group cooldown 6 s.
   If several groups fire, show the most urgent.
3. **Alert screen**: full-viewport overlay with the group's color, giant icon and title (e.g. "SMOKE ALARM"), confidence, time,
   "Dismiss" button (Esc too). Urgent: pulse ≤ 2 Hz unless reduced-motion. `navigator.vibrate` pattern on supported devices.
   Optional system notification if the user enabled it (ask permission only on click). Update `document.title` while active.
4. **History**: list of alerts with time, group, confidence, source (mic / sample / taught). "While you were away" summary:
   counts per group since the page was last focused. Clear button. Kept in memory + localStorage.
5. **Try without a microphone** (for judges): buttons that play the bundled sample sounds from `sounds/*.wav` through the SAME
   analysis pipeline (and audibly through the speakers), so the full flow works with no mic permission. Label clearly:
   "Synthesized test sounds (generated by tools/synth_sounds.py, CC0)".
6. **Teach a sound** (custom sounds): name + emoji + color, then capture 3 examples (from mic for ~2.5 s each, or from a
   sample file for demo). Feature vector per example = concatenation of (a) the mean YAMNet score vector over its windows,
   L2-normalized (use all 521 categories: call the classifier with maxResults: -1 or a high number and build the full vector
   by category index/name), and (b) a 32-band log-energy spectrum profile (from AnalyserNode / FFT of the clip),
   L2-normalized; weight (a) 0.5, (b) 0.5. Prototype = mean of examples. At runtime compare each window's feature with
   cosine similarity; fire if similarity ≥ threshold (default 0.85, slider) and it beats the second-best custom sound by a
   margin of 0.03. Store prototypes (numbers only, no audio) in localStorage. Export/Import as a JSON file
   (so a family member can set it up). Show a "Test" button that replays an example.
7. **Settings**: sensitivity slider (global threshold offset), per-group enable toggles, reduced-motion override,
   vibration on/off, notification on/off.
8. **About/Privacy panel**: how it works (one paragraph), privacy (audio never leaves the device; only numbers for taught
   sounds are stored locally), limitations, credits (YAMNet / MediaPipe Apache-2.0, sounds CC0, made during NextSpark Hacks 2026).

## Code layout

- `index.html`, `styles.css`, `js/app.js` (UI wiring), `js/audio.js` (capture + windows + playback of samples into the pipeline),
  `js/classifier.js` (MediaPipe wrapper, full-score vectors), `js/groups.js`, `js/custom.js` (teach/match, export/import),
  `js/alerts.js` (overlay, vibration, notification, history), `js/spectrum.js`.
- Expose a small hook for automated tests and demo recording: `window.soundsense = { ready: Promise, playSample(name), events: [] }`
  where each alert pushes `{t, group, score, source}` into `events`, and `ready` resolves when the model has loaded.
- `README.md` (what it is, who it helps, how to run locally, how it works, privacy, limitations, credits, AI-assistance note
  placeholder), `LICENSE` (MIT for the code), `sounds/LICENSE` (CC0 1.0 for the synthesized sounds).
- `tests/smoke_test.py`: a Playwright (python) script that serves the folder with `http.server`, opens the page headless,
  waits for `window.soundsense.ready`, calls `playSample` for smoke_alarm, kettle, knock, microwave, doorbell and asserts the
  expected groups appear in `events`; then teaches `washer_tune` from the sample file 3 times and checks it is recognized
  when played, and that `microwave` is NOT recognized as the taught sound. Print a pass/fail table. (It will be run later on
  another machine; do not try to install browsers.)
