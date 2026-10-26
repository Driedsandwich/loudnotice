# SoundSense

**Your world. Made visible.** A free, private, browser-only sound alert prototype for Deaf and hard-of-hearing people, made during NextSpark Hacks 2026.

SoundSense turns microphone input into large visual alerts, optional phone vibration and optional system notifications. Try six included synthesized sounds without granting microphone access, or teach the app your own household sound with three examples.

## Run locally

No build step, Node, account or API key is needed:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. For GitHub Pages, publish this directory as the site root; all application assets use relative paths, including the audio worklet. Use HTTPS or localhost for microphone access and AudioWorklet. Opening `index.html` as a `file://` URL will not work.

The first load downloads the pinned MediaPipe runtime / WASM and YAMNet model. Wait for **YAMNet ready**. Internet access to those hosts is required; offline availability is not guaranteed. Download failures show a retry control. Nothing is installed by the app.

## Quick demo

1. Click **Smoke alarm**, **Kettle**, **Knocking**, **Microwave** or **Doorbell**. Audio plays through your speakers and enters the same capture / window / classification path as the microphone. Dismiss the full-screen alert with the button or Escape. All matching groups appear in Recent alerts.
2. In **Teach a sound**, enter “My washer is done”. Click **Use washer sample** three times, waiting for each capture to complete. Click **Save my sound**, then **Test** or the **Washer tune** sample. Each sound has a similarity slider (default 85%).
3. After at least six seconds, play **Microwave** as a negative comparison. It should not match the taught washer; real-model behavior still needs browser verification.
4. To use a real sound, capture three distinct 2.5-second microphone examples, or select local audio files (1–15 seconds, at most 12 MB). Avoid mixing different sounds in one set. Reset starts a new set. Capturing a sample/file stops the current live input; microphone capture leaves listening active.
5. Export taught fingerprints to JSON and import on another device. Import merges sounds by ID (matching IDs update). Imported text is rendered as text, and the entire file is validated before changes are made.

## Implemented features

- Start/Stop microphone capture with echo cancellation, noise suppression and automatic gain control disabled; permission and device error feedback. AudioWorklet with ScriptProcessor fallback.
- One-second windows every 0.5 seconds, live input meter, scrolling spectrogram and top three raw non-silence labels.
- All twelve requested built-in groups. Two of three windows confirm an ordinary match; urgent groups can also trigger from one score at least 0.1 above threshold. Six-second cooldown per group.
- Full-viewport icon + text + color alerts, confidence and time, Escape dismissal, focus management with native modal dialog, screen-reader live region, vibration and opt-in notifications. Urgent border pulses once per 2.4 seconds (about 0.42 Hz); reduced-motion preference or override makes it static.
- Last 200 alerts persisted locally, with mic/sample/taught source labels, clear control and counts for alerts generated while the page was unfocused. History shows all eligible groups; the overlay shows the highest urgency, then highest score. A visible urgent alert is retained over later lower-priority matches until dismissed.
- Six bundled synthesized samples, played audibly and classified through the real shared pipeline. Sample names never select or fabricate an alert.
- Three-example custom training, local numeric prototypes, per-sound enable / similarity controls, deletion, session-only Test replay and validated JSON export/import (up to 50 sounds).
- Global sensitivity for built-ins, individual group toggles, motion / vibration / notification preferences, About and Privacy information.
- English UI, keyboard controls, large alert text, responsive cards, system-font typography and no external visual assets.

## How recognition and teaching work

`AudioClassifier.classify(float32Samples, sampleRate)` uses the verified Tasks Audio API. The classifier requests **maxResults: 521, scoreThreshold: 0**. Each result must contain all 521 named categories; the wrapper orders them lexicographically by `categoryName`, yielding a deterministic full vector. It never uses a top-5 or top-10 approximation for teaching. Silence is excluded from raw-label display and built-in matching, and near-silent frames are gated before matching.

Each example averages the full score vectors of its one-second windows and L2-normalizes that mean. A local radix-2 FFT calculates 32 logarithmically spaced frequency bands (60–8000 Hz) across the clip, applies log-energy compression and L2 normalization. Both parts are weighted 0.5 and concatenated into 553 numbers. The prototype is the mean of three examples. Runtime features use the identical extraction code. A custom match needs cosine similarity at or above its threshold and a margin of at least 0.03 over the second-best enabled custom sound, with a six-second cooldown. With one custom sound, the runner-up score is zero. Built-in sensitivity does not change custom thresholds.

Audio processing uses the browser's actual sample rate. The classifier receives that rate explicitly. Model inference is synchronous on the main thread in this prototype, so slower devices may show UI pauses or delayed alerts.

## Privacy and data

Audio is never uploaded. Microphone buffers and example replay audio exist only in memory; Stop releases microphone tracks. No audio is placed in localStorage or JSON exports. Preferences, the last 200 alerts, and taught numeric fingerprints plus user-chosen labels are stored locally. Clear history / remove taught sounds to remove those records, or clear the site's browser data to erase everything. Stored sound names and times may still be personal information.

Only these external resources are loaded:

- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/audio_bundle.mjs`
- Runtime dependencies in `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm`
- `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`

The hosting service, jsDelivr and Google receive normal asset requests, including ordinary connection metadata. There are no analytics, advertising, remote audio services, secrets or paid APIs. Notification permission is requested only after the user enables the checkbox. No service worker or push service is used.

## Browser verification

This implementation was created on a machine without a browser or Node. **Browser smoke tests have not been run.** Only the requested Python syntax check was run locally:

```sh
python3 -m py_compile tests/smoke_test.py
```

On a separate machine with Python Playwright and Chromium already available:

```sh
python3 tests/smoke_test.py
# Optional visible browser:
python3 tests/smoke_test.py --headed
```

The script serves its own localhost site on an available port, loads the real model, plays all five required recognition fixtures, teaches the washer three times through the UI, tests positive/negative recognition, verifies numeric-only persistence, checks the request allowlist and reports uncaught errors. It prints a pass/fail table and returns a nonzero status on any failure. A 6.2-second gap before the negative control prevents cooldown from hiding a false positive. It never installs browsers or packages and does not ask for microphone permission.

Manual checks on the judging device:

- Permit / deny microphone access; clap, stop, restart, and confirm the browser's microphone indicator turns off after Stop.
- Check real-world examples and adjust thresholds. The bundled synthesized fixtures are not representative validation data.
- Check the UI at 320 px and at large text zoom, keyboard focus, Escape, screen-reader alert announcements and system reduced motion.
- Check device vibration and explicitly enabled system notifications. Support differs by browser; some mobile browsers do not support them.
- Leave and refocus the page during a sample for the away summary. Locking a phone or backgrounding a browser can suspend processing.
- Export/import a custom sound, reload, and verify settings/history persist. Replay audio intentionally disappears on reload; imported fingerprints remain usable against live input and samples.

Automation hook:

```js
await window.soundsense.ready;
await window.soundsense.playSample('smoke_alarm');
console.table(window.soundsense.events); // { t: epoch milliseconds, group, score, source }
```

Valid sample names: `smoke_alarm`, `doorbell`, `knock`, `microwave`, `kettle`, `washer_tune`. Built-in event IDs: `smoke`, `doorbell`, `knock`, `appliance`, `kettle`, `siren`, `baby`, `dog`, `glass`, `phone`, `water`, `clapping`. Taught sound IDs start with `custom-`. Event sources are `mic`, `sample` or `taught`; custom entries use `taught` for either input type. `playSample` resolves after playback and final analysis, but does not auto-dismiss the alert. Automated browsers need audio autoplay enabled; normal users activate audio with a click. `ready` rejects on model-load failure; retry replaces it with a new Promise. Demo events are kept for this page session and are separate from persisted history.

## Planned / incomplete

- All eight feature sections have implementations; **actual browser execution, fixture accuracy and mobile accessibility/device behavior remain unverified**. A passing smoke test is not claimed.
- No calibration against real household recordings or evaluation of false-positive / false-negative rates. Broad YAMNet labels overlap: the supplied kettle can also score highly as `Alarm`, which belongs to the urgent smoke group; that urgent overlay can take precedence while the kettle event appears in history. Music-like doorbells and beeps can also be confused.
- No reliable background / lock-screen monitoring, offline guarantee, or independent worker for model inference. Keep the tab open and visible.
- Test replay audio is intentionally session-only to keep audio out of storage and export. After reload/import, test with the original sound or capture new examples. Teaching the same bundled file three times is a demo, not evidence of generalization.
- This is not a medical device, life-safety system, certified alarm or substitute for existing accessibility aids. It may miss sounds or false-alarm. Model confidence and custom similarity are different, uncalibrated scores.

## Files and credits

- `js/audio.js`, `js/capture-worklet.js`: shared audio graph, microphone, sample playback and capture.
- `js/classifier.js`, `js/spectrum.js`: pinned MediaPipe wrapper, all-category scores and local FFT features.
- `js/groups.js`, `js/custom.js`: group decision rules and custom prototypes.
- `js/alerts.js`, `js/app.js`: visual / system alerts, history, settings and UI.
- `sounds/*.wav`: original synthesized fixtures generated by the supplied `tools/synth_sounds.py`; CC0 1.0. The generator requires NumPy only if you choose to regenerate sounds; the application does not.
- YAMNet / MediaPipe: Google, Apache-2.0. Loaded remotely, not relicensed under the application's MIT license.
- Code: MIT; see `LICENSE`. Synthesized sounds: see `sounds/LICENSE`.
- Made during **NextSpark Hacks 2026**. Submission and deadline management are outside this implementation.

**AI-assistance note:** OpenAI Codex assisted with implementation, documentation and the smoke-test script. [Before submission: add the human author's name, review details and any additional AI assistance required by the hackathon disclosure rules.]
