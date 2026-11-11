import { Resend } from "resend";
import { MorningPlan, ParsedTaskInput, Task } from "./types";
import { formatReadableDate } from "./dates";

export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY || "";
  return Boolean(key && key.startsWith("re_") && !key.includes("your_resend_api_key"));
}

export function getResendClient(): Resend | null {
  if (!isResendConfigured()) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EmailDispatchResult {
  sent: boolean;
  emailId: string;
  to: string;
  subject: string;
  htmlPreview: string;
  mode: "resend_live" | "preview_only";
  error?: string;
}

// ============================================================
// 1. Simple Morning Email (What to do today)
// ============================================================
export async function sendMorningPlanEmail(params: {
  dateStr: string;
  plan: MorningPlan;
  tasks: Task[];
}): Promise<EmailDispatchResult> {
  const to = process.env.USER_EMAIL || "you@example.com";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || undefined;
  const readableDate = formatReadableDate(params.dateStr);

  const taskListHtml =
    params.plan.tasks.length === 0
      ? `<p style="font-size: 15px; color: #4B5563; margin: 0 0 16px 0;">You have no tasks scheduled for today. Enjoy your day!</p>`
      : `<ol style="margin: 0 0 24px 0; padding-left: 22px; font-size: 16px; line-height: 1.6; color: #111827;">
          ${params.plan.tasks
            .map(
              (t) =>
                `<li style="margin-bottom: 8px;">
                  <strong>${escapeHtml(t.title)}</strong>
                  ${t.notes ? `<div style="font-size: 13px; color: #6B7280; margin-top: 2px;">${escapeHtml(t.notes)}</div>` : ""}
                </li>`
            )
            .join("")}
        </ol>`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 32px 16px; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <div style="max-width: 540px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 32px;">
    <div style="font-size: 12px; font-weight: 600; color: #2563EB; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px;">
      ${escapeHtml(readableDate)}
    </div>
    <h1 style="font-size: 22px; line-height: 1.3; margin: 0 0 16px 0; color: #111827;">
      ${escapeHtml(params.plan.subject)}
    </h1>
    <p style="font-size: 15px; line-height: 1.5; color: #374151; margin: 0 0 20px 0;">
      ${escapeHtml(params.plan.greeting)}
    </p>

    ${taskListHtml}

    <div style="border-top: 1px solid #E5E7EB; padding-top: 16px; font-size: 13px; color: #6B7280; line-height: 1.5;">
      ${escapeHtml(params.plan.reminder_footer)}
    </div>
  </div>
</body>
</html>
  `.trim();

  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
      emailId: `preview-morning-${Date.now()}`,
      to,
      subject: params.plan.subject,
      htmlPreview: html,
      mode: "preview_only",
    };
  }

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    ...(replyTo ? { replyTo } : {}),
    subject: params.plan.subject,
    html,
  });

  if (error) {
    return {
      sent: false,
      emailId: "",
      to,
      subject: params.plan.subject,
      htmlPreview: html,
      mode: "resend_live",
      error: error.message,
    };
  }

  return {
    sent: true,
    emailId: data?.id || `resend-${Date.now()}`,
    to,
    subject: params.plan.subject,
    htmlPreview: html,
    mode: "resend_live",
  };
}

// ============================================================
// 2. Simple Evening Email (Ask what to do tomorrow + what was done)
// ============================================================
export async function sendEveningAskEmail(params: {
  todayDateStr: string;
  tomorrowDateStr: string;
  todayTasks: Task[];
  tomorrowTasks: Task[];
}): Promise<EmailDispatchResult> {
  const to = process.env.USER_EMAIL || "you@example.com";
  const userName = process.env.USER_NAME || "friend";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || undefined;
  const readableTomorrow = formatReadableDate(params.tomorrowDateStr);
  const subject = `Evening Check-in: What do you need to do tomorrow?`;

  const todayListHtml =
    params.todayTasks.length > 0
      ? `
        <div style="margin: 16px 0 20px 0; padding: 14px 16px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px;">
          <div style="font-size: 12px; font-weight: 600; color: #4B5563; margin-bottom: 8px;">
            TODAY'S TASKS LIST:
          </div>
          <ul style="margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.5; color: #1F2937;">
            ${params.todayTasks
              .map(
                (t) =>
                  `<li>${escapeHtml(t.title)} ${t.status === "done" ? '<span style="color: #059669; font-weight: 600;">(Done)</span>' : ""}</li>`
              )
              .join("")}
          </ul>
        </div>
      `
      : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 32px 16px; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <div style="max-width: 540px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 32px;">
    <div style="font-size: 12px; font-weight: 600; color: #D97706; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px;">
      PLANNING FOR ${escapeHtml(readableTomorrow)}
    </div>
    <h1 style="font-size: 21px; line-height: 1.3; margin: 0 0 14px 0; color: #111827;">
      Hey ${escapeHtml(userName)}, what's on your list for tomorrow?
    </h1>
    <p style="font-size: 15px; line-height: 1.55; color: #374151; margin: 0 0 16px 0;">
      Reply directly to this email to update your tasks.
    </p>

    ${todayListHtml}

    <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 14px 16px; margin: 0 0 20px 0;">
      <div style="font-size: 13px; font-weight: 700; color: #1D4ED8; margin-bottom: 6px;">
        Just hit &ldquo;Reply&rdquo; and tell me:
      </div>
      <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #1E3A8A; line-height: 1.5;">
        <li>What tasks you finished today (I'll mark them as done)</li>
        <li>What tasks you need to do tomorrow (I'll add them to the database)</li>
      </ul>
    </div>

    <p style="font-size: 13px; color: #6B7280; line-height: 1.5; margin: 0;">
      RemindAI will parse your reply, save tomorrow's tasks, and send you a reminder email tomorrow morning at 8:00 AM!
    </p>
  </div>
</body>
</html>
  `.trim();

  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
      emailId: `preview-evening-${Date.now()}`,
      to,
      subject,
      htmlPreview: html,
      mode: "preview_only",
    };
  }

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    ...(replyTo ? { replyTo } : {}),
    subject,
    html,
  });

  if (error) {
    return {
      sent: false,
      emailId: "",
      to,
      subject,
      htmlPreview: html,
      mode: "resend_live",
      error: error.message,
    };
  }

  return {
    sent: true,
    emailId: data?.id || `resend-${Date.now()}`,
    to,
    subject,
    htmlPreview: html,
    mode: "resend_live",
  };
}

// ============================================================
// 3. Simple Confirmation Email (When user replies)
// ============================================================
export async function sendReplyConfirmationEmail(params: {
  toEmail?: string;
  tomorrowDateStr: string;
  completedTasks: string[];
  tomorrowTasks: Array<{ title: string; notes?: string | null; priority?: string }>;
  summaryMessage: string;
}): Promise<EmailDispatchResult> {
  const to = params.toEmail || process.env.USER_EMAIL || "you@example.com";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const readableTomorrow = formatReadableDate(params.tomorrowDateStr);
  const subject = `Got it! Tomorrow's tasks are set (${params.tomorrowTasks.length} queued)`;

  const completedHtml =
    params.completedTasks.length > 0
      ? `
        <div style="margin-bottom: 16px;">
          <strong style="color: #059669; font-size: 14px;">Marked as finished today:</strong>
          <ul style="margin: 4px 0 0 0; padding-left: 18px; font-size: 14px; color: #374151;">
            ${params.completedTasks.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
        </div>
      `
      : "";

  const tomorrowHtml =
    params.tomorrowTasks.length > 0
      ? `
        <div style="margin-bottom: 16px;">
          <strong style="font-size: 14px; color: #111827;">Scheduled for tomorrow (${escapeHtml(readableTomorrow)}):</strong>
          <ol style="margin: 4px 0 0 0; padding-left: 20px; font-size: 14px; line-height: 1.5; color: #111827;">
            ${params.tomorrowTasks.map((t) => `<li><strong>${escapeHtml(t.title)}</strong></li>`).join("")}
          </ol>
        </div>
      `
      : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 24px 16px; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827;">
  <div style="max-width: 520px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px; padding: 28px;">
    <h1 style="font-size: 18px; line-height: 1.3; margin: 0 0 12px 0; color: #111827;">
      Update Received
    </h1>
    <p style="font-size: 14px; color: #4B5563; margin: 0 0 16px 0;">
      ${escapeHtml(params.summaryMessage)}
    </p>

    ${completedHtml}
    ${tomorrowHtml}

    <p style="font-size: 13px; color: #6B7280; margin: 16px 0 0 0; border-top: 1px solid #E5E7EB; padding-top: 12px;">
      I will send your morning reminder tomorrow at 8:00 AM!
    </p>
  </div>
</body>
</html>
  `.trim();

  const resend = getResendClient();
  if (!resend) {
    return {
      sent: false,
      emailId: `preview-confirm-${Date.now()}`,
      to,
      subject,
      htmlPreview: html,
      mode: "preview_only",
    };
  }

  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    html,
  });

  return {
    sent: !error,
    emailId: data?.id || "",
    to,
    subject,
    htmlPreview: html,
    mode: "resend_live",
    error: error?.message,
  };
}
