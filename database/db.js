const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

// Hosting panels often inject DATABASE_* or MYSQL_* instead of DB_*.
function env(...names) {
    return names.map(name => process.env[name]).find(value => value !== undefined && value !== '');
}

const pool = mysql.createPool({
    host: env('DB_HOST', 'DATABASE_HOST', 'MYSQL_HOST') || 'localhost',
    port: Number(env('DB_PORT', 'DATABASE_PORT', 'MYSQL_PORT')) || 3306,
    user: env('DB_USER', 'DATABASE_USER', 'MYSQL_USER'),
    password: env('DB_PASSWORD', 'DATABASE_PASSWORD', 'MYSQL_PASSWORD', 'DB_PASS'),
    database: env('DB_NAME', 'DATABASE_NAME', 'MYSQL_DATABASE', 'MYSQL_DB'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    timezone: 'Z'
});

async function testConnection() {
    const connection = await pool.getConnection();
    try {
        await connection.ping();
    } finally {
        connection.release();
    }
}

module.exports = { pool, testConnection };
