"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import type { DailyBrief, Task, TaskStatus } from "@/lib/types";

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
  const [brainDump, setBrainDump] = useState("");
  const [brainDumpEdited, setBrainDumpEdited] = useState(false);
  const [brainDumpError, setBrainDumpError] = useState("");
  const [targetDay, setTargetDay] = useState<"tomorrow" | "today">("tomorrow");
  const [submitting, setSubmitting] = useState(false);
  const [dispatching, setDispatching] = useState<"morning" | "evening" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [emailModal, setEmailModal] = useState<EmailModalData | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const brainDumpId = useId();
  const brainDumpHintId = useId();
  const brainDumpErrorId = useId();

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
    if (brainDumpEdited && brainDump.trim().length > 0 && brainDump.trim().length < 4) {
      setBrainDumpError("Please describe at least one task (4+ characters).");
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setBrainDump(e.target.value);
    setBrainDumpEdited(true);
    if (brainDumpError) {
      setBrainDumpError("");
    }
  }

  async function handleBrainDumpSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = brainDump.trim();
    if (trimmed.length < 4) {
      setBrainDumpError("Please enter what you need to do (at least 4 characters).");
      textareaRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setStatusMessage("");
    try {
      // If targetDay is tomorrow, we can route through the Resend Inbound Webhook simulator
      // or /api/tasks so the exact same Gemini parsing + 2-minute starter step pipeline runs
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brainDump: trimmed,
          targetDay,
          source: targetDay === "tomorrow" ? "email_reply" : "web",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setBrainDump("");
        setBrainDumpEdited(false);
        setStatusMessage(
          json.coachingNote ||
            `Queued ${json.tasks?.length || 1} task(s) for ${targetDay}.`
        );
        await fetchDashboard();
      } else {
        setBrainDumpError(json.error || "Could not parse tasks.");
      }
    } catch {
      setBrainDumpError("Network error while saving tasks.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleTask(task: Task) {
    const nextStatus: TaskStatus = task.status === "done" ? "pending" : "done";
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, status: nextStatus }),
      });
      await fetchDashboard();
    } catch (e) {
      console.error("Failed to toggle task:", e);
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
          title: kind === "morning" ? "Morning Action Plan Email" : "Evening Check-in Email",
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
          <h1 className="brand-title">RemindAI Dispatch Desk</h1>
          <p className="brand-subtitle">
            Your anti-procrastination daily agent: sends a 2-minute-starter action plan every morning at 08:00 and asks what&apos;s on deck for tomorrow every evening at 20:00.
          </p>
        </div>

        <div className="dispatch-toolbar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={dispatching !== null}
            onClick={() => handleTriggerEmail("morning")}
          >
            {dispatching === "morning"
              ? "Generating Morning Plan..."
              : "Send Morning Plan Email"}
          </button>
          <button
            type="button"
            className="btn btn-amber"
            disabled={dispatching !== null}
            onClick={() => handleTriggerEmail("evening")}
          >
            {dispatching === "evening"
              ? "Sending Evening Check-in..."
              : "Send Evening Check-in Email"}
          </button>
        </div>
      </header>

      {/* Integration & Cron Telemetry Bar */}
      <aside className="status-strip" aria-label="Service connection status">
        <div className="status-pills">
          <span>
            <span
              className={`status-dot ${data?.integrations.gemini ? "dot-live" : "dot-local"}`}
              aria-hidden="true"
            />
            <strong>Gemini 3.8 Flash:</strong>{" "}
            {data?.integrations.gemini ? "Connected" : "Fallback Heuristic Mode"}
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
            {data?.integrations.supabase ? "Connected" : "Local Store (.remindai-store.json)"}
          </span>
        </div>
        <span className="mono-tag">CRON: 08:00 AM / 08:00 PM</span>
      </aside>

      {/* Accessible Live Feedback Banner */}
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
        {/* LEFT COLUMN: Today's Morning Plan & Active Task Ledger */}
        <section className="ledger-sheet" aria-labelledby="today-heading">
          <div className="sheet-heading-row">
            <h2 id="today-heading" className="sheet-title">
              Today&apos;s Gameplan
            </h2>
            <span className="mono-tag">
              {data?.today || "Loading..."} &middot; {doneCount}/{todayTasks.length} Done
            </span>
          </div>

          {data?.brief && (
            <div className="frog-box">
              <div className="frog-label">
                #1 FROG OF THE DAY (DO THIS FIRST)
              </div>
              <p className="frog-text">{data.brief.frog_of_the_day}</p>
              {data.brief.lazy_hack && (
                <p className="hack-note">
                  <strong>Lazy-Brain Trick:</strong> {data.brief.lazy_hack}
                </p>
              )}
            </div>
          )}

          {loading ? (
            <p>Loading today&apos;s tasks...</p>
          ) : todayTasks.length === 0 ? (
            <p className="form-hint">
              No tasks scheduled for today yet. Use the form on the right to brain-dump tasks for today or tomorrow.
            </p>
          ) : (
            <ul className="task-list">
              {todayTasks.map((task) => {
                const checkboxId = `task-check-${task.id}`;
                return (
                  <li key={task.id} className="task-item">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="task-checkbox"
                      checked={task.status === "done"}
                      onChange={() => handleToggleTask(task)}
                    />
                    <div>
                      <label
                        htmlFor={checkboxId}
                        className={`task-title ${task.status === "done" ? "task-title-done" : ""}`}
                      >
                        {task.title}
                      </label>
                      <div className="starter-pill">
                        <strong>2-Min Starter:</strong> {task.starter_step}
                      </div>
                      <div className="task-meta">
                        <span className={`badge badge-${task.priority}`}>
                          {task.priority.toUpperCase()}
                        </span>
                        <span>~{task.estimated_minutes} min</span>
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
                );
              })}
            </ul>
          )}

          {data?.brief?.schedule_json && data.brief.schedule_json.length > 0 && (
            <details style={{ marginTop: "1.5rem" }}>
              <summary style={{ fontWeight: 600, cursor: "pointer" }}>
                View AI Time-Blocked Schedule ({data.brief.schedule_json.length} blocks)
              </summary>
              <ol className="schedule-list">
                {data.brief.schedule_json.map((slot, idx) => (
                  <li key={idx} className="schedule-row">
                    <span className="mono-tag">{slot.time_slot}</span>
                    <div>
                      <strong>{slot.task_title}</strong> ({slot.duration_minutes}m)
                      <div className="form-hint">{slot.why_it_matters}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>

        {/* RIGHT COLUMN: Evening Reply Simulator + Tomorrow's Queue */}
        <section
          className="ledger-sheet ledger-sheet-evening"
          aria-labelledby="tomorrow-heading"
        >
          <div className="sheet-heading-row">
            <h2 id="tomorrow-heading" className="sheet-title">
              Evening Check-in &amp; Tomorrow Queue
            </h2>
            <span className="mono-tag">{data?.tomorrow || "Tomorrow"}</span>
          </div>

          <form
            ref={formRef}
            onSubmit={handleBrainDumpSubmit}
            aria-labelledby="tomorrow-heading"
            noValidate
          >
            <fieldset className="radio-fieldset">
              <legend className="radio-legend">Schedule tasks for</legend>
              <div className="radio-group">
                <span className="radio-option">
                  <input
                    type="radio"
                    id="target-tomorrow"
                    name="targetDay"
                    value="tomorrow"
                    checked={targetDay === "tomorrow"}
                    onChange={() => setTargetDay("tomorrow")}
                  />
                  <label htmlFor="target-tomorrow">
                    Tomorrow ({data?.tomorrow || "Next Day"})
                  </label>
                </span>
                <span className="radio-option">
                  <input
                    type="radio"
                    id="target-today"
                    name="targetDay"
                    value="today"
                    checked={targetDay === "today"}
                    onChange={() => setTargetDay("today")}
                  />
                  <label htmlFor="target-today">
                    Today ({data?.today || "Today"})
                  </label>
                </span>
              </div>
            </fieldset>

            <div className="form-group">
              <label htmlFor={brainDumpId} className="form-label">
                What do you need to get done? (Natural language or email reply)
              </label>
              <span id={brainDumpHintId} className="form-hint">
                Type casually like replying to the 8 PM email. Press Enter to submit (Shift+Enter for new line). Gemini will break it down into 2-minute starter steps.
              </span>
              <textarea
                ref={textareaRef}
                id={brainDumpId}
                name="brainDump"
                className="form-textarea"
                required
                minLength={4}
                aria-invalid={brainDumpError ? "true" : undefined}
                aria-describedby={
                  brainDumpError
                    ? `${brainDumpHintId} ${brainDumpErrorId}`
                    : brainDumpHintId
                }
                placeholder="e.g., Tomorrow I need to finish the API slides before 11am, call the dentist, and clean up my Git branches..."
                value={brainDump}
                onChange={handleTextareaInput}
                onBlur={handleTextareaBlur}
                onKeyDown={handleTextareaKeyDown}
              />
              {brainDumpError && (
                <span id={brainDumpErrorId} className="error-msg" role="alert">
                  {brainDumpError}
                </span>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {submitting
                ? "Gemini is breaking tasks into 2-minute steps..."
                : `Parse & Queue Tasks for ${targetDay === "tomorrow" ? "Tomorrow" : "Today"}`}
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
              Nothing queued for tomorrow yet. Reply to tonight&apos;s check-in email or type above!
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
                    <div className="starter-pill">
                      <strong>2-Min Starter:</strong> {task.starter_step}
                    </div>
                    <div className="task-meta">
                      <span>~{task.estimated_minutes} min</span>
                      <span>via {task.source}</span>
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

      {/* Native Modal Dialog for Inspecting Dispatched Email HTML */}
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
