const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(value) {
    const raw = String(value || '').slice(0, 10);
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function daysUntilDeadline(deadline, now = new Date()) {
    const due = toUtcDay(deadline);
    if (due === null) return null;

    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((due - today) / DAY_MS);
}

function isReminderDue(task, now = new Date(), daysBefore = 2) {
    if (!task || !task.assigned_user_email || task.status === 'completed' || task.reminder_sent) {
        return false;
    }

    const daysLeft = daysUntilDeadline(task.deadline, now);
    return daysLeft !== null && daysLeft >= 0 && daysLeft <= daysBefore;
}

module.exports = { daysUntilDeadline, isReminderDue };
