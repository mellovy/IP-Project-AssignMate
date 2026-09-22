# AssignMate

AssignMate is a web-based dashboard for managing team tasks and projects. It allows administrators to register team members, define skills, create tasks/projects, auto-assign tasks, and track progress.

## Features

- User registration and skill management
- Task and project creation
- Automatic task assignment based on skills and workload
- Real-time progress tracking

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express

## Setup

1. Install dependencies: `npm install`
2. Configure `.env` with database credentials
3. Start services:
   - `node gateway/server.js`
   - `node user_service/server.js`
   - `node task_service/server.js`
4. Visit http://localhost:20201 in your browser