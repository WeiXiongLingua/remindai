import { GoogleGenAI } from "@google/genai";
import * as z from "zod";
import { MorningPlan, ParsedTaskBundle, Task } from "./types";

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
// 1. Parse messy evening reply / brain-dump into tomorrow's tasks
// ============================================================

const parsedTasksJsonSchema = {
  type: "object",
  properties: {
    coaching_note: {
      type: "string",
      description:
        "A short, encouraging 1-2 sentence acknowledgment of the user's tasks for tomorrow, written in a warm anti-procrastination tone.",
    },
    tasks: {
      type: "array",
      description: "Actionable tasks extracted from the user's message.",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Clear, concise, action-verb task title.",
          },
          notes: {
            type: "string",
            description: "Optional context or constraints mentioned by the user.",
          },
          starter_step: {
            type: "string",
            description:
              "A ridiculously easy 2-minute micro-step to overcome laziness and start this task effortlessly.",
          },
          estimated_minutes: {
            type: "integer",
            description: "Realistic duration in minutes (typically 10 to 60).",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Task priority based on urgency and impact.",
          },
        },
        required: ["title", "starter_step", "estimated_minutes", "priority"],
      },
    },
  },
  required: ["coaching_note", "tasks"],
};

const parsedTasksValidator = z.object({
  coaching_note: z.string(),
  tasks: z.array(
    z.object({
      title: z.string(),
      notes: z.string().optional(),
      starter_step: z.string(),
      estimated_minutes: z.number().int().min(5).max(240),
      priority: z.enum(["high", "medium", "low"]),
    })
  ),
});

export async function parseTasksFromBrainDump(
  rawText: string,
  targetDateStr: string
): Promise<ParsedTaskBundle> {
  const client = getGenAIClient();

  if (client) {
    const parsed = await generateJsonWithFallback(
      client,
      {
        system_instruction:
          "You are RemindAI, an anti-procrastination executive function coach for someone who feels too lazy to start tasks. " +
          "Extract concrete tasks from their casual email reply or brain dump. " +
          "If a task sounds huge or vague, break it into a realistic 15-45 minute chunk and invent a frictionless 'starter_step' that takes under 2 minutes.",
        input: `Target date: ${targetDateStr}\n\nUser message:\n"""\n${rawText}\n"""`,
        schema: parsedTasksJsonSchema,
      },
      (raw) => parsedTasksValidator.parse(raw)
    );
    if (parsed) return parsed;
    console.error("All Gemini models failed for parseTasksFromBrainDump, using heuristic parser.");
  }

  // Fallback parser when GEMINI_API_KEY is not yet configured
  const lines = rawText
    .split(/\r?\n|;|,(?=\s*(?:and\s+)?(?:need|call|write|finish|send|buy|clean|review|fix|prepare|email|study|work))/i)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 2);

  const tasks = (lines.length > 0 ? lines : [rawText.trim()]).map((line, index) => {
    const lower = line.toLowerCase();
    const isHigh =
      index === 0 ||
      lower.includes("urgent") ||
      lower.includes("must") ||
      lower.includes("deadline") ||
      lower.includes("asap") ||
      lower.includes("important");
    return {
      title: line.charAt(0).toUpperCase() + line.slice(1),
      starter_step: `Open the needed tab or tool for "${line.slice(0, 36)}" and do just the first 2 minutes.`,
      estimated_minutes: isHigh ? 30 : 20,
      priority: (isHigh ? "high" : index === 1 ? "medium" : "low") as "high" | "medium" | "low",
    };
  });

  return {
    coaching_note: `Got it! I queued ${tasks.length} task${tasks.length === 1 ? "" : "s"} for ${targetDateStr} and attached a 2-minute lazy-proof starter step to each one.`,
    tasks,
  };
}

// ============================================================
// 2. Generate Morning Action Plan from today's tasks
// ============================================================

const morningPlanJsonSchema = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Punchy, motivating morning email subject line (max 65 chars).",
    },
    greeting: {
      type: "string",
      description: "Warm, anti-overwhelm 2-sentence morning greeting.",
    },
    frog_of_the_day: {
      type: "string",
      description:
        "The single #1 highest-leverage task to do first today so the day is already a win even if the user is lazy later.",
    },
    lazy_hack: {
      type: "string",
      description:
        "One concrete psychological trick tailored to today's tasks (e.g., the 2-minute rule, body doubling, or temptation bundling).",
    },
    schedule: {
      type: "array",
      description: "Time-blocked sequence for tackling today's tasks with generous buffers.",
      items: {
        type: "object",
        properties: {
          time_slot: {
            type: "string",
            description: "Suggested time window, e.g. '09:00 – 09:25'.",
          },
          task_title: {
            type: "string",
            description: "The title of the task.",
          },
          duration_minutes: {
            type: "integer",
            description: "Minutes allocated.",
          },
          priority: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
          starter_step: {
            type: "string",
            description: "The tiny 2-minute action to start this block without resistance.",
          },
          why_it_matters: {
            type: "string",
            description: "1 short sentence on how good it will feel once this is done.",
          },
        },
        required: [
          "time_slot",
          "task_title",
          "duration_minutes",
          "priority",
          "starter_step",
          "why_it_matters",
        ],
      },
    },
  },
  required: ["subject", "greeting", "frog_of_the_day", "lazy_hack", "schedule"],
};

const morningPlanValidator = z.object({
  subject: z.string(),
  greeting: z.string(),
  frog_of_the_day: z.string(),
  lazy_hack: z.string(),
  schedule: z.array(
    z.object({
      time_slot: z.string(),
      task_title: z.string(),
      duration_minutes: z.number(),
      priority: z.enum(["high", "medium", "low"]),
      starter_step: z.string(),
      why_it_matters: z.string(),
    })
  ),
});

export async function generateMorningActionPlan(
  tasks: Task[],
  dateStr: string,
  userName = process.env.USER_NAME || "friend"
): Promise<MorningPlan> {
  const pendingTasks = tasks.filter((t) => t.status !== "skipped");
  const client = getGenAIClient();

  if (client && pendingTasks.length > 0) {
    const taskSummary = pendingTasks
      .map(
        (t, i) =>
          `${i + 1}. [${t.priority.toUpperCase()}] ${t.title} (~${t.estimated_minutes}m) | Starter step: ${t.starter_step}${t.notes ? ` | Notes: ${t.notes}` : ""}`
      )
      .join("\n");

    const plan = await generateJsonWithFallback(
      client,
      {
        system_instruction:
          "You are RemindAI, an empathetic, practical daily productivity coach for a smart person who struggles with task initiation and procrastination. " +
          "Turn their task list into a calm, realistic, time-blocked morning gameplan. " +
          "Pick the single most important 'Frog of the Day' first, space out the time slots with breathing room starting around 09:00, and emphasize the 2-minute starter step so they never feel overwhelmed.",
        input: `User Name: ${userName}\nDate: ${dateStr}\nToday's Tasks:\n${taskSummary}`,
        schema: morningPlanJsonSchema,
      },
      (raw) => morningPlanValidator.parse(raw)
    );
    if (plan) return plan;
    console.error("All Gemini models failed for generateMorningActionPlan, using fallback plan.");
  }

  // Fallback deterministic plan
  if (pendingTasks.length === 0) {
    return {
      subject: `Morning Dispatch (${dateStr}): Clean Slate Today`,
      greeting: `Good morning, ${userName}! You didn't queue any tasks last night, so let's pick just ONE 15-minute win to make today count.`,
      frog_of_the_day: "Pick 1 nagging task you've been avoiding all week and spend just 10 minutes on it.",
      lazy_hack:
        "The 2-Minute Rule: Tell yourself you are only allowed to work on your task for 120 seconds. Usually, starting is 80% of the battle.",
      schedule: [
        {
          time_slot: "09:30 – 09:45",
          task_title: "Choose 1 small win on your RemindAI desk",
          duration_minutes: 15,
          priority: "high",
          starter_step: "Open your RemindAI dashboard and type one thing you want off your plate by tonight.",
          why_it_matters: "Turns a zero-plan day into an intentional win.",
        },
      ],
    };
  }

  const sorted = [...pendingTasks].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  let currentMinutesFromMidnight = 9 * 60; // Start at 09:00
  const schedule = sorted.map((t) => {
    const startH = String(Math.floor(currentMinutesFromMidnight / 60)).padStart(2, "0");
    const startM = String(currentMinutesFromMidnight % 60).padStart(2, "0");
    const endTotal = currentMinutesFromMidnight + t.estimated_minutes;
    const endH = String(Math.floor(endTotal / 60)).padStart(2, "0");
    const endM = String(endTotal % 60).padStart(2, "0");
    currentMinutesFromMidnight = endTotal + 20; // 20m buffer between tasks

    return {
      time_slot: `${startH}:${startM} – ${endH}:${endM}`,
      task_title: t.title,
      duration_minutes: t.estimated_minutes,
      priority: t.priority,
      starter_step: t.starter_step,
      why_it_matters:
        t.priority === "high"
          ? "Knocking this out first removes 80% of today's mental guilt."
          : "Keeps your momentum rolling without burning out.",
    };
  });

  const frog = sorted[0];

  return {
    subject: `Morning Plan (${dateStr}): Start with "${frog.title.slice(0, 38)}"`,
    greeting: `Good morning, ${userName}! Don't worry about finishing the whole list right now — your only job is to do the 2-minute starter step for Task #1.`,
    frog_of_the_day: `${frog.title} (${frog.estimated_minutes} min) — ${frog.starter_step}`,
    lazy_hack:
      "Put your phone in another room for just the first 25-minute block. Once the #1 Frog is done, the rest of the day feels effortless.",
    schedule,
  };
}
