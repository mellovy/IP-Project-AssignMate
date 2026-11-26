const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { pool, testConnection } = require('../database/db');
const {
    createSession,
    requireAuth,
    requireAdmin,
    deleteSession,
    canAccessUser
} = require('../database/auth');
const {
    isConfigured: isGoogleConfigured,
    createAuthUrl,
    exchangeCode,
    getUserEmail,
    sendGmail,
    syncCalendarEvent,
    createState,
    consumeState
} = require('./google-auth');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-session-token']
}));
app.use(express.json());

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireInternal(req, res, next) {
    if (!INTERNAL_API_KEY) {
        return res.status(503).json({ error: 'INTERNAL_API_KEY is not configured' });
    }
    if (req.get('x-internal-key') !== INTERNAL_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function splitSkills(value) {
    return value ? String(value).split(',') : [];
}

function mapUser(row, { includeSkills = true } = {}) {
    const skillNames = splitSkills(row.skill_names);
    const user = {
        id: row.id,
        name: row.name,
        email: row.email,
        avatar_url: row.avatar_url,
        active_tasks: row.active_tasks,
        role: row.role,
        google_connected: Boolean(row.google_refresh_token),
        google_email: row.google_email || null
    };

    if (includeSkills) {
        user.skill = skillNames[0] || null;
        user.skills = skillNames;
        user.all_skills = skillNames.length ? skillNames.join(',') : null;
    }

    return user;
}

async function getUserWithSkills(id) {
    const [rows] = await pool.execute(
        `SELECT u.*, GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ',') AS skill_names
         FROM users u
         LEFT JOIN user_skills us ON us.user_id = u.id
         LEFT JOIN skills s ON s.id = us.skill_id
         WHERE u.id = ?
         GROUP BY u.id`,
        [id]
    );
    return rows[0] || null;
}

// GET: All available skills
app.get('/api/skills', requireAuth, async (req, res, next) => {
    try {
        const [rows] = await pool.query('SELECT id, name FROM skills ORDER BY name');
        res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST: Add new skill (admin)
app.post('/api/skills', requireAuth, requireAdmin, async (req, res, next) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Skill name required' });

    try {
        const [result] = await pool.execute('INSERT INTO skills (name) VALUES (?)', [name]);
        res.json({ id: result.insertId, name });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Skill already exists' });
        }
        next(err);
    }
});

// GET: Least-busy user with a skill (internal, used by task_service)
app.get('/api/users/match/:skill', requireInternal, async (req, res, next) => {
    try {
        const [rows] = await pool.execute(
            `SELECT u.id, u.name, u.email, u.avatar_url, u.active_tasks,
                    u.google_email, u.google_refresh_token
             FROM users u
             JOIN user_skills us ON us.user_id = u.id
             JOIN skills s ON s.id = us.skill_id
             WHERE LOWER(s.name) = LOWER(?)
             ORDER BY u.active_tasks ASC, u.id ASC
             LIMIT 1`,
            [req.params.skill]
        );

        if (!rows[0]) return res.json([]);
        res.json([mapUser(rows[0], { includeSkills: false })]);
    } catch (err) {
        next(err);
    }
});

// POST: Register new team member (admin)
app.post('/api/users', requireAuth, requireAdmin, async (req, res, next) => {
    const { name, email, skill, skills: requestedSkills, avatar_url, role } = req.body || {};
    const skillNames = Array.isArray(requestedSkills)
        ? requestedSkills.map(String)
        : skill
            ? [String(skill)]
            : [];

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanName) return res.status(400).json({ error: 'Name required' });
    if (!cleanEmail) return res.status(400).json({ error: 'Email required' });
    if (skillNames.length === 0) return res.status(400).json({ error: 'At least one skill required' });

    const connection = await pool.getConnection();
    try {
        const placeholders = skillNames.map(() => '?').join(',');
        const [skillRows] = await connection.execute(
            `SELECT id, name FROM skills WHERE name IN (${placeholders})`,
            skillNames
        );

        if (skillRows.length !== new Set(skillNames.map(s => s.toLowerCase())).size) {
            return res.status(400).json({ error: 'One or more skills do not exist' });
        }

        await connection.beginTransaction();

        const [userResult] = await connection.execute(
            `INSERT INTO users (name, email, avatar_url, role)
             VALUES (?, ?, ?, ?)`,
            [cleanName, cleanEmail, avatar_url || null, role === 'admin' ? 'admin' : 'member']
        );

        for (const skillRow of skillRows) {
            await connection.execute(
                'INSERT INTO user_skills (user_id, skill_id) VALUES (?, ?)',
                [userResult.insertId, skillRow.id]
            );
        }

        await connection.commit();

        const user = await getUserWithSkills(userResult.insertId);
        res.json(mapUser(user));
    } catch (err) {
        await connection.rollback().catch(() => {});
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'A member with that email already exists' });
        }
        next(err);
    } finally {
        connection.release();
    }
});

// GET: Team members (admin gets all, member gets self)
app.get('/api/users', requireAuth, async (req, res, next) => {
    try {
        const isAdmin = req.user.role === 'admin';
        const where = isAdmin ? '' : 'WHERE u.id = ?';
        const params = isAdmin ? [] : [req.user.id];

        const [rows] = await pool.execute(
            `SELECT u.*, GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ',') AS skill_names
             FROM users u
             LEFT JOIN user_skills us ON us.user_id = u.id
             LEFT JOIN skills s ON s.id = us.skill_id
             ${where}
             GROUP BY u.id
             ORDER BY u.id`,
            params
        );

        res.json(rows.map(row => mapUser(row)));
    } catch (err) {
        next(err);
    }
});

// GET: Single user
app.get('/api/users/:id', requireAuth, async (req, res, next) => {
    const userId = Number(req.params.id);
    if (!canAccessUser(req, userId)) {
        return res.status(403).json({ error: 'You can only view your own profile' });
    }

    try {
        const user = await getUserWithSkills(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(mapUser(user));
    } catch (err) {
        next(err);
    }
});

// GET: Return the Google authorization URL (frontend redirects to it)
app.get('/api/users/:id/google/connect', requireAuth, async (req, res) => {
    const userId = Number(req.params.id);
    if (!canAccessUser(req, userId)) {
        return res.status(403).json({ error: 'You can only connect your own Google account' });
    }
    if (!isGoogleConfigured()) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }

    const state = createState(userId);
    res.json({ authUrl: createAuthUrl(state) });
});

// GET: Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/user.html?google=error');

    const entry = consumeState(state);
    if (!entry) return res.status(400).send('Invalid or expired Google OAuth state');

    try {
        const tokens = await exchangeCode(code);
        if (!tokens.refresh_token) {
            throw new Error('Google did not return a refresh token. Remove the app from your Google account and connect again.');
        }

        const googleEmail = await getUserEmail(tokens.access_token);
        await pool.execute(
            `UPDATE users
             SET google_email = ?, google_refresh_token = ?, google_connected_at = NOW()
             WHERE id = ?`,
            [googleEmail, tokens.refresh_token, entry.userId]
        );

        res.redirect('/user.html?google=connected');
    } catch (err) {
        console.error('Google OAuth callback failed:', err.message);
        res.redirect('/user.html?google=error');
    }
});

// GET: Gmail connection status
app.get('/api/users/:id/google/status', requireAuth, async (req, res, next) => {
    const userId = Number(req.params.id);
    if (!canAccessUser(req, userId)) {
        return res.status(403).json({ error: 'You can only view your own connection' });
    }

    try {
        const [rows] = await pool.execute(
            'SELECT google_email, google_refresh_token FROM users WHERE id = ?',
            [userId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found' });

        res.json({
            connected: Boolean(rows[0].google_refresh_token),
            email: rows[0].google_email || null
        });
    } catch (err) {
        next(err);
    }
});

// POST: Create a real all-day Google Calendar event as the member (internal)
app.post('/api/users/:id/calendar/sync', requireInternal, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, email, google_refresh_token FROM users WHERE id = ?',
            [req.params.id]
        );
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.google_refresh_token) {
            return res.status(409).json({ error: 'User has not connected Google' });
        }

        const task = req.body?.task;
        if (!task?.title) return res.status(400).json({ error: 'Task title required' });

        const event = await syncCalendarEvent({
            refreshToken: user.google_refresh_token,
            attendeeEmail: user.email,
            task,
            eventId: task.calendar_event_id
        });

        res.json({ synced: true, eventId: event.id, htmlLink: event.htmlLink || null });
    } catch (err) {
        console.error('Calendar sync failed:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST: Send an email as the connected member (internal, called by task_service)
app.post('/api/users/:id/send-email', requireInternal, async (req, res, next) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, email, google_email, google_refresh_token FROM users WHERE id = ?',
            [req.params.id]
        );
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.google_refresh_token) {
            return res.status(409).json({ error: 'User has not connected Google' });
        }

        const { subject, text, html } = req.body || {};
        if (!subject) return res.status(400).json({ error: 'Subject required' });

        const result = await sendGmail({
            refreshToken: user.google_refresh_token,
            from: user.google_email,
            to: user.email,
            subject,
            text,
            html
        });

        res.json({ sent: true, messageId: result.messageId, to: result.to });
    } catch (err) {
        console.error('Gmail send failed:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// PUT: Adjust a user's active_tasks count (internal)
app.put('/api/users/:id/active-tasks', requireInternal, async (req, res, next) => {
    const userId = Number(req.params.id);
    const delta = Number(req.body?.delta);

    if (!Number.isFinite(delta)) {
        return res.status(400).json({ error: 'delta must be a number' });
    }

    try {
        const [result] = await pool.execute(
            'UPDATE users SET active_tasks = GREATEST(0, active_tasks + ?) WHERE id = ?',
            [delta, userId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });

        const [rows] = await pool.execute('SELECT id, active_tasks FROM users WHERE id = ?', [userId]);
        res.json(rows[0]);
    } catch (err) {
        next(err);
    }
});

// DELETE: Remove team member (admin)
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res, next) => {
    const userId = Number(req.params.id);
    if (userId === Number(req.user.id)) {
        return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    try {
        await pool.execute(
            `UPDATE tasks
             SET assigned_user_id = NULL, assigned_user_name = NULL,
                 assigned_user_email = NULL, status = 'unassigned',
                 calendar_synced = 0, calendar_event_id = NULL
             WHERE assigned_user_id = ?`,
            [userId]
        );

        const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
        if (!result.affectedRows) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted' });
    } catch (err) {
        next(err);
    }
});

// POST: Email login
app.post('/api/auth/login', async (req, res, next) => {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'Email required' });

    try {
        const [rows] = await pool.execute(
            `SELECT u.*, GROUP_CONCAT(s.name ORDER BY s.name SEPARATOR ',') AS skill_names
             FROM users u
             LEFT JOIN user_skills us ON us.user_id = u.id
             LEFT JOIN skills s ON s.id = us.skill_id
             WHERE LOWER(u.email) = LOWER(?)
             GROUP BY u.id
             LIMIT 1`,
            [email]
        );

        if (!rows[0]) return res.status(401).json({ error: 'No member found with that email' });

        const session = await createSession(rows[0].id);
        res.json({
            token: session.token,
            expires_at: session.expiresAt.toISOString(),
            user: mapUser(rows[0])
        });
    } catch (err) {
        next(err);
    }
});

// GET: Current session
app.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try {
        const user = await getUserWithSkills(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: mapUser(user) });
    } catch (err) {
        next(err);
    }
});

// POST: Logout
app.post('/api/auth/logout', async (req, res, next) => {
    try {
        await deleteSession(req);
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

app.use((err, req, res, next) => {
    console.error('User service error:', err);
    res.status(500).json({ error: err.message });
});

const PORT = Number(process.env.USER_SERVICE_PORT) || 3001;

testConnection()
    .then(() => {
        app.listen(PORT, () => console.log(`User Service running on port ${PORT}`));
    })
    .catch(err => {
        console.error('User Service database connection failed:', err.message);
        process.exit(1);
    });
