#!/usr/bin/env python3
"""Run on a separate machine with Python Playwright and Chromium already installed.

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
                args=["--autoplay-policy=no-user-gesture-required"],
            )
            try:
                context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
                page = context.new_page()
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on("request", lambda request: requests.add(request.url))
                page.set_default_timeout(30_000)
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_function("() => !!window.soundsense?.ready", timeout=args.timeout)
                page.wait_for_function(
                    "() => document.querySelector('#model-state').textContent.includes('YAMNet ready') || "
                    "!document.querySelector('#retry-model').hidden",
                    timeout=args.timeout,
                )
                page.evaluate("() => window.soundsense.ready")
                rows.append(("Pinned YAMNet loaded", True, "real model, 521 categories requested"))

                def play(name: str) -> list[dict]:
                    # A timeout also catches an audio graph that never finishes.
                    return page.evaluate(
                        """async name => {
                            const start = window.soundsense.events.length;
                            let timer;
                            try {
                                await Promise.race([
                                    window.soundsense.playSample(name),
                                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sample timed out')), 45000); })
                                ]);
                                return window.soundsense.events.slice(start);
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

                def builtin(name, expected):
                    detected = play(name)
                    groups = [event["group"] for event in detected]
                    assert any(event["group"] == expected and event["source"] == "sample" for event in detected), (
                        f"Expected {expected}; events={json.dumps(detected)}; "
                        f"last labels={page.locator('#top-labels').inner_text()}"
                    )
                    return f"expected {expected}; detected {', '.join(groups)}"

                for name, expected in [
                    ("smoke_alarm", "smoke"),
                    ("kettle", "kettle"),
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
                    stored = page.evaluate("JSON.parse(localStorage.getItem('soundsense.custom.v1'))")
                    sound = stored["sounds"][0]
                    taught_id = sound["id"]
                    assert len(sound["prototype"]) == 553, "Expected 521 + 32 feature values"
                    assert len(stored["sounds"]) == 1
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

                def persistence():
                    assert taught_id is not None, "Teaching failed"
                    page.reload(wait_until="domcontentloaded")
                    page.locator(f'[data-sound-id="{taught_id}"]').wait_for()
                    assert page.locator(f'[data-sound-id="{taught_id}"] .custom-test').is_disabled()
                    return "fingerprint restored; replay correctly unavailable after reload"

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
