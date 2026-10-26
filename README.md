# LoudNotice

**See the sounds that matter.**

**Live demo:** https://driedsandwich.github.io/loudnotice/ · **Demo video:** linked on the project's Devpost page

LoudNotice is a free, private, browser-only sound alert prototype for Deaf and hard-of-hearing people. It turns household sounds into large visual alerts with an icon, a name and a color, with optional vibration and system notifications. It is also meant for anyone who wears headphones or is absorbed in something and can miss an alarm, a doorbell or an appliance beep. It was made during NextSpark Hacks 2026.

Try the included synthesized sounds without a microphone, teach a household sound with three examples, or give an unused laptop or tablet a new purpose as a room’s sound display. The existing dark dashboard, mint accents, sound timeline and full-screen alerts are shared across these features.

## Station mode

Choose **Enter Station mode** to turn a spare laptop or tablet into an at-a-glance display:

- A large clock, listening status, latest alert and counts for every built-in and taught sound group.
- Counts start at zero each time you enter and include all detected groups, including test samples. The latest alert can come from earlier history.
- Listening starts automatically if no input is running. Allow microphone access when asked. An existing microphone or sample session is left running.
- The page requests the Fullscreen API. If unavailable or denied, the display fills the browser viewport instead.
- The page requests `navigator.wakeLock.request('screen')`. A small status explains whether the screen can stay awake. It requests the lock again when the page becomes visible; the browser or operating system may still release it.
- Alerts use the same full-screen notification as the dashboard. **Dismiss** returns to the station. **Esc** or **Exit Station mode** leaves the station and releases its wake lock. An established microphone session continues; use **Stop listening** on the dashboard to stop it. Leaving while microphone startup is pending cancels that startup.

Keep the page visible. Station mode cannot overcome browser suspension, device power policies, a closed lid or a locked screen. If microphone access fails, the station shows an error and its status remains “Not listening.” Exit, fix permissions or retry the model download, then enter again.

## Set up for someone you care about

1. A hearing family member teaches three examples of that home’s sounds and adjusts the enabled groups, sensitivity, vibration and other preferences.
2. Choose **Export setup** to download one `loudnotice-setup.json` file.
3. On the recipient’s device, open LoudNotice and choose **Import setup**. Test the actual household sounds together, then enter Station mode.

The version 2 JSON contains an application identifier, feature-format identifier, taught numeric fingerprints and their names/icons/colors, each taught sound’s enable flag and similarity threshold, all built-in group toggles, global sensitivity, vibration, reduced motion and the notification preference. It contains **no recordings or audio samples**, no alert history, and no Station session counts. Export works even when no sounds have been taught.

Import validates the entire setup before changing it, then replaces taught sounds and preferences. Imported controls update immediately and persist in this browser. Browser notification permission is separate: an imported “on” preference does not grant permission or open a permission prompt. If needed, turn that setting off and on on the receiving device. Old version 1 sound-only exports still merge by sound ID and leave preferences alone. Saved data from the previous app name can also be read on the same origin; compatibility copies are written so older smoke scripts can still inspect their storage keys.

## Run locally

No build step, Node, account, API key or backend is required:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. For static hosting such as GitHub Pages, publish this directory as the site root. Microphone access and AudioWorklet require HTTPS or localhost; opening `index.html` directly as a file will not work. A different device accessing an HTTP LAN address does not get the localhost security exception: use HTTPS there.

Wait for **YAMNet ready**. The first load downloads the pinned model and runtime. Internet access to those hosts is required; download failures show a retry button, and offline availability is not guaranteed. The application installs nothing.

## Try it and test it

Use **Smoke alarm**, **Kettle**, **Knocking**, **Microwave** and **Doorbell**. Samples play audibly through the same audio capture, windowing and recognition pipeline as the microphone; their names never choose an alert. Dismiss alerts with the button or Esc. When several groups match, the timeline records all of them while the overlay favors urgency and then score.

To teach the demo washer, enter a name, choose **Use washer sample** three times, then **Save my sound**. Use **Test** or **Washer tune** to replay it. For real teaching, record three distinct 2.5-second microphone examples or choose local audio examples of 1–15 seconds (at most 12 MB). The saved sound’s similarity slider defaults to 85%. Example replay audio lasts only for the current session and is cleared by import or reload.

**While you were away** appears in a prominent banner at the top of the viewport when you return after the page was hidden or unfocused. It summarizes counts per group for alerts actually detected during that absence, including sample alerts. It is also visible in Station mode, and **Got it** dismisses it. The Recent alerts panel explains where to find it. This is not evidence of continuous background listening; suspended pages cannot detect sounds.

Latest result (2026-10-27, headless Chromium through Python Playwright, real pinned YAMNet model): **16/16 checks passed**. The checks cover the five built-in samples (and that everyday sounds such as the kettle do not raise an urgent smoke alert), teaching and recognizing the washer jingle while not confusing it with the microwave, Station mode entry/exit and API fallbacks, setup export/import, saved data after reload, the external-request allowlist and uncaught errors. These are synthesized fixtures, so they show that the pipeline works, not real-room accuracy.

With Python Playwright and Chromium available:

```sh
python3 tests/smoke_test.py
# Optional visible browser:
python3 tests/smoke_test.py --headed
```

The script starts its own local server, uses the real pinned model, keeps all five recognition checks including knock, teaches and tests the washer, checks complete setup export/import and persistence, checks Station entry/exit through buttons, Esc and the API, checks full-screen or viewport coverage, and checks handled Fullscreen/Wake Lock failures. It also checks the legacy hook, external request allowlist and uncaught browser errors. It uses Chromium’s fake microphone for Station startup; model inference is never mocked. Separate fallback checks deliberately make only the Fullscreen and Wake Lock APIs unavailable or reject. No packages or browsers are installed by the script. Results are printed as a LoudNotice PASS/FAIL table; any failure produces a nonzero exit status.

On the intended device, also check:

- Knock detection, other fixtures and real household sounds at the intended distance and noise level.
- Station mode’s clock, latest alert and per-group counts; alert dismissal; button and Esc exit; screen-awake behavior; return from a hidden tab; microphone denial and disconnection.
- Export on one device, import on another, then reload. Verify taught sounds, enabled groups, sensitivity, vibration, motion and the notification preference. Grant notification permission separately.
- The away banner after an alert occurs while hidden/unfocused. A phone’s locked screen may suspend detection.
- Narrow screens, large text zoom, keyboard focus, screen-reader announcements, reduced motion, vibration and system notifications.

All test sounds are generated by `tools/synth_sounds.py` (Python 3 with NumPy). The knock is two groups of three knocks over four seconds. To regenerate a fixture:

```sh
python3 -c "from tools.synth_sounds import knock, write; write('sounds/knock.wav', knock())"
```

Automation / recording entry point:

```js
await window.loudnotice.ready;
await window.loudnotice.playSample('knock');
console.table(window.loudnotice.events); // { t, group, score, source }
await window.loudnotice.station(true);
await window.loudnotice.station(false);
window.loudnotice === window.soundsense; // true: compatibility alias
```

Sample names: `smoke_alarm`, `doorbell`, `knock`, `microwave`, `kettle`, `washer_tune`. Event sources are `mic`, `sample`, or `taught`; taught sound IDs start with `custom-`. `playSample` resolves after final analysis and leaves any alert open. Browser permission and user-gesture requirements still apply to these hooks. `ready` rejects on model-load failure; retry replaces it with a new promise shared by both names.

## How it works

The browser captures mono microphone audio with echo cancellation, noise suppression and automatic gain control disabled. AudioWorklet, with a ScriptProcessor fallback, supplies one-second windows every half-second at the browser’s actual sample rate. Google’s YAMNet model runs locally through MediaPipe Tasks Audio with `maxResults: 521` and `scoreThreshold: 0`. Silence is excluded from built-in matching; near-silent input is gated. The dashboard displays the top three labels, input level and live spectrum.

Twelve built-in groups cover smoke/fire alarms, doorbells, knocks, appliance beeps, kettle/whistles, sirens, babies crying, dogs barking, glass breaking, phones ringing, running water and clapping. A group’s score is the maximum of its matching labels. **Every built-in group can trigger with one window at least 0.10 above its sensitivity-adjusted threshold**, or with two of the last three windows at/above threshold. Each group has a six-second cooldown. Knock’s balanced threshold is 0.20, so a 0.33 score qualifies immediately. The change does not fabricate detections or change sample-specific behavior.

Taught sounds combine 521 category scores sorted by name with a 32-band frequency profile from a local FFT. The two normalized parts have equal weight, producing 553 numeric features. A prototype averages three examples. Recognition uses cosine similarity, the chosen threshold, a margin of at least 0.03 over the second-best taught sound, and a six-second cooldown. Built-in sensitivity does not change taught thresholds. Up to 50 taught sounds can be saved.

Alerts combine text, icons and color. Urgent alerts have a slow border pulse; reduced-motion preferences make it static. The last 200 alerts are stored locally. Station counts and current absence counts are maintained separately so they are not truncated by the history limit. Model inference is synchronous on the main thread, so older devices may show delays.

## Privacy

Microphone audio is processed locally and never uploaded or saved. Live buffers and teaching replay audio exist only in memory. Stop releases the microphone. Local storage contains preferences, taught numeric fingerprints and labels, and the last 200 alerts. Remove taught sounds, clear history, or clear the site’s browser data to erase saved information. Sound names and alert times may themselves be personal information.

Only the existing three external resource locations are loaded:

- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/audio_bundle.mjs`
- `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/wasm` (runtime dependencies)
- `https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite`

The site host, jsDelivr and Google receive ordinary asset download requests and connection metadata. There are no accounts, analytics, advertising, secrets, paid APIs, remote audio services, service workers or push services. Fullscreen, wake lock and notifications use browser APIs, not additional external services.

## Limitations

This is a prototype. It is not a medical device, not a certified smoke or fire alarm, and not a replacement for existing alarms or accessibility aids. It may miss sounds or false-alarm. There is no validation of real-world false-positive/false-negative rates. Noise, distance, microphones and similar sounds affect results; model confidence and taught similarity are different, uncalibrated scores.

Broad labels overlap: YAMNet can give a whistling kettle a high generic "Alarm" score. LoudNotice lets the smoke group yield when it matched only through that generic label and a sound-specific label (kettle, siren, phone or doorbell) explains the sound at least as well; appliance beeps are deliberately not used for this, because real smoke alarms often score "Beep" and a missed alarm is worse than a false one. A smoke alarm sample can still add an extra "Appliance beep" entry to the history. The single-window rule improves brief-sound responsiveness but may also increase false alarms. Synthetic samples and teaching the same file three times demonstrate the pipeline, not generalization to a home.

Station mode does not guarantee uninterrupted listening or prevent device sleep under all conditions. API support varies, older devices may be slow, and background tabs, locked screens and operating-system power controls can interrupt processing. Check the actual device in the actual room.

## Related work, honestly

Phones already have similar built-in features: iPhone Sound Recognition can also learn a custom alarm, appliance or doorbell (iOS 16 and later), and Android's Sound Notifications with Google's Live Transcribe & Notification app can add custom sounds. Other hackathon projects have explored the same idea. LoudNotice's angle is that it runs in any modern browser, including on a laptop or an old tablet kept in one room (Station mode), needs no account or install, keeps audio on the device, lets a hearing family member prepare and hand over the whole setup as one file, and is open source.

## Sources and credits

- [Google YAMNet](https://github.com/tensorflow/models/tree/master/research/audioset/yamnet): AudioSet sound classification model, Apache-2.0.
- [MediaPipe Tasks Audio](https://ai.google.dev/edge/mediapipe/solutions/audio/audio_classifier/web_js): on-device browser classifier runtime, pinned to 1.1.1; Apache-2.0.
- Synthesized WAV fixtures: original generated sounds from `tools/synth_sounds.py`, no third-party recordings; CC0 1.0, see `sounds/LICENSE`.
- Application code: MIT, see `LICENSE`. Model/runtime licenses are separate.
- YAMNet in TFLite form is published by Google under Apache 2.0 (Kaggle model page `google/yamnet`); LoudNotice loads the MediaPipe-hosted `yamnet.tflite` at runtime, the same file Google's MediaPipe web samples use, and does not redistribute it.
- Demo video narration: synthesized with Kokoro-82M (Apache-2.0), voice `af_heart`. No music. The video was recorded automatically with Playwright; the sounds in it are the synthesized test sounds, played through the app's sample buttons or fed into Chromium as a fake microphone input (Station mode scene).
- Made during NextSpark Hacks 2026 (submission period October 22–27, 2026).

Main files: `index.html` and `styles.css` provide the interface; `js/app.js` connects the controls; `js/station.js` manages Station mode; `js/setup.js` validates complete setups; `js/audio.js` and `js/capture-worklet.js` handle input; `js/classifier.js` and `js/spectrum.js` extract features; `js/groups.js` and `js/custom.js` recognize sounds; `js/alerts.js` manages notifications/history/away summaries; `js/storage.js` reads older saved data.

## How AI tools were used

NextSpark Hacks allows AI tools if their use is explained. LoudNotice was built by one student working heavily with AI tools. To keep the line between AI output and human work clear:

- **Ideas:** two AI models (Anthropic's Claude Fable 5.1 and OpenAI's Codex) proposed project ideas from the public hackathon description only. The ideas were compared against the judging criteria and whether a convincing demo could be recorded. The human author chose LoudNotice from the compared options.
- **Code:** most of the application code and the test script were written by OpenAI Codex (GPT-6 Astra) from a written brief (`docs/BRIEF.md`). Anthropic's Claude Code wrote the brief and the sound synthesis script, ran the browser tests, and found and fixed bugs (a kettle raising a false smoke alarm, a taught sound being shadowed by the generic beep alert, a test timing issue). Notes from the build are in `docs/ai-build-notes/`.
- **Writing and review:** this README and the Devpost text were drafted with Claude and checked against the hackathon rules by other AI models (OpenAI Codex, DeepSeek, Cursor Composer and Mistral).
- **Video:** recorded automatically with Playwright; the narration is synthesized speech (Kokoro-82M), not a human voice.
- **The human author:** decided to enter, pushed to finish and submit within the last day, chose LoudNotice, decided that the repository could be made public by the AI, and uploads the demo video and submits the project on Devpost. The human author did not write the code by hand.
