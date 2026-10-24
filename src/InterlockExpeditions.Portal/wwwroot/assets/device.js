const prefix = 'interlock-v1:';
/** Keeps a room identity separate per tab, with a device-local fallback after reopening a tab. */
export function rememberPlayer(roomId, identity) { const value = JSON.stringify(identity); sessionStorage.setItem(prefix + roomId, value); localStorage.setItem(prefix + roomId, value); }
export function player(roomId) { const value = sessionStorage.getItem(prefix + roomId) ?? localStorage.getItem(prefix + roomId); return value ? JSON.parse(value) : null; }
export async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
export function download(name, content, mime = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([content], { type: mime })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name.replace(/[^A-Za-z0-9._-]/g, '-'); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
