import { NextRequest, NextResponse } from "next/server";
import { getTodayDateStr, getTomorrowDateStr } from "@/lib/dates";
import { getTasksForDate, recordEveningEmailSent } from "@/lib/db";
import { sendEveningAskEmail } from "@/lib/email";

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.includes("generate_a_random_secret")) {
    return true;
  }
  const authHeader = req.headers.get("authorization");
  const isManualDashboardCall = req.headers.get("x-remindai-manual") === "true";
  return authHeader === `Bearer ${cronSecret}` || isManualDashboardCall;
}

async function handleEveningCheckin(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized cron trigger" }, { status: 401 });
  }

  try {
    const today = getTodayDateStr();
    const tomorrow = getTomorrowDateStr();

    const [todayTasks, tomorrowTasks] = await Promise.all([
      getTasksForDate(today),
      getTasksForDate(tomorrow),
    ]);

    const emailResult = await sendEveningAskEmail({
      todayDateStr: today,
      tomorrowDateStr: tomorrow,
      todayTasks,
      tomorrowTasks,
    });

    await recordEveningEmailSent(today, emailResult.emailId);

    return NextResponse.json({
      ok: true,
      today,
      tomorrow,
      email: emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleEveningCheckin(req);
}

export async function POST(req: NextRequest) {
  return handleEveningCheckin(req);
}
