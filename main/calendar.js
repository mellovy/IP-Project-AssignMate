const TASK_SERVICE_URL = '/task_service/api';

const TASK_STATUSES = [
    { value: 'backlog', label: 'Backlog' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Complete' }
];

let calTasks = [];
let calMonth = new Date();
let selectedTaskId = null;

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function statusLabel(status) {
    const match = TASK_STATUSES.find(s => s.value === status);
    return match ? match.label : status;
}

function dateKey(date) {
    return date.toISOString().slice(0, 10);
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function formatDeadline(value) {
    if (!value) return 'No deadline';
    const clean = value.includes('T') ? value.split('T')[0] : value;
    const parts = clean.split('-');
    if (parts.length !== 3) return value;
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

async function loadCalendar() {
    const grid = document.getElementById('calendar-container');

    try {
        const response = await apiFetch(`${TASK_SERVICE_URL}/tasks`);
        if (!response.ok) throw new Error(`Calendar API error: ${response.status}`);

        const data = await response.json();
        calTasks = (Array.isArray(data) ? data : []).filter(t => t.task_type !== 'project');
        renderCalendar();
    } catch (err) {
        grid.innerHTML = `
            <div class="empty-state cal-empty">
                <p>Could not load the calendar: ${escapeHtml(err.message)}</p>
                <button type="button" class="btn btn-ghost" onclick="loadCalendar()">Retry</button>
            </div>`;
        document.getElementById('calendar-list').innerHTML = '';
    }
}

function tasksByDate() {
    const map = new Map();
    calTasks.forEach(task => {
        if (!task.deadline) return;
        if (!map.has(task.deadline)) map.set(task.deadline, []);
        map.get(task.deadline).push(task);
    });
    return map;
}

function renderCalendar() {
    const grid = document.getElementById('calendar-container');
    const list = document.getElementById('calendar-list');
    const year = calMonth.getUTCFullYear();
    const month = calMonth.getUTCMonth();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    document.getElementById('calendar-month-label').textContent =
        calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const byDate = tasksByDate();
    const monthTasks = calTasks.filter(t => t.deadline && String(t.deadline).slice(0, 7) === monthPrefix);
    document.getElementById('calendar-count').textContent = monthTasks.length;
    document.getElementById('calendar-synced').textContent = monthTasks.filter(t => t.calendar_synced).length;

    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const startOffset = (firstOfMonth.getUTCDay() + 6) % 7; // Monday-first
    const start = new Date(Date.UTC(year, month, 1 - startOffset));

    const weeks = [];
    for (let w = 0; w < 6; w++) {
        const days = [];
        for (let d = 0; d < 7; d++) {
            days.push(new Date(start.getTime() + (w * 7 + d) * 86400000));
        }
        weeks.push(days);
    }
    while (weeks.length > 4) {
        const last = weeks[weeks.length - 1];
        const outside = last.every(day => day.getUTCMonth() !== month);
        const empty = last.every(day => !(byDate.get(dateKey(day)) || []).length);
        if (outside && empty) weeks.pop();
        else break;
    }

    const today = todayKey();

    grid.innerHTML = weeks.flat().map(day => {
        const key = dateKey(day);
        const dayTasks = byDate.get(key) || [];
        const classes = ['cal-cell'];
        if (day.getUTCMonth() !== month) classes.push('other-month');
        if (key === today) classes.push('today');

        return `
            <div class="${classes.join(' ')}">
                <div class="cal-daynum">${day.getUTCDate()}</div>
                <div class="cal-chips">
                    ${dayTasks.slice(0, 3).map(task => `
                        <button type="button" class="cal-chip ${task.status}" onclick="selectTask(${task.id})"
                            title="${escapeHtml(task.assigned_user_name || 'No owner')} · ${statusLabel(task.status)}">
                            <span class="cal-dot ${task.status}"></span>
                            <span class="cal-chip-title">${escapeHtml(task.title)}</span>
                        </button>
                    `).join('')}
                    ${dayTasks.length > 3 ? `<div class="cal-more">+${dayTasks.length - 3} more</div>` : ''}
                </div>
            </div>`;
    }).join('');

    list.innerHTML = monthTasks.length === 0
        ? `<div class="empty-state cal-empty"><p>No deadlines in ${calMonth.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })}.</p></div>`
        : monthTasks
            .slice()
            .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
            .map(task => `
                <button type="button" class="cal-list-item" onclick="selectTask(${task.id})">
                    <span class="cal-list-date">${escapeHtml(formatDeadline(task.deadline))}</span>
                    <span class="cal-list-title"><span class="cal-dot ${task.status}"></span>${escapeHtml(task.title)}</span>
                    <span class="cal-list-meta">${statusLabel(task.status)}</span>
                </button>
            `).join('');
}

function selectTask(taskId) {
    const task = calTasks.find(t => t.id === taskId);
    if (!task) return;

    selectedTaskId = taskId;
    document.getElementById('cal-detail-title').textContent = task.title;
    document.getElementById('cal-detail-status').textContent = statusLabel(task.status);
    document.getElementById('cal-detail-deadline').textContent = formatDeadline(task.deadline);
    document.getElementById('cal-detail-owner').textContent = task.assigned_user_name || 'No owner yet';
    document.getElementById('cal-detail-skill').textContent = task.required_skill || 'No skill required';
    document.getElementById('cal-detail-sync').textContent = task.calendar_synced
        ? 'On Google Calendar'
        : 'Adding automatically';
    document.getElementById('calendar-detail').hidden = false;
}
window.selectTask = selectTask;

function closeDetail() {
    selectedTaskId = null;
    document.getElementById('calendar-detail').hidden = true;
}
window.closeDetail = closeDetail;

function changeMonth(offset) {
    calMonth = new Date(Date.UTC(calMonth.getUTCFullYear(), calMonth.getUTCMonth() + offset, 1));
    closeDetail();
    renderCalendar();
}
window.changeMonth = changeMonth;

function goToday() {
    const now = new Date();
    calMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    closeDetail();
    renderCalendar();
}
window.goToday = goToday;

async function openInGoogleCalendar(taskId) {
    if (!taskId) return;
    try {
        const res = await apiFetch(`${TASK_SERVICE_URL}/tasks/${taskId}/calendar-event`);
        if (!res.ok) throw new Error('Failed to get calendar event details');
        const data = await res.json();
        if (data.googleCalendarUrl) window.open(data.googleCalendarUrl, '_blank');
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
