const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function formatDeadline(value) {
    const raw = String(value || '').slice(0, 10);
    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return raw || 'No deadline';

    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
    });
}

async function sendTaskEmail(task, { kind = 'reminder', daysLeft, calendarUrl } = {}) {
    if (!task.assigned_user_id) {
        return { sent: false, reason: 'Assignee is missing' };
    }

    const internalKey = process.env.INTERNAL_API_KEY;
    if (!internalKey) {
        return { sent: false, reason: 'INTERNAL_API_KEY is not configured' };
    }

    const title = String(task.title || 'Untitled task').replace(/[\r\n]+/g, ' ');
    const deadline = formatDeadline(task.deadline);
    const dueText = daysLeft === 0
        ? 'today'
        : daysLeft === 1
            ? 'tomorrow'
            : Number.isFinite(daysLeft)
                ? `in ${daysLeft} days`
                : 'soon';
    const isAssignment = kind === 'assignment';
    const subject = isAssignment
        ? `AssignMate: New task assigned - ${title}`
        : `AssignMate reminder: ${title} is due ${dueText}`;
    const intro = isAssignment
        ? 'You have been assigned a new task in AssignMate.'
        : `This is a reminder that your AssignMate task is due ${dueText}.`;

    const details = [
        ['Task', task.title || 'Untitled task'],
        ['Assigned to', task.assigned_user_name || 'Team member'],
        ['Status', task.status || 'assigned'],
        ['Required skill', task.required_skill || 'N/A'],
        ['Deadline', deadline]
    ];

    const text = [
        `Hi ${task.assigned_user_name || 'there'},`,
        '',
        intro,
        '',
        ...details.map(([label, value]) => `${label}: ${value}`),
        task.description ? `\nDescription:\n${task.description}` : '',
        task.specifications ? `\nSpecifications:\n${task.specifications}` : '',
        calendarUrl ? `\nAdd to Google Calendar:\n${calendarUrl}` : '',
        '',
        'This is an automated message from AssignMate.'
    ].filter(Boolean).join('\n');

    const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222;max-width:640px;margin:0 auto">
            <h2 style="margin:0 0 16px">${escapeHtml(subject)}</h2>
            <p>Hi ${escapeHtml(task.assigned_user_name || 'there')},</p>
            <p>${escapeHtml(intro)}</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0">
                ${details.map(([label, value]) => `
                    <tr>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666;width:140px">${escapeHtml(label)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(value)}</td>
                    </tr>
                `).join('')}
            </table>
            ${task.description ? `<h3>Description</h3><p style="white-space:pre-wrap">${escapeHtml(task.description)}</p>` : ''}
            ${task.specifications ? `<h3>Specifications</h3><p style="white-space:pre-wrap">${escapeHtml(task.specifications)}</p>` : ''}
            ${calendarUrl ? `<p><a href="${escapeHtml(calendarUrl)}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Add to Google Calendar</a></p>` : ''}
            <p style="color:#777;font-size:12px">Automated message from AssignMate.</p>
        </div>
    `;

    try {
        const response = await fetch(`${USER_SERVICE_URL}/api/users/${task.assigned_user_id}/send-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-key': internalKey
            },
            body: JSON.stringify({ subject, text, html })
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return { sent: false, reason: data.error || `user_service returned ${response.status}` };
        }

        return { sent: true, messageId: data.messageId, to: data.to };
    } catch (err) {
        return { sent: false, reason: err.message };
    }
}

module.exports = { sendTaskEmail, formatDeadline };
