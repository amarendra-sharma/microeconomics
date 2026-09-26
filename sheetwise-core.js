/* ==========================================================================
   Sheetwise core  \u2014  bubble-sheet layout, printing and optical reading.
   Framework-independent: no Supabase, no course logic. Anything that can
   hand it a question list and a scanned image can use it.

   Globals it uses when present:  qrcode (qrcode-generator), jsQR, pdfjsLib
   Safari-safe ES5 (no arrows, template literals, optional chaining).
   ========================================================================== */
(function (root) {
  'use strict';

  var VERSION = 'sheetwise-core-1.3';
  var PAGE_W = 612, PAGE_H = 792;              // US Letter in points

  // Fiducial squares (centres) and orientation bar, in page points.
  var FID = 22;
  var FIDS = [[40, 40], [572, 40], [40, 752], [572, 752]];   // TL, TR, BL, BR
  var OBAR = { x: 58, y: 35, w: 36, h: 10 };                  // right of TL only
  var WHITE_PTS = [[306, 40], [306, 752], [22, 396], [590, 396], [200, 752], [420, 40]];
  var QR_BOX = { x: 472, y: 56, s: 80 };
  var AREA = { top: 160, bottom: 728, left: 50, right: 562 };
  var ARCHIVE_PPT = 1.6;   // stored scan resolution (about 115 dpi, ~120 KB per page)

  // Choice-bubble geometry
  var MC_ROW = 19, MC_R = 6.5, MC_STEP = 19;
  // Numeric grid geometry
  var NUM_COLS = 7, NUM_DX = 17, NUM_DY = 13.6, NUM_R = 5.2;
  var NUM_W = 128, NUM_H = 210;

  // Reading thresholds on the normalised fill score (0 = empty bubble, 1 = solid ink)
  var T = { FILL: 0.40, FAINT: 0.22, ERASE_GAP: 0.30 };

  /* ------------------------------------------------------------------ layout */
  // questions: [{ n: displayNumber, kind: 'mc'|'yn'|'num', nopts: int }]
  // opts.versions: number of booklet versions (>1 adds a "booklet version" bubble row, read as q 'V')
  function layout(questions, opts) {
    opts = opts || {};
    var choice = [], nums = [];
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      if (q.kind === 'num') { nums.push(q); } else { choice.push(q); }
    }
    var maxOpts = 2;
    for (i = 0; i < choice.length; i++) {
      var no = choice[i].kind === 'yn' ? 2 : Math.max(2, choice[i].nopts || 4);
      if (no > maxOpts) { maxOpts = no; }
    }
    var mcCols = maxOpts > 5 ? 3 : 4;
    var colW = (AREA.right - AREA.left) / mcCols;

    var pages = [];
    function newPage() {
      var p = { index: pages.length, groups: [] };
      pages.push(p); return p;
    }
    var page = newPage();
    var y = AREA.top;
    var ci = 0;
    var nv = opts.versions || 0;
    if (nv > 1) {
      // Booklet-version bubbles live in the header, right of the name box (no answer space used).
      page.hasVersion = true;
      page.groups.push({ type: 'label', text: 'BOOKLET VERSION', x: 310, y: 110 });
      var vl = letters(nv), vb = [];
      for (var vi = 0; vi < vl.length; vi++) { vb.push({ x: 318 + vi * 18, y: 134, r: MC_R, ch: vl[vi] }); }
      page.groups.push({ type: 'choice', q: 'V', kind: 'version', labels: vl, bubbles: vb, labelX: null, labelY: 134,
        bbox: { x: 306, y: 104, w: 18 * vl.length + 12, h: 40 } });
    }
    while (ci < choice.length) {
      var avail = Math.floor((AREA.bottom - y - 16) / MC_ROW);
      if (avail < 1) { page = newPage(); y = AREA.top; continue; }
      var remaining = choice.length - ci;
      var rows = Math.min(avail, Math.ceil(remaining / mcCols));
      var take = Math.min(remaining, rows * mcCols);
      page.groups.push({ type: 'label', text: 'Multiple choice \u2014 fill one bubble per question', x: AREA.left, y: y + 8 });
      var y0 = y + 16;
      for (var k = 0; k < take; k++) {
        var qq = choice[ci + k];
        var col = Math.floor(k / rows), row = k % rows;
        var cx = AREA.left + col * colW, cy = y0 + row * MC_ROW + MC_ROW / 2;
        var labels = qq.kind === 'yn' ? ['Y', 'N'] : letters(Math.max(2, qq.nopts || 4));
        var bubbles = [];
        for (var b = 0; b < labels.length; b++) {
          bubbles.push({ x: cx + 34 + b * MC_STEP, y: cy, r: MC_R, ch: labels[b] });
        }
        page.groups.push({ type: 'choice', q: qq.n, kind: qq.kind, labels: labels, bubbles: bubbles,
          labelX: cx + 24, labelY: cy,
          bbox: { x: cx, y: cy - MC_ROW / 2, w: 34 + labels.length * MC_STEP + 4, h: MC_ROW } });
      }
      ci += take;
      y = y0 + rows * MC_ROW + 10;
    }

    var perRow = Math.floor((AREA.right - AREA.left) / NUM_W);
    var ni = 0;
    var labelled = false;
    while (ni < nums.length) {
      var needed = (labelled ? 0 : 16) + NUM_H;
      if (y + needed > AREA.bottom) { page = newPage(); y = AREA.top; labelled = false; continue; }
      if (!labelled) {
        page.groups.push({ type: 'label', text: 'Numeric answers \u2014 write the number in the boxes, then fill one bubble per column (left-aligned)', x: AREA.left, y: y + 8 });
        y += 16; labelled = true;
      }
      for (var c = 0; c < perRow && ni < nums.length; c++, ni++) {
        page.groups.push(numGroup(nums[ni], AREA.left + c * NUM_W, y));
      }
      y += NUM_H;
    }
    return { version: VERSION, pages: pages, pageCount: pages.length };
  }

  function letters(n) { var a = []; for (var i = 0; i < n; i++) { a.push(String.fromCharCode(65 + i)); } return a; }

  function numGroup(q, x, y) {
    var gx = x + 6, top = y + 14;             // number label row
    var boxY = top + 2;                        // write-in boxes
    var gridY = boxY + 22;                     // first bubble row centre
    var cols = [];
    for (var c = 0; c < NUM_COLS; c++) {
      var cx = gx + 8 + c * NUM_DX;
      var bs = [];
      var rowsCh = ['-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      for (var r = 0; r < rowsCh.length; r++) {
        var ch = rowsCh[r];
        if (ch === '-' && c !== 0) { continue; }
        if (ch === '.' && c === 0) { continue; }
        bs.push({ x: cx, y: gridY + r * NUM_DY, r: NUM_R, ch: ch });
      }
      cols.push({ x: cx, bubbles: bs });
    }
    var rowLabels = [];
    var rowsAll = ['-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (var rr = 0; rr < rowsAll.length; rr++) { rowLabels.push({ x: x + 4.2, y: gridY + rr * NUM_DY, ch: rowsAll[rr] }); }
    return { type: 'num', q: q.n, kind: 'num', cols: cols, x: gx, y: y, boxY: boxY, rowLabels: rowLabels,
      bbox: { x: x, y: y, w: NUM_W - 4, h: NUM_H - 6 } };
  }

  /* ----------------------------------------------------------------- render */
  // meta: { title, studentName, studentLine2, code, pageIndex, pageCount, instructions }
  function renderPageSVG(page, meta) {
    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + PAGE_W + ' ' + PAGE_H + '" width="8.5in" height="11in" style="display:block;background:#fff" font-family="Helvetica,Arial,sans-serif">');
    s.push('<rect x="0" y="0" width="' + PAGE_W + '" height="' + PAGE_H + '" fill="#fff"/>');
    for (var i = 0; i < FIDS.length; i++) {
      s.push('<rect x="' + (FIDS[i][0] - FID / 2) + '" y="' + (FIDS[i][1] - FID / 2) + '" width="' + FID + '" height="' + FID + '" fill="#000"/>');
    }
    s.push('<rect x="' + OBAR.x + '" y="' + OBAR.y + '" width="' + OBAR.w + '" height="' + OBAR.h + '" fill="#000"/>');

    // Header
    s.push(txt(60, 80, meta.title || 'Exam', 15, '700', '#000'));
    s.push(txt(60, 100, 'Answer sheet \u00b7 page ' + (page.index + 1) + ' of ' + (meta.pageCount || 1) + ' \u00b7 sheet ' + (meta.code || ''), 9.5, '400', '#333'));
    var nameW = page.hasVersion ? 238 : 330;
    s.push('<rect x="60" y="110" width="' + nameW + '" height="34" fill="none" stroke="#000" stroke-width="0.8"/>');
    s.push(txt(66, 121, 'NAME', 6.5, '700', '#555'));
    s.push(txt(66, 138, meta.studentName || '', 13, '600', '#000'));
    if (meta.studentLine2) { s.push(txt(page.hasVersion ? 150 : 396, page.hasVersion ? 121 : 138, meta.studentLine2, 7.5, '400', '#444')); }
    s.push(txt(60, 154, meta.instructions || 'Use a dark pencil or pen. Fill bubbles completely. Erase cleanly. Do not mark near the black squares or the code.', 7.5, '400', '#444'));
    s.push(qrSVG('SW1|' + (meta.code || '') + '|' + (page.index + 1), QR_BOX.x, QR_BOX.y, QR_BOX.s));
    s.push(txt(QR_BOX.x + QR_BOX.s / 2, QR_BOX.y + QR_BOX.s + 10, meta.code || '', 8, '700', '#000', 'middle'));

    for (i = 0; i < page.groups.length; i++) {
      var g = page.groups[i];
      if (g.type === 'label') { s.push(txt(g.x, g.y + 3, g.text, g.text === 'BOOKLET VERSION' ? 6.5 : 8, '700', g.text === 'BOOKLET VERSION' ? '#555' : '#222')); continue; }
      if (g.type === 'choice') {
        if (g.labelX !== null) { s.push(txt(g.labelX, g.labelY + 3.2, String(g.q), 9, '700', '#000', 'end')); }
        for (var b = 0; b < g.bubbles.length; b++) { s.push(bubble(g.bubbles[b])); }
        continue;
      }
      if (g.type === 'num') {
        s.push(txt(g.x, g.y + 10, 'Q' + g.q, 9, '700', '#000'));
        for (var c = 0; c < g.cols.length; c++) {
          var col = g.cols[c];
          s.push('<rect x="' + (col.x - 7.5) + '" y="' + g.boxY + '" width="15" height="16" fill="none" stroke="#000" stroke-width="0.7"/>');
          for (var k = 0; k < col.bubbles.length; k++) { s.push(bubble(col.bubbles[k])); }
        }
        // Row labels printed dark OUTSIDE the bubbles, so students can see which row is which digit.
        if (g.rowLabels) {
          for (var rl = 0; rl < g.rowLabels.length; rl++) {
            var L = g.rowLabels[rl];
            s.push(txt(L.x, L.y + 2.6, L.ch === '-' ? '\u2212' : L.ch, 7.5, '700', '#000', 'middle'));
          }
        }
      }
    }
    s.push('</svg>');
    return s.join('');
  }

  function bubble(b) {
    return '<circle cx="' + r2(b.x) + '" cy="' + r2(b.y) + '" r="' + b.r + '" fill="none" stroke="#555" stroke-width="0.7"/>' +
      '<text x="' + r2(b.x) + '" y="' + r2(b.y + b.r * 0.42) + '" font-size="' + r2(b.r * 1.15) + '" text-anchor="middle" fill="#aaa">' + escX(b.ch === '-' ? '\u2212' : b.ch) + '</text>';
  }
  function txt(x, y, t, size, weight, fill, anchor) {
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + escX(t) + '</text>';
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function escX(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function qrSVG(data, x, y, size) {
    if (typeof root.qrcode !== 'function') { return '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="none" stroke="#c00"/>'; }
    var qr = root.qrcode(0, 'M'); qr.addData(data); qr.make();
    var n = qr.getModuleCount(), m = size / (n + 2);   // 1-module quiet ring inside the box
    var p = ['<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" fill="#fff"/><path fill="#000" d="'];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) { p.push('M' + r2(x + (c + 1) * m) + ' ' + r2(y + (r + 1) * m) + 'h' + r2(m) + 'v' + r2(m) + 'h-' + r2(m) + 'z'); }
      }
    }
    p.push('"/>');
    return p.join('');
  }

  /* ----------------------------------------------------------- image input */
  function grayFromImageData(id) {
    var d = id.data, n = id.width * id.height, g = new Uint8Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) { g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; }
    return { gray: g, w: id.width, h: id.height };
  }
  function grayFromCanvas(cv) {
    return grayFromImageData(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height));
  }

  /* -------------------------------------------------------------- geometry */
  function solveHomography(src, dst) {
    // src/dst: 4 [x,y] pairs. Returns 3x3 (h33 = 1) mapping src -> dst.
    var A = [], B = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    var h = gauss(A, B);
    if (!h) { return null; }
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function gauss(A, B) {
    var n = B.length, M = [];
    for (var i = 0; i < n; i++) { M.push(A[i].slice()); M[i].push(B[i]); }
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) { if (Math.abs(M[r][c]) > Math.abs(M[p][c])) { p = r; } }
      if (Math.abs(M[p][c]) < 1e-12) { return null; }
      var t = M[c]; M[c] = M[p]; M[p] = t;
      for (r = 0; r < n; r++) {
        if (r === c) { continue; }
        var f = M[r][c] / M[c][c];
        for (var k = c; k <= n; k++) { M[r][k] -= f * M[c][k]; }
      }
    }
    var x = [];
    for (i = 0; i < n; i++) { x.push(M[i][n] / M[i][i]); }
    return x;
  }
  function mapPt(H, x, y) {
    var w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }
  function sampleGray(img, u, v) {
    var w = img.w, h = img.h;
    if (u < 0 || v < 0 || u >= w - 1 || v >= h - 1) { return 255; }
    var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0, g = img.gray, i = y0 * w + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
  }

  /* ------------------------------------------------------ fiducial search */
  function otsu(img, x0, y0, x1, y1) {
    var hist = new Array(256), i, n = 0;
    for (i = 0; i < 256; i++) { hist[i] = 0; }
    var step = Math.max(1, Math.floor((x1 - x0) / 300));
    for (var y = y0; y < y1; y += step) { for (var x = x0; x < x1; x += step) { hist[img.gray[y * img.w + x]]++; n++; } }
    var sum = 0; for (i = 0; i < 256; i++) { sum += i * hist[i]; }
    var sumB = 0, wB = 0, best = 0, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) { continue; }
      var wF = n - wB; if (!wF) { break; }
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = i; }
    }
    return Math.min(th, 160);
  }

  function findFiducial(img, corner) {
    var W = img.w, Hh = img.h;
    var ww = Math.floor(W * 0.22), wh = Math.floor(Hh * 0.17);
    var x0 = (corner === 1 || corner === 3) ? W - ww : 0;
    var y0 = (corner >= 2) ? Hh - wh : 0;
    var x1 = x0 + ww, y1 = y0 + wh;
    var th = otsu(img, x0, y0, x1, y1);
    var seen = new Uint8Array(ww * wh);
    var exp = FID / PAGE_W * W;
    var cornerX = (corner === 1 || corner === 3) ? W : 0, cornerY = corner >= 2 ? Hh : 0;
    var best = null, bestD = 1e18;
    var stack = [];
    for (var yy = 0; yy < wh; yy++) {
      for (var xx = 0; xx < ww; xx++) {
        var li = yy * ww + xx;
        if (seen[li]) { continue; }
        seen[li] = 1;
        if (img.gray[(y0 + yy) * W + x0 + xx] > th) { continue; }
        // flood fill
        var cnt = 0, sx = 0, sy = 0, mnx = xx, mxx = xx, mny = yy, mxy = yy, tooBig = false;
        stack.length = 0; stack.push(li);
        while (stack.length) {
          var p = stack.pop(), px = p % ww, py = (p - px) / ww;
          cnt++; sx += px; sy += py;
          if (px < mnx) { mnx = px; } if (px > mxx) { mxx = px; }
          if (py < mny) { mny = py; } if (py > mxy) { mxy = py; }
          if (cnt > exp * exp * 6) { tooBig = true; }
          var nb = [p - 1, p + 1, p - ww, p + ww];
          for (var k = 0; k < 4; k++) {
            var q = nb[k];
            if (q < 0 || q >= ww * wh) { continue; }
            if ((k === 0 && px === 0) || (k === 1 && px === ww - 1)) { continue; }
            if (seen[q]) { continue; }
            seen[q] = 1;
            var qx = q % ww, qy = (q - qx) / ww;
            if (img.gray[(y0 + qy) * W + x0 + qx] <= th) { stack.push(q); }
          }
        }
        if (tooBig) { continue; }
        var bw = mxx - mnx + 1, bh = mxy - mny + 1;
        if (bw < exp * 0.55 || bh < exp * 0.55 || bw > exp * 1.9 || bh > exp * 1.9) { continue; }
        var asp = bw / bh; if (asp < 0.7 || asp > 1.43) { continue; }
        if (cnt / (bw * bh) < 0.6) { continue; }
        var side = Math.sqrt(cnt); if (side < exp * 0.6 || side > exp * 1.6) { continue; }
        var cx = x0 + sx / cnt, cy = y0 + sy / cnt;
        var d = (cx - cornerX) * (cx - cornerX) + (cy - cornerY) * (cy - cornerY);
        if (d < bestD) { bestD = d; best = [cx, cy]; }
      }
    }
    return best;
  }

  /* ---------------------------------------------------------------- locate */
  // Finds fiducials, fixes orientation, decodes the QR code.
  // Returns { ok, H, code, page, white, black, error }
  function locate(img) {
    var f = [], missing = [];
    for (var c = 0; c < 4; c++) {
      var p = findFiducial(img, c);
      if (!p) { missing.push(['top-left', 'top-right', 'bottom-left', 'bottom-right'][c]); }
      f.push(p);
    }
    if (missing.length) {
      return { ok: false, found: 4 - missing.length, error: missing.length >= 3 ? 'Not an answer sheet.' : 'Could not find the ' + missing.join(' and ') + ' corner square' + (missing.length > 1 ? 's' : '') + ' \u2014 re-scan this page full-size.' };
    }
    var tpl = FIDS;
    var cands = [
      { H: solveHomography(tpl, [f[0], f[1], f[2], f[3]]), rot: 0 },
      { H: solveHomography(tpl, [f[3], f[2], f[1], f[0]]), rot: 180 }
    ];
    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var H = cands[i].H; if (!H) { continue; }
      var black = 0; for (var k = 0; k < 4; k++) { black += patchMean(img, H, FIDS[k][0], FIDS[k][1], FID * 0.3); } black /= 4;
      var white = 0; for (k = 0; k < WHITE_PTS.length; k++) { white += patchMean(img, H, WHITE_PTS[k][0], WHITE_PTS[k][1], 5); } white /= WHITE_PTS.length;
      var bar = patchMean(img, H, OBAR.x + OBAR.w / 2, OBAR.y + OBAR.h / 2, 3);
      var barNorm = (white - bar) / Math.max(1, white - black);
      if (!best || barNorm > best.barNorm) { best = { H: H, rot: cands[i].rot, white: white, black: black, barNorm: barNorm }; }
    }
    if (!best || best.barNorm < 0.5) { return { ok: false, error: 'Corner squares found but the page orientation mark is unclear.' }; }
    if (best.white - best.black < 40) { return { ok: false, error: 'Scan contrast is too low to read reliably.' }; }
    var qr = decodeQR(img, best.H);
    var out = { ok: true, H: best.H, rotation: best.rot, white: best.white, black: best.black, code: null, page: null };
    if (qr) {
      var parts = qr.split('|');
      if (parts[0] === 'SW1' && parts.length >= 3) { out.code = parts[1]; out.page = parseInt(parts[2], 10) || 1; }
      else { out.qrText = qr; }
    }
    if (!out.code) { out.warning = 'QR code unreadable \u2014 enter the sheet code printed under it.'; }
    return out;
  }

  function patchMean(img, H, x, y, rad) {
    var s = 0, n = 0;
    for (var dy = -rad; dy <= rad; dy += rad / 2) {
      for (var dx = -rad; dx <= rad; dx += rad / 2) {
        var p = mapPt(H, x + dx, y + dy); s += sampleGray(img, p[0], p[1]); n++;
      }
    }
    return s / n;
  }

  function warpRegion(img, H, x, y, w, h, ppt) {
    var W = Math.round(w * ppt), Hh = Math.round(h * ppt);
    var out = new Uint8ClampedArray(W * Hh * 4);
    for (var j = 0; j < Hh; j++) {
      for (var i = 0; i < W; i++) {
        var p = mapPt(H, x + (i + 0.5) / ppt, y + (j + 0.5) / ppt);
        var g = sampleGray(img, p[0], p[1]);
        var o = (j * W + i) * 4; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
      }
    }
    return { data: out, width: W, height: Hh };
  }

  function decodeQR(img, H) {
    if (typeof root.jsQR !== 'function') { return null; }
    var pad = 10, scales = [4, 3, 6, 2.5];
    for (var i = 0; i < scales.length; i++) {
      var r = warpRegion(img, H, QR_BOX.x - pad, QR_BOX.y - pad, QR_BOX.s + 2 * pad, QR_BOX.s + 2 * pad, scales[i]);
      var res = root.jsQR(r.data, r.width, r.height, { inversionAttempts: 'dontInvert' });
      if (res && res.data) { return res.data; }
    }
    return null;
  }

  /* ------------------------------------------------------------- read marks */
  function bubbleDark(img, H, b) {
    var rad = b.r * 0.58, s = 0, n = 0;
    for (var dy = -rad; dy <= rad + 1e-9; dy += rad / 3) {
      for (var dx = -rad; dx <= rad + 1e-9; dx += rad / 3) {
        if (dx * dx + dy * dy > rad * rad * 1.02) { continue; }
        var p = mapPt(H, b.x + dx, b.y + dy); s += sampleGray(img, p[0], p[1]); n++;
      }
    }
    return s / n;
  }

  // Ink just OUTSIDE a bubble's outline (annulus r1..r2 times the radius): catches marks that miss the circle.
  function ringDark(img, H, b, r1, r2) {
    var s = 0, n = 0;
    for (var a = 0; a < 20; a++) {
      var ang = a / 20 * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      for (var k = 0; k < 3; k++) {
        var rad = b.r * (r1 + (r2 - r1) * k / 2);
        var p = mapPt(H, b.x + ca * rad, b.y + sa * rad); s += sampleGray(img, p[0], p[1]); n++;
      }
    }
    return s / n;
  }
  var RING = { mc: [1.15, 1.4], num: [1.1, 1.25], OUT: 0.16 };

  // Reads every bubble group on one page. Returns { groups: { q: result } }.
  // result: { q, kind, value, status, scores, needsReview }
  function readMarks(img, loc, page) {
    var contrast = Math.max(1, loc.white - loc.black);
    var raw = [], all = [];
    var i, g, b, v;
    for (i = 0; i < page.groups.length; i++) {
      g = page.groups[i];
      if (g.type === 'choice') {
        var arr = [];
        for (b = 0; b < g.bubbles.length; b++) { v = (loc.white - bubbleDark(img, loc.H, g.bubbles[b])) / contrast; arr.push(v); all.push(v); }
        raw.push({ g: g, s: arr });
      } else if (g.type === 'num') {
        var cols = [];
        for (var c = 0; c < g.cols.length; c++) {
          var ca = [];
          for (b = 0; b < g.cols[c].bubbles.length; b++) { v = (loc.white - bubbleDark(img, loc.H, g.cols[c].bubbles[b])) / contrast; ca.push(v); all.push(v); }
          cols.push(ca);
        }
        raw.push({ g: g, s: cols });
      }
    }
    // Ring ink around each bubble (not for the version row or the minus row, which sits under the write-in boxes).
    var ringsAll = [];
    for (i = 0; i < raw.length; i++) {
      g = raw[i].g;
      if (g.type === 'choice' && g.kind !== 'version') {
        raw[i].ring = g.bubbles.map(function (bb) { var r = (loc.white - ringDark(img, loc.H, bb, RING.mc[0], RING.mc[1])) / contrast; ringsAll.push(r); return r; });
      } else if (g.type === 'num') {
        raw[i].ring = g.cols.map(function (col) { return col.bubbles.map(function (bb) {
          if (bb.ch === '-') { return 0; }
          var r = (loc.white - ringDark(img, loc.H, bb, RING.num[0], RING.num[1])) / contrast; ringsAll.push(r); return r; }); });
      }
    }
    var ringBase = percentile(ringsAll, 0.5);
    function rnorm(x) { return Math.max(0, (x - ringBase) / Math.max(0.2, 1 - ringBase)); }

    // Baseline = what an empty printed bubble reads as on THIS page.
    var base = percentile(all, 0.35);
    function norm(x) { return Math.max(0, Math.min(1.2, (x - base) / Math.max(0.2, 1 - base))); }

    // Adapt thresholds to how dark THIS student marks (light pencil vs pen):
    // the typical filled bubble on the page sets the scale.
    var maxes = [];
    for (i = 0; i < raw.length; i++) {
      if (raw[i].g.type === 'choice') { maxes.push(norm(Math.max.apply(null, raw[i].s))); }
      else { for (var cc = 0; cc < raw[i].s.length; cc++) { var mm = norm(Math.max.apply(null, raw[i].s[cc])); if (mm > 0.1) { maxes.push(mm); } } }
    }
    var typical = maxes.length ? percentile(maxes, 0.6) : 0.8;
    var k = Math.max(0.45, Math.min(1, typical / 0.8));
    var t = { FILL: T.FILL * k, FAINT: Math.max(0.12, T.FAINT * k), ERASE_GAP: T.ERASE_GAP * k };

    var res = {};
    for (i = 0; i < raw.length; i++) {
      g = raw[i].g;
      if (g.type === 'choice') {
        var sc = raw[i].s.map(norm);
        var d = decide(sc, t);
        if (d.index === null && d.status === 'blank' && raw[i].ring) {
          var rmax = Math.max.apply(null, raw[i].ring.map(rnorm));
          if (rmax >= RING.OUT) { d = { index: null, status: 'outside', review: true }; }
        }
        res[g.q] = { q: g.q, kind: g.kind, scores: sc.map(rd), labels: g.labels,
          value: d.index === null ? null : (g.kind === 'yn' ? (d.index === 0 ? 'yes' : 'no') : String(d.index)),
          display: d.index === null ? '' : g.labels[d.index],
          status: d.status, needsReview: d.review || (g.kind === 'version' && d.index === null), bbox: g.bbox };
      } else {
        var colsN = raw[i].s.map(function (a) { return a.map(norm); });
        res[g.q] = readNumeric(g, colsN, t);
        if (raw[i].ring && !res[g.q].needsReview) {
          for (var ci2 = 0; ci2 < colsN.length; ci2++) {
            var colMax = Math.max.apply(null, colsN[ci2]);
            if (colMax < t.FAINT && Math.max.apply(null, raw[i].ring[ci2].map(rnorm)) >= RING.OUT) {
              res[g.q].status = 'outside'; res[g.q].needsReview = true; break;
            }
          }
        }
      }
    }
    return { base: rd(base), markScale: rd(k), groups: res };
  }

  function decide(sc, t) {
    t = t || T;
    var i1 = -1, i2 = -1;
    for (var i = 0; i < sc.length; i++) {
      if (i1 < 0 || sc[i] > sc[i1]) { i2 = i1; i1 = i; }
      else if (i2 < 0 || sc[i] > sc[i2]) { i2 = i; }
    }
    var s1 = sc[i1], s2 = i2 >= 0 ? sc[i2] : 0;
    if (s1 < t.FAINT) { return { index: null, status: 'blank', review: false }; }
    if (s1 < t.FILL) { return { index: i1, status: 'faint', review: true }; }
    if (s2 >= t.FILL) { return { index: null, status: 'multiple', review: true }; }
    if (s2 >= t.FAINT) {
      if (s1 - s2 >= t.ERASE_GAP) { return { index: i1, status: 'erasure', review: false }; }
      return { index: i1, status: 'unclear', review: true };
    }
    return { index: i1, status: 'ok', review: false };
  }

  function readNumeric(g, cols, t) {
    var chars = [], statuses = [], review = false, detail = [];
    for (var c = 0; c < cols.length; c++) {
      var d = decide(cols[c], t);
      var ch = d.index === null ? '' : g.cols[c].bubbles[d.index].ch;
      if (d.status === 'multiple') { ch = '?'; }
      chars.push(ch); statuses.push(d.status); detail.push(cols[c].map(rd));
      if (d.review) { review = true; }
    }
    // trim blank columns at both ends; an interior blank is suspicious
    var first = -1, last = -1;
    for (c = 0; c < chars.length; c++) { if (chars[c] !== '') { if (first < 0) { first = c; } last = c; } }
    var status = 'ok', value = null;
    if (first < 0) { status = 'blank'; }
    else {
      var str = '';
      for (c = first; c <= last; c++) {
        if (chars[c] === '') { status = 'gap'; review = true; continue; }
        str += chars[c];
      }
      if (str.indexOf('?') >= 0) { status = 'multiple'; review = true; value = null; }
      else if (!/^-?(\d+\.?\d*|\.\d+)$/.test(str)) { status = 'invalid'; review = true; value = str; }
      else { value = str; if (status === 'ok') { for (c = 0; c < statuses.length; c++) { if (statuses[c] === 'erasure') { status = 'erasure'; } } } }
      if (status === 'ok' && review) { status = 'unclear'; }
    }
    return { q: g.q, kind: 'num', value: value, display: value === null ? chars.join('') : value, status: status, needsReview: review, scores: detail, bbox: g.bbox };
  }

  function percentile(a, p) {
    if (!a.length) { return 0; }
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }
  function rd(x) { return Math.round(x * 1000) / 1000; }

  /* ------------------------------------------------------------- crops */
  function cropDataURL(img, loc, box, ppt, doc, quality) {
    doc = doc || root.document;
    var r = warpRegion(img, loc.H, box.x, box.y, box.w, box.h, ppt || 3);
    var cv = doc.createElement('canvas'); cv.width = r.width; cv.height = r.height;
    var ctx = cv.getContext('2d'); var id = ctx.createImageData(r.width, r.height); id.data.set(r.data); ctx.putImageData(id, 0, 0);
    return cv.toDataURL('image/jpeg', quality || 0.82);
  }
  function pagePreview(img, loc, ppt) {
    return cropDataURL(img, loc, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, ppt || 1.1);
  }

  /* ------------------------------------------------------ file loading */
  // Calls onPage(canvas, pageNo, total) sequentially for every page/image; returns a Promise.
  function loadFiles(files, onPage, targetWidth) {
    targetWidth = targetWidth || 1700;
    var list = Array.prototype.slice.call(files);
    var chain = Promise.resolve(), counter = { n: 0 };
    list.forEach(function (file) {
      chain = chain.then(function () {
        if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) { return loadPdf(file, onPage, targetWidth, counter); }
        return loadImage(file).then(function (cv) { counter.n++; return onPage(scaleCanvas(cv, targetWidth), counter.n, null, file.name); });
      });
    });
    return chain;
  }
  function loadPdf(file, onPage, targetWidth, counter) {
    if (!root.pdfjsLib) { return Promise.reject(new Error('PDF reader (pdf.js) is not loaded')); }
    return file.arrayBuffer().then(function (buf) {
      return root.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var ch = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pn) {
          ch = ch.then(function () { return pdf.getPage(pn); }).then(function (pg) {
            var vp0 = pg.getViewport({ scale: 1 });
            var sc = targetWidth / Math.min(vp0.width, vp0.height);
            var vp = pg.getViewport({ scale: sc });
            var cv = root.document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
            return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              counter.n++;
              if (cv.width > cv.height) { cv = rotate90(cv); }
              return onPage(cv, counter.n, pdf.numPages, file.name + ' p' + pn);
            });
          });
        })(i);
      }
      return ch;
    });
  }
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var cv = root.document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        cv.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
        if (cv.width > cv.height) { cv = rotate90(cv); }
        resolve(cv);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not open image ' + file.name)); };
      im.src = url;
    });
  }
  function scaleCanvas(cv, tw) {
    if (Math.abs(cv.width - tw) < 50) { return cv; }
    var s = tw / cv.width, o = root.document.createElement('canvas');
    o.width = Math.round(cv.width * s); o.height = Math.round(cv.height * s);
    var ctx = o.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cv, 0, 0, o.width, o.height);
    return o;
  }
  function rotate90(cv) {
    var o = root.document.createElement('canvas'); o.width = cv.height; o.height = cv.width;
    var ctx = o.getContext('2d'); ctx.translate(o.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(cv, 0, 0);
    return o;
  }

  /* ------------------------------------------------ convenience: one page */
  // Full pipeline for a canvas. resolvePage(code, pageNo) -> page layout or null.
  function readCanvas(cv, resolvePage) {
    var img = grayFromCanvas(cv);
    var loc = locate(img);
    if (!loc.ok) { return { ok: false, error: loc.error, found: loc.found || 0 }; }
    var out = { ok: true, code: loc.code, page: loc.page, rotation: loc.rotation, warning: loc.warning || null };
    out.preview = pagePreview(img, loc, 1.1);
    out._img = img; out._loc = loc;          // caller may call finishRead later (e.g. after manual code entry)
    if (loc.code && resolvePage) {
      var pl = resolvePage(loc.code, loc.page);
      if (pl) { finishRead(out, pl); }
      else { out.warning = 'Sheet ' + loc.code + ' is not part of this exam.'; }
    }
    return out;
  }
  function finishRead(out, pageLayout) {
    var r = readMarks(out._img, out._loc, pageLayout);
    out.base = r.base; out.groups = r.groups;
    for (var q in r.groups) {
      if (Object.prototype.hasOwnProperty.call(r.groups, q) && r.groups[q].needsReview) {
        var bb = r.groups[q].bbox;
        r.groups[q].crop = cropDataURL(out._img, out._loc, { x: bb.x - 4, y: bb.y - 2, w: bb.w + 8, h: bb.h + 4 }, 3);
      }
    }
    // Deskewed archive copy of the whole page (template-aligned: pixel = point * ARCHIVE_PPT)
    try { out.archive = cropDataURL(out._img, out._loc, { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, ARCHIVE_PPT, null, 0.7); } catch (e) { out.archive = null; }
    out._img = null;                           // free the full-resolution pixels
    out.read = true;
    return out;
  }

  root.SheetwiseCore = {
    VERSION: VERSION, PAGE_W: PAGE_W, PAGE_H: PAGE_H, ARCHIVE_PPT: ARCHIVE_PPT, THRESHOLDS: T,
    layout: layout, renderPageSVG: renderPageSVG,
    grayFromCanvas: grayFromCanvas, grayFromImageData: grayFromImageData,
    locate: locate, readMarks: readMarks, readCanvas: readCanvas, finishRead: finishRead,
    cropDataURL: cropDataURL, loadFiles: loadFiles, mapPt: mapPt, solveHomography: solveHomography
  };
})(typeof window !== 'undefined' ? window : this);
