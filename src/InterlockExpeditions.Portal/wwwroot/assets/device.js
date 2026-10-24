const prefix = 'interlock-v1:';
/** Keeps a room identity separate per tab, with a device-local fallback after reopening a tab. */
export function rememberPlayer(roomId, identity) {
  const value = JSON.stringify(identity); let saved = false;
  try { sessionStorage.setItem(prefix + roomId, value); saved = true; } catch { }
  try { localStorage.setItem(prefix + roomId, value); saved = true; } catch { }
  if (!saved) throw new Error('Player access could not be saved on this device.');
}
export function player(roomId) {
  let readable = false;
  for (const name of ['sessionStorage', 'localStorage']) {
    try { const value = globalThis[name].getItem(prefix + roomId); readable = true; if (value) return JSON.parse(value); } catch { }
  }
  if (!readable) throw new Error('Saved player access is unavailable.');
  return null;
}
export async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
export function download(name, content, mime = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([content], { type: mime })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[^A-Za-z0-9._-]/g, '-'); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
