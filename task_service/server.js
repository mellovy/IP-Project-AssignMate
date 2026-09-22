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
        task.status = 'assigned';

        if (prevStatus !== 'assigned') {
            await adjustActiveTasks(bestUser.id, 1);
        }

        if (task.parent_id) {
            calculateProjectProgress(task.parent_id);
        }

        res.json({ message: `Successfully assigned to ${bestUser.name}`, user: bestUser });
    } catch (err) {
        console.error('Auto-assign error:', err);
        res.status(500).json({ error: "Integration Layer Error: " + err.message });
    }
});

// POST: Create Task
app.post('/api/tasks', (req, res) => {
    const { title, required_skill, description, specifications, parent_id, task_type } = req.body;

    if (!title) return res.status(400).json({ error: "Title required" });

    const newTask = {
        id: nextTaskId++,
        title,
        description: description || null,
        specifications: specifications || null,
        required_skill,
        parent_id: parent_id ? Number(parent_id) : null,
        task_type: task_type || 'task',
        status: 'unassigned',
        assigned_user_id: null,
        assigned_user_name: null,
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

    const { title, description, specifications, required_skill, status, parent_id, task_type } = req.body;
    const prevStatus = task.status;
    const assignedUserId = task.assigned_user_id;

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (specifications !== undefined) task.specifications = specifications;
    if (required_skill !== undefined) task.required_skill = required_skill;
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

// GET: Single task with details
app.get('/api/tasks/:id', (req, res) => {
    const task = findTaskById(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });

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