import { NextRequest, NextResponse } from "next/server";
import { getTodayDateStr, getTomorrowDateStr } from "@/lib/dates";
import {
  deleteTask,
  getDailyBrief,
  getTasksForDate,
  insertTasks,
  isSupabaseConfigured,
  updateTaskStatus,
  upsertMorningBrief,
} from "@/lib/db";
import {
  generateMorningActionPlan,
  isGeminiConfigured,
  parseTasksFromBrainDump,
} from "@/lib/ai";
import { isResendConfigured } from "@/lib/email";
import { TaskPriority, TaskStatus } from "@/lib/types";

// Allow time for Gemini model fallbacks (Vercel function max duration, seconds).
export const maxDuration = 60;

export async function GET() {
  try {
    const today = getTodayDateStr();
    const tomorrow = getTomorrowDateStr();

    const [todayTasks, tomorrowTasks, existingBrief] = await Promise.all([
      getTasksForDate(today),
      getTasksForDate(tomorrow),
      getDailyBrief(today),
    ]);

    let brief = existingBrief;
    if (!brief) {
      const generatedPlan = await generateMorningActionPlan(todayTasks, today);
      brief = await upsertMorningBrief(today, generatedPlan);
    }

    return NextResponse.json({
      ok: true,
      today,
      tomorrow,
      todayTasks,
      tomorrowTasks,
      brief,
      integrations: {
        gemini: isGeminiConfigured(),
        resend: isResendConfigured(),
        supabase: isSupabaseConfigured(),
        userEmail: process.env.USER_EMAIL || "you@example.com",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tasks";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const targetDay: "today" | "tomorrow" = body.targetDay === "today" ? "today" : "tomorrow";
    const dateStr = targetDay === "today" ? getTodayDateStr() : getTomorrowDateStr();

    // Mode A: Brain-dump / natural language input parsed by Gemini
    if (typeof body.brainDump === "string" && body.brainDump.trim()) {
      const parsed = await parseTasksFromBrainDump(body.brainDump.trim(), dateStr);
      const created = await insertTasks(
        parsed.tasks,
        dateStr,
        body.source === "email_reply" ? "email_reply" : "web"
      );

      // If added to today, refresh today's morning plan
      let updatedBrief = null;
      if (targetDay === "today") {
        const allToday = await getTasksForDate(dateStr);
        const newPlan = await generateMorningActionPlan(allToday, dateStr);
        updatedBrief = await upsertMorningBrief(dateStr, newPlan);
      }

      return NextResponse.json({
        ok: true,
        coachingNote: parsed.coaching_note,
        tasks: created,
        brief: updatedBrief,
      });
    }

    // Mode B: Direct structured task creation
    if (typeof body.title === "string" && body.title.trim()) {
      const priority: TaskPriority = ["high", "medium", "low"].includes(body.priority)
        ? body.priority
        : "medium";
      const estimatedMinutes = Number(body.estimated_minutes) || 25;
      const starterStep =
        typeof body.starter_step === "string" && body.starter_step.trim()
          ? body.starter_step.trim()
          : `Spend 2 minutes opening the needed files for "${body.title.trim()}".`;

      const created = await insertTasks(
        [
          {
            title: body.title.trim(),
            notes: body.notes || undefined,
            starter_step: starterStep,
            estimated_minutes: estimatedMinutes,
            priority,
          },
        ],
        dateStr,
        "web"
      );

      return NextResponse.json({ ok: true, tasks: created });
    }

    return NextResponse.json({ ok: false, error: "Provide brainDump or title" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create tasks";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body as { id?: string; status?: TaskStatus };
    if (!id || !status || !["pending", "done", "skipped"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Valid id and status required" }, { status: 400 });
    }

    const updated = await updateTaskStatus(id, status);
    return NextResponse.json({ ok: true, task: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ ok: false, error: "Task id required" }, { status: 400 });
    }
    const deleted = await deleteTask(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete task";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
