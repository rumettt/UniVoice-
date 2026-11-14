-- V004: Closed-request messaging performance indexes
-- ---------------------------------------------------------------------------
-- Adds a covering index for the most common closed-request messaging query:
-- listing student-visible comments for a request ordered by creation time.
-- ---------------------------------------------------------------------------

-- Partial index: covers student-visible comment retrieval ordered by time.
-- Replaces the more general idx_comments_request_visible for this hot path.
CREATE INDEX IF NOT EXISTS idx_comments_request_visible_paginate
  ON comments (request_id, created_at ASC)
  WHERE deleted_at IS NULL AND visibility = 'student_visible';

-- Attachment download by ID — already covered by the PK; no additional index needed.
-- Last-handler lookup by request_id ORDER BY started_at DESC:
-- covered by idx_request_assignments_request_started (request_id, started_at) added in V001.

-- ---------------------------------------------------------------------------
