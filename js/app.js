import { Classifier } from './classifier.js';
import { AudioPipeline } from './audio.js';
import { GROUPS, GroupMatcher } from './groups.js';
import { CustomSounds } from './custom.js';
import { Alerts, element } from './alerts.js';
import { drawSpectrum } from './spectrum.js';

const $ = selector => document.querySelector(selector);
function warn(message) { $('#storage-warning').textContent = message; $('#storage-warning').hidden = false; }
function showError(error) {
  const messages = { NotAllowedError: 'Microphone permission was denied. Allow it in your browser settings, or try the samples below.', NotFoundError: 'No microphone was found. You can still try the bundled samples.', NotReadableError: 'The microphone is busy or unavailable. Close other apps using it and try again.' };
  $('#error').textContent = messages[error.name] || error.message || String(error); $('#error').hidden = false;
}
function clearError() { $('#error').hidden = true; }
const settings = { offset: 0, enabled: Object.fromEntries(GROUPS.map(g => [g.id, true])), vibration: true, notifications: false, reducedMotion: false };
try {
  const saved = JSON.parse(localStorage.getItem('soundsense.settings.v1') || '{}');
  if (typeof saved.offset === 'number' && Number.isFinite(saved.offset)) settings.offset = Math.max(-.2, Math.min(.2, saved.offset));
  for (const key of ['vibration', 'notifications', 'reducedMotion']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  for (const group of GROUPS) if (typeof saved.enabled?.[group.id] === 'boolean') settings.enabled[group.id] = saved.enabled[group.id];
} catch { warn('Saved preferences could not be read. Using the default settings.'); }
function saveSettings() {
  try { localStorage.setItem('soundsense.settings.v1', JSON.stringify(settings)); }
  catch { warn('Preferences cannot be saved in this browser. They will last for this session.'); }
}
const events = [], classifier = new Classifier(), matcher = new GroupMatcher();
const custom = new CustomSounds(warn), alerts = new Alerts(settings, events, warn);
let modelLoaded = false, modelLoading = false, teachingBusy = false, pendingInput = false, inputToken = 0;
let examples = [], replay = null, stopDrawing = null;
const audio = new AudioPipeline(processWindow, updateAudioState, showError);

function processWindow(samples, sampleRate, source) {
  if (!modelLoaded) return;
  const result = classifier.window(samples, sampleRate);
  const top = [...result.labels].sort((a, b) => b[1] - a[1]).slice(0, 3);
  $('#top-labels').replaceChildren(...top.map(([label, score]) => element('li', '', `${label} · ${Math.round(score * 100)}%`)));
  if (teachingBusy) return;
  const builtins = matcher.match(result.level > .003 ? result.labels : new Map(), settings);
  const taught = result.level > .003 ? custom.match(result.feature) : [];
  alerts.fire([...builtins, ...taught], source);
}
function updateControls() {
  const running = Boolean(audio.mode) || pendingInput;
  $('#start-stop').disabled = !modelLoaded && !running;
  $('#start-text').textContent = pendingInput ? 'Cancel' : audio.mode ? 'Stop listening' : modelLoaded ? 'Start listening' : 'Loading model…';
  $('#start-icon').textContent = running ? '■' : '▶';
  document.querySelectorAll('[data-sample]').forEach(button => { button.disabled = !modelLoaded || pendingInput || teachingBusy || Boolean(audio.mode); });
  for (const selector of ['#capture-mic', '#capture-demo', '#capture-file']) $(selector).disabled = !modelLoaded || teachingBusy || pendingInput || examples.length >= 3;
  $('#save-sound').disabled = examples.length !== 3 || teachingBusy;
  $('#reset-teach').disabled = teachingBusy;
  document.querySelectorAll('.custom-test').forEach(button => { button.disabled = !modelLoaded || teachingBusy || pendingInput || Boolean(audio.mode) || !custom.replays.has(button.dataset.id); });
}
function updateAudioState(mode, message) {
  stopDrawing?.(); stopDrawing = null;
  $('#listen-state').classList.toggle('active', Boolean(mode));
  $('#state-text').textContent = mode === 'mic' ? 'Listening live' : mode === 'sample' ? 'Playing sample' : 'Not listening';
  $('#visual-caption').hidden = Boolean(mode);
  $('#listen-help').textContent = message || (mode === 'mic' ? 'Listening on this device. Stop to release the microphone.' : mode === 'sample' ? 'Test audio is playing through the same recognition pipeline.' : 'Microphone access is requested only when you start.');
  if (mode && audio.analyser) stopDrawing = drawSpectrum(audio.analyser, $('#spectrogram'), $('#level'));
  else {
    matcher.resetWindows(); $('#level').value = 0;
    document.querySelectorAll('[data-sample]').forEach(button => button.classList.remove('playing'));
  }
  updateControls();
}
function stopInput() { inputToken++; pendingInput = false; audio.stop(); }
async function startMic() {
  if (pendingInput) throw new Error('An audio request is already in progress.');
  pendingInput = true; const token = ++inputToken; updateControls();
  try { await audio.unlock(); await window.soundsense.ready; if (token !== inputToken) return; await audio.startMic(); }
  finally { if (token === inputToken) { pendingInput = false; updateControls(); } }
}
async function playSample(name) {
  if (teachingBusy || pendingInput) throw new Error('Finish the current capture or audio request first.');
  clearError(); alerts.dismiss();
  pendingInput = true; const token = ++inputToken; updateControls();
  try {
    await audio.unlock(); await window.soundsense.ready;
    const buffer = await audio.sample(name);
    if (token !== inputToken) return;
    pendingInput = false;
    const playing = audio.playBuffer(buffer);
    $(`[data-sample="${name}"]`)?.classList.add('playing');
    await playing;
  } finally { if (token === inputToken) { pendingInput = false; updateControls(); } }
}
window.soundsense = { ready: null, playSample, events };
function loadModel() {
  if (modelLoading) return;
  modelLoading = true; $('#retry-model').hidden = true; $('#model-state').textContent = 'Downloading YAMNet + MediaPipe. First load may take a moment…';
  const ready = classifier.load().then(() => {
    modelLoaded = true; $('#model-state').textContent = '✓ YAMNet ready · processing stays on this device'; updateControls();
  }).catch(error => {
    modelLoaded = false; $('#model-state').textContent = 'Model download failed. Check your connection and retry.';
    $('#retry-model').hidden = false; $('#start-text').textContent = 'Model unavailable'; showError(new Error(`Recognition could not start: ${error.message}`)); throw error;
  }).finally(() => { modelLoading = false; });
  window.soundsense.ready = ready; ready.catch(() => {});
}
$('#retry-model').addEventListener('click', () => { clearError(); loadModel(); });
$('#start-stop').addEventListener('click', async () => {
  clearError();
  if (audio.mode || pendingInput) { stopInput(); return; }
  try { await startMic(); } catch (error) { showError(error); }
});
document.querySelectorAll('[data-sample]').forEach(button => button.addEventListener('click', () => playSample(button.dataset.sample).catch(showError)));

function updateExamples(message) {
  for (let i = 1; i <= 3; i++) {
    const step = $(`#example-${i}`); step.classList.toggle('complete', i <= examples.length);
    step.replaceChildren(document.createTextNode(i <= examples.length ? '✓ ' : `${i} `), element('span', '', i <= examples.length ? 'Captured' : 'Capture'));
  }
  $('#teach-progress').textContent = message || `${examples.length} of 3 examples ready. ${examples.length === 3 ? 'Name your sound and save it.' : 'Capture the same sound again.'}`;
  updateControls();
}
async function captureExample(kind, file) {
  if (teachingBusy || pendingInput || examples.length >= 3) return;
  clearError(); teachingBusy = true; alerts.dismiss(); updateControls();
  $('#teach-progress').textContent = kind === 'mic' ? 'Getting the microphone ready…' : 'Analyzing the example on your device…';
  try {
    await audio.unlock(); await window.soundsense.ready;
    let samples, sampleRate, buffer;
    if (kind === 'mic') {
      if (audio.mode !== 'mic') await startMic();
      if (audio.mode !== 'mic') throw new Error('Microphone request cancelled.');
      $('#teach-progress').textContent = 'Recording for 2.5 seconds — make your sound now.';
      ({ samples, sampleRate } = await audio.captureExample());
      buffer = audio.context.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0);
      $('#teach-progress').textContent = 'Creating a numeric fingerprint…';
    } else {
      stopInput(); buffer = kind === 'file' ? await audio.file(file) : await audio.sample('washer_tune');
      samples = audio.mono(buffer); sampleRate = buffer.sampleRate;
    }
    const feature = await classifier.example(samples, sampleRate);
    examples.push(feature); replay = buffer;
    updateExamples();
  } catch (error) { showError(error); updateExamples('Example not captured. Try again when ready.'); }
  finally { teachingBusy = false; matcher.resetWindows(); updateControls(); }
}
$('#capture-mic').addEventListener('click', () => captureExample('mic'));
$('#capture-demo').addEventListener('click', () => captureExample('demo'));
$('#capture-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = ''; if (file) captureExample('file', file);
});
$('#reset-teach').addEventListener('click', () => { examples = []; replay = null; updateExamples('Examples cleared. Capture three examples of the same sound.'); });
$('#teach-form').addEventListener('submit', event => {
  event.preventDefault(); clearError();
  try {
    const sound = custom.add({ title: $('#teach-name').value, icon: $('#teach-icon').value, color: $('#teach-color').value }, examples, replay);
    examples = []; replay = null; $('#teach-name').value = ''; renderCustom(); updateExamples(`Saved “${sound.title}”. Use Test to replay your example.`);
  } catch (error) { showError(error); }
});
function renderCustom() {
  const list = $('#custom-list'); list.replaceChildren();
  $('#export-sounds').disabled = !custom.sounds.length;
  if (!custom.sounds.length) { list.append(element('p', 'custom-empty', 'An alert that feels like home. Your first taught sound will live here.')); return; }
  for (const sound of custom.sounds) {
    const card = element('div', 'custom-item'); card.style.setProperty('--sound-color', sound.color); card.dataset.soundId = sound.id;
    const top = element('div', 'custom-top'), icon = element('span', 'custom-icon', sound.icon); icon.setAttribute('aria-hidden', 'true');
    const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = sound.enabled; enabled.setAttribute('aria-label', `Enable ${sound.title}`);
    enabled.addEventListener('change', () => { sound.enabled = enabled.checked; custom.save(); });
    top.append(icon, element('strong', '', sound.title), enabled);
    const label = element('label', 'slider-label', 'Similarity threshold'); label.htmlFor = `${sound.id}-threshold`;
    const output = element('output', '', `${Math.round(sound.threshold * 100)}%`); output.htmlFor = `${sound.id}-threshold`; label.append(output);
    const slider = element('input'); slider.type = 'range'; slider.min = '50'; slider.max = '99'; slider.step = '1'; slider.value = String(Math.round(sound.threshold * 100)); slider.id = `${sound.id}-threshold`;
    slider.addEventListener('input', () => { sound.threshold = Number(slider.value) / 100; output.textContent = `${slider.value}%`; custom.save(); });
    const bottom = element('div', 'custom-bottom'), test = element('button', 'text-button custom-test', '▶ Test'); test.dataset.id = sound.id;
    test.disabled = !custom.replays.has(sound.id) || !modelLoaded;
    test.title = custom.replays.has(sound.id) ? 'Replay the last example through recognition' : 'Example audio is not stored. Play the original sound or teach again to test.';
    test.addEventListener('click', async () => {
      clearError(); alerts.dismiss();
      try { await audio.unlock(); await audio.playBuffer(custom.replays.get(sound.id)); } catch (error) { showError(error); }
    });
    const remove = element('button', 'text-button', 'Remove'); remove.setAttribute('aria-label', `Remove ${sound.title}`);
    remove.addEventListener('click', () => { custom.remove(sound.id); renderCustom(); }); bottom.append(test, remove);
    card.append(top, label, slider, bottom);
    if (!custom.replays.has(sound.id)) card.append(element('p', 'helper', 'Test audio is session-only. Play the original sound, or teach again to create a replay.'));
    list.append(card);
  }
  updateControls();
}
$('#export-sounds').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(custom.data(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = 'soundsense-sounds.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#import-sounds').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  clearError();
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a SoundSense JSON file smaller than 2 MB.');
    const count = custom.import(JSON.parse(await file.text())); renderCustom(); $('#teach-progress').textContent = `Imported ${count} sound${count === 1 ? '' : 's'}. Test with the original sound; recordings are not included.`;
  } catch (error) { showError(error); }
});

$('#sensitivity').value = String(Math.round(-settings.offset * 100));
function sensitivityText() {
  const value = Number($('#sensitivity').value);
  $('#sensitivity-value').textContent = value === 0 ? 'Balanced' : value > 0 ? `More sensitive +${value}` : `Less sensitive ${value}`;
}
sensitivityText();
$('#sensitivity').addEventListener('input', () => { settings.offset = -Number($('#sensitivity').value) / 100; matcher.resetWindows(); sensitivityText(); saveSettings(); });
for (const group of GROUPS) {
  const label = element('label', 'group-toggle'), icon = element('span', '', group.icon); icon.setAttribute('aria-hidden', 'true');
  const title = element('span', 'group-label', group.title); if (group.urgency >= 2) title.append(element('span', 'urgent-label', 'Urgent'));
  const input = element('input'); input.type = 'checkbox'; input.checked = settings.enabled[group.id]; input.id = `enable-${group.id}`;
  input.addEventListener('change', () => { settings.enabled[group.id] = input.checked; matcher.resetWindows(); saveSettings(); });
  label.append(icon, title, input); $('#group-settings').append(label);
}
$('#vibration').checked = settings.vibration;
$('#vibration').addEventListener('change', () => { settings.vibration = $('#vibration').checked; saveSettings(); });
$('#reduced-motion').checked = settings.reducedMotion;
document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion);
$('#reduced-motion').addEventListener('change', () => { settings.reducedMotion = $('#reduced-motion').checked; document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion); saveSettings(); });
if (!('Notification' in window)) {
  settings.notifications = false; $('#notifications').disabled = true; $('#notification-help').textContent = 'Not supported here; visual alerts are always available';
} else if (Notification.permission !== 'granted') settings.notifications = false;
$('#notifications').checked = settings.notifications;
$('#notifications').addEventListener('change', async () => {
  clearError();
  if (!$('#notifications').checked) { settings.notifications = false; saveSettings(); return; }
  try {
    const permission = await Notification.requestPermission(); settings.notifications = permission === 'granted';
    $('#notifications').checked = settings.notifications;
    $('#notification-help').textContent = settings.notifications ? 'Enabled while this page is running' : 'Permission not granted; visual alerts still work'; saveSettings();
  } catch (error) { settings.notifications = false; $('#notifications').checked = false; showError(error); }
});
window.addEventListener('pagehide', () => { stopInput(); custom.replays.clear(); replay = null; examples = []; });
window.addEventListener('pageshow', event => { if (event.persisted) { renderCustom(); updateExamples('Capture three examples of the same sound.'); } });
renderCustom(); loadModel();
