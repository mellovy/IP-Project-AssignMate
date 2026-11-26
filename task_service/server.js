const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { sendTaskEmail } = require('./email');
const { daysUntilDeadline, isReminderDue } = require('./reminder-utils');
const { pool, testConnection } = require('../database/db');
const { requireAuth, requireAdmin } = require('../database/auth');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-session-token']
}));
app.use(express.json());

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const REMINDER_DAYS_BEFORE = Number.isFinite(Number(process.env.REMINDER_DAYS_BEFORE))
    ? Math.max(0, Number(process.env.REMINDER_DAYS_BEFORE))
    : 2;
const REMINDER_CHECK_INTERVAL_MINUTES = Number.isFinite(Number(process.env.REMINDER_CHECK_INTERVAL_MINUTES))
    ? Math.max(1, Number(process.env.REMINDER_CHECK_INTERVAL_MINUTES))
    : 60;
// Calendar sync is automatic: this sweep re-syncs any assigned task whose
// event is missing (new task, new owner, moved deadline, late Google connect).
const CALENDAR_SYNC_INTERVAL_MINUTES = Number.isFinite(Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES))
    ? Math.max(1, Number(process.env.CALENDAR_SYNC_INTERVAL_MINUTES))
    : 1;

function getDefaultDeadline(daysAhead = 7) {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return d.toISOString().split('T')[0];
}

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

function normalizeTask(row) {
    return {
        ...row,
        id: Number(row.id),
        parent_id: row.parent_id ? Number(row.parent_id) : null,
        assigned_user_id: row.assigned_user_id ? Number(row.assigned_user_id) : null,
        calendar_synced: Boolean(row.calendar_synced),
        reminder_sent: Boolean(row.reminder_sent),
        progress_percent: Number(row.progress_percent) || 0
    };
}

async function getTaskById(id) {
    const [rows] = await pool.execute('SELECT * FROM tasks WHERE id = ?', [id]);
    return rows[0] ? normalizeTask(rows[0]) : null;
}

async function getAllTasks() {
    const [rows] = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC, id DESC');
    return rows.map(normalizeTask);
}

async function updateProjectProgress(projectId) {
    if (!projectId) return null;

    const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'completed'), 0) AS completed
         FROM tasks WHERE parent_id = ?`,
        [projectId]
    );
    const total = Number(rows[0].total) || 0;
    const completed = Number(rows[0].completed) || 0;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await pool.execute('UPDATE tasks SET progress_percent = ? WHERE id = ?', [progress, projectId]);
    return { total, completed, progress };
}

async function recalcActiveTasks(userIds) {
    const ids = [...new Set(userIds.filter(Boolean).map(Number))];
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    await pool.execute(
        `UPDATE users u
         SET active_tasks = (
             SELECT COUNT(*) FROM tasks t
             WHERE t.assigned_user_id = u.id AND t.status <> 'completed'
         )
         WHERE u.id IN (${placeholders})`,
        ids
    );
}

async function syncCalendarForTask(task) {
    if (!task.assigned_user_id) {
        return { synced: false, reason: 'Assignee is missing' };
    }
    if (!INTERNAL_API_KEY) {
        return { synced: false, reason: 'INTERNAL_API_KEY is not configured' };
    }

    try {
        const response = await fetch(`${USER_SERVICE_URL}/api/users/${task.assigned_user_id}/calendar/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-key': INTERNAL_API_KEY
            },
            body: JSON.stringify({ task })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return { synced: false, reason: data.error || `user_service returned ${response.status}` };
        }

        return { synced: true, eventId: data.eventId, htmlLink: data.htmlLink };
    } catch (err) {
        return { synced: false, reason: err.message };
    }
}

async function saveCalendarResult(task, calendar) {
    if (calendar.synced) {
        await pool.execute(
            'UPDATE tasks SET calendar_synced = 1, calendar_event_id = ? WHERE id = ?',
            [calendar.eventId || null, task.id]
        );
    } else {
        await pool.execute(
            'UPDATE tasks SET calendar_synced = 0, calendar_event_id = NULL WHERE id = ?',
            [task.id]
        );
    }
}

async function sendAssignmentEmail(task) {
    const result = await sendTaskEmail(task, {
        kind: 'assignment',
        calendarUrl: generateGoogleCalendarUrl(task)
    });

    if (!result.sent) {
        console.warn(`Assignment email not sent for task ${task.id}: ${result.reason}`);
    }

    return result;
}

async function sendReminderEmail(task) {
    const result = await sendTaskEmail(task, {
        kind: 'reminder',
        daysLeft: daysUntilDeadline(task.deadline),
        calendarUrl: generateGoogleCalendarUrl(task)
    });

    if (!result.sent) {
        console.warn(`Reminder email not sent for task ${task.id}: ${result.reason}`);
    }

    return result;
}

function canAccessTask(req, task) {
    return req.user.role === 'admin' || task.assigned_user_id === req.user.id;
}

let reminderCheckRunning = false;

async function checkDueReminders() {
    if (reminderCheckRunning) return;
    reminderCheckRunning = true;

    try {
        const now = new Date();
        const [rows] = await pool.query(
            `SELECT * FROM tasks
             WHERE status = 'in_progress'
               AND assigned_user_id IS NOT NULL
               AND reminder_sent = 0
               AND deadline IS NOT NULL`
        );
        const dueTasks = rows.map(normalizeTask).filter(task => isReminderDue(task, now, REMINDER_DAYS_BEFORE));

        for (const task of dueTasks) {
            await pool.execute('UPDATE tasks SET reminder_sent = 1 WHERE id = ?', [task.id]);
            const result = await sendReminderEmail(task);

            if (result.sent) {
                console.log(`Reminder email sent for task ${task.id} to ${result.to || task.assigned_user_email}`);
            } else {
                await pool.execute('UPDATE tasks SET reminder_sent = 0 WHERE id = ?', [task.id]);
            }
        }
    } finally {
        reminderCheckRunning = false;
    }
}

let calendarSweepRunning = false;

async function sweepCalendarSync() {
    if (calendarSweepRunning) return;
    calendarSweepRunning = true;

    try {
        const [rows] = await pool.query(
            `SELECT * FROM tasks
             WHERE assigned_user_id IS NOT NULL
               AND calendar_synced = 0
               AND status <> 'completed'`
        );

        for (const row of rows) {
            const task = normalizeTask(row);
            const calendar = await syncCalendarForTask(task);
            await saveCalendarResult(task, calendar);

            if (calendar.synced) {
                console.log(`Calendar synced for task ${task.id}`);
            } else {
                console.warn(`Calendar pending for task ${task.id}: ${calendar.reason}`);
            }
        }
    } catch (err) {
        console.error('Calendar sweep failed:', err.message);
    } finally {
        calendarSweepRunning = false;
    }
}

// GET: All tasks (members only see their own)
app.get('/api/tasks', requireAuth, async (req, res, next) => {
    try {
        let tasks = await getAllTasks();
        if (req.user.role !== 'admin') {
            tasks = tasks.filter(task => task.assigned_user_id === req.user.id);
        }

        tasks.forEach(task => {
            if (!task.deadline) task.deadline = getDefaultDeadline(7);
            if (task.task_type === 'project') {
                const subtasks = tasks.filter(t => t.parent_id === task.id);
                task.subtask_count = subtasks.length;
                task.subtask_completed = subtasks.filter(t => t.status === 'completed').length;
                task.progress_percent = task.subtask_count > 0
                    ? Math.round((task.subtask_completed / task.subtask_count) * 100)
                    : 0;
            }
        });

        res.json(tasks);
    } catch (err) {
        next(err);
    }
});

// GET: All projects with progress (admin)
app.get('/api/projects', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const allTasks = await getAllTasks();
        const projects = allTasks.filter(t => t.task_type === 'project');

        projects.forEach(project => {
            const subtasks = allTasks.filter(t => t.parent_id === project.id);
            const total = subtasks.length;
            const completed = subtasks.filter(t => t.status === 'completed').length;
            project.progress = {
                total,
                completed,
                progress: total > 0 ? Math.round((completed / total) * 100) : 0
            };
        });

        res.json(projects);
    } catch (err) {
        next(err);
    }
});

// POST: Create task or project (admin)
app.post('/api/tasks', requireAuth, requireAdmin, async (req, res, next) => {
    const {
        title, required_skill, description, specifications,
        parent_id, task_type, deadline
    } = req.body || {};

    if (!title) return res.status(400).json({ error: 'Title required' });

    try {
        const [result] = await pool.execute(
            `INSERT INTO tasks
                (title, description, specifications, required_skill, deadline,
                 parent_id, task_type, status, progress_percent)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'backlog', 0)`,
            [
                String(title).trim(),
                description || null,
                specifications || null,
                required_skill || null,
                deadline || getDefaultDeadline(7),
                parent_id ? Number(parent_id) : null,
                task_type === 'project' ? 'project' : 'task'
            ]
        );

        if (parent_id) await updateProjectProgress(Number(parent_id));

        const task = await getTaskById(result.insertId);
        res.json(task);
    } catch (err) {
        next(err);
    }
});

// PUT: Auto-assign a task (admin)
app.put('/api/tasks/:id/auto-assign', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!task.required_skill) return res.status(400).json({ error: 'Task has no required skill' });
        if (!INTERNAL_API_KEY) {
            return res.status(503).json({ error: 'INTERNAL_API_KEY is not configured' });
        }

        const response = await fetch(
            `${USER_SERVICE_URL}/api/users/match/${encodeURIComponent(task.required_skill)}`,
            { headers: { 'x-internal-key': INTERNAL_API_KEY } }
        );
        if (!response.ok) throw new Error(`user_service returned ${response.status}`);

        const matches = await response.json();
        const bestUser = matches[0];
        if (!bestUser) return res.status(404).json({ message: 'No qualified members found' });

        const deadline = task.deadline || getDefaultDeadline(7);
        await pool.execute(
            `UPDATE tasks
             SET assigned_user_id = ?, assigned_user_name = ?, assigned_user_email = ?,
                 status = 'in_progress', deadline = ?, reminder_sent = 0, calendar_synced = 0
             WHERE id = ?`,
            [bestUser.id, bestUser.name, bestUser.email, deadline, task.id]
        );

        const updatedTask = await getTaskById(task.id);
        await recalcActiveTasks([task.assigned_user_id, bestUser.id]);
        if (updatedTask.parent_id) await updateProjectProgress(updatedTask.parent_id);

        const email = await sendAssignmentEmail(updatedTask);
        const calendar = await syncCalendarForTask(updatedTask);
        await saveCalendarResult(updatedTask, calendar);
        updatedTask.calendar_synced = calendar.synced;
        if (calendar.synced) updatedTask.calendar_event_id = calendar.eventId;

        res.json({
            message: `Successfully assigned to ${bestUser.name}`,
            user: bestUser,
            task: updatedTask,
            email,
            calendar
        });
    } catch (err) {
        next(err);
    }
});

// PUT: Update task
app.put('/api/tasks/:id', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only update your own tasks' });
        }

        const isAdmin = req.user.role === 'admin';
        const body = req.body || {};
        const fields = {};
        const allowed = isAdmin
            ? ['title', 'description', 'specifications', 'required_skill', 'status', 'parent_id', 'task_type', 'deadline', 'calendar_synced', 'assigned_user_email']
            : ['status'];

        for (const key of allowed) {
            if (body[key] !== undefined) fields[key] = body[key];
        }

        if (fields.status !== undefined && !['backlog', 'in_progress', 'completed'].includes(fields.status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        if (fields.task_type !== undefined && !['task', 'project'].includes(fields.task_type)) {
            return res.status(400).json({ error: 'Invalid task type' });
        }

        const previousStatus = task.status;
        const previousAssignee = task.assigned_user_id;

        if (fields.parent_id !== undefined) fields.parent_id = fields.parent_id ? Number(fields.parent_id) : null;
        if (fields.calendar_synced !== undefined) fields.calendar_synced = fields.calendar_synced ? 1 : 0;
        if (fields.deadline !== undefined && fields.deadline !== task.deadline) fields.reminder_sent = 0;
        if (fields.assigned_user_email !== undefined && fields.assigned_user_email !== task.assigned_user_email) fields.reminder_sent = 0;
        if (fields.status === 'in_progress' && previousStatus !== 'in_progress') fields.reminder_sent = 0;

        // Calendar is server-managed: any change that moves the deadline, the owner
        // or the workflow stage invalidates the event so the sweep re-syncs it.
        if (fields.deadline !== undefined && fields.deadline !== task.deadline) fields.calendar_synced = 0;
        if (fields.assigned_user_email !== undefined && fields.assigned_user_email !== task.assigned_user_email) fields.calendar_synced = 0;
        if (fields.status !== undefined && fields.status !== previousStatus) fields.calendar_synced = 0;

        const keys = Object.keys(fields);
        if (keys.length > 0) {
            const setClause = keys.map(key => `${key} = ?`).join(', ');
            await pool.execute(
                `UPDATE tasks SET ${setClause} WHERE id = ?`,
                [...keys.map(key => fields[key]), task.id]
            );
        }

        const updatedTask = await getTaskById(task.id);
        await recalcActiveTasks([previousAssignee, updatedTask.assigned_user_id]);
        if (updatedTask.parent_id) await updateProjectProgress(updatedTask.parent_id);

        res.json(updatedTask);
    } catch (err) {
        next(err);
    }
});

// GET: Calendar details and Google Calendar intent URL for a task
app.get('/api/tasks/:id/calendar-event', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only view your own tasks' });
        }

        const deadline = task.deadline || getDefaultDeadline(7);
        res.json({
            taskId: task.id,
            title: `Deadline: ${task.title}`,
            deadline,
            eventType: 'All-day deadline',
            assignedUserName: task.assigned_user_name,
            assignedUserEmail: task.assigned_user_email,
            calendarSynced: Boolean(task.calendar_synced),
            calendarEventId: task.calendar_event_id,
            googleCalendarUrl: generateGoogleCalendarUrl(task),
            icsUrl: `/task_service/api/tasks/${task.id}/calendar.ics`
        });
    } catch (err) {
        next(err);
    }
});

// GET: Download iCalendar (.ics) for task all-day deadline
app.get('/api/tasks/:id/calendar.ics', async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="task-${task.id}-deadline.ics"`);
        res.send(generateIcsContent(task));
    } catch (err) {
        next(err);
    }
});

// POST: Sync a real all-day event to the assignee's Google Calendar
app.post('/api/tasks/:id/sync-calendar', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only sync your own tasks' });
        }
        if (!task.assigned_user_id) {
            return res.status(400).json({ error: 'Assign this task before syncing the calendar' });
        }

        const calendar = await syncCalendarForTask(task);
        await saveCalendarResult(task, calendar);

        if (!calendar.synced) {
            return res.status(502).json({
                error: calendar.reason,
                calendar,
                task: await getTaskById(task.id)
            });
        }

        res.json({
            success: true,
            calendar,
            task: await getTaskById(task.id),
            googleCalendarUrl: generateGoogleCalendarUrl(task)
        });
    } catch (err) {
        next(err);
    }
});

// POST: Send a deadline reminder email now
app.post('/api/tasks/:id/send-reminder', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only remind yourself' });
        }
        if (!task.assigned_user_email) {
            return res.status(400).json({ error: 'Assign this task before sending a reminder' });
        }
        if (task.status === 'completed') {
            return res.status(400).json({ error: 'Completed tasks do not need reminders' });
        }

        const result = await sendReminderEmail(task);
        if (!result.sent) {
            return res.status(503).json({ error: result.reason });
        }

        await pool.execute('UPDATE tasks SET reminder_sent = 1 WHERE id = ?', [task.id]);
        res.json({
            success: true,
            message: `Reminder sent to ${result.to || task.assigned_user_email}`,
            email: result
        });
    } catch (err) {
        next(err);
    }
});

// POST: Resend the assignment email (admin or the assignee)
app.post('/api/tasks/:id/send-email', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only send email for your own tasks' });
        }
        if (!task.assigned_user_id) {
            return res.status(400).json({ error: 'Assign this task before sending email' });
        }

        const email = await sendAssignmentEmail(task);
        if (!email.sent) {
            return res.status(502).json({ error: email.reason || 'Email was not sent', email });
        }
        res.json({ sent: true, email });
    } catch (err) {
        next(err);
    }
});

// GET: Single task with details
app.get('/api/tasks/:id', requireAuth, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!canAccessTask(req, task)) {
            return res.status(403).json({ error: 'You can only view your own tasks' });
        }

        if (!task.deadline) task.deadline = getDefaultDeadline(7);

        if (task.task_type === 'project') {
            const [rows] = await pool.execute(
                'SELECT * FROM tasks WHERE parent_id = ? ORDER BY id',
                [task.id]
            );
            task.subtasks = rows.map(normalizeTask);
            task.progress = await updateProjectProgress(task.id);
        }

        res.json(task);
    } catch (err) {
        next(err);
    }
});

// DELETE: Delete task (admin)
app.delete('/api/tasks/:id', requireAuth, requireAdmin, async (req, res, next) => {
    try {
        const task = await getTaskById(req.params.id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const [subtasks] = await pool.execute('SELECT * FROM tasks WHERE parent_id = ?', [task.id]);
        const affected = [
            task.assigned_user_id,
            ...subtasks.map(st => st.assigned_user_id)
        ];

        await pool.execute('DELETE FROM tasks WHERE id = ? OR parent_id = ?', [task.id, task.id]);
        await recalcActiveTasks(affected);
        if (task.parent_id) await updateProjectProgress(task.parent_id);

        res.json({ message: 'Task deleted' });
    } catch (err) {
        next(err);
    }
});

app.use((err, req, res, next) => {
    console.error('Task service error:', err);
    res.status(500).json({ error: err.message });
});

setInterval(() => {
    checkDueReminders().catch(err => console.error('Reminder check failed:', err));
}, REMINDER_CHECK_INTERVAL_MINUTES * 60 * 1000);

setInterval(() => {
    sweepCalendarSync().catch(err => console.error('Calendar sweep failed:', err));
}, CALENDAR_SYNC_INTERVAL_MINUTES * 60 * 1000);

testConnection()
    .then(() => {
        checkDueReminders().catch(err => console.error('Initial reminder check failed:', err));
        sweepCalendarSync().catch(err => console.error('Initial calendar sweep failed:', err));
        console.log(`Email reminders active via per-user Google OAuth (${REMINDER_DAYS_BEFORE} day(s) before deadline)`);
        console.log(`Automatic Google Calendar sync active (every ${CALENDAR_SYNC_INTERVAL_MINUTES} minute(s))`);
        app.listen(3002, () => console.log('Task Service running on port 3002'));
    })
    .catch(err => {
        console.error('Task Service database connection failed:', err.message);
        process.exit(1);
    });
