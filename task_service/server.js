const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

// In-memory storage
let tasks = [];
let nextTaskId = 1;

// Helper: Calculate default deadline (N days ahead as YYYY-MM-DD)
function getDefaultDeadline(daysAhead = 7) {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().split('T')[0];
}

// Helper: Format date for Google Calendar all-day event (YYYYMMDD/YYYYMMDD)
// In Google Calendar, all-day events use YYYYMMDD with end date exclusive (next day)
function formatGoogleCalendarAllDayDates(deadlineStr) {
    const cleanDate = (deadlineStr && deadlineStr.includes('T')) ? deadlineStr.split('T')[0] : (deadlineStr || getDefaultDeadline(7));
    const parts = cleanDate.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    const startDate = new Date(Date.UTC(year, month, day));
    const endDate = new Date(Date.UTC(year, month, day + 1));

    const toCompact = (d) => {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dt = String(d.getUTCDate()).padStart(2, '0');
        return `${y}${m}${dt}`;
    };

    return `${toCompact(startDate)}/${toCompact(endDate)}`;
}

// Helper: Generate Google Calendar Web Intent URL for member's personal calendar
function generateGoogleCalendarUrl(task) {
    const deadline = task.deadline || getDefaultDeadline(7);
    const dates = formatGoogleCalendarAllDayDates(deadline);
    const title = `Deadline: ${task.title}`;

    let details = `AssignMate Task Deadline\n`;
    details += `------------------------------------\n`;
    details += `Task: ${task.title}\n`;
    details += `Status: ${task.status}\n`;
    details += `Required Skill: ${task.required_skill || 'N/A'}\n`;
    if (task.assigned_user_name) {
        details += `Assigned To: ${task.assigned_user_name} (${task.assigned_user_email || 'No email'})\n`;
    }
    if (task.description) {
        details += `\nDescription:\n${task.description}\n`;
    }
    if (task.specifications) {
        details += `\nSpecifications / Acceptance Criteria:\n${task.specifications}\n`;
    }
    details += `\nManaged via AssignMate Task Dashboard`;

    let url = `https://calendar.google.com/calendar/render?action=TEMPLATE`;
    url += `&text=${encodeURIComponent(title)}`;
    url += `&dates=${dates}`;
    url += `&details=${encodeURIComponent(details)}`;
    if (task.assigned_user_email) {
        url += `&add=${encodeURIComponent(task.assigned_user_email)}`;
    }
    return url;
}

// Helper: Generate iCalendar (.ics) content for all-day deadline
function generateIcsContent(task) {
    const deadline = task.deadline || getDefaultDeadline(7);
    const dateRange = formatGoogleCalendarAllDayDates(deadline).split('/');
    const dtStart = dateRange[0];
    const dtEnd = dateRange[1];
    const nowCompact = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const summary = `Deadline: ${task.title.replace(/\n/g, ' ')}`;
    const description = `Task: ${task.title}\\nAssignee: ${task.assigned_user_name || 'Unassigned'} (${task.assigned_user_email || ''})\\nRequired Skill: ${task.required_skill || 'N/A'}\\n\\n${(task.description || '').replace(/\n/g, '\\n')}`;

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//AssignMate//Task Deadline Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:assignmate-task-${task.id}-${Date.now()}@assignmate.local`,
        `DTSTAMP:${nowCompact}`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        task.assigned_user_email ? `ATTENDEE;CN=${task.assigned_user_name || 'Member'};ROLE=REQ-PARTICIPANT:mailto:${task.assigned_user_email}` : '',
        'END:VEVENT',
        'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
}

// Initialize sample tasks with deadlines ready for class demo
function initializeSampleTasks() {
    if (tasks.length > 0) return;
    const now = new Date();
    const d1 = new Date(now.getTime() + 2 * 86400000).toISOString().split('T')[0];
    const d2 = new Date(now.getTime() + 4 * 86400000).toISOString().split('T')[0];
    const d3 = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    tasks.push({
        id: nextTaskId++,
        title: "Setup API Gateway Authentication",
        description: "Configure reverse proxy middleware and authenticate microservices requests.",
        specifications: "1. Route user_service and task_service\n2. Add rate limiting\n3. Set headers",
        required_skill: "Development",
        deadline: d1,
        parent_id: null,
        task_type: "task",
        status: "unassigned",
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_user_email: null,
        calendar_synced: false,
        calendar_event_id: null,
        progress_percent: 0,
        created_at: new Date(now.getTime() - 86400000).toISOString()
    });

    tasks.push({
        id: nextTaskId++,
        title: "Create High-Fidelity Dashboard Mockups",
        description: "Draft Figma mockups for task assignment board and project timeline.",
        specifications: "Include responsive tablet and desktop layouts in dark/light contrast.",
        required_skill: "Design",
        deadline: d2,
        parent_id: null,
        task_type: "task",
        status: "unassigned",
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_user_email: null,
        calendar_synced: false,
        calendar_event_id: null,
        progress_percent: 0,
        created_at: new Date(now.getTime() - 43200000).toISOString()
    });

    tasks.push({
        id: nextTaskId++,
        title: "Automated Integration Test Suite",
        description: "Write end-to-end integration tests between User Service and Task Service.",
        specifications: "Test auto-assign load balancing and active task counters.",
        required_skill: "Testing",
        deadline: d3,
        parent_id: null,
        task_type: "task",
        status: "unassigned",
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_user_email: null,
        calendar_synced: false,
        calendar_event_id: null,
        progress_percent: 0,
        created_at: new Date().toISOString()
    });
}

initializeSampleTasks();

function findTaskById(id) {
    return tasks.find(t => t.id === Number(id));
}

function calculateProjectProgress(projectId) {
    const subtasks = tasks.filter(t => t.parent_id === Number(projectId));
    const total = subtasks.length;
    const completed = subtasks.filter(t => t.status === 'completed').length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    const project = findTaskById(projectId);
    if (project) project.progress_percent = progress;

    return { total, completed, progress };
}

async function adjustActiveTasks(userId, delta) {
    if (!userId) return;
    try {
        await fetch(`${USER_SERVICE_URL}/api/users/${userId}/active-tasks`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delta })
        });
    } catch (err) {
        console.error('Failed to adjust active_tasks for user', userId, err);
    }
}

// PUT: Auto-Assign Task
app.put('/api/tasks/:id/auto-assign', async (req, res) => {
    const taskId = req.params.id;
    const task = findTaskById(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    try {
        const response = await fetch(`${USER_SERVICE_URL}/api/users/match/${encodeURIComponent(task.required_skill)}`);
        if (!response.ok) throw new Error(`user_service returned ${response.status}`);
        const matches = await response.json();
        const bestUser = matches[0];

        if (!bestUser) return res.status(404).json({ message: "No qualified members found" });

        const prevStatus = task.status;

        task.assigned_user_id = bestUser.id;
        task.assigned_user_name = bestUser.name;
        task.assigned_user_email = bestUser.email || `${bestUser.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@gmail.com`;
        task.status = 'assigned';
        task.calendar_synced = true;

        if (!task.deadline) {
            task.deadline = getDefaultDeadline(7);
        }

        if (prevStatus !== 'assigned') {
            await adjustActiveTasks(bestUser.id, 1);
        }

        if (task.parent_id) {
            calculateProjectProgress(task.parent_id);
        }

        const calendarUrl = generateGoogleCalendarUrl(task);

        res.json({
            message: `Successfully assigned to ${bestUser.name}`,
            user: bestUser,
            task,
            calendar: {
                synced: true,
                target_email: task.assigned_user_email,
                event_type: 'All-day deadline',
                deadline: task.deadline,
                google_calendar_url: calendarUrl
            }
        });
    } catch (err) {
        console.error('Auto-assign error:', err);
        res.status(500).json({ error: "Integration Layer Error: " + err.message });
    }
});

// POST: Create Task
app.post('/api/tasks', (req, res) => {
    const { title, required_skill, description, specifications, parent_id, task_type, deadline } = req.body;

    if (!title) return res.status(400).json({ error: "Title required" });

    const newTask = {
        id: nextTaskId++,
        title,
        description: description || null,
        specifications: specifications || null,
        required_skill,
        deadline: deadline || getDefaultDeadline(7),
        parent_id: parent_id ? Number(parent_id) : null,
        task_type: task_type || 'task',
        status: 'unassigned',
        assigned_user_id: null,
        assigned_user_name: null,
        assigned_user_email: null,
        calendar_synced: false,
        calendar_event_id: null,
        progress_percent: 0,
        created_at: new Date().toISOString()
    };

    tasks.push(newTask);

    if (newTask.parent_id) {
        calculateProjectProgress(newTask.parent_id);
    }

    res.json(newTask);
});

// PUT: Update Task
app.put('/api/tasks/:id', async (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { title, description, specifications, required_skill, status, parent_id, task_type, deadline, calendar_synced, assigned_user_email } = req.body;
    const prevStatus = task.status;
    const assignedUserId = task.assigned_user_id;

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (specifications !== undefined) task.specifications = specifications;
    if (required_skill !== undefined) task.required_skill = required_skill;
    if (deadline !== undefined) task.deadline = deadline;
    if (calendar_synced !== undefined) task.calendar_synced = Boolean(calendar_synced);
    if (assigned_user_email !== undefined) task.assigned_user_email = assigned_user_email;
    if (parent_id !== undefined) task.parent_id = parent_id ? Number(parent_id) : null;
    if (task_type !== undefined) task.task_type = task_type;

    if (status !== undefined && status !== prevStatus) {
        task.status = status;

        if (assignedUserId) {
            if (status === 'completed' && prevStatus !== 'completed') {
                await adjustActiveTasks(assignedUserId, -1);
            } else if (prevStatus === 'completed' && status !== 'completed') {
                await adjustActiveTasks(assignedUserId, 1);
            } else if (status === 'assigned' && prevStatus === 'unassigned') {
                await adjustActiveTasks(assignedUserId, 1);
            } else if (prevStatus === 'assigned' && status === 'unassigned') {
                await adjustActiveTasks(assignedUserId, -1);
            }
        }

        if (task.parent_id) {
            calculateProjectProgress(task.parent_id);
        }
    }

    res.json(task);
});

// GET: Calendar details and Google Calendar intent URL for a task
app.get('/api/tasks/:id/calendar-event', (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const deadline = task.deadline || getDefaultDeadline(7);
    const googleCalendarUrl = generateGoogleCalendarUrl(task);

    res.json({
        taskId: task.id,
        title: `Deadline: ${task.title}`,
        deadline: deadline,
        eventType: 'All-day deadline',
        assignedUserName: task.assigned_user_name,
        assignedUserEmail: task.assigned_user_email,
        calendarSynced: Boolean(task.calendar_synced),
        googleCalendarUrl: googleCalendarUrl,
        icsUrl: `/task_service/api/tasks/${task.id}/calendar.ics`
    });
});

// GET: Download iCalendar (.ics) for task all-day deadline
app.get('/api/tasks/:id/calendar.ics', (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const icsContent = generateIcsContent(task);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="task-${task.id}-deadline.ics"`);
    res.send(icsContent);
});

// POST: Trigger calendar sync for task
app.post('/api/tasks/:id/sync-calendar', async (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (!task.deadline) {
        task.deadline = getDefaultDeadline(7);
    }
    task.calendar_synced = true;

    // Optional Google Calendar API sync if token provided in env or header
    const accessToken = req.headers.authorization?.replace('Bearer ', '') || process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
    let apiStatus = 'ready_for_calendar';

    if (accessToken) {
        try {
            const nextDay = new Date(new Date(task.deadline).getTime() + 86400000).toISOString().split('T')[0];
            const gResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    summary: `Deadline: ${task.title}`,
                    description: `Assigned via AssignMate to ${task.assigned_user_name || 'member'}\n\n${task.description || ''}`,
                    start: { date: task.deadline },
                    end: { date: nextDay },
                    attendees: task.assigned_user_email ? [{ email: task.assigned_user_email }] : []
                })
            });
            if (gResponse.ok) {
                const gData = await gResponse.json();
                task.calendar_event_id = gData.id;
                apiStatus = 'api_synced';
            }
        } catch (apiErr) {
            console.warn('Google Calendar API sync note:', apiErr.message);
        }
    }

    const calendarUrl = generateGoogleCalendarUrl(task);

    res.json({
        success: true,
        apiStatus,
        message: `Task deadline prepared for ${task.assigned_user_name || 'assignee'} (${task.assigned_user_email || 'No email'})`,
        task,
        googleCalendarUrl: calendarUrl
    });
});

// GET: Single task with details
app.get('/api/tasks/:id', (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    if (!task.deadline) {
        task.deadline = getDefaultDeadline(7);
    }

    if (task.task_type === 'project') {
        const subtasks = tasks.filter(t => t.parent_id === task.id);
        task.subtasks = subtasks;
        task.progress = calculateProjectProgress(task.id);
    }

    res.json(task);
});

// GET: All tasks
app.get('/api/tasks', (req, res) => {
    const result = [...tasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    result.forEach(task => {
        if (!task.deadline) {
            task.deadline = getDefaultDeadline(7);
        }
        if (task.task_type === 'project') {
            const subtasks = tasks.filter(t => t.parent_id === task.id);
            task.subtask_count = subtasks.length;
            task.subtask_completed = subtasks.filter(t => t.status === 'completed').length;
            task.progress_percent = task.subtask_count > 0
                ? Math.round((task.subtask_completed / task.subtask_count) * 100)
                : 0;
        }
    });

    res.json(result);
});

// GET: All projects with progress
app.get('/api/projects', (req, res) => {
    const projects = tasks.filter(t => t.task_type === 'project');
    projects.forEach(project => {
        project.progress = calculateProjectProgress(project.id);
    });
    res.json(projects);
});

// DELETE: Delete task
app.delete('/api/tasks/:id', async (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const isProject = task.task_type === 'project';
    const subtasks = isProject ? tasks.filter(t => t.parent_id === task.id) : [];
    const parentId = task.parent_id;

    // Collect users to decrement (the task itself + subtasks if it's a project)
    const affected = new Map(); // userId -> count of active (non-completed) tasks being removed
    if (task.assigned_user_id && task.status !== 'completed') {
        affected.set(task.assigned_user_id, (affected.get(task.assigned_user_id) || 0) + 1);
    }
    for (const st of subtasks) {
        if (st.assigned_user_id && st.status !== 'completed') {
            affected.set(st.assigned_user_id, (affected.get(st.assigned_user_id) || 0) + 1);
        }
    }

    // Remove the task and its subtasks
    tasks = tasks.filter(t => t.id !== task.id && t.parent_id !== task.id);

    if (parentId) {
        calculateProjectProgress(parentId);
    }

    for (const [userId, count] of affected) {
        await adjustActiveTasks(userId, -count);
    }

    res.json({ message: "Task deleted" });
});

app.listen(3002, () => console.log('Task Service running on port 3002'));