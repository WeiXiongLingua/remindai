export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "done" | "skipped";
export type TaskSource = "web" | "email_reply" | "rollover";

export interface Task {
  id: string;
  title: string;
  notes?: string | null;
  starter_step?: string;
  estimated_minutes?: number;
  priority: TaskPriority;
  scheduled_for: string; // YYYY-MM-DD
  status: TaskStatus;
  source: TaskSource;
  created_at: string;
  completed_at?: string | null;
}

export interface MorningPlan {
  subject: string;
  greeting: string;
  tasks: Array<{
    title: string;
    notes?: string;
    priority?: TaskPriority;
  }>;
  reminder_footer: string;
}

export interface DailyBrief {
  id: string;
  brief_date: string;
  subject: string | null;
  greeting: string | null;
  morning_email_id?: string | null;
  morning_sent_at?: string | null;
  evening_email_id?: string | null;
  evening_sent_at?: string | null;
  raw_evening_reply?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedTaskInput {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  starter_step?: string;
  estimated_minutes?: number;
}

export interface ParsedEmailReply {
  completed_task_titles: string[];
  tomorrow_tasks: ParsedTaskInput[];
  summary_message: string;
}
