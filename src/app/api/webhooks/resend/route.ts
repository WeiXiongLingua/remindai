import { NextRequest, NextResponse } from "next/server";
import { getTodayDateStr, getTomorrowDateStr } from "@/lib/dates";
import { parseEmailReply } from "@/lib/ai";
import {
  getTasksForDate,
  insertTasks,
  markTasksDoneByTitles,
  recordEveningReply,
} from "@/lib/db";
import { getResendClient, sendReplyConfirmationEmail } from "@/lib/email";

// Allow time for Gemini model fallbacks (Vercel function max duration, seconds).
export const maxDuration = 60;

/**
 * Strips quoted email history ("On Wed, Nov 11... wrote:", "> quoted lines")
 * so Gemini only parses the user's fresh reply.
 */
function stripQuotedEmailReply(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^On .+ wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (/^From:\s+/i.test(trimmed)) break;
    if (trimmed.startsWith(">")) continue;
    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").trim();
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // 1. Extract email_id and direct fields
    const data = payload?.data || payload;
    let rawReplyText: string =
      data?.text ||
      data?.body ||
      data?.plain_text ||
      data?.replyText ||
      "";

    const emailId: string | undefined = data?.email_id || payload?.email_id;
    let senderEmail: string | undefined =
      typeof data?.from === "string" ? data.from : data?.from?.email;

    // 2. If inbound from Resend Receiving webhook (email.received), fetch the email text
    if (!rawReplyText && emailId && process.env.RESEND_API_KEY) {
      try {
        const resend = getResendClient();
        if (resend) {
          const { data: receivingData, error: receivingError } =
            await resend.emails.receiving.get(emailId);
          if (!receivingError && receivingData) {
            rawReplyText = receivingData.text || receivingData.html || "";
            if (!senderEmail && receivingData.from) {
              senderEmail = receivingData.from;
            }
          }
        }
      } catch (err) {
        console.error("Resend receiving.get SDK call failed, attempting direct fetch:", err);
        try {
          const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            },
          });
          if (res.ok) {
            const emailData = await res.json();
            rawReplyText = emailData.text || emailData.html || "";
            if (!senderEmail && emailData.from) {
              senderEmail = emailData.from;
            }
          }
        } catch (fetchErr) {
          console.error("Direct fetch for receiving email failed:", fetchErr);
        }
      }
    }

    const cleanedText = stripQuotedEmailReply(rawReplyText);
    if (!cleanedText) {
      return NextResponse.json(
        { ok: false, error: "No reply text found in inbound email payload." },
        { status: 400 }
      );
    }

    const today = getTodayDateStr();
    const tomorrow = data?.targetDate || getTomorrowDateStr();

    // 3. Fetch today's tasks so Gemini can match what was completed
    const todayTasks = await getTasksForDate(today);

    // 4. Parse completed tasks and tomorrow's new tasks with Gemini
    const parsed = await parseEmailReply(cleanedText, todayTasks, tomorrow);

    // 5. Mark completed tasks as DONE in the database
    const completedTasks = await markTasksDoneByTitles(today, parsed.completed_task_titles);
    const completedTitles = completedTasks.map((t) => t.title);

    // 6. Insert tomorrow's new tasks into the database
    const createdTomorrowTasks = await insertTasks(
      parsed.tomorrow_tasks,
      tomorrow,
      "email_reply"
    );

    // 7. Record raw evening reply
    await recordEveningReply(today, cleanedText);

    // 8. Send short confirmation email via Resend
    const confirmationEmail = await sendReplyConfirmationEmail({
      toEmail: senderEmail,
      tomorrowDateStr: tomorrow,
      completedTasks: completedTitles,
      tomorrowTasks: createdTomorrowTasks,
      summaryMessage: parsed.summary_message,
    });

    return NextResponse.json({
      ok: true,
      today,
      tomorrow,
      completedTasks: completedTitles,
      tomorrowTasks: createdTomorrowTasks,
      summaryMessage: parsed.summary_message,
      confirmationEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
