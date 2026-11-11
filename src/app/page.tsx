"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import type { DailyBrief, Task } from "@/lib/types";

interface DashboardState {
  today: string;
  tomorrow: string;
  todayTasks: Task[];
  tomorrowTasks: Task[];
  brief: DailyBrief | null;
  integrations: {
    gemini: boolean;
    resend: boolean;
    supabase: boolean;
    userEmail: string;
  };
}

interface EmailModalData {
  title: string;
  subject: string;
  to: string;
  mode: "resend_live" | "preview_only";
  htmlPreview: string;
}

export default function RemindAIDeskPage() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [replyTextEdited, setReplyTextEdited] = useState(false);
  const [replyTextError, setReplyTextError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dispatching, setDispatching] = useState<"morning" | "evening" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [emailModal, setEmailModal] = useState<EmailModalData | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const replyInputId = useId();
  const replyHintId = useId();
  const replyErrorId = useId();

  async function fetchDashboard() {
    try {
      const res = await fetch("/api/tasks");
      const json = await res.json();
      if (json.ok) {
        setData(json);
      }
    } catch (e) {
      console.error("Failed to load dashboard:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
  }, []);

  function openEmailPreviewModal(modal: EmailModalData) {
    setEmailModal(modal);
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }

  // IME-safe Enter-to-submit following modern-web-guidance `ime-safe-enter-submit`
  function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        return;
      }
      formRef.current?.requestSubmit();
    }
  }

  function handleTextareaBlur() {
    if (replyTextEdited && replyText.trim().length > 0 && replyText.trim().length < 4) {
      setReplyTextError("Please enter your message (at least 4 characters).");
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setReplyText(e.target.value);
    setReplyTextEdited(true);
    if (replyTextError) {
      setReplyTextError("");
    }
  }

  async function handleReplySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (trimmed.length < 4) {
      setReplyTextError("Please enter what you did today and what you need for tomorrow.");
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replyText: trimmed,
          source: "web",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setReplyText("");
        setReplyTextEdited(false);
        const details = [
          json.summaryMessage,
          json.completedTasks?.length ? `Marked done: ${json.completedTasks.join(", ")}` : null,
          json.tomorrowTasks?.length ? `Queued ${json.tomorrowTasks.length} task(s) for tomorrow.` : null,
        ].filter(Boolean).join(" | ");

        setStatusMessage(details || "Updated successfully!");
        await fetchDashboard();
      } else {
        setReplyTextError(json.error || "Could not process reply.");
      }
    } catch {
      setReplyTextError("Network error while submitting reply.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      await fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, {
        method: "DELETE",
      });
      await fetchDashboard();
    } catch (e) {
      console.error("Failed to delete task:", e);
    }
  }

  async function handleTriggerEmail(kind: "morning" | "evening") {
    setDispatching(kind);
    setStatusMessage("");
    try {
      const endpoint = kind === "morning" ? "/api/cron/morning" : "/api/cron/evening";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "x-remindai-manual": "true" },
      });
      const json = await res.json();
      if (json.ok && json.email) {
        await fetchDashboard();
        const modeLabel = json.email.error
          ? `Resend rejected the email: ${json.email.error}`
          : json.email.mode === "resend_live"
            ? `Dispatched via Resend to ${json.email.to}`
            : `Generated email preview (set RESEND_API_KEY in .env.local to send live emails)`;

        setStatusMessage(modeLabel);
        openEmailPreviewModal({
          title: kind === "morning" ? "Morning Tasks Reminder Email" : "Evening Check-in Email",
          subject: json.email.subject,
          to: json.email.to,
          mode: json.email.mode,
          htmlPreview: json.email.htmlPreview,
        });
      } else {
        setStatusMessage(json.error || "Failed to dispatch email.");
      }
    } catch {
      setStatusMessage("Error triggering email endpoint.");
    } finally {
      setDispatching(null);
    }
  }

  const todayTasks = data?.todayTasks || [];
  const tomorrowTasks = data?.tomorrowTasks || [];
  const doneCount = todayTasks.filter((t) => t.status === "done").length;

  return (
    <div className="desk-container">
      <header className="desk-header">
        <div>
          <h1 className="brand-title">RemindAI Agent</h1>
          <p className="brand-subtitle">
            Simple daily task reminders via email. Every morning at 5:00 AM you receive today&apos;s tasks. Every evening at 10:00 PM you receive a check-in — just reply with what you finished and what you need for tomorrow!
          </p>
        </div>

        <div className="dispatch-toolbar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={dispatching !== null}
            onClick={() => handleTriggerEmail("morning")}
          >
            {dispatching === "morning" ? "Sending Morning Email..." : "Send Morning Email Now"}
          </button>
          <button
            type="button"
            className="btn btn-amber"
            disabled={dispatching !== null}
            onClick={() => handleTriggerEmail("evening")}
          >
            {dispatching === "evening" ? "Sending Evening Check-in..." : "Send Evening Check-in Now"}
          </button>
        </div>
      </header>

      {/* Integration Telemetry Bar */}
      <aside className="status-strip" aria-label="Service connection status">
        <div className="status-pills">
          <span>
            <span
              className={`status-dot ${data?.integrations.gemini ? "dot-live" : "dot-local"}`}
              aria-hidden="true"
            />
            <strong>Gemini AI:</strong>{" "}
            {data?.integrations.gemini ? "Connected (Flash-Lite)" : "Fallback Mode"}
          </span>
          <span>
            <span
              className={`status-dot ${data?.integrations.resend ? "dot-live" : "dot-local"}`}
              aria-hidden="true"
            />
            <strong>Resend API:</strong>{" "}
            {data?.integrations.resend
              ? `Live (${data.integrations.userEmail})`
              : "Preview Mode"}
          </span>
          <span>
            <span
              className={`status-dot ${data?.integrations.supabase ? "dot-live" : "dot-local"}`}
              aria-hidden="true"
            />
            <strong>Supabase DB:</strong>{" "}
            {data?.integrations.supabase ? "Connected" : "Local Store"}
          </span>
        </div>
        <span className="mono-tag">EMAIL LOOP: 05:00 AM &middot; 10:00 PM</span>
      </aside>

      {/* Live Feedback Toast */}
      <div role="status" aria-live="polite">
        {statusMessage && (
          <div className="toast-banner">
            <span>{statusMessage}</span>
            <button
              type="button"
              className="btn"
              onClick={() => setStatusMessage("")}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <main className="desk-grid">
        {/* LEFT COLUMN: Today's Tasks */}
        <section className="ledger-sheet" aria-labelledby="today-heading">
          <div className="sheet-heading-row">
            <h2 id="today-heading" className="sheet-title">
              Today&apos;s Tasks
            </h2>
            <span className="mono-tag">
              {data?.today || "Today"} &middot; {doneCount}/{todayTasks.length} Done
            </span>
          </div>

          <p className="form-hint" style={{ marginBottom: "1.25rem" }}>
            No need to manually check off tasks here. Simply reply to your evening check-in email with what you completed, and RemindAI marks them done automatically!
          </p>

          {loading ? (
            <p>Loading tasks...</p>
          ) : todayTasks.length === 0 ? (
            <p className="form-hint">
              No tasks scheduled for today yet. Use the reply box on the right or reply to your email to queue tasks.
            </p>
          ) : (
            <ul className="task-list">
              {todayTasks.map((task) => (
                <li key={task.id} className="task-item">
                  <span
                    className={`badge ${task.status === "done" ? "badge-done" : "badge-pending"}`}
                    style={{ marginTop: "0.2rem" }}
                  >
                    {task.status === "done" ? "Done" : "Pending"}
                  </span>
                  <div>
                    <div className={`task-title ${task.status === "done" ? "task-title-done" : ""}`}>
                      {task.title}
                    </div>
                    {task.notes && (
                      <div className="form-hint" style={{ marginTop: "0.2rem" }}>
                        {task.notes}
                      </div>
                    )}
                    <div className="task-meta">
                      <span className={`badge badge-${task.priority}`}>
                        {task.priority.toUpperCase()}
                      </span>
                      <span>Source: {task.source}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Remove task ${task.title}`}
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* RIGHT COLUMN: Reply / Quick Update + Tomorrow's Queue */}
        <section
          className="ledger-sheet ledger-sheet-evening"
          aria-labelledby="reply-heading"
        >
          <div className="sheet-heading-row">
            <h2 id="reply-heading" className="sheet-title">
              Reply &amp; Set Tomorrow
            </h2>
            <span className="mono-tag">Tomorrow: {data?.tomorrow || "Next Day"}</span>
          </div>

          <form
            ref={formRef}
            onSubmit={handleReplySubmit}
            aria-labelledby="reply-heading"
            noValidate
          >
            <div className="form-group">
              <label htmlFor={replyInputId} className="form-label">
                Reply with what you finished &amp; what you need tomorrow:
              </label>
              <span id={replyHintId} className="form-hint">
                Type naturally like replying to the evening email. Press Enter to submit (Shift+Enter for a new line).
              </span>
              <textarea
                ref={textareaRef}
                id={replyInputId}
                name="replyText"
                className="form-textarea"
                required
                minLength={4}
                aria-invalid={replyTextError ? "true" : undefined}
                aria-describedby={
                  replyTextError
                    ? `${replyHintId} ${replyErrorId}`
                    : replyHintId
                }
                placeholder="e.g., I finished writing the report and called the dentist. Tomorrow I need to review pull requests and buy train tickets..."
                value={replyText}
                onChange={handleTextareaInput}
                onBlur={handleTextareaBlur}
                onKeyDown={handleTextareaKeyDown}
              />
              {replyTextError && (
                <span id={replyErrorId} className="error-msg" role="alert">
                  {replyTextError}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {submitting ? "Gemini is updating tasks..." : "Process Reply & Update Tasks"}
            </button>
          </form>

          <hr
            style={{
              border: 0,
              borderTop: "1px solid var(--rule-line)",
              margin: "1.75rem 0 1.25rem",
            }}
          />

          <h3 style={{ fontSize: "1.05rem", margin: "0 0 0.75rem 0" }}>
            Queued for Tomorrow ({tomorrowTasks.length})
          </h3>

          {tomorrowTasks.length === 0 ? (
            <p className="form-hint">
              Nothing queued for tomorrow yet. Type above or reply to tonight&apos;s check-in email!
            </p>
          ) : (
            <ul className="task-list">
              {tomorrowTasks.map((task) => (
                <li key={task.id} className="task-item">
                  <span
                    className={`badge badge-${task.priority}`}
                    style={{ marginTop: "0.2rem" }}
                  >
                    {task.priority.toUpperCase()}
                  </span>
                  <div>
                    <div className="task-title">{task.title}</div>
                    {task.notes && (
                      <div className="form-hint" style={{ marginTop: "0.2rem" }}>
                        {task.notes}
                      </div>
                    )}
                    <div className="task-meta">
                      <span>Source: {task.source}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Remove tomorrow task ${task.title}`}
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Modal Dialog for Inspecting Dispatched Email */}
      <dialog
        ref={dialogRef}
        className="email-dialog"
        {...({ closedby: "any" } as Record<string, string>)}
      >
        <div className="dialog-header">
          <div>
            <strong>{emailModal?.title || "Email Preview"}</strong>
            <div className="mono-tag">
              To: {emailModal?.to} &middot; Subject: {emailModal?.subject}
            </div>
          </div>
          <form method="dialog">
            <button type="submit" className="btn" value="close">
              Close preview
            </button>
          </form>
        </div>
        <div className="dialog-body">
          {emailModal && (
            <iframe
              title={emailModal.title}
              className="email-preview-frame"
              srcDoc={emailModal.htmlPreview}
            />
          )}
        </div>
      </dialog>
    </div>
  );
}
