// Read previous installations without losing their preferences or taught sounds.
export function readStored(key) {
  return localStorage.getItem(key) ?? localStorage.getItem(key.replace('loudnotice.', 'soundsense.'));
}

export function writeStored(key, value) {
  localStorage.setItem(key, value);
  // Original smoke scripts also inspect the old storage keys directly.
  localStorage.setItem(key.replace('loudnotice.', 'soundsense.'), value);
}
