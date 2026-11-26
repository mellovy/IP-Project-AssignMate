const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    isConfigured: isGoogleConfigured,
    createAuthUrl,
    exchangeCode,
    getUserEmail,
    sendGmail,
    createState,
    consumeState
} = require('./google-auth');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-internal-key']
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

// In-memory storage
let skills = [];
let users = [];
let nextSkillId = 1;
let nextUserId = 1;

// Initialize with some sample data for demonstration
function initializeSampleData() {
    // Add sample skills
    const sampleSkills = ['Project Management', 'Development', 'Design', 'Testing', 'Documentation'];
    sampleSkills.forEach(skillName => {
        skills.push({ id: nextSkillId++, name: skillName });
    });

    // Add sample users with Google Calendar email addresses
    const sampleUsers = [
        { name: 'Alice Johnson', email: 'alice.johnson@gmail.com', avatar_url: 'https://i.pravatar.cc/40?img=1', skills: [1, 2] },
        { name: 'Bob Smith', email: 'bob.smith@gmail.com', avatar_url: 'https://i.pravatar.cc/40?img=2', skills: [2, 3] },
        { name: 'Carol Davis', email: 'carol.davis@gmail.com', avatar_url: 'https://i.pravatar.cc/40?img=3', skills: [3, 4] },
        { name: 'David Wilson', email: 'david.wilson@gmail.com', avatar_url: 'https://i.pravatar.cc/40?img=4', skills: [1, 4] },
        { name: 'Emma Brown', email: 'emma.brown@gmail.com', avatar_url: 'https://i.pravatar.cc/40?img=5', skills: [2, 5] }
    ];

    sampleUsers.forEach(userData => {
        const user = {
            id: nextUserId++,
            name: userData.name,
            email: userData.email,
            avatar_url: userData.avatar_url,
            active_tasks: 0,
            skills: [...userData.skills]
        };
        users.push(user);
    });
}

// Initialize sample data
initializeSampleData();

// Helper functions
function findSkillById(id) {
    return skills.find(s => s.id === id);
}

function findSkillByName(name) {
    return skills.find(s => s.name.toLowerCase() === name.toLowerCase());
}

function findUserById(id) {
    return users.find(u => u.id === id);
}

function getEffectiveEmail(user) {
    return user.google?.email || user.email || `${user.name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@gmail.com`;
}

function getUserSkills(userId) {
    const user = findUserById(userId);
    return user ? user.skills : [];
}

// GET: All available skills
app.get('/api/skills', async (req, res) => {
    try {
        res.json(skills);
    } catch (err) {
        console.error('Error fetching skills:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Add new skill
app.post('/api/skills', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Skill name required" });

    // Check if skill already exists
    if (findSkillByName(name)) {
        return res.status(400).json({ error: "Skill already exists" });
    }

    try {
        const newSkill = { id: nextSkillId++, name };
        skills.push(newSkill);
        res.json(newSkill);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET: Returns users with a specific skill (Ordered by least active tasks)
app.get('/api/users/match/:skill', async (req, res) => {
    try {
        const skillName = req.params.skill;
        const skilledUsers = users.filter(user =>
            user.skills.some(skillId => {
                const skill = findSkillById(skillId);
                return skill && skill.name.toLowerCase() === skillName.toLowerCase();
            })
        );

        // Sort by active_tasks ascending (least busy first)
        skilledUsers.sort((a, b) => a.active_tasks - b.active_tasks);

        // Return the least busy user (or empty array if none).
        // Build explicitly so the OAuth refresh token is never exposed.
        const bestUser = skilledUsers[0];
        const result = bestUser ? [{
            id: bestUser.id,
            name: bestUser.name,
            email: getEffectiveEmail(bestUser),
            avatar_url: bestUser.avatar_url,
            active_tasks: bestUser.active_tasks,
            skills: [...bestUser.skills],
            google_connected: Boolean(bestUser.google?.refresh_token),
            google_email: bestUser.google?.email || null
        }] : [];
        res.json(result);
    } catch (err) {
        console.error('Error finding users by skill:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST: Register new team member
app.post('/api/users', async (req, res) => {
    const { name, email, skill, skills: skillIds, avatar_url } = req.body;
    const skillList = skillIds || (skill ? [skill] : []);

    if (!name) return res.status(400).json({ error: "Name required" });
    if (skillList.length === 0) return res.status(400).json({ error: "At least one skill required" });

    // Validate that all skill IDs exist
    const invalidSkills = skillIds.filter(id => !findSkillById(id));
    if (invalidSkills.length > 0) {
        return res.status(400).json({ error: `Invalid skill IDs: ${invalidSkills.join(', ')}` });
    }

    try {
        const userEmail = email ? email.trim() : `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@gmail.com`;

        const newUser = {
            id: nextUserId++,
            name,
            email: userEmail,
            avatar_url: avatar_url || null,
            active_tasks: 0,
            skills: [...skillList],
            google: null
        };

        users.push(newUser);

        // Return user with primary skill (first skill in list) for backward compatibility
        const primarySkill = findSkillById(newUser.skills[0]);
        res.json({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            skill: primarySkill ? primarySkill.name : null,
            skills: newUser.skills.map(id => findSkillById(id).name),
            avatar_url: newUser.avatar_url
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET: All team members with their skills and emails
app.get('/api/users', async (req, res) => {
    try {
        const usersWithSkills = users.map(user => {
            const skillNames = user.skills.map(id => {
                const skill = findSkillById(id);
                return skill ? skill.name : null;
            }).filter(Boolean); // Remove nulls

            return {
                id: user.id,
                name: user.name,
                email: getEffectiveEmail(user),
                skill: skillNames.length > 0 ? skillNames[0] : null, // Primary skill for backward compatibility
                avatar_url: user.avatar_url,
                active_tasks: user.active_tasks,
                all_skills: skillNames.length > 0 ? skillNames.join(',') : null,
                google_connected: Boolean(user.google?.refresh_token),
                google_email: user.google?.email || null
            };
        });

        res.json(usersWithSkills);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET: Single user by ID
app.get('/api/users/:id', async (req, res) => {
    const user = findUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: "User not found" });

    const skillNames = user.skills.map(id => {
        const skill = findSkillById(id);
        return skill ? skill.name : null;
    }).filter(Boolean);

    res.json({
        id: user.id,
        name: user.name,
        email: getEffectiveEmail(user),
        avatar_url: user.avatar_url,
        active_tasks: user.active_tasks,
        skills: skillNames,
        google_connected: Boolean(user.google?.refresh_token),
        google_email: user.google?.email || null
    });
});

// ponytail: in-memory OAuth tokens; reconnect after restart, use encrypted DB storage for production
// GET: Start per-user Google OAuth
app.get('/api/users/:id/google/connect', (req, res) => {
    const user = findUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!isGoogleConfigured()) {
        return res.status(503).json({ error: 'Google OAuth is not configured' });
    }

    const state = createState(user.id);
    res.redirect(createAuthUrl(state));
});

// GET: Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/user.html?google=error');

    const entry = consumeState(state);
    if (!entry) return res.status(400).send('Invalid or expired Google OAuth state');

    const user = findUserById(entry.userId);
    if (!user) return res.status(404).send('User not found');

    try {
        const tokens = await exchangeCode(code);
        if (!tokens.refresh_token) {
            throw new Error('Google did not return a refresh token. Remove the app from your Google account and connect again.');
        }

        const googleEmail = await getUserEmail(tokens.access_token);
        user.google = {
            email: googleEmail,
            refresh_token: tokens.refresh_token,
            connected_at: new Date().toISOString()
        };
        user.email = googleEmail;

        res.redirect('/user.html?google=connected');
    } catch (err) {
        console.error('Google OAuth callback failed:', err.message);
        res.redirect('/user.html?google=error');
    }
});

// GET: Gmail connection status for a member
app.get('/api/users/:id/google/status', (req, res) => {
    const user = findUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        connected: Boolean(user.google?.refresh_token),
        email: user.google?.email || null
    });
});

// POST: Send an email as the connected member (called by task_service)
app.post('/api/users/:id/send-email', requireInternal, async (req, res) => {
    const user = findUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.google?.refresh_token) {
        return res.status(409).json({ error: 'User has not connected Google' });
    }

    const { subject, text, html } = req.body || {};
    if (!subject) return res.status(400).json({ error: 'Subject required' });

    try {
        const result = await sendGmail({
            refreshToken: user.google.refresh_token,
            from: user.google.email,
            to: user.google.email,
            subject,
            text,
            html
        });
        res.json({ sent: true, messageId: result.messageId, to: result.to });
    } catch (err) {
        console.error(`Gmail send failed for user ${user.id}:`, err.message);
        res.status(502).json({ error: err.message });
    }
});

// PUT: Adjust a user's active_tasks count (used by task_service)
app.put('/api/users/:id/active-tasks', async (req, res) => {
    const userId = parseInt(req.params.id);
    const { delta } = req.body;

    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (typeof delta !== 'number') return res.status(400).json({ error: "delta must be a number" });

    const user = findUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.active_tasks = Math.max(0, user.active_tasks + delta);
    res.json({ id: user.id, active_tasks: user.active_tasks });
});

// DELETE: Remove team member
app.delete('/api/users/:id', async (req, res) => {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
        return res.status(400).json({ error: "Invalid user ID" });
    }

    try {
        const index = users.findIndex(u => u.id === userId);
        if (index === -1) {
            return res.status(404).json({ error: "User not found" });
        }

        users.splice(index, 1);
        res.json({ message: "User deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`User Service running on port ${PORT}`));