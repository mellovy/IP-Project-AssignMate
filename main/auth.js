const SESSION_KEY = 'assignmate_session';
const USER_SERVICE_API = '/user_service/api';

function getSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
        return null;
    }
}

function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function authHeaders(extra = {}) {
    const session = getSession();
    return {
        ...extra,
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {})
    };
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: authHeaders(options.headers || {})
    });

    if (response.status === 401 && !window.location.pathname.endsWith('/login.html')) {
        clearSession();
        window.location.replace('/login.html');
    }

    return response;
}

function requireLogin() {
    const session = getSession();
    if (!session?.token) {
        window.location.replace('/login.html');
        return null;
    }
    return session;
}

function isAdmin() {
    return getSession()?.user?.role === 'admin';
}

function applyRoleUI() {
    const session = getSession();
    if (!session) return;

    const isAdminUser = session.user.role === 'admin';
    const nameEl = document.getElementById('user-display');
    const roleEl = document.getElementById('user-role-display');
    if (nameEl) nameEl.textContent = session.user.name;
    if (roleEl) roleEl.textContent = isAdminUser ? 'Admin' : 'Member';

    document.querySelectorAll('[data-admin-only]').forEach(el => {
        el.style.display = isAdminUser ? '' : 'none';
    });

    if (!isAdminUser) {
        const projectLink = document.querySelector('a[href="project.html"]');
        if (projectLink?.closest('li')) projectLink.closest('li').style.display = 'none';

        if (window.location.pathname.endsWith('/project.html')) {
            window.location.replace('/task.html');
        }
    }
}

async function connectGoogle(userId) {
    try {
        const response = await apiFetch(`${USER_SERVICE_API}/users/${userId}/google/connect`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            alert(data.error || 'Could not start Google connection');
            return;
        }
        window.location.href = data.authUrl;
    } catch (err) {
        alert('Google connection error: ' + err.message);
    }
}

async function logout() {
    try {
        await apiFetch(`${USER_SERVICE_API}/auth/logout`, { method: 'POST' });
    } catch {
        // Clear the local session even if the server is unreachable.
    }
    clearSession();
    window.location.replace('/login.html');
}

window.getSession = getSession;
window.setSession = setSession;
window.clearSession = clearSession;
window.authHeaders = authHeaders;
window.apiFetch = apiFetch;
window.requireLogin = requireLogin;
window.isAdmin = isAdmin;
window.connectGoogle = connectGoogle;
window.logout = logout;
