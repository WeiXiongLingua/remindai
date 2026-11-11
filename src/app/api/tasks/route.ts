import { NextRequest, NextResponse } from "next/server";
import { getTodayDateStr, getTomorrowDateStr } from "@/lib/dates";
import {
  deleteTask,
  getDailyBrief,
  getTasksForDate,
  insertTasks,
  isSupabaseConfigured,
  markTasksDoneByTitles,
  updateTaskStatus,
  upsertMorningBrief,
} from "@/lib/db";
import {
  generateMorningPlan,
  isGeminiConfigured,
  parseEmailReply,
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
      const generatedPlan = await generateMorningPlan(todayTasks, today);
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
    const today = getTodayDateStr();
    const tomorrow = getTomorrowDateStr();

    // Mode A: Natural language reply (Simulating what user replies via email)
    if (typeof body.replyText === "string" && body.replyText.trim()) {
      const todayTasks = await getTasksForDate(today);
      const parsed = await parseEmailReply(body.replyText.trim(), todayTasks, tomorrow);

      const completed = await markTasksDoneByTitles(today, parsed.completed_task_titles);
      const created = await insertTasks(
        parsed.tomorrow_tasks,
        tomorrow,
        body.source === "email_reply" ? "email_reply" : "web"
      );

      return NextResponse.json({
        ok: true,
        summaryMessage: parsed.summary_message,
        completedTasks: completed.map((t) => t.title),
        tomorrowTasks: created,
      });
    }

    // Mode B: Direct single task creation
    if (typeof body.title === "string" && body.title.trim()) {
      const targetDay = body.targetDay === "today" ? today : tomorrow;
      const priority: TaskPriority = ["high", "medium", "low"].includes(body.priority)
        ? body.priority
        : "medium";

      const created = await insertTasks(
        [
          {
            title: body.title.trim(),
            notes: body.notes || undefined,
            priority,
          },
        ],
        targetDay,
        "web"
      );

      return NextResponse.json({ ok: true, tasks: created });
    }

    return NextResponse.json({ ok: false, error: "Provide replyText or title" }, { status: 400 });
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
