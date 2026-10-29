const { spawn } = require('child_process');
const path = require('path');

const services = [
    { name: 'User Service', script: path.join(__dirname, 'user_service/server.js') },
    { name: 'Task Service', script: path.join(__dirname, 'task_service/server.js') },
    { name: 'Gateway', script: path.join(__dirname, 'gateway/server.js') }
];

const children = [];

services.forEach(srv => {
    const child = spawn(process.execPath, [srv.script], {
        cwd: __dirname,
        stdio: 'inherit'
    });

    child.on('error', err => {
        console.error(`[${srv.name}] Error:`, err);
    });

    children.push(child);
});

function cleanup() {
    children.forEach(c => c.kill());
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
