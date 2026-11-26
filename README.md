# AssignMate

AssignMate is a web-based dashboard for managing team tasks and projects. It allows administrators to register team members, define skills, create tasks/projects, auto-assign tasks, and track progress.

## Group Members
- Cabahug, Lorenze Antoinette
- Bocado, Denise
- Suganob, Torcy Klyne
- Mayol, Saint Yves

## Features

- User registration and skill management with personal Google accounts
- Task and project creation with all-day deadline tracking
- Automatic task assignment based on skills and workload
- **Google Calendar Integration**:
  - Automatically syncs tasks as **all-day deadline events** directly into each member's personal Google Calendar.
  - 1-click **Open in Member's Google Calendar** action pre-fills title, specifications, and member email.
  - Standard RFC 5545 `.ics` file download per task.
- **Email Reminders with per-member Gmail OAuth**:
  - Each member connects their own Google account from Team Members.
  - Assignment and deadline emails are sent from that member's Gmail account.
  - Uses the Gmail API with the narrow `https://www.googleapis.com/auth/gmail.send` scope.
  - Sends one deadline reminder when a task is within the configured reminder window.
- Real-time progress and velocity tracking

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express (Microservices Architecture with API Gateway)
- Calendar: Google Calendar Web Intent API & iCalendar (.ics)
- Email: Google OAuth 2.0 + Gmail API, with Nodemailer used only to compose the MIME message

## Setup

1. Install dependencies: `npm install`
2. Create a Google Cloud OAuth client:
   - Create or select a project in Google Cloud Console.
   - Enable the **Gmail API**.
   - Configure the OAuth consent screen. If the app is in Testing mode, add every member's Gmail address as a test user.
   - Create an OAuth client of type **Web application**.
   - Add this authorized redirect URI exactly:
     `http://localhost:20201/user_service/api/auth/google/callback`
   - Copy the client ID and client secret.
3. Configure environment variables:
   - Copy `.env.example` to `.env`.
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   - Set `INTERNAL_API_KEY` to a long random string. Both services use it for the internal send-email request.
   - Optional: set `REMINDER_DAYS_BEFORE` (default `2`) and `REMINDER_CHECK_INTERVAL_MINUTES` (default `60`).
4. Start all services together:
   - `npm start` (or `node start.js`)
   - *Alternatively, run individually in separate terminals:*
     - `node gateway/server.js` (Port 20201)
     - `node user_service/server.js` (Port 3001)
     - `node task_service/server.js` (Port 3002)
5. Visit http://localhost:20201 and open **Team Members**.
   - Add each member with their real Gmail address.
   - Click **Connect Google** next to the member and approve Gmail sending access.
   - The sample users use fake `@gmail.com` addresses; they cannot receive real email.

OAuth refresh tokens are kept in memory for this demo. A service restart requires members to reconnect Google. For production, store tokens in an encrypted database.

## Email Reminder Testing

1. Connect a member with a real Gmail account.
2. Assign a task to that member.
3. Trigger the reminder immediately:

```bash
curl -X POST http://localhost:20201/task_service/api/tasks/1/send-reminder
```

The email is sent from the member's connected Gmail account to the same address. If the member has not connected Google, the task service returns an error and the rest of the dashboard continues to work.
