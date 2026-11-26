const TASK_SERVICE_URL = '/task_service/api';

const TASK_STATUSES = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Complete' }
];

function statusLabel(status) {
    const match = TASK_STATUSES.find(s => s.value === status);
    return match ? match.label : status;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDay(dateStr) {
    if (!dateStr) return { label: 'No deadline', weekday: '', day: '' };
    const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const parts = clean.split('-');
    if (parts.length !== 3) return { label: dateStr, weekday: '', day: '' };

    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return {
        label: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
        weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        day: d.toLocaleDateString('en-US', { day: '2-digit', timeZone: 'UTC' })
    };
}

async function loadCalendar() {
    const container = document.getElementById('calendar-container');

    try {
        const response = await apiFetch(`${TASK_SERVICE_URL}/tasks`);
        if (!response.ok) throw new Error(`Calendar API error: ${response.status}`);

        const tasks = (await response.json()).filter(t => t.task_type !== 'project');
        const sorted = [...tasks].sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')));

        const syncedCount = sorted.filter(t => t.calendar_synced).length;
        document.getElementById('calendar-count').textContent = sorted.length;
        document.getElementById('calendar-synced').textContent = syncedCount;

        if (sorted.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                    </div>
                    <p>No deadlines yet &mdash; assign a task to fill the board.</p>
                </div>`;
            return;
        }

        const groups = new Map();
        sorted.forEach(task => {
            const key = task.deadline || 'none';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(task);
        });

        container.innerHTML = [...groups.entries()].map(([deadline, groupTasks]) => {
            const day = formatDay(deadline);

            return `
                <section class="calendar-day">
                    <div class="calendar-day-head">
                        <div class="calendar-day-marker">
                            <span class="calendar-day-weekday">${escapeHtml(day.weekday)}</span>
                            <span class="calendar-day-number">${escapeHtml(day.day)}</span>
                        </div>
                        <div>
                            <div class="calendar-day-label">${escapeHtml(day.label)}</div>
                            <div class="calendar-day-count">${groupTasks.length} deadline${groupTasks.length === 1 ? '' : 's'}</div>
                        </div>
                    </div>
                    <div class="calendar-day-items">
                        ${groupTasks.map(task => `
                            <article class="calendar-item ${task.status}">
                                <div class="calendar-item-main">
                                    <div class="calendar-item-title">${escapeHtml(task.title)}</div>
                                    <div class="calendar-item-meta">
                                        <span class="status-badge ${task.status}">${statusLabel(task.status)}</span>
                                        ${task.assigned_user_name ? `<span class="tag">${escapeHtml(task.assigned_user_name)}</span>` : '<span class="tag">No owner yet</span>'}
                                        ${task.required_skill ? `<span class="tag">${escapeHtml(task.required_skill)}</span>` : ''}
                                    </div>
                                </div>
                                <div class="calendar-item-side">
                                    <span class="calendar-sync ${task.calendar_synced ? 'synced' : 'pending'}">
                                        ${task.calendar_synced ? '📅 On Google Calendar' : '📅 Adding automatically'}
                                    </span>
                                    ${task.assigned_user_id ? `
                                        <button class="btn btn-calendar" onclick="openInGoogleCalendar(${task.id})">
                                            <span>📅</span><span>Open</span>
                                        </button>` : ''}
                                </div>
                            </article>
                        `).join('')}
                    </div>
                </section>`;
        }).join('');
    } catch (err) {
        container.innerHTML = `
            <div class="empty-state">
                <p>Could not load the calendar: ${escapeHtml(err.message)}</p>
                <button class="btn btn-ghost" onclick="loadCalendar()">Retry</button>
            </div>`;
    }
}

async function openInGoogleCalendar(taskId) {
    try {
        const res = await apiFetch(`${TASK_SERVICE_URL}/tasks/${taskId}/calendar-event`);
        if (!res.ok) throw new Error('Failed to get calendar event details');
        const data = await res.json();
        if (data.googleCalendarUrl) {
            window.open(data.googleCalendarUrl, '_blank');
        }
    } catch (err) {
        alert('Unable to open Google Calendar: ' + err.message);
    }
}
window.openInGoogleCalendar = openInGoogleCalendar;

document.addEventListener('DOMContentLoaded', () => {
    if (!requireLogin()) return;
    applyRoleUI();
    loadCalendar();
});
