-- im_self_study: paid per-student self-study with Asha for Microeconomics, generated from the Financial Derivatives originals (gen.py).
alter table public.im_course add column if not exists is_self_study boolean not null default false;
create table if not exists public.im_selfstudy_section (chapter int not null, sec int not null, title text not null, primary key (chapter, sec));
alter table public.im_selfstudy_section enable row level security;
drop policy if exists im_selfstudy_section_read on public.im_selfstudy_section;
create policy im_selfstudy_section_read on public.im_selfstudy_section for select using (true);
revoke insert, update, delete, truncate on public.im_selfstudy_section from anon, authenticated;
grant select on public.im_selfstudy_section to anon, authenticated;
delete from public.im_selfstudy_section;
delete from public.im_selfstudy_section;
insert into public.im_selfstudy_section (chapter, sec, title) values
(1, 1, 'Theme One — Scarcity forces choice'),
(1, 2, 'Theme Two — Incentives matter (and often backfire)'),
(1, 3, 'Theme Three — Trade and specialization create value'),
(1, 4, 'Theme Four — Markets coordinate, and sometimes fail'),
(1, 5, 'Theme Five — Rational choice happens at the margin'),
(1, 6, 'Theme Six — The rules of the game shape the outcome'),
(2, 1, 'Models are deliberate simplifications — that is the point'),
(2, 2, 'What is versus what ought to be'),
(2, 3, '"They move together" is not "one causes the other"'),
(2, 4, 'The most useful question an economist asks: "compared to what?"'),
(2, 5, 'Why economists disagree'),
(3, 1, 'Better at everything — and still worth trading'),
(3, 2, 'Where the gains actually come from'),
(3, 3, 'Seeing it on the frontier'),
(3, 4, 'The price has to land in a band'),
(3, 5, 'The half the clean story leaves out'),
(4, 1, 'What a market is'),
(4, 2, 'Demand: buyers step back as the price rises'),
(4, 3, 'Supply: sellers offer more as the price rises'),
(4, 4, 'Equilibrium: where the two meet'),
(4, 5, 'Reading the world: which curve moved?'),
(5, 1, 'Price elasticity of demand'),
(5, 2, 'Elastic, inelastic, and unit elastic'),
(5, 3, 'What determines elasticity'),
(5, 4, 'Elasticity and total revenue'),
(5, 5, 'Three more elasticities worth knowing'),
(6, 1, 'Price ceilings: rent control'),
(6, 2, 'Price floors: the minimum wage'),
(6, 3, 'Taxes and who really pays'),
(6, 4, 'Subsidies: when the government wants more'),
(6, 5, 'Opening the border: the world price'),
(6, 6, 'Tariffs'),
(6, 7, 'Import quotas'),
(7, 1, 'Willingness to pay and consumer surplus'),
(7, 2, 'Cost and producer surplus'),
(7, 3, 'Total surplus and the efficiency of equilibrium'),
(7, 4, 'Deadweight loss: the cost of getting it wrong'),
(7, 5, 'The welfare of trade policy'),
(8, 1, 'The budget constraint'),
(8, 2, 'Utility and diminishing marginal utility'),
(8, 3, 'The consumer''s optimum: the equimarginal rule'),
(8, 4, 'Indifference curves and the optimum bundle'),
(8, 5, 'From the optimum to the demand curve'),
(8, 6, 'The diamond-water paradox'),
(9, 1, 'The production function and the short run'),
(9, 2, 'Marginal product and diminishing returns'),
(9, 3, 'From production to cost'),
(9, 4, 'The shape of the cost curves'),
(9, 5, 'The long run: economies and diseconomies of scale'),
(10, 1, 'The competitive firm is a price taker'),
(10, 2, 'Profit maximization: produce where P = MC'),
(10, 3, 'The firm''s short-run outcomes'),
(10, 4, 'Deriving the firm''s supply curve'),
(10, 5, 'From the short run to the long run'),
(11, 1, 'Why monopolies exist'),
(11, 2, 'The monopolist''s revenue: marginal revenue lies below price'),
(11, 3, 'Profit maximization and the cost of market power'),
(11, 4, 'Natural monopoly'),
(11, 5, 'Regulating monopoly'),
(11, 6, 'Price discrimination'),
(12, 1, 'What makes it its own structure'),
(12, 2, 'The short run: a small monopolist'),
(12, 3, 'The long run: entry competes the profit away'),
(12, 4, 'Excess capacity and the markup'),
(12, 5, 'Differentiation, advertising, and the value of variety'),
(12, 6, 'The three structures side by side'),
(13, 1, 'Strategic interdependence'),
(13, 2, 'Dominant strategies and the Nash equilibrium'),
(13, 3, 'The prisoner''s dilemma'),
(13, 4, 'Oligopoly pricing, collusion, and cartels'),
(13, 5, 'Why some cartels survive: repeated games'),
(13, 6, 'Sequential games and credible threats'),
(14, 1, 'The demand for labor is a derived demand'),
(14, 2, 'How many workers? The hiring rule'),
(14, 3, 'Labor supply and the market wage'),
(14, 4, 'Why wages differ'),
(14, 5, 'Land and capital, briefly'),
(15, 1, 'Private cost, social cost'),
(15, 2, 'The corrective tax: making prices tell the truth'),
(15, 3, 'Positive externalities: the mirror image'),
(15, 4, 'Private solutions and the Coase theorem'),
(15, 5, 'Public goods and common resources'),
(16, 1, 'The market for lemons'),
(16, 2, 'Moral hazard: the hidden action'),
(16, 3, 'Signaling: proving what you know'),
(16, 4, 'Screening: designing the menu'),
(16, 5, 'How much should the market''s fixes reassure us?'),
(17, 1, 'A choice, twice'),
(17, 2, 'Losses loom larger: prospect theory'),
(17, 3, 'Judging under uncertainty: heuristics and their signatures'),
(17, 4, 'Choice architecture and nudges'),
(17, 5, 'How much survives? The defense of the standard model');
create table if not exists public.im_selfstudy_plan (
  course_id uuid primary key references public.im_course(id) on delete cascade,
  student_id text not null unique,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','awaiting_setup','active','completed','cancelled')),
  weeks int, days int[], start_local time, minutes int, tz text, starts_on date, ends_at timestamptz, classes int,
  midterm_id uuid, final_id uuid,
  created_at timestamptz not null default now(), paid_at timestamptz, configured_at timestamptz, paid_by text
);
alter table public.im_selfstudy_plan enable row level security;
drop policy if exists im_selfstudy_plan_read on public.im_selfstudy_plan;
create policy im_selfstudy_plan_read on public.im_selfstudy_plan for select using (student_id = auth.uid()::text or im_is_admin());
revoke insert, update, delete, truncate on public.im_selfstudy_plan from anon, authenticated;
grant select on public.im_selfstudy_plan to authenticated;
create or replace function public.im_course_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_caller text := nullif(current_setting('request.jwt.claim.sub', true), '');
begin
  -- no JWT => service role / migration / seed; the self-study RPC sets im.selfstudy for its own insert
  if v_caller is null or coalesce(current_setting('im.selfstudy', true), '') = '1' then return new; end if;
  if not exists (select 1 from im_person p where p.user_id = v_caller and p.role = 'admin') then
    if new.requires_payment is distinct from true then new.requires_payment := true; end if;    -- a non-admin may never waive the fee
    if tg_op = 'INSERT' then new.is_self_study := false;                                          -- nor mark a course self-study
    elsif new.is_self_study is distinct from old.is_self_study then new.is_self_study := old.is_self_study; end if;
  end if;
  return new;
end $$;
create or replace function public.im__selfstudy_owner() returns text language sql stable security definer set search_path = public as $$
  select p.user_id from im_person p where p.role = 'admin' order by p.user_id limit 1
$$;
create or replace function public.im__selfstudy_status(p_student text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pl im_selfstudy_plan; nxt record; enr text; ps im_platform_setting;
begin
  select * into ps from im_platform_setting order by (id::text = '1') desc, id limit 1;
  select * into pl from im_selfstudy_plan where student_id = p_student;
  if not found then
    return jsonb_build_object('status', 'none', 'enabled', coalesce(ps.self_study_enabled, false), 'price_cents', ps.price_cents, 'currency', ps.currency);
  end if;
  select status::text into enr from im_enrollment where course_id = pl.course_id and student_id = p_student;
  select s.title, s.starts_at, s.duration_min into nxt from im_ai_class_session s
   where s.course_id = pl.course_id and s.status in ('planned','live') and s.starts_at + make_interval(mins => s.duration_min) > now() order by s.starts_at limit 1;
  return jsonb_build_object('status', pl.status, 'enabled', coalesce(ps.self_study_enabled, false), 'course_id', pl.course_id, 'enrollment', enr,
    'price_cents', ps.price_cents, 'currency', ps.currency, 'weeks', pl.weeks, 'days', to_jsonb(pl.days), 'start_local', to_char(pl.start_local, 'HH24:MI'),
    'minutes', pl.minutes, 'tz', pl.tz, 'starts_on', pl.starts_on, 'ends_at', pl.ends_at, 'classes', pl.classes,
    'next_title', nxt.title, 'next_at', nxt.starts_at, 'next_minutes', nxt.duration_min,
    'started', exists (select 1 from im_ai_class_session s where s.course_id = pl.course_id and s.status <> 'planned'),
    'midterm', (select jsonb_build_object('opens', opens_at, 'closes', closes_at) from im_exam where id = pl.midterm_id),
    'final', (select jsonb_build_object('opens', opens_at, 'closes', closes_at) from im_exam where id = pl.final_id));
end $$;
create or replace function public.im_selfstudy_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare u text := auth.uid()::text;
begin
  if u is null or u = '' then return jsonb_build_object('status', 'signed_out'); end if;
  return im__selfstudy_status(u);
end $$;
create or replace function public.im__selfstudy_activate(p_student text) returns boolean language plpgsql security definer set search_path = public as $$
declare pl im_selfstudy_plan; e im_enrollment; pay text;
begin
  select * into pl from im_selfstudy_plan where student_id = p_student and status = 'awaiting_payment';
  if not found then return false; end if;
  select * into e from im_enrollment where course_id = pl.course_id and student_id = p_student;
  if e.status = 'active' then pay := 'admin';
  elsif exists (select 1 from im_fee_waiver w where w.course_id = pl.course_id and (w.student_id is null or w.student_id = p_student)) then pay := 'waiver';
  else
    select m.id into pay from mp_payments m
     where m.client_reference_id = p_student || '__' || pl.course_id::text and m.amount_cents - coalesce(m.refunded_cents, 0) > 0
     order by m.created_at_stripe desc limit 1;
  end if;
  if pay is null then return false; end if;
  update im_enrollment set status = 'active', activated_at = coalesce(activated_at, now()) where course_id = pl.course_id and student_id = p_student;
  update im_selfstudy_plan set status = 'awaiting_setup', paid_at = now(), paid_by = pay where course_id = pl.course_id;
  return true;
end $$;
create or replace function public.im_selfstudy_check_payment() returns jsonb language plpgsql security definer set search_path = public as $$
declare u text := auth.uid()::text;
begin
  if u is null or u = '' then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  perform im__selfstudy_activate(u);
  return im__selfstudy_status(u);
end $$;
create or replace function public.im_selfstudy_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare u text := auth.uid()::text; owner text; cid uuid; ps im_platform_setting;
begin
  if u is null or u = '' then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if exists (select 1 from im_selfstudy_plan where student_id = u) then return im__selfstudy_status(u); end if;
  select * into ps from im_platform_setting order by (id::text = '1') desc, id limit 1;
  if not coalesce(ps.self_study_enabled, false) then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if exists (select 1 from im_person p where p.user_id = u and p.role in ('professor', 'admin')) then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  owner := im__selfstudy_owner();
  if owner is null then return jsonb_build_object('ok', false, 'reason', 'no_admin'); end if;
  insert into im_person (user_id, email, full_name, role) select u, au.email, coalesce(au.raw_user_meta_data ->> 'full_name', ''), 'student' from auth.users au where au.id::text = u on conflict (user_id) do nothing;
  perform set_config('im.selfstudy', '1', true);
  insert into im_course (title, term, description, owner_id, requires_payment, is_self_study, review_quizzes, review_arenas, review_exams,
                         weight_reading, weight_quizzes, weight_arenas, weight_midterm, weight_final, weight_attendance, weight_assignments)
  values ('Microeconomics — Self-Study', 'Self-study with Asha', 'A private self-study section taught by Asha, the AI professor, on the schedule the student chose.',
          owner, true, true, true, true, true, 0.05, 0.20, 0.20, 0.20, 0.30, 0.05, 0)
  returning id into cid;
  perform set_config('im.selfstudy', '', true);
  insert into im_enrollment (course_id, student_id, user_id, status, source) values (cid, u, u, 'pending', 'self_study');
  insert into im_selfstudy_plan (course_id, student_id) values (cid, u);
  update im_ai_settings set enabled = true, professor_mode = true, prof_paused = true, payer = 'platform', review_enabled = true, course_monthly_usd = 10 where course_id = cid;
  perform im__selfstudy_activate(u);
  return im__selfstudy_status(u);
end $$;
create or replace function public.im_selfstudy_configure(p_weeks int, p_start_date date, p_days int[], p_start text, p_minutes int, p_tz text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u text := auth.uid()::text; pl im_selfstudy_plan; owner text; st time; today date; term_end timestamptz; cutoff date; d date; ts timestamptz;
  slots timestamptz[] := '{}'; n int; rev int; l int; m int; total int; i int; j int; a int; b int; k int; cfirst int; clast int;
  srow record; secs_c int[] := '{}'; secs_s int[] := '{}'; secs_t text[] := '{}'; outl jsonb; ttl text; ctitle text; lec_end int[] := '{}'; lec_ts timestamptz[] := '{}';
  ch_done timestamptz[]; mid_ch int := 0; mid_open timestamptz; mid_close timestamptz; fin_open timestamptz; seq int := 0; slot int := 0;
  mid_items uuid[]; fin_items uuid[]; mid_id uuid; fin_id uuid; due timestamptz; arena record; dl timestamptz;
begin
  if u is null or u = '' then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into pl from im_selfstudy_plan where student_id = u for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_plan'); end if;
  if pl.status = 'awaiting_payment' then return jsonb_build_object('ok', false, 'reason', 'not_paid'); end if;
  if pl.status not in ('awaiting_setup', 'active') then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if pl.status = 'active' and exists (select 1 from im_ai_class_session s where s.course_id = pl.course_id and s.status <> 'planned') then
    return jsonb_build_object('ok', false, 'reason', 'already_started'); end if;
  if p_weeks not in (4, 6, 8, 10, 12, 16) then return jsonb_build_object('ok', false, 'reason', 'bad_weeks'); end if;
  if p_minutes is null or p_minutes not between 30 and 120 then return jsonb_build_object('ok', false, 'reason', 'bad_minutes'); end if;
  if p_tz is null or not exists (select 1 from pg_timezone_names where name = p_tz) then return jsonb_build_object('ok', false, 'reason', 'bad_tz'); end if;
  begin st := p_start::time; exception when others then return jsonb_build_object('ok', false, 'reason', 'bad_time'); end;
  if p_days is null or cardinality(p_days) not between 1 and 7 or exists (select 1 from unnest(p_days) x where x not between 0 and 6)
     or (select count(distinct x) from unnest(p_days) x) <> cardinality(p_days) then return jsonb_build_object('ok', false, 'reason', 'bad_days'); end if;
  today := (now() at time zone p_tz)::date;
  if p_start_date is null or p_start_date < today or p_start_date > today + 30 then return jsonb_build_object('ok', false, 'reason', 'bad_start'); end if;
  owner := (select owner_id from im_course where id = pl.course_id);
  term_end := ((p_start_date + p_weeks * 7 - 1)::timestamp + time '23:59') at time zone p_tz;
  cutoff := p_start_date + p_weeks * 7 - 7;               -- the last week is kept for the final exam
  d := p_start_date;
  while d <= cutoff loop
    if extract(dow from d)::int = any (p_days) then
      ts := (d::timestamp + st) at time zone p_tz;
      if ts > now() + interval '15 minutes' then slots := slots || ts; end if;
    end if;
    d := d + 1;
  end loop;
  n := coalesce(cardinality(slots), 0);
  if n < 12 then return jsonb_build_object('ok', false, 'reason', 'too_few_classes', 'classes', n, 'needed', 12); end if;
  if n > 120 then return jsonb_build_object('ok', false, 'reason', 'too_many_classes', 'classes', n); end if;
  for srow in select z.chapter as zc, z.sec as zs, z.title as zt from im_selfstudy_section z order by z.chapter, z.sec loop
    secs_c := secs_c || srow.zc; secs_s := secs_s || srow.zs; secs_t := secs_t || srow.zt;
  end loop;
  total := cardinality(secs_c);
  rev := case when n >= 24 then 2 else 0 end;
  l := n - rev; m := ceil(l / 2.0)::int;
  delete from im_ai_class_session where course_id = pl.course_id and status = 'planned';
  if pl.midterm_id is not null and not exists (select 1 from im_exam_attempt where exam_id = pl.midterm_id) then delete from im_exam where id = pl.midterm_id; end if;
  if pl.final_id is not null and not exists (select 1 from im_exam_attempt where exam_id = pl.final_id) then delete from im_exam where id = pl.final_id; end if;
  ch_done := array_fill(null::timestamptz, array[17]);
  for i in 1 .. l loop
    a := floor((i - 1) * total / l::numeric)::int + 1;
    b := floor(i * total / l::numeric)::int;
    slot := slot + 1;
    outl := '[]'::jsonb;
    for j in a .. b loop
      outl := outl || jsonb_build_array(jsonb_build_object('title', secs_c[j] || '.' || secs_s[j] || ' ' || secs_t[j]));
    end loop;
    cfirst := secs_c[a]; clast := secs_c[b];
    select title into ctitle from im_chapter where number = cfirst;
    if cfirst = clast then
      ttl := 'Chapter ' || cfirst || ': ' || coalesce(ctitle, '');
      if (a > 1 and secs_c[a - 1] = cfirst) or (b < total and secs_c[b + 1] = cfirst) then
        ttl := ttl || ' (' || secs_c[a] || '.' || secs_s[a] || '–' || secs_c[b] || '.' || secs_s[b] || ')';
      end if;
    else
      ttl := 'Chapters ' || cfirst || '–' || clast || ': ' || coalesce(ctitle, '') || ' to ' || coalesce((select title from im_chapter where number = clast), '');
    end if;
    seq := seq + 1;
    insert into im_ai_class_session (course_id, seq, title, outline, starts_at, duration_min) values (pl.course_id, seq, left(ttl, 160), outl, slots[slot], p_minutes);
    for k in cfirst .. clast loop
      if b = total or secs_c[b + 1] > k then ch_done[k] := slots[slot]; end if;
    end loop;
    if i = m then
      mid_ch := case when b = total or secs_c[b + 1] > secs_c[b] then secs_c[b] else secs_c[b] - 1 end;
      if rev = 2 then
        slot := slot + 1; seq := seq + 1;
        insert into im_ai_class_session (course_id, seq, title, outline, starts_at, duration_min)
        values (pl.course_id, seq, 'Midterm review: chapters 1–' || mid_ch,
          jsonb_build_array(jsonb_build_object('title', 'The main results of chapters 1–' || mid_ch), jsonb_build_object('title', 'Worked problems in the style of the midterm'),
                            jsonb_build_object('title', 'Your questions'), jsonb_build_object('title', 'How the midterm works and when it opens')), slots[slot], p_minutes);
      end if;
      mid_open := slots[slot] + make_interval(mins => p_minutes);
    end if;
  end loop;
  if rev = 2 then
    slot := slot + 1; seq := seq + 1;
    insert into im_ai_class_session (course_id, seq, title, outline, starts_at, duration_min)
    values (pl.course_id, seq, 'Final review: the whole course',
      jsonb_build_array(jsonb_build_object('title', 'The structure of the course in one picture'), jsonb_build_object('title', 'Markets: supply and demand, elasticity, taxes and welfare'),
                        jsonb_build_object('title', 'Firms and market structure, factor markets, and market failures'), jsonb_build_object('title', 'Worked problems in the style of the final'),
                        jsonb_build_object('title', 'Your questions')), slots[slot], p_minutes);
  end if;
  fin_open := slots[n] + make_interval(mins => p_minutes);
  mid_close := least(mid_open + interval '4 days', fin_open);
  if mid_ch < 1 then mid_ch := 1; end if;
  for k in 1 .. 17 loop
    due := least(((((ch_done[k] at time zone p_tz)::date + 3)::timestamp + time '23:59') at time zone p_tz), term_end);
    insert into im_quiz_deadline (course_id, chapter, closes_at, updated_at) values (pl.course_id, k, due, now())
      on conflict (course_id, chapter) do update set closes_at = excluded.closes_at, updated_at = now();
  end loop;
  for arena in select * from (values ('market-sandbox', 4), ('elasticity-explorer', 5), ('policy-lab', 7), ('choice-sandbox', 8), ('cost-lab', 9), ('profit-arena', 10), ('monopoly-arena', 11), ('oligopoly-arena', 13), ('labor-lab', 14), ('externality-arena', 15), ('lemons-arena', 16), ('bias-lab', 17)) v(slug, ch) loop
    dl := least(((((ch_done[arena.ch] at time zone p_tz)::date + 3)::timestamp + time '23:59') at time zone p_tz), term_end);
    insert into im_arena_deadline (course_id, arena_slug, closes_at, updated_at) values (pl.course_id, arena.slug, dl, now())
      on conflict (course_id, arena_slug) do update set closes_at = excluded.closes_at, updated_at = now();
  end loop;
  select array_agg(q.iid) into mid_items from (
    select x.iid from generate_series(1, mid_ch) gc(cn), lateral (
      select ai.id as iid from im_assessment_item ai where ai.is_active and coalesce(ai.in_exams, true) and ai.chapter = gc.cn and ai.item_type = 'multiple_choice'
       order by md5(pl.course_id::text || ai.id::text) limit 3) x) q;
  select array_agg(q.iid) into fin_items from (
    select x.iid from generate_series(1, 17) gc(cn), lateral (
      select ai.id as iid from im_assessment_item ai where ai.is_active and coalesce(ai.in_exams, true) and ai.chapter = gc.cn and ai.item_type = 'multiple_choice'
         and ai.id <> all (coalesce(mid_items, '{}'::uuid[]))
       order by md5(pl.course_id::text || 'f' || ai.id::text) limit 2) x) q;
  insert into im_exam (course_id, kind, title, instructions, item_ids, total_points, time_limit_minutes, max_attempts, attempt_scoring, shuffle_questions,
                       is_published, opens_at, closes_at, proctored, camera_mode, created_by)
  values (pl.course_id, 'midterm', 'Midterm exam (chapters 1–' || mid_ch || ')', 'One attempt, ' || greatest(45, cardinality(mid_items) * 3) || ' minutes. Each question has its own numbers. Asha will review it with you after the window closes.',
          mid_items, cardinality(mid_items), greatest(45, cardinality(mid_items) * 3), 1, 'best', true, true, mid_open, mid_close, true, 'block', owner)
  returning id into mid_id;
  insert into im_exam (course_id, kind, title, instructions, item_ids, total_points, time_limit_minutes, max_attempts, attempt_scoring, shuffle_questions,
                       is_published, opens_at, closes_at, proctored, camera_mode, created_by)
  values (pl.course_id, 'final', 'Final exam (chapters 1–17)', 'One attempt, ' || (cardinality(fin_items) * 3) || ' minutes, covering the whole course. Each question has its own numbers.',
          fin_items, cardinality(fin_items), cardinality(fin_items) * 3, 1, 'best', true, true, fin_open, term_end, true, 'block', owner)
  returning id into fin_id;
  insert into im_ai_term (course_id, ends_at, hold_hours, auto_final, final_queued_at, late_pct_per_day, late_max_days)
  values (pl.course_id, term_end + interval '1 day', 24, true, null, 10, 3)
  on conflict (course_id) do update set ends_at = excluded.ends_at, hold_hours = 24, auto_final = true, final_queued_at = null;
  update im_course set access_starts = least(today, current_date) - 1, access_ends = (term_end + interval '30 days')::date,
         term = 'Self-study · ' || to_char(p_start_date, 'Mon DD') || ' – ' || to_char((term_end at time zone p_tz)::date, 'Mon DD, YYYY') where id = pl.course_id;
  update im_ai_settings set enabled = true, professor_mode = true, prof_paused = false, payer = 'platform', review_enabled = true,
         prof_actions = '{"class": true, "announce": true, "deadline": true, "feedback": true, "finalize": true, "standing": true, "assignment": true, "exam_window": true, "grade_final": true, "office_hours": true}'::jsonb,
         autopilot = '{"remind": true, "remind_hours": 24, "finalize_exams": true, "grade_delay_min": 60, "answer_questions": true, "grade_assignments": true, "finalize_delay_min": 60}'::jsonb,
         updated_at = now()
   where course_id = pl.course_id;
  insert into im_ai_syllabus (course_id, title, body, updated_at) values (pl.course_id, 'Microeconomics — Self-Study',
    'This is a private self-study section of Microeconomics taught entirely by Asha, the AI professor, for one student. ' ||
    'The student chose a ' || p_weeks || '-week course starting ' || to_char(p_start_date, 'FMMonth DD, YYYY') || ', with live classes of ' || p_minutes || ' minutes at ' || to_char(st, 'HH24:MI') || ' (' || p_tz || ') on ' ||
    (select string_agg((array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[x + 1], ', ' order by x) from unnest(p_days) x) || '. ' ||
    'There are ' || n || ' live classes covering all 17 chapters in order' || case when rev = 2 then ', including a midterm review and a final review' else '' end || '. ' ||
    'Each chapter quiz and arena is due three days after the class that finishes the chapter. The midterm (chapters 1–' || mid_ch || ') is open from ' ||
    to_char(mid_open at time zone p_tz, 'Mon DD HH24:MI') || ' to ' || to_char(mid_close at time zone p_tz, 'Mon DD HH24:MI') || '; the final (all chapters) from ' ||
    to_char(fin_open at time zone p_tz, 'Mon DD HH24:MI') || ' to ' || to_char(term_end at time zone p_tz, 'Mon DD HH24:MI') || ' (' || p_tz || '). ' ||
    'Grade weights: reading 5%, chapter quizzes 20%, arenas 20%, midterm 20%, final 30%, live-class attendance 5%. Late work loses 10% per day for up to 3 days. ' ||
    'Teach at the pace of the schedule, encourage the student to read each chapter before its class, and keep answers within microeconomics.', now())
  on conflict (course_id) do update set title = excluded.title, body = excluded.body, updated_at = now();
  delete from im_announcement where course_id = pl.course_id and title = 'Welcome to your self-study course';
  insert into im_announcement (course_id, title, body, created_by) values (pl.course_id, 'Welcome to your self-study course',
    'Your course is set: ' || n || ' live classes with Asha from ' || to_char(slots[1] at time zone p_tz, 'FMDay, Mon DD at HH24:MI') || ' (' || p_tz || ') to ' ||
    to_char(slots[n] at time zone p_tz, 'Mon DD') || '. The final exam closes on ' || to_char(term_end at time zone p_tz, 'Mon DD') || '. Read the chapter before each class; quizzes and arenas are due three days after each chapter is finished. Ask Asha anything, any time.', owner);
  update im_selfstudy_plan set status = 'active', weeks = p_weeks, days = p_days, start_local = st, minutes = p_minutes, tz = p_tz, starts_on = p_start_date,
         ends_at = term_end, classes = n, midterm_id = mid_id, final_id = fin_id, configured_at = now() where course_id = pl.course_id;
  perform im__selfstudy_post_syllabus(pl.course_id);
  return jsonb_build_object('ok', true) || im__selfstudy_status(u);
end $$;
create or replace function public.im_selfstudy_tick() returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; act int := 0; done int := 0;
begin
  for r in select student_id from im_selfstudy_plan where status = 'awaiting_payment' loop
    if im__selfstudy_activate(r.student_id) then act := act + 1; end if;
  end loop;
  update im_selfstudy_plan set status = 'completed' where status = 'active' and ends_at + interval '30 days' < now();
  get diagnostics done = row_count;
  return jsonb_build_object('activated', act, 'completed', done);
end $$;
create or replace function public.im_selfstudy_admin_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not im_is_admin() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('course_id', p.course_id, 'student_id', p.student_id, 'name', pe.full_name, 'email', pe.email,
      'status', p.status, 'weeks', p.weeks, 'classes', p.classes, 'starts_on', p.starts_on, 'ends_at', p.ends_at, 'tz', p.tz, 'paid_by', p.paid_by, 'created_at', p.created_at,
      'held', (select count(*) from im_ai_class_session s where s.course_id = p.course_id and s.status in ('done','live')),
      'next_at', (select min(s.starts_at) from im_ai_class_session s where s.course_id = p.course_id and s.status = 'planned')) order by p.created_at desc)
    from im_selfstudy_plan p left join im_person pe on pe.user_id = p.student_id), '[]'::jsonb);
end $$;
create or replace function public.im_selfstudy_admin_comp(p_course uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare s text;
begin
  if not im_is_admin() then raise exception 'not allowed'; end if;
  select student_id into s from im_selfstudy_plan where course_id = p_course and status = 'awaiting_payment';
  if s is null then return jsonb_build_object('ok', false, 'reason', 'not_waiting'); end if;
  update im_enrollment set status = 'active', activated_at = coalesce(activated_at, now()) where course_id = p_course and student_id = s;
  perform im__selfstudy_activate(s);
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.im_selfstudy_admin_reset(p_course uuid) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not im_is_admin() then raise exception 'not allowed'; end if;
  if exists (select 1 from im_ai_class_session where course_id = p_course and status <> 'planned') then return jsonb_build_object('ok', false, 'reason', 'already_started'); end if;
  update im_selfstudy_plan set status = 'awaiting_setup' where course_id = p_course and status = 'active';
  return jsonb_build_object('ok', true);
end $$;
alter table public.im_platform_setting add column if not exists ai_key_owner text;
create or replace function public.im_selfstudy_key_owner_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o text;
begin
  if not im_is_admin() then raise exception 'not allowed'; end if;
  select ai_key_owner into o from im_platform_setting order by id limit 1;
  return jsonb_build_object('owner', o, 'email', (select email from im_person where user_id = o),
    'has_key', exists (select 1 from it_ai_keys k where k.owner_id::text = o));
end $$;
create or replace function public.im_selfstudy_key_owner_set(p_email text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o text;
begin
  if not im_is_admin() then raise exception 'not allowed'; end if;
  select p.user_id into o from im_person p where lower(p.email) = lower(trim(p_email)) limit 1;
  if o is null then select u.id::text into o from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1; end if;
  if o is null then return jsonb_build_object('ok', false, 'reason', 'no_account'); end if;
  if not exists (select 1 from it_ai_keys k where k.owner_id::text = o) then return jsonb_build_object('ok', false, 'reason', 'no_key'); end if;
  update im_platform_setting set ai_key_owner = o;
  return jsonb_build_object('ok', true) || im_selfstudy_key_owner_get();
end $$;
revoke all on function public.im_selfstudy_key_owner_get(), public.im_selfstudy_key_owner_set(text) from public, anon;
grant execute on function public.im_selfstudy_key_owner_get(), public.im_selfstudy_key_owner_set(text) to authenticated;
drop policy if exists im_attendance_checkin_admin_read on public.im_attendance_checkin;
create policy im_attendance_checkin_admin_read on public.im_attendance_checkin for select using (im_is_admin());
alter table public.im_material add column if not exists body text;
create or replace function public.im_exam_course_of(p_name text) returns uuid
language sql stable security definer set search_path to 'public', 'storage' as $$
  select coalesce(
    (select e.course_id from im_exam e where e.id = im_try_uuid((storage.foldername(p_name))[1])),
    (select c.id from im_course c
      where (storage.foldername(p_name))[1] ~ '^quiz-ch[0-9]+-'
        and c.id = im_try_uuid(regexp_replace((storage.foldername(p_name))[1], '^quiz-ch[0-9]+-', ''))
        and c.is_self_study))
$$;
create or replace function public.im__h(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;
create or replace function public.im__selfstudy_post_syllabus(p_course uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  pl im_selfstudy_plan; owner text; tz text; html text; rows text := ''; r record; ex record; dn text;
begin
  select * into pl from im_selfstudy_plan where course_id = p_course;
  if not found or pl.status <> 'active' then return; end if;
  tz := coalesce(pl.tz, 'UTC');
  owner := (select owner_id from im_course where id = p_course);
  dn := (select string_agg((array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[x + 1], ', ' order by x) from unnest(pl.days) x);
  html := '<h1>Microeconomics &mdash; Self-Study Syllabus</h1>'
    || '<p><b>Instructor:</b> Asha, AI professor &nbsp;&middot;&nbsp; <b>Term:</b> '
    || to_char(pl.starts_on, 'FMMonth DD, YYYY') || ' &ndash; ' || to_char(pl.ends_at at time zone tz, 'FMMonth DD, YYYY')
    || ' (' || pl.weeks || ' weeks)</p>'
    || '<p><b>Live classes:</b> ' || pl.classes || ' classes, ' || dn || ' at ' || to_char(pl.start_local, 'HH24:MI') || ' (' || im__h(tz) || '), '
    || pl.minutes || ' minutes each. All times in this syllabus are ' || im__h(tz) || '.</p>'
    || '<h2>About the course</h2>'
    || '<p>This course is a full introduction to microeconomics: the principles economists use, gains from trade, supply and demand, elasticity, government policy and taxation, consumer and producer surplus, costs of production, competitive markets, monopoly, monopolistic competition and oligopoly, factor markets, externalities, information problems and behavioral economics. It follows the 17 chapters of the course textbook in order.</p>'
    || '<h2>How the course works</h2><ul>'
    || '<li>Read the chapter before its class. Asha teaches each class live at the scheduled time; open the <i>AI Instructor</i> at class time to join.</li>'
    || '<li>Ask Asha questions at any time between classes.</li>'
    || '<li>Each chapter has a graded quiz and most have an arena. Both are due three days after the class that finishes the chapter.</li>'
    || '<li>There is a midterm and a final exam, each open for a window of several days. You take each once.</li></ul>';
  for r in select seq, title, starts_at, duration_min from im_ai_class_session where course_id = p_course order by seq loop
    rows := rows || '<tr><td>' || r.seq || '</td><td>' || to_char(r.starts_at at time zone tz, 'Dy Mon DD, HH24:MI') || '</td><td>' || im__h(r.title) || '</td></tr>';
  end loop;
  html := html || '<h2>Class schedule</h2><table><thead><tr><th>#</th><th>When</th><th>Topic</th></tr></thead><tbody>' || rows || '</tbody></table>';
  rows := '';
  for r in
    select c.number, c.title, q.closes_at as qdue,
           (select string_agg(v.nm || ' (' || to_char(a.closes_at at time zone tz, 'Mon DD') || ')', ', ')
              from im_arena_deadline a
              join (values ('market-sandbox', 4, 'Market Sandbox'), ('elasticity-explorer', 5, 'Elasticity Explorer'), ('policy-lab', 7, 'Policy & Tax-Incidence Lab'), ('choice-sandbox', 8, 'Consumer Choice Sandbox'), ('cost-lab', 9, 'Cost Curve Lab'), ('profit-arena', 10, 'Profit-Max Arena'), ('monopoly-arena', 11, 'Monopoly Arena'), ('oligopoly-arena', 13, 'Oligopoly Arena'), ('labor-lab', 14, 'Labor Market Lab'), ('externality-arena', 15, 'Externality Arena'), ('lemons-arena', 16, 'Lemons Market Arena'), ('bias-lab', 17, 'Bias Lab')) v(slug, ch, nm) on v.slug = a.arena_slug
             where a.course_id = p_course and v.ch = c.number) as arenas
      from im_chapter c left join im_quiz_deadline q on q.course_id = p_course and q.chapter = c.number
     where c.number between 1 and 17 order by c.number loop
    rows := rows || '<tr><td>' || r.number || '</td><td>' || im__h(r.title) || '</td><td>'
         || coalesce(to_char(r.qdue at time zone tz, 'Mon DD, HH24:MI'), '&mdash;') || '</td><td>' || coalesce(nullif(im__h(r.arenas), ''), '&mdash;') || '</td></tr>';
  end loop;
  html := html || '<h2>Quiz and arena deadlines</h2><table><thead><tr><th>Ch.</th><th>Chapter</th><th>Quiz due</th><th>Arena due</th></tr></thead><tbody>' || rows || '</tbody></table>';
  html := html || '<h2>Exams</h2><ul>';
  for ex in select kind, title, opens_at, closes_at, time_limit_minutes, cardinality(item_ids) as nq from im_exam
             where id in (pl.midterm_id, pl.final_id) order by opens_at loop
    html := html || '<li><b>' || im__h(ex.title) || '</b>: open ' || to_char(ex.opens_at at time zone tz, 'Dy Mon DD, HH24:MI') || ' to '
         || to_char(ex.closes_at at time zone tz, 'Dy Mon DD, HH24:MI') || '; ' || ex.nq || ' questions, ' || ex.time_limit_minutes || ' minutes, one attempt.</li>';
  end loop;
  html := html || '</ul>'
    || '<h2>Grading</h2><table><tbody>'
    || '<tr><td>Reading</td><td>5%</td></tr><tr><td>Chapter quizzes</td><td>20%</td></tr><tr><td>Arenas</td><td>20%</td></tr>'
    || '<tr><td>Midterm exam</td><td>20%</td></tr><tr><td>Final exam</td><td>30%</td></tr><tr><td>Live-class attendance</td><td>5%</td></tr></tbody></table>'
    || '<p>Late quizzes and arenas lose 10% per day for up to 3 days, after which they close.</p>'
    || '<h2>Academic integrity and proctoring</h2><ul>'
    || '<li>All graded chapter quizzes and both exams are proctored on camera. You need a working webcam and microphone; a quiz or exam will not start without the camera.</li>'
    || '<li>Before each quiz or exam you show your photo ID to the camera. The session runs in fullscreen; leaving the window, switching tabs, copying or pasting is recorded.</li>'
    || '<li>A photo is saved when a rule is broken, and a short clip is recorded if talking is detected. Repeated violations submit the quiz or exam automatically. Recordings are deleted after 30 days.</li>'
    || '<li>A calculator and one blank sheet of scratch paper are allowed; show both to the camera before you begin.</li></ul>';
  delete from im_material where course_id = p_course and kind = 'syllabus';
  insert into im_material (course_id, title, url, kind, position, created_by, body)
  values (p_course, 'Course syllabus', null, 'syllabus', -1, owner, html);
end $$;
revoke all on function public.im__selfstudy_post_syllabus(uuid) from public, anon, authenticated;
create table if not exists public.im_platform_private (
  id int primary key default 1 check (id = 1),
  notify_email text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.im_platform_private enable row level security;
drop policy if exists im_platform_private_admin on public.im_platform_private;
create policy im_platform_private_admin on public.im_platform_private for all
  using (im_is_admin()) with check (im_is_admin());
revoke all on public.im_platform_private from anon;
insert into public.im_platform_private (id, notify_email)
select 1, notify_email from public.im_platform_setting where notify_email is not null and notify_email <> ''
order by (id::text = '1') desc, id limit 1
on conflict (id) do update set notify_email = excluded.notify_email, updated_at = now();
create or replace function public.im__platform_setting_hide_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.notify_email is not null then
    if new.notify_email <> '' then
      insert into im_platform_private (id, notify_email, updated_at, updated_by) values (1, new.notify_email, now(), new.updated_by)
      on conflict (id) do update set notify_email = excluded.notify_email, updated_at = now(), updated_by = excluded.updated_by;
    end if;
    new.notify_email := null;
  end if;
  return new;
end $$;
drop trigger if exists im_platform_setting_hide_email on public.im_platform_setting;
create trigger im_platform_setting_hide_email before insert or update on public.im_platform_setting
  for each row execute function public.im__platform_setting_hide_email();
update public.im_platform_setting set notify_email = null where notify_email is not null;

-- Micro-only pieces the newer courses already have.
create or replace function public.im_try_uuid(p text) returns uuid language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

create table if not exists public.im_proctor_events (
  id uuid primary key default gen_random_uuid(),
  exam_id text not null,
  course_id uuid references public.im_course(id) on delete cascade,
  student_id text not null,
  violations int not null default 0,
  events text,
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id)
);
alter table public.im_proctor_events enable row level security;
drop policy if exists im_proctor_self_write on public.im_proctor_events;
create policy im_proctor_self_write on public.im_proctor_events for insert with check (student_id = auth.uid()::text);
drop policy if exists im_proctor_self_update on public.im_proctor_events;
create policy im_proctor_self_update on public.im_proctor_events for update using (student_id = auth.uid()::text) with check (student_id = auth.uid()::text);
drop policy if exists im_proctor_staff_read on public.im_proctor_events;
create policy im_proctor_staff_read on public.im_proctor_events for select using (student_id = auth.uid()::text or im_owns_course(course_id) or im_is_admin());
drop policy if exists im_proctor_staff_delete on public.im_proctor_events;
create policy im_proctor_staff_delete on public.im_proctor_events for delete using (im_owns_course(course_id) or im_is_admin());
grant select, insert, update, delete on public.im_proctor_events to authenticated;

-- Snapshots of camera-proctored self-study quizzes (folder quiz-ch<N>-<course>) are readable by an administrator.
drop policy if exists im_ss_quiz_snap_read on storage.objects;
create policy im_ss_quiz_snap_read on storage.objects for select using (
  bucket_id = 'proctor-snapshots' and (storage.foldername(name))[1] ~ '^quiz-ch[0-9]+-' and im_exam_course_of(name) is not null and im_is_admin());

revoke all on function public.im__selfstudy_status(text), public.im__selfstudy_activate(text), public.im__selfstudy_owner(), public.im_selfstudy_tick() from public, anon, authenticated;
revoke all on function public.im_selfstudy_status(), public.im_selfstudy_check_payment(), public.im_selfstudy_start(), public.im_selfstudy_configure(int, date, int[], text, int, text),
  public.im_selfstudy_admin_list(), public.im_selfstudy_admin_comp(uuid), public.im_selfstudy_admin_reset(uuid) from public, anon;
grant execute on function public.im_selfstudy_status(), public.im_selfstudy_check_payment(), public.im_selfstudy_start(), public.im_selfstudy_configure(int, date, int[], text, int, text),
  public.im_selfstudy_admin_list(), public.im_selfstudy_admin_comp(uuid), public.im_selfstudy_admin_reset(uuid) to authenticated;
select cron.unschedule('im-selfstudy-tick') where exists (select 1 from cron.job where jobname = 'im-selfstudy-tick');
select cron.schedule('im-selfstudy-tick', '*/10 * * * *', 'select public.im_selfstudy_tick()');
