-- AssignMate MySQL / MariaDB schema
--
-- How to run:
-- 1. Create/select the database in your hosting panel (phpMyAdmin).
-- 2. Open that database, then run this whole file.
-- 3. Add your real admin account at the bottom.
--
-- If your host allows creating the database from SQL, uncomment these:
-- CREATE DATABASE IF NOT EXISTS assignmate CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE assignmate;

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Users
-- Login is by real email. The same email is used for assignment reminders.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500) NULL,
    active_tasks INT UNSIGNED NOT NULL DEFAULT 0,
    role ENUM('admin', 'member') NOT NULL DEFAULT 'member',
    google_email VARCHAR(255) NULL,
    google_refresh_token TEXT NULL,
    google_connected_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role (role),
    KEY idx_users_google_email (google_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Skills + user skills
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_skills_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_skills (
    user_id INT UNSIGNED NOT NULL,
    skill_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, skill_id),
    KEY idx_user_skills_skill (skill_id),
    CONSTRAINT fk_user_skills_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_skills_skill
        FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sessions
-- Login issues a random token; only its SHA-256 hash is stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tasks and projects
-- Projects are tasks with task_type = 'project'. Subtasks use parent_id.
-- assigned_user_name / assigned_user_email are denormalized for the current
-- task-service email + calendar flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    specifications TEXT NULL,
    required_skill VARCHAR(80) NULL,
    deadline DATE NULL,
    parent_id INT UNSIGNED NULL,
    task_type ENUM('task', 'project') NOT NULL DEFAULT 'task',
    status ENUM('backlog', 'in_progress', 'completed') NOT NULL DEFAULT 'backlog',
    assigned_user_id INT UNSIGNED NULL,
    assigned_user_name VARCHAR(120) NULL,
    assigned_user_email VARCHAR(255) NULL,
    calendar_synced TINYINT(1) NOT NULL DEFAULT 0,
    calendar_event_id VARCHAR(255) NULL,
    reminder_sent TINYINT(1) NOT NULL DEFAULT 0,
    progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tasks_status (status),
    KEY idx_tasks_type (task_type),
    KEY idx_tasks_assigned_user (assigned_user_id),
    KEY idx_tasks_parent (parent_id),
    KEY idx_tasks_deadline (deadline),
    KEY idx_tasks_required_skill (required_skill),
    CONSTRAINT fk_tasks_parent
        FOREIGN KEY (parent_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT chk_tasks_progress CHECK (progress_percent <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Starter skills (safe to re-run)
-- ---------------------------------------------------------------------------
INSERT INTO skills (name) VALUES
    ('Project Management'),
    ('Development'),
    ('Design'),
    ('Testing'),
    ('Documentation')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---------------------------------------------------------------------------
-- YOUR ADMIN ACCOUNT
-- Replace the name and email, then run this once.
-- The email must be a real inbox you control.
-- ---------------------------------------------------------------------------
-- INSERT INTO users (name, email, role)
-- VALUES ('Your Name', 'you@example.com', 'admin')
-- ON DUPLICATE KEY UPDATE role = 'admin', name = VALUES(name);

-- Optional: sample tasks for a quick demo. Delete if not needed.
-- INSERT INTO tasks (title, description, specifications, required_skill, deadline, task_type)
-- VALUES
--     ('Setup API Gateway Authentication', 'Configure reverse proxy middleware.', '1. Route both services\n2. Add headers', 'Development', DATE_ADD(CURDATE(), INTERVAL 2 DAY), 'task'),
--     ('Create Dashboard Mockups', 'Draft dashboard mockups.', 'Responsive desktop and tablet layouts', 'Design', DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'task'),
--     ('Automated Integration Test Suite', 'Write end-to-end tests.', 'Test auto-assign and active counters', 'Testing', DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'task');
