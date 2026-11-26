const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 7);

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function getBearerToken(req) {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7).trim();
    return req.get('x-session-token') || null;
}

async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');

    await pool.execute(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${SESSION_DAYS} DAY))`,
        [hashToken(token), userId]
    );

    return {
        token,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000)
    };
}

async function getSessionUser(req) {
    const token = getBearerToken(req);
    if (!token) return null;

    const [rows] = await pool.execute(
        `SELECT u.id, u.name, u.email, u.role, u.avatar_url, u.active_tasks
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
         LIMIT 1`,
        [hashToken(token)]
    );

    return rows[0] || null;
}

async function requireAuth(req, res, next) {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'Login required' });
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
}

function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

async function deleteSession(req) {
    const token = getBearerToken(req);
    if (!token) return;
    await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

function canAccessUser(req, userId) {
    return req.user?.role === 'admin' || Number(req.user?.id) === Number(userId);
}

module.exports = {
    SESSION_DAYS,
    createSession,
    getSessionUser,
    requireAuth,
    requireAdmin,
    deleteSession,
    canAccessUser
};
