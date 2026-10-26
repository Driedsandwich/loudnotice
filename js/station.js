import { GROUPS } from './groups.js';
import { element } from './alerts.js';

const $ = selector => document.querySelector(selector);
const clockFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });

export class Station {
  constructor({ audio, start, cancelPending, sounds, latest, dismiss }) {
    Object.assign(this, { audio, start, cancelPending, sounds, latest, dismiss });
    this.active = false; this.session = 0; this.counts = new Map();
    this.screen = $('#station'); this.wake = null; this.wakeRequest = null;
    this.summaryHome = document.createComment('Away summary home');
    $('#away-summary').before(this.summaryHome);
    $('#enter-station').addEventListener('click', () => { void this.set(true); });
    $('#exit-station').addEventListener('click', () => { void this.set(false); });
    document.addEventListener('keydown', event => {
      if (!this.active) return;
      if (event.key === 'Escape') {
        event.preventDefault(); this.dismiss(); void this.set(false);
      } else if (event.key === 'Tab' && !$('#alert-dialog').open) {
        const buttons = [...this.screen.querySelectorAll('button')].filter(button => button.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === document.documentElement) this.fullscreen = true;
      else if (this.fullscreen) { this.fullscreen = false; if (this.active) void this.set(false); }
    });
    document.addEventListener('visibilitychange', () => {
      if (this.active && !document.hidden) { this.tick(); void this.requestWake(); }
    });
    window.addEventListener('pagehide', () => { void this.set(false); });
  }
  state() {
    if (!this.active) return;
    $('#station-state').textContent = this.starting ? 'Starting listening…' : this.audio.context?.state === 'suspended' ? 'Listening paused — exit and restart listening' :
      this.audio.mode === 'mic' ? 'Listening · on this device' : this.audio.mode === 'sample' ? 'Playing a test sample' : 'Not listening';
    $('#station-state').classList.toggle('active', this.audio.mode === 'mic' && this.audio.context?.state === 'running');
  }
  tick() {
    const now = new Date(); $('#station-clock').textContent = clockFormat.format(now);
    $('#station-clock').dateTime = now.toISOString(); $('#station-date').textContent = dateFormat.format(now);
    this.state();
  }
  record(entry) {
    if (!this.active) return;
    const current = this.counts.get(entry.group) || { title: entry.title, icon: entry.icon, count: 0 };
    current.count++; this.counts.set(entry.group, current); this.renderLatest(entry); this.renderCounts();
  }
  renderLatest(entry) {
    $('#station-latest').textContent = entry ? `${entry.icon} ${entry.title} · ${new Date(entry.t).toLocaleTimeString('en')}` : 'No alerts yet. Your soundscape starts here.';
  }
  renderCounts() {
    $('#station-counts').replaceChildren(...[...this.counts].map(([id, group]) => {
      const tile = element('div', 'station-count');
      tile.dataset.group = id;
      tile.append(element('strong', '', String(group.count)), element('span', '', `${group.icon} ${group.title}`));
      return tile;
    }));
  }
  async requestWake() {
    if (!this.active || document.hidden || this.wake || this.wakeRequest) return;
    if (!navigator.wakeLock?.request) {
      $('#station-wake').textContent = 'Screen wake lock is unavailable here. Adjust this device’s screen timeout.'; return;
    }
    const session = this.session;
    const request = (async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!this.active || session !== this.session) { await lock.release(); return; }
        this.wake = lock; $('#station-wake').textContent = 'Screen stays awake while this page is visible.';
        lock.addEventListener('release', () => {
          if (this.wake !== lock) return;
          this.wake = null;
          if (this.active) $('#station-wake').textContent = 'Screen wake lock was released. This device may dim or sleep.';
        });
      } catch {
        if (this.active && session === this.session) $('#station-wake').textContent = 'Screen wake lock could not be enabled. This device may dim or sleep.';
      }
    })();
    this.wakeRequest = request;
    await request;
    if (this.wakeRequest === request) this.wakeRequest = null;
    if (this.active && session !== this.session) void this.requestWake();
  }
  async set(enabled) {
    if (Boolean(enabled) === this.active) return this.active;
    this.active = Boolean(enabled); const session = ++this.session;
    if (!this.active) {
      clearInterval(this.timer); this.cancelPending(); this.dismiss();
      this.screen.hidden = true; document.body.classList.remove('station-active');
      $('.shell').inert = false; this.summaryHome.after($('#away-summary'));
      const lock = this.wake; this.wake = null;
      if (lock) { try { await lock.release(); } catch {} }
      if (session === this.session && document.fullscreenElement === document.documentElement) {
        try { await document.exitFullscreen(); } catch {}
      }
      if (!this.active) this.returnFocus?.focus();
      return false;
    }
    this.returnFocus = document.activeElement; this.dismiss();
    this.starting = false;
    this.screen.prepend($('#away-summary')); $('.shell').inert = true;
    this.screen.hidden = false; document.body.classList.add('station-active');
    $('#station-error').hidden = true;
    this.counts = new Map([...GROUPS, ...this.sounds()].map(group => [group.id, { title: group.title, icon: group.icon, count: 0 }]));
    this.renderLatest(this.latest()); this.renderCounts(); this.tick();
    this.timer = setInterval(() => this.tick(), 1000); $('#exit-station').focus();
    $('#station-fullscreen').textContent = 'Display fills this browser window.';
    $('#station-wake').textContent = 'Requesting screen wake lock…';
    // Request during the button gesture; fullscreen the root so alert dialogs stay visible.
    const fullscreen = (async () => {
      try {
        if (!document.documentElement.requestFullscreen) return;
        await document.documentElement.requestFullscreen();
        if (!this.active) { if (document.fullscreenElement) await document.exitFullscreen(); return; }
        if (session === this.session) $('#station-fullscreen').textContent = 'Fullscreen · press Esc or use Exit Station mode to leave.';
      } catch { /* The fixed viewport display remains available without fullscreen permission. */ }
    })();
    void this.requestWake();
    try {
      if (!this.audio.mode) { this.starting = true; this.state(); await this.start(); }
    } catch (error) {
      if (this.active && session === this.session) {
        $('#station-error').textContent = `${error.message || error}. Exit Station mode to retry or try a sample.`;
        $('#station-error').hidden = false;
      }
    } finally { if (session === this.session) this.starting = false; }
    await fullscreen;
    if (this.active && session === this.session) this.state();
    return this.active;
  }
}
