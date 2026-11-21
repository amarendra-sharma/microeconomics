// TEMPLATE for the im-grade-attempt edge function. Do not deploy this file directly.
// tools/build_im_grade_attempt.py swaps the three @@..._SRC@@ markers for the site's own
// im-diagrams.js, im-generators.js and im-econ160.js and writes
// supabase/functions/im-grade-attempt/index.ts. The GitHub Action does this on every push
// that changes those files, so an exam always draws what the website draws.
// ---- end of template header ----
// ============================================================================
//  im-grade-attempt  — Supabase Edge Function (Deno)   [Introduction to Microeconomics]
//  Deploy name: im-grade-attempt   Deploy:  supabase functions deploy im-grade-attempt --no-verify-jwt
//
//  The single issue/grade chokepoint for IM exams, graded quizzes, and self-test.
//  Questions are GENERATOR-BACKED (A2): each im_assessment_item carries a
//  generator_id. When a student is issued a question we pick a fresh random seed,
//  generate the exact instance server-side (prompt + options + figure + answer),
//  store the seed on the im_exam_attempt row, and return everything EXCEPT the
//  answer. On grade we regenerate from the SAME seed and compare — so the correct
//  answer never reaches the browser, and every student can get different numbers.
//
//  Actions (POST body { action, ... }):
//    issue { item_id, course_id, exam_id? }
//         -> { attempt_id, item_type, prompt, options, points, figure }
//    issue_batch { item_ids[], course_id, exam_id? }     (added 2026-11-02)
//         -> { items: [ {item_id, attempt_id, item_type, prompt, options, points, figure} ] }  same order as item_ids
//    grade_batch { answers: [ {attempt_id, submitted_value} ] }   (added 2026-11-02)
//         -> { results: [ {attempt_id, is_correct, points_earned, status} | {attempt_id, error} ] }
//       Both do exactly what issue/grade do per item, but with one item lookup,
//       one insert and one grade write per exam instead of one call per question.
//    grade { attempt_id, submitted_value }
//         -> { is_correct, points_earned, status }
//            (free_response => status:'pending_instructor_review', graded later)
//
//  The generator + diagram engines are the SAME source files the browser uses
//  (im-generators.js, im-diagrams.js), embedded below at deploy time so the
//  server and client stay byte-identical. See build note at the bottom.
//
//  Env (auto-present in the Edge runtime):
//    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// __ENGINE_SOURCE__  (replaced by build-grade-attempt.sh with the real files)
@@DIAGRAMS_SRC@@
@@GENERATORS_SRC@@
@@ECON160_SRC@@

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ----------------------------------------------------------------------------
//  GENERATOR ENGINE (embedded — see __ENGINE_SOURCE__ note at bottom)
//  We evaluate the real browser engine files in a sandboxed context so the
//  server produces exactly what the client would render.
// ----------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
const run = (src: string, c: any) => {
  // The engine files end with `})(this)` (so `global.X = this.X` lands on ctx)
  // AND reference the bare identifier `window` inside some generators. To make
  // both resolve to ctx, we eval each file inside a Function that takes `window`
  // and `global` as parameters and is invoked with `this === ctx`.
  new Function("window", "global", src).call(c, c, c);
};

// deno-lint-ignore no-explicit-any
let _ctx: any = null;      // the sandbox the engine files populate
let _econ160 = false;      // has the 2.82MB add-on been compiled in this worker?

// Base engine: im-diagrams.js + im-generators.js, ~414KB. Compiled on the first
// request that needs it rather than at import, so booting a worker is cheap.
// deno-lint-ignore no-explicit-any
function engineCtx(): any {
  if (_ctx) return _ctx;
  const t0 = Date.now();
  // deno-lint-ignore no-explicit-any
  const ctx: any = {};
  ctx.window = ctx;         // engine files reference window.IMDiagrams in 2 places
  ctx.global = ctx;
  run(DIAGRAMS_SRC, ctx);
  run(GENERATORS_SRC, ctx);
  _ctx = ctx;
  try { console.log("engine: base compiled in " + (Date.now() - t0) + "ms"); } catch (_e) { /* logging is never load-bearing */ }
  return ctx;
}

function isEcon160Id(id: unknown): boolean {
  // Add-on generators: IM_ECON160_* (90) and IM_PM_* ready-made banks (Exam 2: 40); lastIndexOf(x,0)===0 is startsWith.
  return typeof id === "string" && (id.lastIndexOf("IM_ECON160", 0) === 0 || id.lastIndexOf("IM_PM_", 0) === 0);
}

// im-econ160.js ADDITIVELY wraps IMGenerators.generate/grade/list and
// IMDiagrams.render on the same objects, delegating unknown ids to the
// originals -- so compiling it late is equivalent to compiling it at boot,
// as long as it lands before the first IM_ECON160_* id is served.
function ensureEcon160(): void {
  if (_econ160) return;
  const ctx = engineCtx();
  if (ECON160_SRC.indexOf("__IM_ECON160_JS__") === -1) {
    const t0 = Date.now();
    run(ECON160_SRC, ctx);
    try { console.log("engine: econ160 compiled in " + (Date.now() - t0) + "ms"); } catch (_e) { /* ignore */ }
  }
  _econ160 = true;
}

// Same surface the rest of this file already calls: ENGINE.IMGenerators.generate
// and ENGINE.IMDiagrams.render. Each property is read from the live context at
// call time, so the add-on's wrappers take effect the moment it is compiled.
// deno-lint-ignore no-explicit-any
const ENGINE: any = {
  get IMDiagrams() {
    const ctx = engineCtx();
    return {
      // deno-lint-ignore no-explicit-any
      render: function (spec: any) {
        if (spec && spec.type === "econ160svg") ensureEcon160();
        return ctx.IMDiagrams.render(spec);
      },
    };
  },
  get IMGenerators() {
    const ctx = engineCtx();
    return {
      // deno-lint-ignore no-explicit-any
      generate: function (id: string, seed: number, cfg?: any) {
        if (isEcon160Id(id)) ensureEcon160();
        return ctx.IMGenerators.generate(id, seed, cfg);
      },
      // deno-lint-ignore no-explicit-any
      grade: function (id: string, seed: number, submitted: any, cfg?: any) {
        if (isEcon160Id(id)) ensureEcon160();
        return ctx.IMGenerators.grade(id, seed, submitted, cfg);
      },
      // list() enumerates every id, so it does need the add-on.
      list: function () { ensureEcon160(); return ctx.IMGenerators.list(); },
    };
  },
};

// Map a generator's diagramSpec into the portal's `figure` contract.
// The portal's renderFigure() natively supports {type:'matrix'} and {type:'tree'};
// everything else we hand over as pre-rendered SVG ({type:'svg', svg}) which the
// portal injects (a one-line renderFigure branch added client-side).
// deno-lint-ignore no-explicit-any
function toFigure(spec: any): any {
  if (!spec || !spec.type) return null;
  if (spec.type === "payoff_matrix") {
    // portal matrix figure: rowPlayer/colPlayer/rowStrategies/colStrategies/cells[r][c]=[p1,p2]
    return {
      type: "matrix",
      rowPlayer: spec.playerA || "Player 1",
      colPlayer: spec.playerB || "Player 2",
      rowStrategies: spec.stratA || [],
      colStrategies: spec.stratB || [],
      cells: spec.cells || [],
    };
  }
  // all other diagram types -> server-rendered SVG string
  try {
    const svg = ENGINE.IMDiagrams.render(spec);
    return { type: "svg", svg: svg };
  } catch (_e) {
    return null;
  }
}

// generator kind -> portal item_type vocabulary
function toItemType(kind: string): string {
  if (kind === "mc") return "multiple_choice";
  if (kind === "numeric") return "parameterized_numeric";
  if (kind === "decision") return "parameterized_decision";
  if (kind === "short") return "free_response";
  return "parameterized_numeric";
}

function randSeed(): number {
  // 31-bit positive seed
  return (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 1;
}

// Is `callerId` allowed to see / mark student work on this course?
// True for the course owner, platform admins, and TAs the instructor gave
// can_grade or can_view_grades to.
// deno-lint-ignore no-explicit-any
async function canGradeCourse(db: any, courseId: string, callerId: string): Promise<boolean> {
  if (!courseId || !callerId) return false;
  const { data: course } = await db
    .from("im_course").select("owner_id").eq("id", courseId).maybeSingle();
  if (course && course.owner_id === callerId) return true;
  const { data: me } = await db
    .from("im_person").select("role").eq("user_id", callerId).maybeSingle();
  if (me && me.role === "admin") return true;
  const { data: staff } = await db
    .from("im_course_staff").select("can_grade, can_view_grades")
    .eq("course_id", courseId).eq("user_id", callerId).maybeSingle();
  return !!staff && (staff.can_grade === true || staff.can_view_grades === true);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // caller identity from JWT
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const studentId = userData.user.id;

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const action = String(body.action || "");

  try {
    // ====================================================================
    // ====================================================================
    // BATCH ISSUE (2026-11-02): same per-item logic as "issue" below, but one
    // bank lookup and ONE multi-row insert for the whole exam. All-or-nothing:
    // any unavailable item or insert failure returns an error and the client
    // falls back to issuing one question at a time.
    if (action === "issue_batch") {
      const raw = Array.isArray(body.item_ids) ? (body.item_ids as unknown[]) : [];
      const ids = raw.map(function (x) { return String(x || ""); }).filter(function (x) { return !!x; });
      const courseId = body.course_id ? String(body.course_id) : null;
      const examId = body.exam_id ? String(body.exam_id) : null;
      if (ids.length === 0 || ids.length > 150) return json({ error: "item_ids must hold 1-150 ids" }, 400);

      const { data: rows, error: ie } = await db
        .from("im_assessment_item")
        .select("id, generator_id, item_type, prompt, options, points, is_active")
        .in("id", ids);
      if (ie) return json({ error: "Item lookup failed: " + ie.message }, 400);
      // deno-lint-ignore no-explicit-any
      const byId: Record<string, any> = {};
      for (const r of (rows || [])) byId[r.id] = r;

      // deno-lint-ignore no-explicit-any
      const built: any[] = [];
      // deno-lint-ignore no-explicit-any
      const inserts: any[] = [];
      for (const itemId of ids) {
        const item = byId[itemId];
        if (!item || item.is_active === false) return json({ error: "Item not available: " + itemId }, 404);
        let itemType = item.item_type || "parameterized_numeric";
        let prompt = item.prompt || "";
        // deno-lint-ignore no-explicit-any
        let options: any = item.options || null;
        let points = (item.points === null || item.points === undefined) ? 1 : Number(item.points);
        // deno-lint-ignore no-explicit-any
        let figure: any = null;
        let seed: number | null = null;
        const genId = item.generator_id || null;
        if (genId) {
          seed = randSeed();
          const q = ENGINE.IMGenerators.generate(genId, seed);
          if (!q) return json({ error: "Unknown generator: " + genId }, 400);
          itemType = toItemType(q.kind);
          prompt = q.prompt;
          options = (q.kind === "mc") ? q.options : null;
          points = q.points ? Number(q.points) : 1;
          figure = q.diagramSpec ? toFigure(q.diagramSpec) : null;
        }
        built.push({ item_id: itemId, seed: seed, item_type: itemType, prompt: prompt, options: options, points: points, figure: figure });
        inserts.push({ exam_id: examId, student_id: studentId, course_id: courseId, item_id: itemId, generator_id: genId, seed: seed });
      }

      const { data: atts, error: ae } = await db
        .from("im_exam_attempt").insert(inserts).select("id, item_id, seed");
      if (ae) return json({ error: "Could not issue: " + ae.message }, 400);
      if (!atts || atts.length !== built.length) return json({ error: "Could not issue: row count mismatch" }, 500);

      // Match rows back by item_id + seed (do not rely on RETURNING order).
      // deno-lint-ignore no-explicit-any
      const pool: Record<string, any[]> = {};
      for (const a of atts) {
        const k = String(a.item_id) + "|" + String(a.seed);
        (pool[k] = pool[k] || []).push(a);
      }
      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const b of built) {
        const k = String(b.item_id) + "|" + String(b.seed);
        const a = pool[k] && pool[k].shift();
        if (!a) return json({ error: "Could not issue: unmatched row" }, 500);
        items.push({ item_id: b.item_id, attempt_id: a.id, item_type: b.item_type, prompt: b.prompt,
                     options: b.options, points: b.points, figure: b.figure });
      }
      return json({ items: items });
    }

    // ====================================================================
    // BATCH GRADE (2026-11-02): same per-item logic as "grade" below; one
    // attempt lookup, one key lookup, ONE write (im_apply_exam_grades).
    // Per-entry problems come back as {attempt_id, error} so the client can
    // regrade just those through the single-item path.
    if (action === "grade_batch") {
      const answers = Array.isArray(body.answers) ? (body.answers as unknown[]) : [];
      if (answers.length === 0 || answers.length > 150) return json({ error: "answers must hold 1-150 entries" }, 400);
      // deno-lint-ignore no-explicit-any
      const reqs = answers.map(function (a: any) {
        return {
          attempt_id: String((a && a.attempt_id) || ""),
          submitted: (a && a.submitted_value !== undefined && a.submitted_value !== null) ? String(a.submitted_value) : "",
        };
      });
      const ids = reqs.map(function (r) { return r.attempt_id; }).filter(function (x) { return !!x; });

      const { data: attRows, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, student_id, item_id, generator_id, seed, graded_at")
        .in("id", ids);
      if (ae) return json({ error: "Attempt lookup failed: " + ae.message }, 400);
      // deno-lint-ignore no-explicit-any
      const attById: Record<string, any> = {};
      for (const a of (attRows || [])) attById[a.id] = a;

      // static (non-generator) items: fetch their keys once
      const staticIds: string[] = [];
      for (const a of (attRows || [])) {
        if (!a.generator_id && a.item_id && staticIds.indexOf(a.item_id) < 0) staticIds.push(a.item_id);
      }
      // deno-lint-ignore no-explicit-any
      const itemById: Record<string, any> = {};
      // deno-lint-ignore no-explicit-any
      const keyById: Record<string, any> = {};
      if (staticIds.length) {
        const { data: its } = await db.from("im_assessment_item").select("id, item_type, points").in("id", staticIds);
        for (const it of (its || [])) itemById[it.id] = it;
        const { data: ks } = await db.from("im_assessment_item_key").select("item_id, answer, tolerance").in("item_id", staticIds);
        for (const k of (ks || [])) keyById[k.item_id] = k;
      }

      // deno-lint-ignore no-explicit-any
      const results: any[] = [];
      // deno-lint-ignore no-explicit-any
      const writes: any[] = [];
      for (const r of reqs) {
        const att = attById[r.attempt_id];
        if (!r.attempt_id || !att) { results.push({ attempt_id: r.attempt_id, error: "Attempt not found" }); continue; }
        if (att.student_id !== studentId) { results.push({ attempt_id: r.attempt_id, error: "Not your attempt" }); continue; }

        let kind = "";
        // deno-lint-ignore no-explicit-any
        let answer: any = null;
        let tolerance = 0.01;
        let points = 1;
        if (att.generator_id) {
          const q = ENGINE.IMGenerators.generate(att.generator_id, Number(att.seed) || 1);
          if (!q) { results.push({ attempt_id: r.attempt_id, error: "Regeneration failed" }); continue; }
          kind = q.kind;
          answer = q.answer;
          tolerance = (typeof q.tolerance === "number") ? q.tolerance : 0.01;
          points = q.points ? Number(q.points) : 1;
        } else {
          const item = itemById[att.item_id];
          const key = keyById[att.item_id];
          kind = item && item.item_type === "multiple_choice" ? "mc"
               : item && item.item_type === "free_response" ? "short"
               : item && item.item_type === "parameterized_decision" ? "decision" : "numeric";
          points = item && item.points ? Number(item.points) : 1;
          answer = key ? key.answer : null;
          tolerance = key && typeof key.tolerance === "number" ? key.tolerance : 0.01;
        }

        if (kind === "short") {
          writes.push({ id: att.id, student_id: studentId, submitted_value: r.submitted, is_correct: null, points_earned: null, graded: false });
          results.push({ attempt_id: r.attempt_id, is_correct: null, points_earned: 0, status: "pending_instructor_review" });
          continue;
        }
        let correct = false;
        if (kind === "mc") {
          correct = String(parseInt(r.submitted, 10)) === String(answer);
        } else if (kind === "decision") {
          correct = String(r.submitted).toLowerCase() === String(answer).toLowerCase();
        } else {
          const v = parseFloat(r.submitted);
          correct = !isNaN(v) && Math.abs(v - Number(answer)) <= tolerance;
        }
        const earned = correct ? points : 0;
        writes.push({ id: att.id, student_id: studentId, submitted_value: r.submitted, is_correct: correct, points_earned: earned, graded: true });
        results.push({ attempt_id: r.attempt_id, is_correct: correct, points_earned: earned, status: "graded" });
      }

      if (writes.length) {
        const { error: we } = await db.rpc("im_apply_exam_grades", { p_rows: writes });
        // Nothing was saved: tell the client so it regrades item by item.
        if (we) return json({ error: "Could not save grades: " + we.message }, 500);
      }
      return json({ results: results });
    }

    // ====================================================================
    if (action === "issue") {
      const itemId = String(body.item_id || "");
      const courseId = body.course_id ? String(body.course_id) : null;
      const examId = body.exam_id ? String(body.exam_id) : null;
      if (!itemId) return json({ error: "item_id required" }, 400);

      // look up the bank item (service role bypasses RLS)
      const { data: item, error: ie } = await db
        .from("im_assessment_item")
        .select("id, generator_id, item_type, prompt, options, points, is_active")
        .eq("id", itemId).maybeSingle();
      if (ie) return json({ error: "Item lookup failed: " + ie.message }, 400);
      if (!item || item.is_active === false) return json({ error: "Item not available" }, 404);

      let itemType = item.item_type || "parameterized_numeric";
      let prompt = item.prompt || "";
      // deno-lint-ignore no-explicit-any
      let options: any = item.options || null;
      let points = (item.points === null || item.points === undefined) ? 1 : Number(item.points);
      // deno-lint-ignore no-explicit-any
      let figure: any = null;
      let seed: number | null = null;
      const genId = item.generator_id || null;

      if (genId) {
        // GENERATOR-BACKED: produce a fresh instance
        seed = randSeed();
        const q = ENGINE.IMGenerators.generate(genId, seed);
        if (!q) return json({ error: "Unknown generator: " + genId }, 400);
        itemType = toItemType(q.kind);
        prompt = q.prompt;
        options = (q.kind === "mc") ? q.options : null;
        points = q.points ? Number(q.points) : 1;
        figure = q.diagramSpec ? toFigure(q.diagramSpec) : null;
      }

      // record the attempt (seed lets grade regenerate the exact instance)
      const { data: att, error: ae } = await db
        .from("im_exam_attempt")
        .insert({
          exam_id: examId, student_id: studentId, course_id: courseId,
          item_id: itemId, generator_id: genId, seed: seed,
        })
        .select("id").single();
      if (ae) return json({ error: "Could not issue: " + ae.message }, 400);

      return json({
        attempt_id: att.id, item_type: itemType, prompt: prompt,
        options: options, points: points, figure: figure,
      });
    }

    // ====================================================================
    if (action === "grade") {
      const attemptId = String(body.attempt_id || "");
      const submitted = (body.submitted_value === undefined || body.submitted_value === null)
        ? "" : String(body.submitted_value);
      if (!attemptId) return json({ error: "attempt_id required" }, 400);

      // load the attempt (must belong to caller)
      const { data: att, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, student_id, item_id, generator_id, seed, graded_at")
        .eq("id", attemptId).maybeSingle();
      if (ae || !att) return json({ error: "Attempt not found" }, 404);
      if (att.student_id !== studentId) return json({ error: "Not your attempt" }, 403);

      // resolve the correct answer + kind by regenerating (or from the static row)
      let kind = "";
      // deno-lint-ignore no-explicit-any
      let answer: any = null;
      let tolerance = 0.01;
      let points = 1;

      if (att.generator_id) {
        const q = ENGINE.IMGenerators.generate(att.generator_id, Number(att.seed) || 1);
        if (!q) return json({ error: "Regeneration failed" }, 400);
        kind = q.kind;
        answer = q.answer;
        tolerance = (typeof q.tolerance === "number") ? q.tolerance : 0.01;
        points = q.points ? Number(q.points) : 1;
      } else {
        // static item fallback: read vaulted key
        const { data: item } = await db
          .from("im_assessment_item").select("item_type, points").eq("id", att.item_id).maybeSingle();
        const { data: key } = await db
          .from("im_assessment_item_key").select("answer, tolerance").eq("item_id", att.item_id).maybeSingle();
        kind = item && item.item_type === "multiple_choice" ? "mc"
             : item && item.item_type === "free_response" ? "short"
             : item && item.item_type === "parameterized_decision" ? "decision" : "numeric";
        points = item && item.points ? Number(item.points) : 1;
        answer = key ? key.answer : null;
        tolerance = key && typeof key.tolerance === "number" ? key.tolerance : 0.01;
      }

      // written answers are not auto-graded
      if (kind === "short") {
        await db.from("im_exam_attempt")
          .update({ submitted_value: submitted, is_correct: null, points_earned: null })
          .eq("id", attemptId);
        return json({ is_correct: null, points_earned: 0, status: "pending_instructor_review" });
      }

      // auto-grade mc / numeric / decision
      let correct = false;
      if (kind === "mc" || kind === "decision") {
        // submitted is the selected index (mc) or 'yes'/'no' (decision) -> compare as string/int
        if (kind === "mc") {
          correct = String(parseInt(submitted, 10)) === String(answer);
        } else {
          correct = String(submitted).toLowerCase() === String(answer).toLowerCase();
        }
      } else {
        const v = parseFloat(submitted);
        correct = !isNaN(v) && Math.abs(v - Number(answer)) <= tolerance;
      }
      const earned = correct ? points : 0;

      await db.from("im_exam_attempt")
        .update({
          submitted_value: submitted, is_correct: correct,
          points_earned: earned, graded_at: new Date().toISOString(),
        })
        .eq("id", attemptId);

      return json({ is_correct: correct, points_earned: earned, status: "graded" });
    }

    // ====================================================================
    // REVIEW: return the student's WRONG questions for one exam, but only
    // once review is open (instructor released it AND the deadline passed).
    // The deadline/permission test lives in the database (im_review_open) so
    // the browser cannot talk its way past it.
    if (action === "review") {
      const examId = String(body.exam_id || "");
      const courseId = String(body.course_id || "");
      if (!examId || !courseId) return json({ error: "exam_id and course_id required" }, 400);

      const { data: openRow, error: oe } = await db
        .rpc("im_review_open", { p_course: courseId, p_kind: "exam", p_ref: examId });
      if (oe) return json({ error: "Could not check review status: " + oe.message }, 400);
      if (openRow !== true) {
        return json({ ok: true, open: false, items: [],
          note: "Review is not open for this exam yet." });
      }

      // wrong (and ungraded-written) attempts belonging to THIS student
      const { data: atts, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, item_id, generator_id, seed, submitted_value, is_correct, points_earned")
        .eq("exam_id", examId).eq("student_id", studentId)
        .not("graded_at", "is", null)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // wrong_only is the platform policy; read it so a future "full review"
      // setting is honoured without changing this function.
      const { data: courseRow } = await db
        .from("im_course").select("review_wrong_only").eq("id", courseId).maybeSingle();
      const wrongOnly = !courseRow || courseRow.review_wrong_only !== false;

      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const a of (atts || [])) {
        if (wrongOnly && a.is_correct === true) continue;   // skip what they got right
        // deno-lint-ignore no-explicit-any
        let q: any = null;
        if (a.generator_id) {
          q = ENGINE.IMGenerators.generate(a.generator_id, Number(a.seed) || 1);
        }
        if (!q) continue;
        items.push({
          attempt_id: a.id,
          item_type: toItemType(q.kind),
          prompt: q.prompt,
          options: (q.kind === "mc") ? q.options : null,
          figure: q.diagramSpec ? toFigure(q.diagramSpec) : null,
          your_answer: a.submitted_value,
          correct_answer: q.answer,
          rationale: q.rationale || null,
          is_correct: a.is_correct,
          points_earned: a.points_earned,
        });
      }
      return json({ ok: true, open: true, wrong_only: wrongOnly, items: items });
    }

    // ====================================================================
    // QUIZ_REVIEW: a STUDENT reviews the chapter-quiz questions they missed,
    // once the instructor's deadline for that chapter's quiz has passed. Mirrors
    // the exam "review" action but for chapter quizzes (im_exam_attempt rows with
    // exam_id NULL, grouped by the bank item's chapter). Gate = im_quiz_deadline
    // (course-wide) with any per-student im_assessment_accommodation override.
    // Answers are regenerated server-side from the stored seed, so a correct
    // answer never reaches the browser before the deadline passes.
    if (action === "quiz_review") {
      const courseId = String(body.course_id || "");
      const chapter = (body.chapter === undefined || body.chapter === null)
        ? NaN : Number(body.chapter);
      if (!courseId || isNaN(chapter)) {
        return json({ error: "course_id and chapter required" }, 400);
      }

      // 1) course-wide close time for this chapter's quiz
      const { data: dl } = await db
        .from("im_quiz_deadline").select("closes_at")
        .eq("course_id", courseId).eq("chapter", chapter).maybeSingle();
      let closeMs = (dl && dl.closes_at) ? new Date(dl.closes_at).getTime() : null;

      // 2) per-student override (a reschedule wins over the course deadline)
      const { data: accs } = await db
        .from("im_assessment_accommodation")
        .select("ref_id, due_override, kind")
        .eq("student_id", studentId).eq("course_id", courseId).eq("kind", "quiz");
      for (const a of (accs || [])) {
        if (String(a.ref_id) === String(chapter) && a.due_override) {
          closeMs = new Date(a.due_override).getTime();
        }
      }

      // gate: no deadline -> review off; deadline still in the future -> not yet
      if (closeMs === null) {
        return json({ ok: true, open: false,
          note: "Review isn't open for this quiz. Your instructor turns it on by setting a deadline for this chapter's quiz." });
      }
      if (Date.now() < closeMs) {
        return json({ ok: true, open: false,
          note: "Review opens after this chapter's quiz deadline (" + new Date(closeMs).toLocaleString() + ")." });
      }

      // 3) the student's OWN graded chapter-quiz attempts. Quiz rows (written by
      //    im-grade-quiz) carry generator_id + seed but NO item_id, and there is
      //    no chapter column -- so map each attempt's chapter FROM its generator:
      //    first via the bank (im_assessment_item.generator_id -> chapter), then
      //    falling back to the generator id's own "chN_" prefix.
      const { data: atts, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, generator_id, seed, submitted_value, is_correct, points_earned, regrade_note, ai_feedback")
        .eq("course_id", courseId).eq("student_id", studentId)
        .is("exam_id", null)
        .not("graded_at", "is", null)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // map generator_id -> chapter via the bank (no FK / embed needed)
      // deno-lint-ignore no-explicit-any
      const genIds: any[] = [];
      for (const a of (atts || [])) {
        if (a.generator_id && genIds.indexOf(a.generator_id) < 0) genIds.push(a.generator_id);
      }
      // deno-lint-ignore no-explicit-any
      const chapterOfGen: any = {};
      if (genIds.length) {
        const { data: bank } = await db
          .from("im_assessment_item").select("generator_id, chapter").in("generator_id", genIds);
        for (const b of (bank || [])) {
          if (b.generator_id != null && b.chapter != null && chapterOfGen[b.generator_id] === undefined) {
            chapterOfGen[b.generator_id] = Number(b.chapter);
          }
        }
      }
      // deno-lint-ignore no-explicit-any
      function chapterForGen(gen: any): number {
        if (gen == null) return NaN;
        if (chapterOfGen[gen] !== undefined) return chapterOfGen[gen];
        const m = /^ch(\d+)_/i.exec(String(gen));
        return m ? Number(m[1]) : NaN;
      }

      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const a of (atts || [])) {
        if (chapterForGen(a.generator_id) !== chapter) continue;   // this chapter only
        // deno-lint-ignore no-explicit-any
        let q: any = null;
        if (a.generator_id) q = ENGINE.IMGenerators.generate(a.generator_id, Number(a.seed) || 1);
        if (!q) continue;
        // "missed" across ALL question types: auto-graded items (MC / numeric /
        // decision) use is_correct; written / short items (is_correct null, scored
        // by points) are missed only when the student did not earn full marks.
        const maxPts = (q.points !== undefined && q.points !== null) ? Number(q.points) : 1;
        const earned = (a.points_earned !== undefined && a.points_earned !== null) ? Number(a.points_earned) : 0;
        let missed: boolean;
        if (a.is_correct === true) missed = false;
        else if (a.is_correct === false) missed = true;
        else missed = earned < maxPts;
        if (!missed) continue;
        items.push({
          attempt_id: a.id,
          item_type: toItemType(q.kind),
          prompt: q.prompt,
          options: (q.kind === "mc") ? q.options : null,
          figure: q.diagramSpec ? toFigure(q.diagramSpec) : null,
          your_answer: a.submitted_value,
          correct_answer: q.answer,
          rationale: q.rationale || null,
          is_correct: a.is_correct,
          points_earned: a.points_earned,
          max_points: maxPts,
          feedback: (a.regrade_note != null && a.regrade_note !== "") ? a.regrade_note
                    : ((a.ai_feedback != null && a.ai_feedback !== "") ? a.ai_feedback : null),
        });
      }
      return json({ ok: true, open: true, items: items });
    }

    // ====================================================================
    // STUDENT_WORK: an instructor (or a TA with grading permission) sees a
    // student's FULL attempt for one exam -- every question, what the student
    // answered, the correct answer, and the points awarded. Unlike "review"
    // this is not deadline-gated and is not limited to wrong answers, because
    // it is staff-facing. Access is verified against the course before any
    // answer is returned.
    if (action === "student_work") {
      const examId = String(body.exam_id || "");
      const targetStudent = String(body.student_id || "");
      if (!examId || !targetStudent) {
        return json({ error: "exam_id and student_id required" }, 400);
      }

      // which course is this exam in?
      const { data: exam, error: xe } = await db
        .from("im_exam").select("id, course_id, title, total_points")
        .eq("id", examId).maybeSingle();
      if (xe || !exam) return json({ error: "Exam not found" }, 404);

      // caller must own the course, be an admin, or be a TA with can_grade
      const { data: course } = await db
        .from("im_course").select("owner_id").eq("id", exam.course_id).maybeSingle();
      const { data: me } = await db
        .from("im_person").select("role").eq("user_id", studentId).maybeSingle();
      let allowed = (!!course && course.owner_id === studentId) || (!!me && me.role === "admin");
      if (!allowed) {
        const { data: staff } = await db
          .from("im_course_staff").select("can_grade, can_view_grades")
          .eq("course_id", exam.course_id).eq("user_id", studentId).maybeSingle();
        allowed = !!staff && (staff.can_grade === true || staff.can_view_grades === true);
      }
      if (!allowed) return json({ error: "Not allowed to view this student's work" }, 403);

      const { data: atts, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, item_id, generator_id, seed, submitted_value, is_correct, points_earned, graded_at, original_points, regraded_by, regraded_at, regrade_note")
        .eq("exam_id", examId).eq("student_id", targetStudent)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const a of (atts || [])) {
        // deno-lint-ignore no-explicit-any
        let q: any = null;
        if (a.generator_id) {
          q = ENGINE.IMGenerators.generate(a.generator_id, Number(a.seed) || 1);
        }
        items.push({
          attempt_id: a.id,
          item_type: q ? toItemType(q.kind) : "free_response",
          prompt: q ? q.prompt : "(question could not be regenerated)",
          options: (q && q.kind === "mc") ? q.options : null,
          figure: (q && q.diagramSpec) ? toFigure(q.diagramSpec) : null,
          your_answer: a.submitted_value,
          correct_answer: q ? q.answer : null,
          rationale: q ? (q.rationale || null) : null,
          max_points: q ? (q.points || 1) : 1,
          is_correct: a.is_correct,
          points_earned: a.points_earned,
          graded: a.graded_at !== null,
          original_points: a.original_points,
          regraded_by: a.regraded_by,
          regraded_at: a.regraded_at,
          regrade_note: a.regrade_note,
        });
      }
      return json({ ok: true, exam: { id: exam.id, title: exam.title, total_points: exam.total_points }, items: items });
    }

    // ====================================================================
    // QUIZ_WORK: a student's chapter-quiz questions. Quiz questions are stored
    // in im_exam_attempt with exam_id null; we group them by the chapter of the
    // underlying bank item. Staff-facing, same permission test as student_work.
    if (action === "quiz_work") {
      const courseId = String(body.course_id || "");
      const targetStudent = String(body.student_id || "");
      const chapter = body.chapter === undefined || body.chapter === null
        ? null : Number(body.chapter);
      if (!courseId || !targetStudent) {
        return json({ error: "course_id and student_id required" }, 400);
      }
      if (!(await canGradeCourse(db, courseId, studentId))) {
        return json({ error: "Not allowed to view this student's work" }, 403);
      }

      const { data: atts, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, item_id, generator_id, seed, submitted_value, is_correct, points_earned, graded_at, original_points, regraded_by, regraded_at, regrade_note, im_assessment_item(chapter, points)")
        .eq("course_id", courseId).eq("student_id", targetStudent)
        .is("exam_id", null)
        .not("graded_at", "is", null)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const a of (atts || [])) {
        // deno-lint-ignore no-explicit-any
        const bank: any = a.im_assessment_item || {};
        if (chapter !== null && Number(bank.chapter) !== chapter) continue;
        // deno-lint-ignore no-explicit-any
        let q: any = null;
        if (a.generator_id) q = ENGINE.IMGenerators.generate(a.generator_id, Number(a.seed) || 1);
        items.push({
          attempt_id: a.id,
          chapter: bank.chapter,
          item_type: q ? toItemType(q.kind) : "free_response",
          prompt: q ? q.prompt : "(question could not be regenerated)",
          options: (q && q.kind === "mc") ? q.options : null,
          figure: (q && q.diagramSpec) ? toFigure(q.diagramSpec) : null,
          your_answer: a.submitted_value,
          correct_answer: q ? q.answer : null,
          rationale: q ? (q.rationale || null) : null,
          max_points: q ? (q.points || 1) : (bank.points || 1),
          is_correct: a.is_correct,
          points_earned: a.points_earned,
          original_points: a.original_points,
          regraded_by: a.regraded_by,
          regraded_at: a.regraded_at,
          regrade_note: a.regrade_note,
        });
      }
      return json({ ok: true, items: items });
    }

    // ====================================================================
    // ARENA_WORK: a student's logged arena submissions for one arena, with the
    // correct code from the vault (which only the service role can read).
    if (action === "arena_work") {
      const courseId = String(body.course_id || "");
      const targetStudent = String(body.student_id || "");
      const arenaSlug = String(body.arena_slug || "");
      if (!courseId || !targetStudent || !arenaSlug) {
        return json({ error: "course_id, student_id and arena_slug required" }, 400);
      }
      if (!(await canGradeCourse(db, courseId, studentId))) {
        return json({ error: "Not allowed to view this student's work" }, 403);
      }

      const { data: cfg } = await db
        .from("im_arena_config").select("arena_slug, title, chapter, case_count, grading_mode")
        .eq("arena_slug", arenaSlug).maybeSingle();
      const { data: keys } = await db
        .from("im_answer_key").select("case_index, correct_code").eq("arena_slug", arenaSlug);
      const keyOf: Record<string, string> = {};
      for (const k of (keys || [])) keyOf[String(k.case_index)] = k.correct_code;

      const { data: atts, error: ae } = await db
        .from("im_attempt")
        .select("id, case_index, submitted, is_correct, created_at, original_correct, regraded_by, regraded_at, regrade_note")
        .eq("user_id", targetStudent).eq("arena_slug", arenaSlug)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // deno-lint-ignore no-explicit-any
      const items = (atts || []).map((a: any) => ({
        attempt_id: a.id,
        case_index: a.case_index,
        your_answer: a.submitted,
        correct_answer: a.case_index === null ? null : (keyOf[String(a.case_index)] || null),
        is_correct: a.is_correct,
        attempted_at: a.created_at,
        original_correct: a.original_correct,
        regraded_by: a.regraded_by,
        regraded_at: a.regraded_at,
        regrade_note: a.regrade_note,
      }));
      return json({ ok: true, arena: cfg || { arena_slug: arenaSlug }, items: items });
    }

    // ====================================================================
    // PREVIEW: a staff-facing look at one bank item as students will see it,
    // including its diagram/table. The bank stores prompt text only (the figure
    // is produced by the generator at issue time), so the exam builder needs
    // this to show the picture. Deliberately does NOT return the answer.
    if (action === "preview") {
      const itemId = String(body.item_id || "");
      const seed = body.seed ? Number(body.seed) : 1;
      if (!itemId) return json({ error: "item_id required" }, 400);

      // any instructor/admin/TA may preview the bank; students may not.
      const { data: me } = await db
        .from("im_person").select("role").eq("user_id", studentId).maybeSingle();
      let allowed = !!me && (me.role === "admin" || me.role === "professor");
      if (!allowed) {
        const { data: anyStaff } = await db
          .from("im_course_staff").select("id").eq("user_id", studentId).limit(1);
        allowed = !!anyStaff && anyStaff.length > 0;
      }
      if (!allowed) return json({ error: "Staff only" }, 403);

      const { data: item, error: ie } = await db
        .from("im_assessment_item")
        .select("id, generator_id, item_type, prompt, options, points")
        .eq("id", itemId).maybeSingle();
      if (ie || !item) return json({ error: "Item not found" }, 404);

      if (!item.generator_id) {
        // static item: whatever is stored is all there is
        return json({ ok: true, item_type: item.item_type, prompt: item.prompt,
          options: item.options, points: item.points, figure: null });
      }
      const q = ENGINE.IMGenerators.generate(item.generator_id, seed || 1);
      if (!q) return json({ error: "Unknown generator: " + item.generator_id }, 400);
      return json({
        ok: true,
        item_type: toItemType(q.kind),
        prompt: q.prompt,
        options: (q.kind === "mc") ? q.options : null,
        points: q.points || 1,
        figure: q.diagramSpec ? toFigure(q.diagramSpec) : null,
      });
    }

    // ====================================================================
    // RESUME: return the questions the student was issued for this exam but has
    // not yet answered (graded_at null), so an interrupted exam can be finished.
    // Each attempt stored its generator_id + seed at issue time, so we
    // regenerate the exact same instance the student saw. Answers never returned.
    if (action === "resume") {
      const examId = String(body.exam_id || "");
      if (!examId) return json({ error: "exam_id required" }, 400);

      const { data: atts, error: ae } = await db
        .from("im_exam_attempt")
        .select("id, item_id, generator_id, seed, submitted_value, graded_at")
        .eq("exam_id", examId).eq("student_id", studentId)
        .is("graded_at", null)
        .order("created_at");
      if (ae) return json({ error: ae.message }, 400);

      // deno-lint-ignore no-explicit-any
      const items: any[] = [];
      for (const a of (atts || [])) {
        // skip any that already have a submitted value pending grade
        if (a.submitted_value !== null && a.submitted_value !== undefined) continue;
        // deno-lint-ignore no-explicit-any
        let q: any = null;
        if (a.generator_id) {
          q = ENGINE.IMGenerators.generate(a.generator_id, Number(a.seed) || 1);
        }
        if (!q) {
          // static item: fetch its stored prompt/options
          const { data: item } = await db
            .from("im_assessment_item")
            .select("item_type, prompt, options, points")
            .eq("id", a.item_id).maybeSingle();
          items.push({
            attempt_id: a.id,
            item_type: item ? (item.item_type || "free_response") : "free_response",
            prompt: item ? item.prompt : "(question unavailable)",
            options: item ? item.options : null,
            points: item ? (item.points || 1) : 1,
            figure: null,
          });
          continue;
        }
        items.push({
          attempt_id: a.id,
          item_type: toItemType(q.kind),
          prompt: q.prompt,
          options: (q.kind === "mc") ? q.options : null,
          points: q.points ? Number(q.points) : 1,
          figure: q.diagramSpec ? toFigure(q.diagramSpec) : null,
        });
      }
      return json({ ok: true, items: items });
    }

    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// ============================================================================
//  BUILD NOTE
//  The two constants below (DIAGRAMS_SRC, GENERATORS_SRC) are the FULL text of
//  im-diagrams.js and im-generators.js, injected by build-grade-attempt.sh so
//  this function stays byte-identical to the browser engine. Do not edit them by
//  hand — re-run the build script whenever the generators change:
//     ./build-grade-attempt.sh
//  (In this checked-in copy they are placeholders; the build script replaces the
//   two `const X = String.raw\`...\`;` lines with the real source.)
// ============================================================================
