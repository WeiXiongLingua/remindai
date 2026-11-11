# RemindAI — Anti-Procrastination Daily Email Agent

RemindAI is a personal AI agent built with **Next.js (App Router)**, **Google Gemini (`gemini-3.8-flash` via `@google/genai`)**, **Resend**, **Supabase**, and **Vercel Cron**.

## How the Daily Loop Works

1. **Morning Action Plan (08:00 AM Cron — `/api/cron/morning`)**:
   - Automatically rolls over any unfinished tasks from yesterday.
   - Calls **Gemini 3.5 Flash** to pick your **#1 Frog of the Day**, design a time-blocked schedule, and attach a frictionless **2-Minute Lazy Starter Step** to each task.
   - Sends the HTML dispatch email via **Resend** and stores the brief in **Supabase**.
2. **Evening Check-in (08:00 PM Cron — `/api/cron/evening`)**:
   - Summarizes how many tasks you finished today and asks: *"What do you need to get done tomorrow?"*
3. **Natural-Language Reply (`/api/webhooks/resend` + Web Desk)**:
   - Just hit **Reply** to the evening email (or type on the web dashboard) in plain English:
     > *"Tomorrow I need to finish the Q4 slides, call the dentist before noon, and clean up my Git branches."*
   - Gemini extracts structured tasks, estimates durations, invents a 2-minute starter step for each, saves them to Supabase for tomorrow, and sends a confirmation email.

---

## Quick Start

```bash
cd ~/remindai
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
> **Out-of-the-box local mode:** Even before you paste your Supabase, Resend, or Gemini keys, RemindAI works immediately using a local JSON store (`.remindai-store.json`), heuristic task parsing, and an interactive in-browser HTML email preview modal.

---

## Production Setup (Supabase + Resend + Vercel)

### 1. Supabase Database
1. Create a new project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** and run the contents of [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy your `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into `.env.local` (and Vercel Environment Variables).

### 2. Google Gemini API Key
1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey).
2. Set `GEMINI_API_KEY` in `.env.local`.

### 3. Resend Outbound & Inbound Webhook
1. Create an API key at [resend.com](https://resend.com) and verify your domain.
2. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO_EMAIL`, and `USER_EMAIL` in `.env.local`.
3. In Resend Dashboard → **Webhooks**, add a webhook pointing to:
   ```
   https://your-vercel-domain.vercel.app/api/webhooks/resend
   ```
   and subscribe to `email.received` (inbound email replies).

### 4. Deploy to Vercel
```bash
npx vercel --prod
```
[`vercel.json`](./vercel.json) automatically registers the two daily cron jobs:
- `0 8 * * *` → `/api/cron/morning`
- `0 20 * * *` → `/api/cron/evening`
