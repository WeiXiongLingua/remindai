import { GoogleGenAI } from "@google/genai";
import * as z from "zod";
import { MorningPlan, ParsedEmailReply, Task } from "./types";
import { formatReadableDate } from "./dates";

// Models are tried in order. If one is overloaded (503), slow, or failing,
// the next one is used. Override the first choice with GEMINI_MODEL in env.
const GEMINI_MODELS = Array.from(
  new Set(
    [
      process.env.GEMINI_MODEL,
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.8-flash",
    ].filter((m): m is string => Boolean(m))
  )
);

// Per-model time limit, so a hanging model can't eat the whole Vercel function budget.
const PER_MODEL_TIMEOUT_MS = 15_000;

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  return Boolean(key && !key.includes("your_gemini_api_key"));
}

function getGenAIClient(): GoogleGenAI | null {
  if (!isGeminiConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Calls Gemini with structured JSON output, falling back through GEMINI_MODELS.
 * Returns the validated result, or null if every model failed.
 */
async function generateJsonWithFallback<T>(
  client: GoogleGenAI,
  params: { system_instruction: string; input: string; schema: object },
  validate: (raw: unknown) => T
): Promise<T | null> {
  for (const model of GEMINI_MODELS) {
    try {
      const interaction = await withTimeout(
        client.interactions.create({
          model,
          system_instruction: params.system_instruction,
          input: params.input,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: params.schema,
          },
        }),
        PER_MODEL_TIMEOUT_MS,
        model
      );

      if (interaction.output_text) {
        return validate(JSON.parse(interaction.output_text));
      }
      console.warn(`Gemini ${model} returned no text, trying next model.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Gemini ${model} failed (${message.slice(0, 160)}), trying next model.`);
    }
  }
  return null;
}

// ============================================================
// 1. Parse Inbound Email Reply (Completed tasks + Tomorrow tasks)
// ============================================================

const emailReplyJsonSchema = {
  type: "object",
  properties: {
    completed_task_titles: {
      type: "array",
      description:
        "Exact or approximate titles of today's tasks that the user indicated they finished or completed.",
      items: { type: "string" },
    },
    tomorrow_tasks: {
      type: "array",
      description: "New tasks the user wants to do tomorrow.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Clear, concise task title.",
          },
          notes: {
            type: "string",
            description: "Optional notes or details mentioned by the user.",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Priority based on urgency.",
          },
        },
        required: ["title"],
      },
    },
    summary_message: {
      type: "string",
      description:
        "A short, friendly 1-sentence confirmation acknowledging what was completed today and what is scheduled for tomorrow.",
    },
  },
  required: ["completed_task_titles", "tomorrow_tasks", "summary_message"],
};

const emailReplyValidator = z.object({
  completed_task_titles: z.array(z.string()),
  tomorrow_tasks: z.array(
    z.object({
      title: z.string(),
      notes: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
    })
  ),
  summary_message: z.string(),
});

export async function parseEmailReply(
  rawText: string,
  todayTasks: Task[],
  tomorrowDateStr: string
): Promise<ParsedEmailReply> {
  const client = getGenAIClient();

  if (client) {
    const todayTaskSummary =
      todayTasks.length > 0
        ? todayTasks.map((t, i) => `${i + 1}. [${t.status.toUpperCase()}] ${t.title}`).join("\n")
        : "(No tasks were on today's list)";

    const parsed = await generateJsonWithFallback(
      client,
      {
        system_instruction:
          "You are RemindAI, a direct and helpful personal task assistant. " +
          "The user is replying to their evening check-in email. " +
          "Carefully identify:\n" +
          "1. Any tasks from today's list that the user says they finished, completed, or got done.\n" +
          "2. Any tasks the user needs or wants to do tomorrow.\n" +
          "Be clean, direct, and accurate.",
        input: `Today's Date Tasks:\n${todayTaskSummary}\n\nTomorrow Date: ${tomorrowDateStr}\n\nUser Email Reply:\n"""\n${rawText}\n"""`,
        schema: emailReplyJsonSchema,
      },
      (raw) => emailReplyValidator.parse(raw)
    );

    if (parsed) {
      return {
        completed_task_titles: parsed.completed_task_titles,
        tomorrow_tasks: parsed.tomorrow_tasks.map((t) => ({
          title: t.title,
          notes: t.notes,
          priority: t.priority || "medium",
        })),
        summary_message: parsed.summary_message,
      };
    }
  }

  // Deterministic fallback parser if Gemini is not responding
  const lines = rawText
    .split(/\r?\n|;|,(?=\s*(?:and\s+)?(?:need|call|write|finish|send|buy|clean|review|fix|prepare|email|study|work))/i)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 2);

  const completed: string[] = [];
  const tomorrowTasks: { title: string; priority: "high" | "medium" | "low" }[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("done:") || lower.includes("finished") || lower.includes("completed") || lower.includes("did ")) {
      completed.push(line.replace(/^(done:?|finished|completed|did)\s*/i, "").trim());
    } else {
      tomorrowTasks.push({
        title: line.charAt(0).toUpperCase() + line.slice(1),
        priority: lower.includes("urgent") || lower.includes("asap") ? "high" : "medium",
      });
    }
  }

  return {
    completed_task_titles: completed,
    tomorrow_tasks: tomorrowTasks.length > 0 ? tomorrowTasks : [{ title: rawText.trim(), priority: "medium" }],
    summary_message: `Saved ${tomorrowTasks.length} task(s) for tomorrow.`,
  };
}

// ============================================================
// 2. Simple Morning Reminder Generator
// ============================================================

export async function generateMorningPlan(
  tasks: Task[],
  dateStr: string,
  userName = process.env.USER_NAME || "friend"
): Promise<MorningPlan> {
  const pendingTasks = tasks.filter((t) => t.status !== "skipped");
  const readableDate = formatReadableDate(dateStr);

  if (pendingTasks.length === 0) {
    return {
      subject: `Today's Tasks (${readableDate})`,
      greeting: `Good morning ${userName}! You don't have any tasks scheduled for today.`,
      tasks: [],
      reminder_footer:
        "Tonight at 10:00 PM you'll receive a check-in email where you can reply with what you need to do tomorrow.",
    };
  }

  return {
    subject: `Today's Tasks (${readableDate})`,
    greeting: `Good morning ${userName}! Here is what you need to do today:`,
    tasks: pendingTasks.map((t) => ({
      title: t.title,
      notes: t.notes || undefined,
      priority: t.priority,
    })),
    reminder_footer:
      "Tonight at 10:00 PM, you'll receive an evening check-in email. Simply reply to it with what you finished and what you need to do tomorrow!",
  };
}
