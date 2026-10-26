import { readStored, writeStored } from './storage.js';
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export class Alerts {
  constructor(settings, events, onWarning) {
    this.settings = settings; this.events = events; this.onWarning = onWarning;
    this.dialog = document.querySelector('#alert-dialog'); this.history = [];
    this.awayCounts = new Map();
    this.awaySince = document.hidden || !document.hasFocus() ? Date.now() : null;
    try {
      const stored = JSON.parse(readStored('loudnotice.history.v1') || '[]');
      if (!Array.isArray(stored)) throw new Error();
      this.history = stored.filter(e => e && Number.isFinite(e.t) && Number.isFinite(e.score) && e.score >= 0 && e.score <= 1 &&
        typeof e.title === 'string' && typeof e.icon === 'string' && typeof e.group === 'string' && ['mic', 'sample', 'taught'].includes(e.source)).slice(-200);
    } catch { onWarning('Saved history could not be read. New alerts will still appear here.'); }
    document.querySelector('#dismiss-alert').addEventListener('click', () => this.dismiss());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.dismiss(); });
    window.addEventListener('blur', () => this.leave());
    window.addEventListener('focus', () => this.returned());
    document.addEventListener('visibilitychange', () => document.hidden ? this.leave() : this.returned());
    document.querySelector('#clear-history').addEventListener('click', () => {
      this.history = []; this.awayCounts.clear(); this.persist(); this.render(); document.querySelector('#away-summary').hidden = true;
    });
    document.querySelector('#dismiss-away').addEventListener('click', () => { document.querySelector('#away-summary').hidden = true; });
    this.render();
  }
  persist() {
    try { writeStored('loudnotice.history.v1', JSON.stringify(this.history)); }
    catch { this.onWarning('History cannot be saved in this browser. It is available until you close the page.'); }
  }
  leave() { if (this.awaySince === null) this.awaySince = Date.now(); }
  returned() {
    if (document.hidden || this.awaySince === null) return;
    const counts = this.awayCounts; this.awayCounts = new Map();
    this.awaySince = null;
    if (counts.size) {
      document.querySelector('#away-text').textContent = [...counts.values()].map(({ title, count }) => `${title}: ${count}`).join(' · ');
      this.dismiss(); // Reveal the return summary instead of leaving a stale alert over it.
      document.querySelector('#away-summary').hidden = false;
    }
  }
  fire(matches, inputSource) {
    if (!matches.length) return;
    const now = Date.now();
    for (const match of matches) {
      const source = match.id.startsWith('custom-') ? 'taught' : inputSource;
      const entry = { t: now, group: match.id, title: match.title, icon: match.icon, score: match.score, source, inputSource };
      this.events.push({ t: now, group: match.id, score: match.score, source });
      this.history.push(entry);
      if (this.awaySince !== null) {
        const count = (this.awayCounts.get(entry.group)?.count || 0) + 1;
        this.awayCounts.set(entry.group, { title: entry.title, count });
      }
      this.onEvent?.(entry);
    }
    this.history = this.history.slice(-200); this.persist(); this.render();
    const match = [...matches].sort((a, b) => b.urgency - a.urgency || b.score - a.score)[0];
    if (this.active && this.active.urgency > match.urgency) return;
    this.active = match;
    this.dialog.style.setProperty('--alert-color', match.color);
    const channels = [1, 3, 5].map(i => parseInt(match.color.slice(i, i + 2), 16) / 255)
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    this.dialog.style.setProperty('--alert-ink', luminance > .2 ? '#101b22' : '#ffffff');
    this.dialog.classList.toggle('urgent', match.urgency >= 2);
    document.querySelector('#alert-icon').textContent = match.icon;
    document.querySelector('#alert-title').textContent = match.title;
    document.querySelector('#alert-priority').textContent = match.urgency >= 2 ? 'Urgent sound detected' : 'Sound detected';
    document.querySelector('#alert-meta').textContent = `${Math.round(match.score * 100)}% ${match.id.startsWith('custom-') ? 'similarity' : 'model confidence'} · ${timeFormat.format(now)} · ${inputSource === 'mic' ? 'Microphone' : 'Test sample'}`;
    document.querySelector('#alert-live').textContent = `${match.urgency >= 2 ? 'Urgent: ' : ''}${match.title}. ${Math.round(match.score * 100)} percent.`;
    document.title = `${match.icon} ${match.title} — LoudNotice`;
    if (!this.dialog.open) { this.returnFocus = document.activeElement; this.dialog.showModal(); document.querySelector('#dismiss-alert').focus(); }
    if (this.settings.vibration && navigator.vibrate) { try { navigator.vibrate(match.urgency >= 2 ? [250, 150, 250, 150, 500] : [200, 100, 200]); } catch {} }
    if (this.settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(`LoudNotice: ${match.title}`, { body: 'A sound may need your attention. Check your surroundings.', tag: 'loudnotice-alert', silent: true }); }
      catch { this.onWarning('System notifications are unavailable here. Visual alerts still work.'); }
    }
  }
  dismiss() {
    this.active = null;
    if (this.dialog.open) this.dialog.close();
    document.title = 'LoudNotice — See the sounds that matter.';
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch {} }
    this.returnFocus?.focus();
  }
  render() {
    const list = document.querySelector('#history-list'); list.replaceChildren();
    document.querySelector('#history-count').textContent = String(this.history.length);
    document.querySelector('#clear-history').disabled = !this.history.length;
    if (!this.history.length) { list.append(element('li', 'empty-state', 'A little quieter here. Detected sounds will appear in your timeline.')); return; }
    for (const event of [...this.history].reverse()) {
      const row = element('li', 'history-row'), icon = element('span', 'history-icon', event.icon);
      icon.setAttribute('aria-hidden', 'true');
      const detail = element('div', 'history-detail'); detail.append(element('strong', '', event.title), element('span', 'muted', `${event.source === 'taught' ? 'Taught sound' : event.source === 'mic' ? 'Microphone' : 'Test sample'} · ${Math.round(event.score * 100)}%`));
      const time = element('time', '', timeFormat.format(event.t)); time.dateTime = new Date(event.t).toISOString(); time.title = new Date(event.t).toLocaleString();
      row.append(icon, detail, time); list.append(row);
    }
  }
}
