/** Owner-selected application mount, independent of the incoming request's origin. */
export function appBasePath(value = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || !value.endsWith('/') || value.includes('//') || value.includes('\\') || value.includes('?') || value.includes('#') || value.includes('%')) throw new TypeError('Use an absolute application path ending in /.');
  if (value.split('/').some(part => part === '.' || part === '..' || [...part].some(character => !'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.includes(character)))) throw new TypeError('The application path contains an unsupported segment.');
  return value;
}
export function apiRoute(url, basePath) {
  const prefix = basePath + 'api';
  if (url.pathname === prefix) return [];
  if (!url.pathname.startsWith(prefix + '/')) return null;
  return url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
}
