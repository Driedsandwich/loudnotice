import { GROUPS } from './groups.js';
import { validateImport } from './custom.js';

export function exportSetup(custom, settings) {
  // Copy only the documented numeric fingerprints, metadata and preferences.
  const sounds = validateImport(custom.data());
  return { app: 'LoudNotice', version: 2, featureFormat: custom.data().featureFormat, sounds,
    settings: { offset: settings.offset, enabled: { ...settings.enabled }, vibration: settings.vibration,
      notifications: settings.notifications, reducedMotion: settings.reducedMotion } };
}

export function validateSetup(data) {
  if (!data || data.app !== 'LoudNotice' || data.version !== 2) throw new Error('Choose a LoudNotice v2 setup file.');
  const sounds = validateImport({ ...data, version: 1 });
  const settings = data.settings;
  if (!settings || typeof settings.offset !== 'number' || !Number.isFinite(settings.offset) ||
      settings.offset < -.2 || settings.offset > .2 ||
      !['vibration', 'notifications', 'reducedMotion'].every(key => typeof settings[key] === 'boolean') ||
      !GROUPS.every(group => typeof settings.enabled?.[group.id] === 'boolean')) {
    throw new Error('Invalid setup preferences. Nothing was imported.');
  }
  return { sounds, settings: { offset: settings.offset,
    enabled: Object.fromEntries(GROUPS.map(group => [group.id, settings.enabled[group.id]])),
    vibration: settings.vibration, notifications: settings.notifications, reducedMotion: settings.reducedMotion } };
}
