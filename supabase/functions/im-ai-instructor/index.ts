// im-ai-instructor loader: the instructor server from a pinned, immutable commit of the public repo, with the self-study store override.
// Source: https://github.com/amarendra-sharma/International-Trade/tree/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor (index-im.ts)
import { createClient } from "npm:@supabase/supabase-js@2";
import { LIMITS } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/config.ts";
import { hashUser, makeSampledLogger } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/log.ts";
import { routedProvider } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/provider.ts";
import { Admission, BreakerSet, ControlCache, isMode, TtlCache } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/resilience.ts";
import { makeHandler } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/handler.ts";
import { ImSupabaseStore } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/im-store.ts";
import { SupabaseContent } from "https://raw.githubusercontent.com/amarendra-sharma/International-Trade/6c8efde226c7aafdebaa77a0310218f47cfa4735/ai-instructor/server/it-ai-instructor/content.ts";

// Self-study override (MacroNations): platform-paid courses bill the account named in <p>_platform_setting.ai_key_owner when it has a
// saved key (else the first administrator with one), and comped enrollments count as enrolled.
// deno-lint-ignore no-explicit-any
function withSelfStudy<T extends new (...a: any[]) => any>(Base: T, prefix: string) {
  return class extends Base {
    async platformKeyOwner(): Promise<string | null> {
      const ps = await this.db.from(prefix + "platform_setting").select("ai_key_owner").order("id", { ascending: true }).limit(1);
      const named = !ps.error && ps.data && ps.data[0] ? (ps.data[0] as { ai_key_owner: string | null }).ai_key_owner : null;
      if (named) {
        const k = await this.db.from("it_ai_keys").select("owner_id").eq("owner_id", named).limit(1);
        if (!k.error && k.data && k.data.length) return named;
      }
      return await super.platformKeyOwner();
    }
    // deno-lint-ignore no-explicit-any
    async getCourseAccess(userId: string, courseId: string, now: Date): Promise<any> {
      const a = await super.getCourseAccess(userId, courseId, now);
      if (a.allowed || a.reason !== "not_enrolled") return a;
      const enr = await this.one(this.db.from(prefix + "enrollment").select("status").eq("course_id", courseId).eq("user_id", userId).maybeSingle());
      if (!enr || enr.status !== "comped") return a;
      const c = await this.one(this.db.from(prefix + "course").select("is_active,access_starts,access_ends").eq("id", courseId).maybeSingle());
      if (!c || !c.is_active) return { ...a, reason: "inactive" };
      const today = now.toISOString().slice(0, 10);
      if ((c.access_starts && today < c.access_starts) || (c.access_ends && today > c.access_ends)) return { ...a, reason: "expired" };
      const { reason: _r, ...rest } = a;
      return { ...rest, allowed: true };
    }
  };
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const salt = Deno.env.get("AI_INSTRUCTOR_LOG_SALT") ?? "";
const store = new (withSelfStudy(ImSupabaseStore, "im_"))(admin);
const envMode = Deno.env.get("AI_INSTRUCTOR_MODE");
// deno-lint-ignore no-explicit-any
const deps: any = {
  store, control: new ControlCache(() => store.getControl(), isMode(envMode) ? envMode : "normal"), breakers: new BreakerSet(),
  admissionWaitMs: LIMITS.admissionWaitMs, accessCache: new TtlCache(LIMITS.accessCacheTtlMs), assessCache: new TtlCache(LIMITS.assessmentCacheTtlMs),
  provider: routedProvider, extraHosts: (Deno.env.get("AI_INSTRUCTOR_EXTRA_HOSTS") ?? "").split(",").map((x) => x.trim()).filter(Boolean), content: new SupabaseContent(admin, "im_ai_"), log: makeSampledLogger((l: string) => console.log(l), { infoSampleRate: LIMITS.logInfoSampleRate, perSecond: LIMITS.logPerSecondPerInstance, burst: 20 }), gate: new Admission(LIMITS.isolateMaxConcurrentTurns, LIMITS.admissionQueueMax),
  kek: Deno.env.get("AI_INSTRUCTOR_KEK") ?? "", platformKeyOwner: Deno.env.get("AI_INSTRUCTOR_PLATFORM_KEY_OWNER") || undefined, userHash: (id: string) => hashUser(id, salt),
};

Deno.serve(makeHandler(deps, {
  allowedOrigins: (Deno.env.get("AI_INSTRUCTOR_ORIGINS") ?? "*").split(",").map((x) => x.trim()),
  authenticate: async (req: Request) => {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return null;
    const { data } = await admin.auth.getUser(token);
    return data?.user?.id ?? null;
  },
}));
