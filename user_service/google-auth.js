const crypto = require('crypto');
const nodemailer = require('nodemailer');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:20201/user_service/api/auth/google/callback';
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/gmail.send';
const STATE_TTL_MS = 10 * 60 * 1000;

const oauthStates = new Map();

function isConfigured() {
    return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function createAuthUrl(state) {
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_REDIRECT_URI,
        response_type: 'code',
        scope: GOOGLE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function readJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function googleError(data, fallback) {
    return new Error(data.error_description || data.error?.message || data.error || fallback);
}

async function exchangeCode(code) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: GOOGLE_REDIRECT_URI
        })
    });
    const data = await readJson(response);
    if (!response.ok) throw googleError(data, 'Google authorization failed');
    return data;
}

async function getUserEmail(accessToken) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await readJson(response);
    if (!response.ok) throw googleError(data, 'Could not read the Google account email');
    return data.email;
}

async function getAccessToken(refreshToken) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });
    const data = await readJson(response);
    if (!response.ok) throw googleError(data, 'Could not refresh the Google token');
    return data.access_token;
}

async function sendGmail({ refreshToken, from, to, subject, text, html }) {
    const accessToken = await getAccessToken(refreshToken);

    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({ from, to, subject, text, html });
    const message = Buffer.isBuffer(info.message) ? info.message : Buffer.from(info.message);
    const raw = message.toString('base64url');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    });
    const data = await readJson(response);
    if (!response.ok) throw googleError(data, 'Gmail send failed');

    return { messageId: data.id, to };
}

function pruneStates(now = Date.now()) {
    for (const [state, entry] of oauthStates) {
        if (entry.expiresAt <= now) oauthStates.delete(state);
    }
}

function createState(userId) {
    pruneStates();
    const state = crypto.randomBytes(24).toString('hex');
    oauthStates.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
    return state;
}

function consumeState(state) {
    if (!state) return null;
    const entry = oauthStates.get(state);
    oauthStates.delete(state);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry;
}

module.exports = {
    isConfigured,
    createAuthUrl,
    exchangeCode,
    getUserEmail,
    sendGmail,
    createState,
    consumeState
};
