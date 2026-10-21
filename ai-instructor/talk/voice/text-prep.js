// text-prep.js - text handling around the speech models: streaming sentence splitting for TTS,
// converting economics notation to speakable text, and correcting course vocabulary in ASR output.

const ABBREV = ['e.g', 'i.e', 'etc', 'vs', 'cf', 'fig', 'eq', 'no', 'dr', 'mr', 'mrs', 'ms', 'prof', 'u.s', 'u.k', 'approx', 'st', 'inc', 'ltd', 'al'];

// Streaming splitter: push(text deltas as they arrive from the model) -> complete sentences.
// A sentence is released only when we can tell it has ended (terminator followed by space/newline),
// so "3.5 percent" and "e.g. tariffs" are not cut. flush() releases the remainder at end of reply.
export class SentenceSplitter {
  constructor(opts) {
    opts = opts || {};
    this.minChars = opts.minChars === undefined ? 24 : opts.minChars;    // merge very short sentences
    this.maxChars = opts.maxChars === undefined ? 260 : opts.maxChars;   // force a break at a clause for long runs
    this.fastFirst = !!opts.fastFirst;                                   // release the FIRST chunk at an early comma so speech starts sooner
    this.firstClauseChars = opts.firstClauseChars === undefined ? 32 : opts.firstClauseChars;
    this._emitted = false;
    this._buf = '';
  }
  push(delta) {
    this._buf += delta;
    var r = this._drain(false);
    if (r.length) this._emitted = true;
    return r;
  }
  flush() { return this._drain(true); }
  _drain(final) {
    var out = [], s = this._buf, start = 0, i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s[i];
      var isEnd = false;
      if (ch === '\n') { isEnd = i + 1 < s.length && s[i + 1] === '\n' || final && i === s.length - 1; if (!isEnd && s[i + 1] !== undefined) { /* single newline: soft */ } }
      else if (ch === '.' || ch === '!' || ch === '?' || ch === '…') {
        var next = s[i + 1];
        if (next === undefined) { isEnd = final; }
        else if (/\s/.test(next)) {
          isEnd = true;
          if (ch === '.') {
            var word = (/([A-Za-z.]+)$/.exec(s.slice(start, i)) || ['', ''])[1].toLowerCase();
            var prevDigit = /\d$/.test(s.slice(start, i)) && /^\s+\d/.test(s.slice(i + 1));
            if (ABBREV.indexOf(word) >= 0 || /^[a-z]$/.test(word) || prevDigit) isEnd = false;
          }
        }
        else if (next === '"' || next === ')' || next === '”' || next === '’') { isEnd = s[i + 2] !== undefined && /\s/.test(s[i + 2]); }
      }
      if (!isEnd && this.fastFirst && !this._emitted && (ch === ',' || ch === ';' || ch === ':') && i - start >= this.firstClauseChars && s[i + 1] !== undefined && /\s/.test(s[i + 1])) isEnd = true;
      if (!isEnd && i - start >= this.maxChars && (ch === ',' || ch === ';' || ch === ':') && s[i + 1] !== undefined) isEnd = true;
      if (isEnd) {
        var piece = s.slice(start, i + 1).trim();
        if (piece) out.push(piece);
        start = i + 1;
      }
    }
    var rest = s.slice(start);
    if (final) { if (rest.trim()) out.push(rest.trim()); rest = ''; }
    this._buf = rest;
    return this._merge(out, final);
  }
  _merge(parts, final) {
    // Short sentences ("Right.", "Yes.") sound choppy as separate TTS calls; join them to the next one.
    var out = [], carry = '';
    for (var i = 0; i < parts.length; i++) {
      var p = carry ? carry + ' ' + parts[i] : parts[i];
      if (p.length < this.minChars && i < parts.length - 1) { carry = p; continue; }
      if (p.length < this.minChars && !final) { carry = p; continue; }
      out.push(p); carry = '';
    }
    if (carry) { if (final) out.push(carry); else this._buf = carry + ' ' + this._buf; }
    return out;
  }
}

var GREEK = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'ω': 'omega' };
var SYMBOLS = [
  [/≤/g, ' is less than or equal to '], [/≥/g, ' is greater than or equal to '], [/≠/g, ' is not equal to '],
  [/≈/g, ' is approximately '], [/→/g, ' leads to '], [/↑/g, ' rises '], [/↓/g, ' falls '],
  [/×/g, ' times '], [/÷/g, ' divided by '], [/[−–]/g, ' minus '], [/Δ/g, 'change in '], [/∂/g, 'partial '],
  [/√/g, 'square root of '], [/∑/g, 'sum of '], [/∞/g, 'infinity']
];

// Make text safe and natural for a TTS voice. Removes markdown/LaTeX markup and spells out notation.
export function toSpeakable(text) {
  var t = String(text);
  t = t.replace(/```[\s\S]*?```/g, ' (code omitted) ');               // never read code blocks aloud
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                       // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');                     // links -> label only
  t = t.replace(/https?:\/\/\S+/g, ' link ');
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*[-*•]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '');
  t = t.replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, '$2');
  // LaTeX-ish
  t = t.replace(/\$\$?([^$]+)\$\$?/g, function (_, m) { return ' ' + latexToSpeech(m) + ' '; });
  t = t.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, function (_, a, b) { return ' ' + latexToSpeech(a || b) + ' '; });
  t = latexToSpeech(t, true);
  for (var i = 0; i < SYMBOLS.length; i++) t = t.replace(SYMBOLS[i][0], SYMBOLS[i][1]);
  t = t.replace(/[αβγδεθλμπρστφω]/g, function (c) { return ' ' + GREEK[c] + ' '; });
  t = t.replace(/(\d)\s*%/g, '$1 percent').replace(/%/g, ' percent');
  t = t.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(billion|million|trillion|thousand)?/gi, function (_, n, unit) { return n.replace(/,/g, '') + (unit ? ' ' + unit.toLowerCase() : '') + ' dollars'; });
  t = t.replace(/(\w)\^2\b/g, '$1 squared').replace(/(\w)\^3\b/g, '$1 cubed').replace(/(\w)\^\{?(-?\w+)\}?/g, '$1 to the power $2');
  t = t.replace(/(\w)_\{?(\w+)\}?/g, '$1 sub $2');
  t = t.replace(/\s=\s/g, ' equals ').replace(/\s\+\s/g, ' plus ').replace(/(\w)\s\/\s(\w)/g, '$1 over $2');
  t = t.replace(/\bQ\s*d\b/g, 'quantity demanded');
  t = t.replace(/[{}\\|<>~]/g, ' ');
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
  return t;
}

export function latexToSpeech(m, onlyCommands) {
  var t = String(m), prev;
  for (var n = 0; n < 5; n++) {                                     // nested fractions
    prev = t;
    t = t.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, ' $1 over $2 ');
    t = t.replace(/\\sqrt\{([^{}]*)\}/g, ' square root of $1 ');
    if (t === prev) break;
  }
  t = t.replace(/\\(cdot|times)\b/g, ' times ').replace(/\\div\b/g, ' divided by ').replace(/\\(le|leq)\b/g, ' is at most ')
    .replace(/\\(ge|geq)\b/g, ' is at least ').replace(/\\neq\b/g, ' is not equal to ').replace(/\\Delta\b/g, ' change in ')
    .replace(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|omega)\b/g, ' $1 ')
    .replace(/\\(left|right)\b/g, '').replace(/\\%/g, ' percent').replace(/\\,/g, ' ').replace(/\\text\{([^{}]*)\}/g, '$1');
  if (!onlyCommands) {
    t = t.replace(/\^2\b/g, ' squared').replace(/\^\{?(-?\w+)\}?/g, ' to the power $1').replace(/_\{?(\w+)\}?/g, ' sub $1')
      .replace(/=/g, ' equals ').replace(/\+/g, ' plus ').replace(/-/g, ' minus ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
var norm = function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };

// Corrects course vocabulary that general-purpose ASR tends to mishear ("ricardian" -> "Ricardian",
// "Hecksher Ohlin" -> "Heckscher-Ohlin", "comparative advantage" heard as "comparable advantage").
// Conservative by design: exact aliases first, then fuzzy matching only for long terms (edit distance
// <= 1 for 7-11 letters, 2 for 12-15, 3 for 16+), so ordinary words are not "corrected" into jargon.
export class GlossaryCorrector {
  constructor(terms, aliases) {
    this.terms = (terms || []).filter(Boolean);
    this.aliases = [];
    var k; aliases = aliases || {};
    for (k in aliases) if (Object.prototype.hasOwnProperty.call(aliases, k)) this.aliases.push([new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), aliases[k]]);
    this._index = this.terms.map(function (t) { return { term: t, key: norm(t), words: t.split(/[\s-]+/).length }; }).filter(function (e) { return e.key.length >= 7; });
  }
  correct(text) {
    var t = String(text), i;
    for (i = 0; i < this.aliases.length; i++) t = t.replace(this.aliases[i][0], this.aliases[i][1]);
    if (!this._index.length) return t;
    var tokens = t.split(/(\s+)/), words = [], pos = [];
    for (i = 0; i < tokens.length; i++) if (!/^\s+$/.test(tokens[i]) && tokens[i] !== '') { words.push(tokens[i]); pos.push(i); }
    var out = tokens.slice(), used = {};
    for (var n = 3; n >= 1; n--) {
      for (i = 0; i + n <= words.length; i++) {
        var skip = false; for (var u = 0; u < n; u++) if (used[i + u]) skip = true;
        if (skip) continue;
        var chunk = words.slice(i, i + n), core = chunk.map(function (w) { return w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''); }), key = norm(core.join(''));
        if (key.length < 7) continue;
        for (var e = 0; e < this._index.length; e++) {
          var ent = this._index[e];
          if (ent.words !== n && Math.abs(ent.words - n) > 1) continue;
          var allow = ent.key.length >= 16 ? 3 : (ent.key.length >= 12 ? 2 : 1);
          if (lev(key, ent.key, allow) <= allow) {
            var lead = (chunk[0].match(/^[^A-Za-z0-9]*/) || [''])[0], trail = (chunk[n - 1].match(/[^A-Za-z0-9]*$/) || [''])[0];
            out[pos[i]] = lead + ent.term + trail;
            for (u = 1; u < n; u++) { out[pos[i + u]] = ''; if (pos[i + u] - 1 > pos[i + u - 1]) out[pos[i + u] - 1] = ''; }
            for (u = 0; u < n; u++) used[i + u] = true;
            break;
          }
        }
      }
    }
    return out.join('').replace(/\s{2,}/g, ' ').trim();
  }
}

// ASR output that is just noise or a known hallucination on silence (Whisper-family models do this).
var HALLUCINATIONS = [/^\s*$/, /^\[.*\]$/, /^\(.*\)$/, /^(thanks for watching|thank you for watching|please subscribe|subtitles by.*|you)[.!\s]*$/i, /^(\.|,|-|\s)+$/];
export function isLikelyNoise(text) {
  var t = String(text || '').trim();
  for (var i = 0; i < HALLUCINATIONS.length; i++) if (HALLUCINATIONS[i].test(t)) return true;
  return t.replace(/[^A-Za-z0-9]/g, '').length < 2;
}
