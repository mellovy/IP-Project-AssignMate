const test = require('node:test');
const assert = require('node:assert/strict');
const { daysUntilDeadline, isReminderDue } = require('./reminder-utils');

test('daysUntilDeadline counts UTC calendar days', () => {
    const now = new Date('2026-11-26T23:30:00Z');
    assert.equal(daysUntilDeadline('2026-11-28', now), 2);
    assert.equal(daysUntilDeadline('2026-11-26', now), 0);
});

test('isReminderDue only targets assigned, incomplete tasks inside the window', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const base = {
        assigned_user_email: 'member@example.com',
        status: 'assigned',
        deadline: '2026-11-27'
    };

    assert.equal(isReminderDue(base, now, 2), true);
    assert.equal(isReminderDue({ ...base, reminder_sent: true }, now, 2), false);
    assert.equal(isReminderDue({ ...base, status: 'completed' }, now, 2), false);
    assert.equal(isReminderDue({ ...base, assigned_user_email: null }, now, 2), false);
    assert.equal(isReminderDue({ ...base, deadline: '2026-12-01' }, now, 2), false);
});
