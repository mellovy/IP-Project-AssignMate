-- AssignMate status vocabulary migration
--
-- Run this ONCE in phpMyAdmin (select the database first) BEFORE deploying the
-- new code. The old 'unassigned' / 'assigned' statuses become:
--   'assigned'   -> 'in_progress'
--   'unassigned' -> 'backlog'
--
-- The enum is widened first, then the rows are mapped, then the enum is
-- narrowed: MySQL/MariaDB refuses to change an enum while existing rows still
-- hold a value that is not in the new list.

ALTER TABLE tasks
    MODIFY COLUMN status ENUM('unassigned', 'assigned', 'backlog', 'in_progress', 'completed')
    NOT NULL DEFAULT 'backlog';

UPDATE tasks SET status = 'in_progress' WHERE status = 'assigned';
UPDATE tasks SET status = 'backlog' WHERE status = 'unassigned';

ALTER TABLE tasks
    MODIFY COLUMN status ENUM('backlog', 'in_progress', 'completed')
    NOT NULL DEFAULT 'backlog';

-- Ownership is stored in assigned_user_id and is independent of the workflow
-- status, so nothing else needs to change here.
