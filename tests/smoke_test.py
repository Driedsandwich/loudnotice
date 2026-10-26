#!/usr/bin/env python3
"""LoudNotice smoke test. Run on a separate machine with Python Playwright and Chromium already installed.

Serves the repository locally. All detections come from the real pinned YAMNet
model and the real audio pipeline: no classifier mocks or sample-name shortcuts.
This script does not install anything. Exit status is nonzero on any failure.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
from pathlib import Path
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headed", action="store_true", help="Show Chromium while testing")
    parser.add_argument("--timeout", type=int, default=180_000, help="Model startup timeout in ms")
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("FAIL: Python Playwright is required on the test machine. Nothing was installed.")
        return 1

    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    rows: list[tuple[str, bool, str]] = []
    page_errors: list[str] = []
    requests: set[str] = set()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=not args.headed,
                args=["--autoplay-policy=no-user-gesture-required",
                      "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
            )
            try:
                context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
                context.grant_permissions(["microphone", "notifications"], origin=url)
                page = context.new_page()
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("request", lambda request: requests.add(request.url))
                page.set_default_timeout(30_000)
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_function("() => !!window.loudnotice?.ready", timeout=args.timeout)
                page.wait_for_function(
                    "() => document.querySelector('#model-state').textContent.includes('YAMNet ready') || "
                    "!document.querySelector('#retry-model').hidden",
                    timeout=args.timeout,
                )
                page.evaluate("() => window.loudnotice.ready")
                rows.append(("Pinned YAMNet loaded", True, "real model, 521 categories requested"))

                def play(name: str) -> list[dict]:
                    # A timeout also catches an audio graph that never finishes.
                    return page.evaluate(
                        """async name => {
                            const start = window.loudnotice.events.length;
                            let timer;
                            try {
                                await Promise.race([
                                    window.loudnotice.playSample(name),
                                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sample timed out')), 45000); })
                                ]);
                                return window.loudnotice.events.slice(start);
                            } finally { clearTimeout(timer); }
                        }""",
                        name,
                    )

                def check(label, action):
                    try:
                        detail = action()
                        rows.append((label, True, detail or "OK"))
                    except Exception as error:
                        rows.append((label, False, str(error).replace("\n", " ")[:400]))
                    finally:
                        # The overlay remains until dismissed; normal user behavior.
                        page.keyboard.press("Escape")
                        if not page.locator("#error").is_hidden():
                            print("UI diagnostic:", page.locator("#error").inner_text())

                def branding():
                    assert page.title() == "LoudNotice — See the sounds that matter."
                    assert page.evaluate("window.loudnotice === window.soundsense"), "Legacy hook must be the same object"
                    return "LoudNotice title and shared legacy automation alias"

                check("LoudNotice branding and compatibility", branding)

                def builtin(name, expected):
                    detected = play(name)
                    groups = [event["group"] for event in detected]
                    assert any(event["group"] == expected and event["source"] == "sample" for event in detected), (
                        f"Expected {expected}; events={json.dumps(detected)}; "
                        f"last labels={page.locator('#top-labels').inner_text()}"
                    )
                    # A non-urgent everyday sound must not be raised as an urgent alarm.
                    if expected in ("kettle", "knock", "appliance", "doorbell"):
                        assert "smoke" not in groups and "siren" not in groups, f"False urgent alert: {groups}"
                    return f"expected {expected}; detected {', '.join(groups)}"

                for name, expected in [
                    ("kettle", "kettle"),  # first: a fresh smoke cooldown must not hide a false smoke alert
                    ("smoke_alarm", "smoke"),
                    ("knock", "knock"),
                    ("microwave", "appliance"),
                    ("doorbell", "doorbell"),
                ]:
                    check(f"Sample: {name}", lambda n=name, g=expected: builtin(n, g))

                taught_id = None

                def teach():
                    nonlocal taught_id
                    page.locator("#teach-name").fill("My washer is done")
                    for number in range(1, 4):
                        page.locator("#capture-demo").click()
                        page.wait_for_function(
                            "n => document.querySelectorAll('.example-steps .complete').length === n",
                            arg=number,
                            timeout=45_000,
                        )
                    page.locator("#save-sound").click()
                    page.locator(".custom-item").wait_for()
                    stored = page.evaluate("JSON.parse(localStorage.getItem('loudnotice.custom.v1'))")
                    sound = stored["sounds"][0]
                    taught_id = sound["id"]
                    assert len(sound["prototype"]) == 553, "Expected 521 + 32 feature values"
                    assert len(stored["sounds"]) == 1
                    assert page.evaluate("localStorage.getItem('loudnotice.custom.v1') === localStorage.getItem('soundsense.custom.v1')"), "Legacy storage remains readable"
                    assert sound["threshold"] == 0.85
                    assert "audio" not in sound and "samples" not in sound
                    return "3 examples; 553 numeric features; default threshold 0.85"

                check("Teach washer through UI", teach)

                def positive():
                    assert taught_id is not None, "Teaching failed"
                    detected = play("washer_tune")
                    match = next((e for e in detected if e["group"] == taught_id), None)
                    assert match and match["source"] == "taught", f"Washer was not recognized: {detected}"
                    assert match["score"] >= 0.85
                    return f"washer similarity {match['score']:.3f}"

                check("Taught washer: positive", positive)
                # Essential: don't let the 6-second cooldown mask a false match.
                page.wait_for_timeout(6_200)

                def negative():
                    assert taught_id is not None, "Teaching failed"
                    detected = play("microwave")
                    assert not any(event["group"] == taught_id for event in detected), f"Microwave falsely matched washer: {detected}"
                    assert any(event["group"] == "appliance" for event in detected), "Negative control did not traverse the working classifier"
                    return "microwave detected as appliance, not taught washer; cooldown expired"

                check("Taught washer: negative", negative)

                def station_mode():
                    page.locator("#enter-station").click()
                    page.locator("#station").wait_for(state="visible")
                    page.wait_for_function("document.querySelector('#station-state').textContent.startsWith('Listening ·')")
                    assert page.locator("#station-error").is_hidden()
                    assert page.locator("#station-clock").inner_text()
                    assert page.locator(".station-count").count() >= 12
                    assert page.evaluate("""() => {
                        const screen = document.querySelector('#station');
                        const r = screen.getBoundingClientRect();
                        return !!document.fullscreenElement ||
                            (getComputedStyle(screen).position === 'fixed' && Math.abs(r.top) < 1 &&
                             Math.abs(r.left) < 1 && r.width >= innerWidth - 1 && r.height >= innerHeight - 1);
                    }"""), "Station must fill the screen or viewport"
                    page.wait_for_function("document.querySelector('#station-wake').textContent.length > 0 && !document.querySelector('#station-wake').textContent.startsWith('Requesting')")
                    wake_status = page.locator("#station-wake").inner_text()
                    page.locator("#exit-station").click()
                    page.wait_for_function("document.querySelector('#station').hidden && !document.fullscreenElement")
                    assert not page.evaluate("document.querySelector('.shell').inert")
                    event_start = page.evaluate("""async () => {
                        const start = window.loudnotice.events.length;
                        await window.loudnotice.station(true); return start;
                    }""")
                    detected = play("doorbell")
                    assert any(event['group'] == 'doorbell' for event in detected), f"Station sample not detected: {detected}"
                    session_events = page.evaluate("start => window.loudnotice.events.slice(start)", event_start)
                    for group in {event['group'] for event in session_events}:
                        expected = sum(event['group'] == group for event in session_events)
                        assert int(page.locator(f'.station-count[data-group="{group}"] strong').inner_text()) == expected
                    latest = page.evaluate("JSON.parse(localStorage.getItem('loudnotice.history.v1')).at(-1)")
                    assert latest['title'] in page.locator('#station-latest').inner_text()
                    assert page.locator('#alert-dialog').is_visible()
                    page.locator('#dismiss-alert').click()
                    assert page.locator('#station').is_visible(), "Dismissing an alert should return to Station"
                    page.keyboard.press("Escape")
                    page.wait_for_function("document.querySelector('#station').hidden && !document.fullscreenElement")
                    page.evaluate("() => window.loudnotice.station(true)")
                    page.evaluate("() => window.loudnotice.station(false)")
                    page.wait_for_function("document.querySelector('#station').hidden && !document.fullscreenElement")
                    page.locator("#start-stop").click()  # Exit keeps an established microphone session running.
                    assert page.locator("#state-text").inner_text() == "Not listening"
                    return f"button, Esc and API entry/exit; microphone start; real alert, latest and counts; {wake_status}"

                check("Station mode entry and exit", station_mode)

                def station_fallback():
                    # Inject browser capability failures only; audio classification remains real.
                    return page.evaluate("""async () => {
                        const root = document.documentElement;
                        const originalFullscreen = Object.getOwnPropertyDescriptor(root, 'requestFullscreen');
                        const originalWake = Object.getOwnPropertyDescriptor(navigator, 'wakeLock');
                        let calls = 0;
                        try {
                            for (const unavailable of [true, false]) {
                                Object.defineProperty(root, 'requestFullscreen', { configurable: true,
                                    value: unavailable ? undefined : () => Promise.reject(new Error('Fullscreen denied')) });
                                Object.defineProperty(navigator, 'wakeLock', { configurable: true,
                                    value: unavailable ? undefined : { request: async type => {
                                        if (type !== 'screen') throw new Error('Wrong wake lock type');
                                        calls++; throw new Error('Wake lock denied');
                                    } } });
                                await window.loudnotice.station(true);
                                const r = document.querySelector('#station').getBoundingClientRect();
                                if (r.height < innerHeight - 1 || r.width < innerWidth - 1) throw new Error('Fallback is not full viewport');
                                if (!/unavailable|could not/.test(document.querySelector('#station-wake').textContent))
                                    throw new Error('Missing wake lock fallback explanation');
                                await window.loudnotice.station(false);
                            }
                            if (calls !== 1) throw new Error('Expected screen wake lock request');
                            return 'Unavailable and rejected Fullscreen / Wake Lock APIs handled without uncaught errors';
                        } finally {
                            await window.loudnotice.station(false);
                            if (originalFullscreen) Object.defineProperty(root, 'requestFullscreen', originalFullscreen);
                            else delete root.requestFullscreen;
                            if (originalWake) Object.defineProperty(navigator, 'wakeLock', originalWake);
                            else delete navigator.wakeLock;
                            if (document.querySelector('#state-text').textContent === 'Listening live')
                                document.querySelector('#start-stop').click();
                        }
                    }""")

                check("Station mode API fallbacks", station_fallback)
                restored_settings = None

                def setup_roundtrip():
                    nonlocal restored_settings
                    assert taught_id is not None, "Teaching failed"
                    page.locator('#sensitivity').evaluate("el => { el.value = '13'; el.dispatchEvent(new Event('input')); }")
                    page.locator('#enable-knock').uncheck()
                    page.locator('#enable-water').uncheck()
                    page.locator('#vibration').uncheck()
                    page.locator('#reduced-motion').check()
                    page.locator('#notifications').check()
                    page.wait_for_function("JSON.parse(localStorage.getItem('loudnotice.settings.v1')).notifications === true")
                    card = page.locator(f'[data-sound-id="{taught_id}"]')
                    card.locator('input[type="checkbox"]').uncheck()
                    card.locator('input[type="range"]').evaluate("el => { el.value = '91'; el.dispatchEvent(new Event('input')); }")
                    with page.expect_download() as download_info:
                        page.get_by_role('button', name='Export setup', exact=True).click()
                    download = download_info.value
                    assert download.suggested_filename == 'loudnotice-setup.json'
                    payload = Path(download.path()).read_bytes()
                    exported = json.loads(payload)
                    assert exported['app'] == 'LoudNotice' and exported['version'] == 2
                    assert set(exported) == {'app', 'version', 'featureFormat', 'sounds', 'settings'}
                    assert len(exported['sounds']) == 1
                    sound = exported['sounds'][0]
                    assert set(sound) == {'id', 'title', 'icon', 'color', 'threshold', 'enabled', 'prototype', 'urgency'}
                    assert len(sound['prototype']) == 553 and all(isinstance(v, (int, float)) for v in sound['prototype'])
                    assert sound['threshold'] == .91 and sound['enabled'] is False
                    restored_settings = exported['settings']
                    assert restored_settings == page.evaluate("JSON.parse(localStorage.getItem('loudnotice.settings.v1'))")
                    card.get_by_role('button', name=f'Remove {sound["title"]}', exact=True).click()
                    page.locator('#sensitivity').evaluate("el => { el.value = '0'; el.dispatchEvent(new Event('input')); }")
                    for selector in ('#enable-knock', '#enable-water', '#vibration'):
                        page.locator(selector).check()
                    page.locator('#reduced-motion').uncheck()
                    page.locator('#notifications').uncheck()
                    with page.expect_file_chooser() as chooser_info:
                        page.get_by_role('button', name='Import setup', exact=True).click()
                    chooser_info.value.set_files({'name': 'setup.json', 'mimeType': 'application/json', 'buffer': payload})
                    page.wait_for_function("document.querySelector('#setup-status').textContent.includes('all preferences')")
                    assert page.evaluate("JSON.parse(localStorage.getItem('loudnotice.custom.v1')).sounds") == exported['sounds']
                    assert page.evaluate("JSON.parse(localStorage.getItem('loudnotice.settings.v1'))") == restored_settings
                    assert page.locator('#sensitivity').input_value() == '13'
                    assert not page.locator('#enable-knock').is_checked()
                    assert not page.locator('#enable-water').is_checked()
                    assert not page.locator('#vibration').is_checked()
                    assert page.locator('#notifications').is_checked()
                    assert page.locator('#reduced-motion').is_checked()
                    assert page.evaluate("document.documentElement.classList.contains('reduce-motion')")
                    assert card.locator('input[type="range"]').input_value() == '91'
                    assert not card.locator('input[type="checkbox"]').is_checked()
                    assert card.locator('.custom-test').is_disabled()
                    # Malformed preferences must not partially replace the valid taught sounds.
                    invalid = {**exported, 'sounds': [], 'settings': {**restored_settings, 'offset': 'bad'}}
                    page.locator('#import-file').set_input_files({'name': 'invalid.json', 'mimeType': 'application/json',
                                                                 'buffer': json.dumps(invalid).encode()})
                    page.wait_for_function("document.querySelector('#error').textContent.includes('Invalid setup preferences')")
                    assert page.evaluate("JSON.parse(localStorage.getItem('loudnotice.custom.v1')).sounds") == exported['sounds']
                    assert page.evaluate("JSON.parse(localStorage.getItem('loudnotice.settings.v1'))") == restored_settings
                    page.evaluate("document.querySelector('#error').hidden = true")
                    return 'Downloaded v2 JSON restores all fingerprints and preferences; invalid file leaves both intact; no audio'

                check("Export / import complete setup", setup_roundtrip)

                def persistence():
                    assert taught_id is not None, "Teaching failed"
                    page.reload(wait_until="domcontentloaded")
                    page.wait_for_function("window.loudnotice && window.loudnotice.ready")
                    page.evaluate("window.loudnotice.ready")
                    page.locator(f'[data-sound-id="{taught_id}"]').scroll_into_view_if_needed()
                    page.locator(f'[data-sound-id="{taught_id}"]').wait_for()
                    assert page.locator(f'[data-sound-id="{taught_id}"] .custom-test').is_disabled()
                    assert restored_settings is not None, "Setup roundtrip failed"
                    assert page.evaluate("JSON.parse(localStorage.getItem('loudnotice.settings.v1'))") == restored_settings
                    assert page.locator('#sensitivity').input_value() == '13'
                    assert page.locator('#reduced-motion').is_checked()
                    return "fingerprint and preferences restored; replay correctly unavailable after reload"

                check("Numeric-only persistence", persistence)
                allowed = (
                    url,
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.1.1/",
                    "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite",
                    "data:", "blob:",
                )
                unexpected = sorted(request for request in requests if not request.startswith(allowed))
                rows.append(("External request allowlist", not unexpected, ", ".join(unexpected) or "only local assets and pinned MediaPipe / YAMNet"))
                rows.append(("Uncaught browser errors", not page_errors, "; ".join(page_errors) or "none"))
            finally:
                browser.close()
    except Exception as error:
        rows.append(("Browser / model setup", False, str(error).replace("\n", " ")[:500]))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    print("\nLoudNotice smoke test")
    print("\n| Check | Result | Detail |")
    print("| --- | --- | --- |")
    for name, passed, detail in rows:
        safe_detail = detail.replace("|", "/")
        print(f"| {name} | {'PASS' if passed else 'FAIL'} | {safe_detail} |")
    failed = sum(not passed for _, passed, _ in rows)
    print(f"\n{len(rows) - failed}/{len(rows)} passed. Real-model recognition is probabilistic.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
