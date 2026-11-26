# AssignMate

AssignMate is a web-based dashboard for managing team tasks and projects. It allows administrators to register team members, define skills, create tasks/projects, auto-assign tasks, and track progress. Members sign in with their real email, see only their own tasks, and connect their own Google account.

## Group Members
- Cabahug, Lorenze Antoinette
- Bocado, Denise
- Suganob, Torcy Klyne
- Mayol, Saint Yves

## Features

- MySQL-backed users, skills, tasks, projects, and login sessions
- Email login with `admin` and `member` roles
- Admin: full task/project/team management, add or remove skills
- Member: own tasks, move own tasks through **Backlog → In Progress → Complete**, connect own Gmail and Calendar
- Automatic task assignment based on skills and workload
- **Google Calendar Integration**:
  - Creates real **all-day deadline events** with the Google Calendar API.
  - **Fully automatic**: a background sweep re-syncs any assigned task whose event is missing (new task, new owner, moved deadline, late Google connect). No manual sync button.
  - Shows **Calendar synced / Syncing automatically** on task cards and a dedicated **Calendar** tab.
  - 1-click **Open in Google Calendar** link and `.ics` download per task.
- **Email Reminders with per-member Gmail OAuth**:
  - Each member connects their own Google account from Team Members.
  - Assignment and deadline emails are sent from that member's Gmail account to their real email.
  - Uses the Gmail API with `https://www.googleapis.com/auth/gmail.send`.
  - Sends one deadline reminder when a task is within the configured reminder window.
- Real-time progress and velocity tracking

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express (microservices + API gateway)
- Database: MySQL / MariaDB via `mysql2`
- Calendar: Google Calendar API + iCalendar (.ics)
- Email: Google OAuth 2.0 + Gmail API, with Nodemailer used only to compose the MIME message

## Setup

1. Install dependencies: `npm install`
2. Create the database tables:
   - Create/select the database in your hosting panel.
   - Run `database/schema.sql` in phpMyAdmin.
   - Add your real admin account by running the commented `INSERT INTO users` statement at the bottom of that file.
   - Upgrading an existing install? Run `database/migrations/2026-11-27-status-vocabulary.sql` **before** deploying the new code (it converts the old `assigned` / `unassigned` statuses to `in_progress` / `backlog`).
3. Create a Google Cloud OAuth client:
   - Create or select a project in Google Cloud Console.
   - Enable the **Gmail API** and **Google Calendar API**.
   - Configure the OAuth consent screen. If the app is in Testing mode, add every member's real email as a test user.
   - Create an OAuth client of type **Web application**.
   - Add this authorized redirect URI exactly:
     `https://assignmate.dcism.org/user_service/api/auth/google/callback`
   - For local development, also add:
     `http://localhost:20201/user_service/api/auth/google/callback`
   - Copy the client ID and client secret.
4. Configure environment variables in `.env`:
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `INTERNAL_API_KEY` (long random string)
   - Optional: `SESSION_DAYS` (default `7`), `REMINDER_DAYS_BEFORE` (default `2`), `REMINDER_CHECK_INTERVAL_MINUTES` (default `60`), `CALENDAR_SYNC_INTERVAL_MINUTES` (default `1`)
5. Start all services:
   - `npm start` (or `node start.js`)
   - Individually: `node gateway/server.js`, `node user_service/server.js`, `node task_service/server.js`
6. Visit https://assignmate.dcism.org and sign in with your **real email**.
   - Admin: add members with their real email and skills, manage the skill list on Team Members, create tasks and projects.
   - Members: sign in, open **Team Members**, and click **Connect Google**. Approve Gmail + Calendar access.

There is no password step: login is by email, and sessions expire after `SESSION_DAYS`. If an email is not in MySQL, it cannot sign in.

## Task Statuses

| Status | Meaning |
| --- | --- |
| `backlog` | Not started yet (new tasks start here). |
| `in_progress` | Actively being worked on. Auto-assign moves a task here. |
| `completed` | Done. |

Every task card has a **Backlog / In Progress / Complete** switch; admins and members can both move their own tasks. Changing the status, the owner, or the deadline invalidates the calendar event so it is re-synced automatically.

## Email and Calendar Testing

1. Sign in as a member and connect Google (Gmail + Calendar scopes).
2. As admin, create/assign a task to that member.
3. The assignment email is sent from the member's Gmail to their real email.
4. Within a minute the task card shows **Calendar synced** once the Calendar API event was created; until then it reads **Syncing automatically**. The **Calendar** tab lists every deadline grouped by date.

If a member has not connected Google, assignment still succeeds but email/calendar sync reports the reason in the API response and the dashboard continues to work.

## Email Troubleshooting

Auto-assign now reports the real outcome in a toast, for example:

`Assigned to Jamie Rivera · email NOT sent: User has not connected Google · calendar NOT synced: ...`

| Message | Fix |
| --- | --- |
| `INTERNAL_API_KEY is not configured` | Add `INTERNAL_API_KEY` to the server `.env` and restart. |
| `User has not connected Google` | That member must click **Connect Google** on Team Members. |
| `insufficient authentication scopes` / `403` from Gmail | Reconnect Google so the new Gmail + Calendar scopes are granted. |
| `fetch failed` / `user_service returned 502` | The user service is down or `INTERNAL_API_KEY` differs between services. |

Assigned task cards have a **Resend email** button so a failed assignment email can be retried without reassigning.

Check the server log for the underlying error:

```bash
cd /data/users/s22100684/assignmate.dcism.org && grep -iE "email|not sent|gmail|internal" app.log | tail -n 30
```

Reminder emails (separate from the assignment email) are sent by the background checker every `REMINDER_CHECK_INTERVAL_MINUTES` (default 60) and once at startup, when an assigned task's deadline is 0..`REMINDER_DAYS_BEFORE` days away (default 2). One reminder per task; the flag resets if the deadline, assignee, or status changes.
