const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, '../main')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../main/login.html'));
});

// Forwarding helper for microservices (preserves method, headers, query, and streaming body)
function createProxy(targetPort) {
    return (req, res) => {
        const options = {
            hostname: '127.0.0.1',
            port: targetPort,
            path: req.url, // Express strips the '/user_service' prefix automatically in mounted routers
            method: req.method,
            headers: {
                ...req.headers,
                host: `127.0.0.1:${targetPort}`
            }
        };

        const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error(`[Gateway Proxy -> :${targetPort}] Error:`, err.message);
            res.status(502).json({ error: `Service on port ${targetPort} unavailable: ${err.message}` });
        });

        req.pipe(proxyReq);
    };
}

// 2. Route to User Service (Port 3001)
app.use('/user_service', createProxy(3001));

// 3. Route to Task Service (Port 3002)
app.use('/task_service', createProxy(3002));

const PORT = Number(process.env.PORT) || 20339;

app.listen(PORT, '0.0.0.0', () => console.log(`Gateway and Dashboard running on port ${PORT}`));