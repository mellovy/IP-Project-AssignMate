const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

if (getSession()?.token) {
    window.location.replace('/task.html');
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';

    const email = document.getElementById('login-email').value.trim();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Signing in...';

    try {
        const response = await fetch('/user_service/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            loginError.textContent = data.error || 'Could not sign in';
            return;
        }

        setSession({
            token: data.token,
            expires_at: data.expires_at,
            user: data.user
        });
        window.location.replace('/task.html');
    } catch (err) {
        loginError.textContent = 'Login service is unavailable: ' + err.message;
    } finally {
        button.disabled = false;
        button.textContent = 'Sign in';
    }
});
