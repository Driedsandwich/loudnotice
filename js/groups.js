// Names follow YAMNet's AudioSet labels; aliases cover the brief's household terms.
export const GROUPS = [
  { id: 'smoke', title: 'Smoke / fire alarm', icon: '🔥', color: '#ff8a80', urgency: 3, threshold: .30, labels: ['Smoke detector, smoke alarm', 'Fire alarm', 'Alarm', 'Buzzer'] },
  { id: 'doorbell', title: 'Doorbell / bell', icon: '🔔', color: '#b4a1fa', urgency: 1, threshold: .18, labels: ['Doorbell', 'Ding-dong', 'Ding', 'Bell', 'Chime', 'Jingle bell'] },
  { id: 'knock', title: 'Someone is knocking', icon: '🚪', color: '#f4c381', urgency: 1, threshold: .20, labels: ['Knock', 'Whack, thwack', 'Tap'] },
  { id: 'appliance', title: 'Appliance beep', icon: '⏲️', color: '#9cbef8', urgency: 1, threshold: .24, labels: ['Beep, bleep', 'Microwave oven'] },
  { id: 'kettle', title: 'Kettle / whistle', icon: '🫖', color: '#8dddc4', urgency: 1, threshold: .42, labels: ['Whistle', 'Steam whistle', 'Kettle whistle'] },
  { id: 'siren', title: 'Siren nearby', icon: '🚨', color: '#ff8a80', urgency: 3, threshold: .40, labels: ['Siren', 'Civil defense siren', 'Police car (siren)', 'Ambulance (siren)', 'Fire engine, fire truck (siren)'] },
  { id: 'baby', title: 'Baby crying', icon: '👶', color: '#f5afcc', urgency: 2, threshold: .38, labels: ['Baby cry, infant cry', 'Crying, sobbing'] },
  { id: 'dog', title: 'Dog barking', icon: '🐕', color: '#e4cc92', urgency: 1, threshold: .40, labels: ['Dog', 'Bark'] },
  { id: 'glass', title: 'Glass breaking', icon: '💥', color: '#ffad85', urgency: 3, threshold: .38, labels: ['Shatter', 'Glass', 'Breaking'] },
  { id: 'phone', title: 'Phone ringing', icon: '📞', color: '#b4a1fa', urgency: 1, threshold: .35, labels: ['Telephone bell ringing', 'Ringtone'] },
  { id: 'water', title: 'Water running', icon: '🚰', color: '#8dcde9', urgency: 1, threshold: .40, labels: ['Water tap, faucet', 'Sink (filling or washing)', 'Running water'] },
  { id: 'clapping', title: 'Clapping', icon: '👏', color: '#c2da91', urgency: 1, threshold: .35, labels: ['Clapping', 'Applause'] },
].map(group => ({ ...group, enabled: true }));

// "Alarm" is a generic YAMNet label: a whistling kettle can score "Alarm" 0.99 next to "Whistle" 0.99.
// When the smoke group matches only through that generic label and a sound-specific label from one of
// these groups explains the sound at least as well, the smoke group yields. Appliance "Beep" is left out
// on purpose: real smoke alarms often score "Beep", and a missed alarm is worse than a false one.
const GENERIC_LABELS = { smoke: ['Alarm'] };
const SPECIFIC_RIVALS = ['kettle', 'siren', 'phone', 'doorbell'];

function groupScore(group, labels) {
  const generic = GENERIC_LABELS[group.id] || [];
  const specific = Math.max(0, ...group.labels.filter(label => !generic.includes(label)).map(label => labels.get(label) || 0));
  const general = Math.max(0, ...generic.map(label => labels.get(label) || 0));
  if (general <= specific) return specific;
  const rival = Math.max(0, ...GROUPS.filter(other => SPECIFIC_RIVALS.includes(other.id))
    .flatMap(other => other.labels.map(label => labels.get(label) || 0)));
  return rival >= general * .9 ? specific : general;
}

export class GroupMatcher {
  constructor() { this.windows = new Map(); this.cooldowns = new Map(); }
  resetWindows() { this.windows.clear(); }
  match(labels, settings, now = Date.now()) {
    const matches = [];
    for (const group of GROUPS) {
      const score = groupScore(group, labels);
      const history = [...(this.windows.get(group.id) || []), score].slice(-3);
      this.windows.set(group.id, history);
      const threshold = Math.max(.05, Math.min(.95, group.threshold + settings.offset));
      const confirmed = history.filter(value => value >= threshold).length >= 2;
      // A strong single window is enough for every built-in group.
      const strong = score >= threshold + .1;
      if (settings.enabled[group.id] !== false && (confirmed || strong) &&
          now - (this.cooldowns.get(group.id) || 0) >= 6000) {
        this.cooldowns.set(group.id, now);
        matches.push({ ...group, score: strong ? score : Math.max(...history) });
      }
    }
    return matches;
  }
}
