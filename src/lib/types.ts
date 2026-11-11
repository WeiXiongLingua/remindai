export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "done" | "skipped";
export type TaskSource = "web" | "email_reply" | "rollover";

export interface Task {
  id: string;
  title: string;
  notes?: string | null;
  starter_step: string;
  estimated_minutes: number;
  priority: TaskPriority;
  scheduled_for: string; // YYYY-MM-DD
  status: TaskStatus;
  source: TaskSource;
  created_at: string;
  completed_at?: string | null;
}

export interface ScheduleBlock {
  time_slot: string;
  task_title: string;
  duration_minutes: number;
  priority: TaskPriority;
  starter_step: string;
  why_it_matters: string;
}

export interface MorningPlan {
  subject: string;
  greeting: string;
  frog_of_the_day: string;
  lazy_hack: string;
  schedule: ScheduleBlock[];
}

export interface DailyBrief {
  id: string;
  brief_date: string;
  subject: string | null;
  greeting: string | null;
  frog_of_the_day: string | null;
  lazy_hack: string | null;
  schedule_json: ScheduleBlock[];
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
  starter_step: string;
  estimated_minutes: number;
  priority: TaskPriority;
}

export interface ParsedTaskBundle {
  coaching_note: string;
  tasks: ParsedTaskInput[];
}
