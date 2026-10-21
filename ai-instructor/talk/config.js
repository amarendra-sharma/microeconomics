// config.js - where avatar models may be loaded from.
// Production rule: a model URL must start with an entry of approvedOrigins (Macronations-controlled storage).
// Development rule: relative URLs (same origin as the sandbox page) are allowed only when allowRelativeDev is true.
// No default model URL is invented here; callers must supply one.
export function isApprovedModelUrl(url, opts) {
  opts = opts || {};
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return { ok: false, reason: 'No model URL configured' };
  var lower = url.trim().toLowerCase();
  if (/^(data|blob|javascript|file|ftp):/.test(lower)) return { ok: false, reason: 'Model URL scheme is not allowed' };
  if (url.indexOf('..') >= 0) return { ok: false, reason: 'Model URL may not contain ".."' };
  var origins = opts.approvedOrigins || [];
  var isAbsolute = /^https:\/\//i.test(url);
  if (isAbsolute) {
    for (var i = 0; i < origins.length; i++) {
      if (origins[i] && url.indexOf(origins[i]) === 0) return { ok: true };
    }
    return { ok: false, reason: 'Model URL is not under an approved Macronations origin' };
  }
  if (/^\/\//.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url)) return { ok: false, reason: 'Model URL must be https from an approved origin' };
  if (opts.allowRelativeDev === true) return { ok: true, dev: true };
  return { ok: false, reason: 'Relative model URLs are only allowed in development mode' };
}

export var DEFAULT_QUALITY = { maxPixelRatio: 2, targetFps: 60 };
