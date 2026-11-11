import { createClient, SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DailyBrief, MorningPlan, ParsedTaskInput, Task, TaskSource, TaskStatus } from "./types";
import { getTodayDateStr, getTomorrowDateStr } from "./dates";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseKey &&
      !supabaseUrl.includes("your-project-id") &&
      !supabaseKey.includes("your_supabase")
  );
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseInstance) {
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
  }
  return supabaseInstance;
}

// ============================================================
// Local File Fallback (when Supabase env vars are not yet set)
// ============================================================
interface LocalStore {
  tasks: Task[];
  daily_briefs: DailyBrief[];
}

const LOCAL_STORE_PATH = path.join(process.cwd(), ".remindai-store.json");

function createInitialSeedStore(): LocalStore {
  const today = getTodayDateStr();
  const tomorrow = getTomorrowDateStr();
  const nowIso = new Date().toISOString();

  const seedTasks: Task[] = [
    {
      id: "task-seed-1",
      title: "Ship Q4 product roadmap summary email",
      notes: "Keep it to 5 bullet points for the engineering lead",
      starter_step: "Open your email client, type the recipient address, and write 1 rough bullet point.",
      estimated_minutes: 25,
      priority: "high",
      scheduled_for: today,
      status: "pending",
      source: "email_reply",
      created_at: nowIso,
    },
    {
      id: "task-seed-2",
      title: "Review Supabase & Resend webhook logs",
      notes: "Verify inbound reply domain DNS records",
      starter_step: "Open the Resend dashboard tab and check the green Verified badge on your domain.",
      estimated_minutes: 15,
      priority: "medium",
      scheduled_for: today,
      status: "pending",
      source: "email_reply",
      created_at: nowIso,
    },
    {
      id: "task-seed-3",
      title: "20-minute walk outside without phone notifications",
      notes: "Reset brain after lunch",
      starter_step: "Put your shoes right next to your desk chair right now.",
      estimated_minutes: 20,
      priority: "low",
      scheduled_for: today,
      status: "done",
      source: "web",
      created_at: nowIso,
      completed_at: nowIso,
    },
    {
      id: "task-seed-4",
      title: "Draft slide deck for Friday demo",
      notes: "Focus on the live email-reply workflow",
      starter_step: "Create a blank presentation file named 'Friday Demo' and write the title slide only.",
      estimated_minutes: 35,
      priority: "high",
      scheduled_for: tomorrow,
      status: "pending",
      source: "email_reply",
      created_at: nowIso,
    },
  ];

  const seedBrief: DailyBrief = {
    id: "brief-seed-today",
    brief_date: today,
    subject: `Your 3-Step Lazy-Proof Plan for ${today}`,
    greeting:
      "Good morning! You don't need motivation today — you just need to survive the first 2 minutes of your #1 task.",
    frog_of_the_day: "Ship Q4 product roadmap summary email (25m) — knock this out before checking Slack.",
    lazy_hack:
      "Set a 5-minute timer and give yourself permission to quit when it rings. Once you write the first bullet point, momentum takes over.",
    schedule_json: [
      {
        time_slot: "09:00 – 09:25",
        task_title: "Ship Q4 product roadmap summary email",
        duration_minutes: 25,
        priority: "high",
        starter_step: "Open your email client, type the recipient address, and write 1 rough bullet point.",
        why_it_matters: "Clears your biggest mental weight before 9:30 AM.",
      },
      {
        time_slot: "10:30 – 10:45",
        task_title: "Review Supabase & Resend webhook logs",
        duration_minutes: 15,
        priority: "medium",
        starter_step: "Open the Resend dashboard tab and check the green Verified badge on your domain.",
        why_it_matters: "Ensures tonight's reply-to-plan loop runs hands-free.",
      },
      {
        time_slot: "13:30 – 13:50",
        task_title: "20-minute walk outside without phone notifications",
        duration_minutes: 20,
        priority: "low",
        starter_step: "Put your shoes right next to your desk chair right now.",
        why_it_matters: "Prevents the 3 PM energy crash.",
      },
    ],
    created_at: nowIso,
    updated_at: nowIso,
  };

  return {
    tasks: seedTasks,
    daily_briefs: [seedBrief],
  };
}

let inMemoryFallback: LocalStore | null = null;

function readLocalStore(): LocalStore {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, "utf8");
      return JSON.parse(raw) as LocalStore;
    }
  } catch {
    // Fallback to in-memory if filesystem is read-only (e.g., Vercel serverless without Supabase)
  }
  if (!inMemoryFallback) {
    inMemoryFallback = createInitialSeedStore();
    writeLocalStore(inMemoryFallback);
  }
  return inMemoryFallback;
}

function writeLocalStore(store: LocalStore): void {
  inMemoryFallback = store;
  try {
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Ignore write error in read-only serverless environments
  }
}

// ============================================================
// Repository Operations
// ============================================================

export async function getTasksForDate(dateStr: string): Promise<Task[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("scheduled_for", dateStr)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Supabase getTasksForDate error: ${error.message}`);
    return (data || []) as Task[];
  }

  const store = readLocalStore();
  return store.tasks.filter((t) => t.scheduled_for === dateStr);
}

export async function insertTasks(
  inputs: ParsedTaskInput[],
  scheduledFor: string,
  source: TaskSource = "web"
): Promise<Task[]> {
  if (inputs.length === 0) return [];
  const supabase = getSupabaseClient();

  const rows = inputs.map((item) => ({
    title: item.title,
    notes: item.notes || null,
    starter_step: item.starter_step,
    estimated_minutes: item.estimated_minutes || 25,
    priority: item.priority || "medium",
    scheduled_for: scheduledFor,
    status: "pending" as TaskStatus,
    source,
  }));

  if (supabase) {
    const { data, error } = await supabase.from("tasks").insert(rows).select("*");
    if (error) throw new Error(`Supabase insertTasks error: ${error.message}`);
    return (data || []) as Task[];
  }

  const store = readLocalStore();
  const nowIso = new Date().toISOString();
  const created: Task[] = rows.map((r) => ({
    id: crypto.randomUUID(),
    ...r,
    created_at: nowIso,
  }));
  store.tasks.push(...created);
  writeLocalStore(store);
  return created;
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task | null> {
  const supabase = getSupabaseClient();
  const completedAt = status === "done" ? new Date().toISOString() : null;

  if (supabase) {
    const { data, error } = await supabase
      .from("tasks")
      .update({ status, completed_at: completedAt })
      .eq("id", taskId)
      .select("*")
      .single();
    if (error) throw new Error(`Supabase updateTaskStatus error: ${error.message}`);
    return data as Task;
  }

  const store = readLocalStore();
  const idx = store.tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  store.tasks[idx] = {
    ...store.tasks[idx],
    status,
    completed_at: completedAt,
  };
  writeLocalStore(store);
  return store.tasks[idx];
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase.from("tasks").delete().eq("id", taskId);
    if (error) throw new Error(`Supabase deleteTask error: ${error.message}`);
    return true;
  }

  const store = readLocalStore();
  const initialLen = store.tasks.length;
  store.tasks = store.tasks.filter((t) => t.id !== taskId);
  writeLocalStore(store);
  return store.tasks.length < initialLen;
}

export async function rolloverUnfinishedTasks(fromDate: string, toDate: string): Promise<Task[]> {
  const fromTasks = await getTasksForDate(fromDate);
  const pending = fromTasks.filter((t) => t.status === "pending");
  if (pending.length === 0) return [];

  const toTasks = await getTasksForDate(toDate);
  const existingTitles = new Set(toTasks.map((t) => t.title.toLowerCase().trim()));

  const toRollover = pending.filter((t) => !existingTitles.has(t.title.toLowerCase().trim()));
  if (toRollover.length === 0) return [];

  // Mark old tasks as skipped so they don't duplicate
  for (const oldTask of toRollover) {
    await updateTaskStatus(oldTask.id, "skipped");
  }

  return insertTasks(
    toRollover.map((t) => ({
      title: t.title,
      notes: t.notes || undefined,
      starter_step: t.starter_step,
      estimated_minutes: t.estimated_minutes,
      priority: t.priority,
    })),
    toDate,
    "rollover"
  );
}

export async function getDailyBrief(dateStr: string): Promise<DailyBrief | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("daily_briefs")
      .select("*")
      .eq("brief_date", dateStr)
      .maybeSingle();
    if (error) throw new Error(`Supabase getDailyBrief error: ${error.message}`);
    return (data as DailyBrief) || null;
  }

  const store = readLocalStore();
  return store.daily_briefs.find((b) => b.brief_date === dateStr) || null;
}

export async function upsertMorningBrief(
  dateStr: string,
  plan: MorningPlan,
  morningEmailId?: string | null
): Promise<DailyBrief> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  if (supabase) {
    const payload = {
      brief_date: dateStr,
      subject: plan.subject,
      greeting: plan.greeting,
      frog_of_the_day: plan.frog_of_the_day,
      lazy_hack: plan.lazy_hack,
      schedule_json: plan.schedule,
      ...(morningEmailId ? { morning_email_id: morningEmailId, morning_sent_at: nowIso } : {}),
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from("daily_briefs")
      .upsert(payload, { onConflict: "brief_date" })
      .select("*")
      .single();
    if (error) throw new Error(`Supabase upsertMorningBrief error: ${error.message}`);
    return data as DailyBrief;
  }

  const store = readLocalStore();
  const existingIdx = store.daily_briefs.findIndex((b) => b.brief_date === dateStr);
  const record: DailyBrief = {
    id: existingIdx >= 0 ? store.daily_briefs[existingIdx].id : crypto.randomUUID(),
    brief_date: dateStr,
    subject: plan.subject,
    greeting: plan.greeting,
    frog_of_the_day: plan.frog_of_the_day,
    lazy_hack: plan.lazy_hack,
    schedule_json: plan.schedule,
    morning_email_id: morningEmailId ?? (existingIdx >= 0 ? store.daily_briefs[existingIdx].morning_email_id : null),
    morning_sent_at: morningEmailId ? nowIso : existingIdx >= 0 ? store.daily_briefs[existingIdx].morning_sent_at : null,
    evening_email_id: existingIdx >= 0 ? store.daily_briefs[existingIdx].evening_email_id : null,
    evening_sent_at: existingIdx >= 0 ? store.daily_briefs[existingIdx].evening_sent_at : null,
    raw_evening_reply: existingIdx >= 0 ? store.daily_briefs[existingIdx].raw_evening_reply : null,
    created_at: existingIdx >= 0 ? store.daily_briefs[existingIdx].created_at : nowIso,
    updated_at: nowIso,
  };

  if (existingIdx >= 0) {
    store.daily_briefs[existingIdx] = record;
  } else {
    store.daily_briefs.push(record);
  }
  writeLocalStore(store);
  return record;
}

export async function recordEveningEmailSent(dateStr: string, eveningEmailId?: string | null): Promise<void> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  if (supabase) {
    await supabase
      .from("daily_briefs")
      .upsert(
        {
          brief_date: dateStr,
          evening_email_id: eveningEmailId || "local-preview",
          evening_sent_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "brief_date" }
      );
    return;
  }

  const store = readLocalStore();
  const idx = store.daily_briefs.findIndex((b) => b.brief_date === dateStr);
  if (idx >= 0) {
    store.daily_briefs[idx].evening_email_id = eveningEmailId || "local-preview";
    store.daily_briefs[idx].evening_sent_at = nowIso;
    store.daily_briefs[idx].updated_at = nowIso;
  } else {
    store.daily_briefs.push({
      id: crypto.randomUUID(),
      brief_date: dateStr,
      subject: null,
      greeting: null,
      frog_of_the_day: null,
      lazy_hack: null,
      schedule_json: [],
      evening_email_id: eveningEmailId || "local-preview",
      evening_sent_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    });
  }
  writeLocalStore(store);
}

export async function recordEveningReply(dateStr: string, rawReplyText: string): Promise<void> {
  const supabase = getSupabaseClient();
  const nowIso = new Date().toISOString();

  if (supabase) {
    await supabase
      .from("daily_briefs")
      .upsert(
        {
          brief_date: dateStr,
          raw_evening_reply: rawReplyText,
          updated_at: nowIso,
        },
        { onConflict: "brief_date" }
      );
    return;
  }

  const store = readLocalStore();
  const idx = store.daily_briefs.findIndex((b) => b.brief_date === dateStr);
  if (idx >= 0) {
    store.daily_briefs[idx].raw_evening_reply = rawReplyText;
    store.daily_briefs[idx].updated_at = nowIso;
  } else {
    store.daily_briefs.push({
      id: crypto.randomUUID(),
      brief_date: dateStr,
      subject: null,
      greeting: null,
      frog_of_the_day: null,
      lazy_hack: null,
      schedule_json: [],
      raw_evening_reply: rawReplyText,
      created_at: nowIso,
      updated_at: nowIso,
    });
  }
  writeLocalStore(store);
}
