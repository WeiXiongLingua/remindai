import { NextRequest, NextResponse } from "next/server";
import { getTomorrowDateStr } from "@/lib/dates";
import { parseTasksFromBrainDump } from "@/lib/ai";
import { insertTasks, recordEveningReply } from "@/lib/db";
import { sendReplyConfirmationEmail } from "@/lib/email";

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

    // Support both Resend's `email.received` webhook structure and direct inbound JSON payloads
    const data = payload?.data || payload;
    let rawReplyText: string =
      data?.text ||
      data?.body ||
      data?.plain_text ||
      data?.replyText ||
      "";

    // If Resend sent an email.received event with only an email_id and RESEND_API_KEY is configured,
    // fetch the inbound email content from Resend API if text wasn't in the webhook body
    if (!rawReplyText && data?.email_id && process.env.RESEND_API_KEY) {
      try {
        const res = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          },
        });
        if (res.ok) {
          const emailData = await res.json();
          rawReplyText = emailData.text || emailData.html || "";
        }
      } catch (e) {
        console.error("Failed to fetch inbound email body from Resend:", e);
      }
    }

    const cleanedText = stripQuotedEmailReply(rawReplyText);
    if (!cleanedText) {
      return NextResponse.json(
        { ok: false, error: "No reply text found in inbound email payload." },
        { status: 400 }
      );
    }

    const targetDate: string = data?.targetDate || getTomorrowDateStr();
    const senderEmail: string | undefined =
      typeof data?.from === "string" ? data.from : data?.from?.email;

    // 1. Parse natural language reply into structured tasks with 2-minute starter steps
    const parsedBundle = await parseTasksFromBrainDump(cleanedText, targetDate);

    // 2. Save tasks to Supabase for tomorrow
    const savedTasks = await insertTasks(parsedBundle.tasks, targetDate, "email_reply");

    // 3. Record raw reply in daily_briefs
    await recordEveningReply(targetDate, cleanedText);

    // 4. Send confirmation email via Resend
    const confirmationEmail = await sendReplyConfirmationEmail({
      toEmail: senderEmail,
      tomorrowDateStr: targetDate,
      coachingNote: parsedBundle.coaching_note,
      tasks: parsedBundle.tasks,
    });

    return NextResponse.json({
      ok: true,
      targetDate,
      coachingNote: parsedBundle.coaching_note,
      tasksCreated: savedTasks,
      confirmationEmail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
