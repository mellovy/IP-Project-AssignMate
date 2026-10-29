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
- Real-time progress and velocity tracking

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express (Microservices Architecture with API Gateway)
- Calendar: Google Calendar Web Intent API & iCalendar (.ics)

## Setup

1. Install dependencies: `npm install`
2. Start all services together:
   - `npm start` (or `node start.js`)
   - *Alternatively, run individually in separate terminals:*
     - `node gateway/server.js` (Port 20201)
     - `node user_service/server.js` (Port 3001)
     - `node task_service/server.js` (Port 3002)
3. Visit http://localhost:20201 in your browser
