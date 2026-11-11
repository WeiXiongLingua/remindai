import { Resend } from "resend";
import { MorningPlan, ParsedTaskInput, Task } from "./types";
import { formatReadableDate } from "./dates";

export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY || "";
  return Boolean(key && key.startsWith("re_") && !key.includes("your_resend_api_key"));
}

function getResendClient(): Resend | null {
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

export async function sendMorningPlanEmail(params: {
  dateStr: string;
  plan: MorningPlan;
  tasks: Task[];
}): Promise<EmailDispatchResult> {
  const to = process.env.USER_EMAIL || "you@example.com";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || undefined;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const readableDate = formatReadableDate(params.dateStr);

  const scheduleRowsHtml = params.plan.schedule
    .map((block, idx) => {
      const badgeBg =
        block.priority === "high"
          ? "#DBEAFE"
          : block.priority === "medium"
            ? "#FEF3C7"
            : "#F1F5F9";
      const badgeColor =
        block.priority === "high"
          ? "#1D4ED8"
          : block.priority === "medium"
            ? "#B45309"
            : "#475569";

      return `
        <tr>
          <td style="padding: 16px 0; border-bottom: 1px solid #DCE1E9; vertical-align: top;">
            <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #525B6C; margin-bottom: 4px;">
              STEP ${idx + 1} &middot; ${escapeHtml(block.time_slot)} (${block.duration_minutes}m)
              <span style="display: inline-block; margin-left: 8px; padding: 2px 7px; border-radius: 3px; background: ${badgeBg}; color: ${badgeColor}; font-weight: 600; font-size: 11px;">
                ${escapeHtml(block.priority.toUpperCase())}
              </span>
            </div>
            <div style="font-size: 16px; font-weight: 700; color: #14181F; margin-bottom: 6px;">
              ${escapeHtml(block.task_title)}
            </div>
            <div style="background: #F8F9FA; border-left: 3px solid #1D4ED8; padding: 8px 12px; font-size: 13px; color: #14181F; margin-bottom: 4px;">
              <strong>2-Minute Lazy Starter:</strong> ${escapeHtml(block.starter_step)}
            </div>
            <div style="font-size: 12px; color: #525B6C;">
              Why: ${escapeHtml(block.why_it_matters)}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.plan.subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #14181F;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCE1E9; border-top: 4px solid #1D4ED8;">
    <tr>
      <td style="padding: 28px 32px;">
        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #1D4ED8; font-weight: 600; margin-bottom: 6px;">
          REMINDAI MORNING DISPATCH &middot; ${escapeHtml(readableDate)}
        </div>
        <h1 style="margin: 0 0 12px 0; font-size: 22px; line-height: 1.3; color: #14181F;">
          ${escapeHtml(params.plan.subject)}
        </h1>
        <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.55; color: #334155;">
          ${escapeHtml(params.plan.greeting)}
        </p>

        <div style="background: #EFF6FF; border: 1px solid #BFDBFE; padding: 16px; margin-bottom: 24px;">
          <div style="font-size: 12px; font-weight: 700; color: #1D4ED8; margin-bottom: 4px;">
            #1 FROG TO EAT FIRST (IF YOU DO NOTHING ELSE TODAY)
          </div>
          <div style="font-size: 15px; font-weight: 600; color: #14181F;">
            ${escapeHtml(params.plan.frog_of_the_day)}
          </div>
        </div>

        <h2 style="margin: 0 0 8px 0; font-size: 15px; color: #14181F; border-bottom: 2px solid #14181F; padding-bottom: 6px;">
          Today's Step-by-Step Gameplan
        </h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
          ${scheduleRowsHtml}
        </table>

        <div style="background: #FFFBEB; border: 1px solid #FDE68A; padding: 14px 16px; margin-bottom: 24px; font-size: 13px; line-height: 1.5; color: #78350F;">
          <strong>Anti-Procrastination Hack for Today:</strong> ${escapeHtml(params.plan.lazy_hack)}
        </div>

        <div style="margin-top: 20px;">
          <a href="${escapeHtml(appUrl)}" style="display: inline-block; background: #1D4ED8; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 14px; padding: 11px 20px;">
            Open RemindAI Desk &amp; Check Off Tasks
          </a>
        </div>
      </td>
    </tr>
  </table>
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

export async function sendEveningAskEmail(params: {
  todayDateStr: string;
  tomorrowDateStr: string;
  todayTasks: Task[];
  tomorrowTasks: Task[];
}): Promise<EmailDispatchResult> {
  const to = process.env.USER_EMAIL || "you@example.com";
  const userName = process.env.USER_NAME || "friend";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL || from;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const doneCount = params.todayTasks.filter((t) => t.status === "done").length;
  const pendingToday = params.todayTasks.filter((t) => t.status === "pending");
  const readableTomorrow = formatReadableDate(params.tomorrowDateStr);
  const subject = `Evening Check-in: What's on your plate for tomorrow (${params.tomorrowDateStr})?`;

  const pendingListHtml =
    pendingToday.length > 0
      ? `
        <div style="margin: 16px 0; padding: 12px 16px; background: #FFFBEB; border: 1px solid #FDE68A; font-size: 13px; color: #78350F;">
          <strong>Still unfinished from today (${pendingToday.length}):</strong>
          <ul style="margin: 6px 0 0 0; padding-left: 18px;">
            ${pendingToday.map((t) => `<li>${escapeHtml(t.title)}</li>`).join("")}
          </ul>
          <div style="margin-top: 6px; font-size: 12px;">
            (RemindAI will automatically roll these over into tomorrow morning's plan unless you mark them done.)
          </div>
        </div>
      `
      : "";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #14181F;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCE1E9; border-top: 4px solid #B45309;">
    <tr>
      <td style="padding: 28px 32px;">
        <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #B45309; font-weight: 600; margin-bottom: 6px;">
          REMINDAI EVENING CHECK-IN &middot; PLANNING FOR ${escapeHtml(readableTomorrow)}
        </div>
        <h1 style="margin: 0 0 12px 0; font-size: 21px; line-height: 1.3; color: #14181F;">
          Hey ${escapeHtml(userName)}, what do you need to get done tomorrow?
        </h1>
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.55; color: #334155;">
          You completed <strong>${doneCount} of ${params.todayTasks.length}</strong> tasks today. Before you wind down, dump tomorrow's tasks out of your head so morning-you doesn't have to think.
        </p>

        ${pendingListHtml}

        <div style="background: #F8F9FA; border: 1px solid #DCE1E9; padding: 16px; margin: 20px 0;">
          <div style="font-size: 13px; font-weight: 700; color: #14181F; margin-bottom: 6px;">
            Just hit &ldquo;Reply&rdquo; to this email and type casually:
          </div>
          <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #525B6C; line-height: 1.5;">
            &ldquo;Tomorrow I need to finish the API docs, call the dentist before noon, and review Alex's PR.&rdquo;
          </div>
        </div>

        <p style="margin: 0 0 20px 0; font-size: 14px; color: #525B6C;">
          Gemini will break your reply into bite-sized tasks with 2-minute starter steps and email your step-by-step schedule at 8:00 AM tomorrow.
        </p>

        <div>
          <a href="${escapeHtml(appUrl)}" style="display: inline-block; background: #14181F; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 14px; padding: 11px 20px;">
            Or Add Tomorrow's Tasks on Web Desk
          </a>
        </div>
      </td>
    </tr>
  </table>
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
    replyTo,
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

export async function sendReplyConfirmationEmail(params: {
  toEmail?: string;
  tomorrowDateStr: string;
  coachingNote: string;
  tasks: ParsedTaskInput[];
}): Promise<EmailDispatchResult> {
  const to = params.toEmail || process.env.USER_EMAIL || "you@example.com";
  const from = process.env.RESEND_FROM_EMAIL || "RemindAI <onboarding@resend.dev>";
  const subject = `Queued ${params.tasks.length} task${params.tasks.length === 1 ? "" : "s"} for ${params.tomorrowDateStr}`;

  const tasksHtml = params.tasks
    .map(
      (t, i) => `
      <li style="margin-bottom: 10px;">
        <strong>${i + 1}. ${escapeHtml(t.title)}</strong> (${t.estimated_minutes}m, ${escapeHtml(t.priority)})<br/>
        <span style="font-size: 12px; color: #525B6C;">2-Min Starter: ${escapeHtml(t.starter_step)}</span>
      </li>
    `
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin: 0; padding: 20px; background: #F8F9FA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #14181F;">
  <div style="max-width: 560px; margin: 0 auto; background: #FFFFFF; border: 1px solid #DCE1E9; border-top: 4px solid #15803D; padding: 24px;">
    <div style="font-size: 12px; font-weight: 700; color: #15803D; margin-bottom: 6px;">REMINDAI INBOUND REPLY RECEIVED</div>
    <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px 0;">${escapeHtml(params.coachingNote)}</p>
    <ul style="margin: 0 0 16px 0; padding-left: 18px; font-size: 14px; line-height: 1.5;">
      ${tasksHtml}
    </ul>
    <p style="font-size: 13px; color: #525B6C; margin: 0;">Rest easy tonight — your full time-blocked plan will arrive at 8:00 AM.</p>
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
