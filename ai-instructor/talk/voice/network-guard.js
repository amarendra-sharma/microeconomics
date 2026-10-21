// network-guard.js - enforces "speech never leaves the student's device or Macronations' own origin".
// Installed inside the speech workers before any model code runs. It wraps fetch/XHR/WebSocket/sendBeacon so
// that (a) the few known hard-coded third-party model URLs are rewritten to our own copies and
// (b) every other cross-origin request throws instead of going out.
export function installNetworkGuard(scope, opts) {
  opts = opts || {};
  var origin = opts.origin || (scope.location && scope.location.origin) || '';
  var rewrites = opts.rewrites || [];            // [{from: 'https://host/prefix/', to: '/models/prefix/'}]
  var blocked = [];
  var realFetch = scope.fetch ? scope.fetch.bind(scope) : null;

  function decide(url) {
    var u = String(url && url.url ? url.url : url), i;
    for (i = 0; i < rewrites.length; i++) if (u.indexOf(rewrites[i].from) === 0) return { url: rewrites[i].to + u.slice(rewrites[i].from.length), rewritten: true };
    if (/^(data|blob):/i.test(u)) return { url: u };
    var abs;
    try { abs = new URL(u, origin || undefined); } catch (e) { return { url: u }; }
    if (origin && abs.origin !== origin) return { blocked: true, url: u };
    return { url: u };
  }
  function block(kind, u) {
    blocked.push({ kind: kind, url: String(u) });
    if (opts.onBlocked) { try { opts.onBlocked(kind, String(u)); } catch (e) { /* ignore */ } }
    var err = new Error('Blocked cross-origin ' + kind + ' request from the speech worker: ' + String(u)); err.name = 'NetworkGuardError';
    return err;
  }
  if (realFetch) {
    scope.fetch = function (input, init) {
      var d = decide(input);
      if (d.blocked) return Promise.reject(block('fetch', d.url));
      return realFetch(d.rewritten ? d.url : input, init);
    };
  }
  if (scope.XMLHttpRequest) {
    var X = scope.XMLHttpRequest, open = X.prototype.open;
    X.prototype.open = function (m, url) {
      var d = decide(url); if (d.blocked) throw block('xhr', d.url);
      var args = Array.prototype.slice.call(arguments); args[1] = d.url; return open.apply(this, args);
    };
  }
  if (scope.WebSocket) { scope.WebSocket = function (url) { throw block('websocket', url); }; }
  if (scope.navigator && scope.navigator.sendBeacon) { scope.navigator.sendBeacon = function (url) { throw block('beacon', url); }; }
  return { blocked: blocked, decide: decide };
}
