import { NextRequest, NextResponse } from "next/server";
import { getTodayDateStr, getYesterdayDateStr } from "@/lib/dates";
import {
  getTasksForDate,
  rolloverUnfinishedTasks,
  upsertMorningBrief,
} from "@/lib/db";
import { generateMorningPlan } from "@/lib/ai";
import { sendMorningPlanEmail } from "@/lib/email";

// Allow time for Gemini model fallbacks (Vercel function max duration, seconds).
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.includes("generate_a_random_secret")) {
    return true;
  }
  const authHeader = req.headers.get("authorization");
  const isManualDashboardCall = req.headers.get("x-remindai-manual") === "true";
  return authHeader === `Bearer ${cronSecret}` || isManualDashboardCall;
}

async function handleMorningDispatch(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized cron trigger" }, { status: 401 });
  }

  try {
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();

    // 1. Automatically roll over any unfinished tasks from yesterday
    const rolledOver = await rolloverUnfinishedTasks(yesterday, today);

    // 2. Fetch all tasks scheduled for today
    const todayTasks = await getTasksForDate(today);

    // 3. Generate a clean, simple morning plan
    const plan = await generateMorningPlan(todayTasks, today);

    // 4. Send the Morning email via Resend
    const emailResult = await sendMorningPlanEmail({
      dateStr: today,
      plan,
      tasks: todayTasks,
    });

    // 5. Persist the brief and Resend email ID in Supabase
    const savedBrief = await upsertMorningBrief(today, plan, emailResult.emailId);

    return NextResponse.json({
      ok: true,
      date: today,
      rolledOverCount: rolledOver.length,
      taskCount: todayTasks.length,
      brief: savedBrief,
      email: emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleMorningDispatch(req);
}

export async function POST(req: NextRequest) {
  return handleMorningDispatch(req);
}
