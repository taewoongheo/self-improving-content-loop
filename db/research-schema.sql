PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE research_runs (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    trigger_kind TEXT NOT NULL
        CHECK (trigger_kind IN ('scheduled', 'content_preflight', 'result_review', 'manual')),
    objective TEXT NOT NULL
        CHECK (length(trim(objective)) BETWEEN 1 AND 1000),
    event_context_json TEXT NOT NULL DEFAULT '{}'
        CHECK (json_valid(event_context_json) AND json_type(event_context_json) = 'object'),
    status TEXT NOT NULL
        CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    started_at TEXT NOT NULL
        CHECK (datetime(started_at) IS NOT NULL),
    lease_expires_at TEXT
        CHECK (lease_expires_at IS NULL OR datetime(lease_expires_at) IS NOT NULL),
    finished_at TEXT
        CHECK (finished_at IS NULL OR datetime(finished_at) IS NOT NULL),
    skip_reason TEXT
        CHECK (skip_reason IS NULL OR length(trim(skip_reason)) BETWEEN 1 AND 1000),
    error_text TEXT
        CHECK (error_text IS NULL OR length(trim(error_text)) BETWEEN 1 AND 2000),
    CHECK (
        (status = 'running'
            AND lease_expires_at IS NOT NULL
            AND finished_at IS NULL
            AND skip_reason IS NULL
            AND error_text IS NULL)
        OR
        (status = 'completed'
            AND lease_expires_at IS NULL
            AND finished_at IS NOT NULL
            AND skip_reason IS NULL
            AND error_text IS NULL)
        OR
        (status = 'failed'
            AND lease_expires_at IS NULL
            AND finished_at IS NOT NULL
            AND skip_reason IS NULL
            AND error_text IS NOT NULL)
        OR
        (status = 'skipped'
            AND lease_expires_at IS NULL
            AND finished_at IS NOT NULL
            AND skip_reason IS NOT NULL
            AND error_text IS NULL)
    )
);

CREATE UNIQUE INDEX research_runs_single_running
ON research_runs ((1))
WHERE status = 'running';

CREATE TABLE research_questions (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL
        CHECK (position BETWEEN 1 AND 3),
    question TEXT NOT NULL
        CHECK (length(trim(question)) BETWEEN 1 AND 2000),
    why_now TEXT NOT NULL
        CHECK (length(trim(why_now)) BETWEEN 1 AND 2000),
    expected_decision TEXT NOT NULL
        CHECK (length(trim(expected_decision)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL
        CHECK (
            status IN (
                'selected', 'completed', 'no_finding', 'outside_scope',
                'duplicate', 'failed'
            )
        ),
    outcome_reason TEXT
        CHECK (outcome_reason IS NULL OR length(trim(outcome_reason)) BETWEEN 1 AND 2000),
    duplicate_of_finding_id TEXT REFERENCES research_findings(id) ON DELETE RESTRICT,
    UNIQUE (run_id, position),
    CHECK (
        (status IN ('failed', 'outside_scope') AND outcome_reason IS NOT NULL)
        OR
        (status NOT IN ('failed', 'outside_scope') AND outcome_reason IS NULL)
    ),
    CHECK (
        (status = 'duplicate' AND duplicate_of_finding_id IS NOT NULL)
        OR
        (status <> 'duplicate' AND duplicate_of_finding_id IS NULL)
    )
);

CREATE TABLE research_sources (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    canonical_url TEXT NOT NULL UNIQUE
        CHECK (
            length(trim(canonical_url)) BETWEEN 8 AND 4096
            AND (
                canonical_url LIKE 'https://%'
                OR canonical_url LIKE 'http://%'
            )
        ),
    source_kind TEXT NOT NULL
        CHECK (length(trim(source_kind)) BETWEEN 1 AND 100),
    title TEXT
        CHECK (title IS NULL OR length(trim(title)) BETWEEN 1 AND 1000),
    publisher TEXT
        CHECK (publisher IS NULL OR length(trim(publisher)) BETWEEN 1 AND 500),
    published_at TEXT
        CHECK (published_at IS NULL OR datetime(published_at) IS NOT NULL),
    first_seen_at TEXT NOT NULL
        CHECK (datetime(first_seen_at) IS NOT NULL),
    last_accessed_at TEXT NOT NULL
        CHECK (datetime(last_accessed_at) IS NOT NULL),
    CHECK (datetime(last_accessed_at) >= datetime(first_seen_at))
);

CREATE TABLE research_source_captures (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE RESTRICT,
    observed_at TEXT NOT NULL
        CHECK (datetime(observed_at) IS NOT NULL),
    original_url TEXT NOT NULL
        CHECK (length(trim(original_url)) BETWEEN 8 AND 4096),
    resolved_url TEXT
        CHECK (resolved_url IS NULL OR length(trim(resolved_url)) BETWEEN 8 AND 4096),
    retrieval_method TEXT NOT NULL
        CHECK (length(trim(retrieval_method)) BETWEEN 1 AND 100),
    http_status INTEGER
        CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    published_at TEXT
        CHECK (published_at IS NULL OR datetime(published_at) IS NOT NULL),
    content_sha256 TEXT
        CHECK (
            content_sha256 IS NULL
            OR (
                length(content_sha256) = 64
                AND content_sha256 NOT GLOB '*[^0-9a-f]*'
            )
        ),
    capture_error TEXT
        CHECK (capture_error IS NULL OR length(trim(capture_error)) BETWEEN 1 AND 2000)
);

CREATE INDEX research_source_captures_source_time
ON research_source_captures(source_id, observed_at);

CREATE TABLE research_findings (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    question_id TEXT NOT NULL REFERENCES research_questions(id) ON DELETE RESTRICT,
    finding_text TEXT NOT NULL
        CHECK (length(trim(finding_text)) BETWEEN 1 AND 10000),
    limitations TEXT NOT NULL
        CHECK (length(trim(limitations)) BETWEEN 1 AND 5000),
    proposed_action TEXT NOT NULL
        CHECK (length(trim(proposed_action)) BETWEEN 1 AND 5000),
    routing_kind TEXT NOT NULL
        CHECK (routing_kind IN (
            'existing_owner',
            'new_owner_proposal'
        )),
    proposed_owner TEXT NOT NULL
        CHECK (length(trim(proposed_owner)) BETWEEN 1 AND 500),
    finding_fingerprint TEXT NOT NULL UNIQUE
        CHECK (
            length(finding_fingerprint) = 64
            AND finding_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
    created_at TEXT NOT NULL
        CHECK (datetime(created_at) IS NOT NULL)
);

CREATE TABLE research_finding_sources (
    finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE RESTRICT,
    relation TEXT NOT NULL
        CHECK (relation IN ('supports', 'contradicts', 'context')),
    evidence_note TEXT NOT NULL
        CHECK (length(trim(evidence_note)) BETWEEN 1 AND 2000),
    PRIMARY KEY (finding_id, source_id)
);

CREATE TABLE research_duplicate_question_sources (
    question_id TEXT NOT NULL REFERENCES research_questions(id) ON DELETE RESTRICT,
    source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE RESTRICT,
    relation TEXT NOT NULL
        CHECK (relation IN ('supports', 'contradicts', 'context')),
    evidence_note TEXT NOT NULL
        CHECK (length(trim(evidence_note)) BETWEEN 1 AND 2000),
    PRIMARY KEY (question_id, source_id)
);

CREATE TRIGGER research_duplicate_question_sources_status_insert
BEFORE INSERT ON research_duplicate_question_sources
WHEN NOT EXISTS (
    SELECT 1
    FROM research_questions
    WHERE id = NEW.question_id AND status = 'duplicate'
)
BEGIN
    SELECT RAISE(ABORT, 'question source requires duplicate question');
END;

CREATE TRIGGER research_duplicate_question_sources_immutable_update
BEFORE UPDATE ON research_duplicate_question_sources
BEGIN
    SELECT RAISE(ABORT, 'duplicate question sources are immutable');
END;

CREATE TRIGGER research_duplicate_question_sources_immutable_delete
BEFORE DELETE ON research_duplicate_question_sources
BEGIN
    SELECT RAISE(ABORT, 'duplicate question sources are immutable');
END;

CREATE TABLE research_reviews (
    finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    decision TEXT NOT NULL
        CHECK (decision IN ('approved', 'rejected', 'revision_requested')),
    rationale TEXT NOT NULL
        CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
    reviewed_at TEXT NOT NULL
        CHECK (datetime(reviewed_at) IS NOT NULL),
    PRIMARY KEY (finding_id, revision)
);

CREATE TABLE research_quality_feedback (
    id INTEGER PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
    finding_id TEXT REFERENCES research_findings(id) ON DELETE RESTRICT,
    verdict TEXT NOT NULL
        CHECK (verdict IN (
            'useful', 'weak_evidence', 'irrelevant', 'overstated', 'correction'
        )),
    rationale TEXT NOT NULL
        CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
    actor_evidence TEXT NOT NULL
        CHECK (length(trim(actor_evidence)) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL
        CHECK (datetime(created_at) IS NOT NULL)
);

CREATE TRIGGER research_quality_feedback_finding_run_match
BEFORE INSERT ON research_quality_feedback
WHEN NEW.finding_id IS NOT NULL
 AND NOT EXISTS (
     SELECT 1
     FROM research_findings AS finding
     JOIN research_questions AS question ON question.id = finding.question_id
     WHERE finding.id = NEW.finding_id
       AND question.run_id = NEW.run_id
 )
BEGIN
    SELECT RAISE(ABORT, 'quality feedback finding does not belong to run');
END;

CREATE TRIGGER research_quality_feedback_immutable_update
BEFORE UPDATE ON research_quality_feedback
BEGIN
    SELECT RAISE(ABORT, 'research quality feedback is immutable');
END;

CREATE TRIGGER research_quality_feedback_immutable_delete
BEFORE DELETE ON research_quality_feedback
BEGIN
    SELECT RAISE(ABORT, 'research quality feedback is immutable');
END;

CREATE TRIGGER research_finding_sources_closed_after_review_insert
BEFORE INSERT ON research_finding_sources
WHEN EXISTS (
    SELECT 1 FROM research_reviews WHERE finding_id = NEW.finding_id
)
BEGIN
    SELECT RAISE(ABORT, 'finding source provenance is closed after review');
END;

CREATE TRIGGER research_finding_sources_closed_after_review_update
BEFORE UPDATE ON research_finding_sources
WHEN EXISTS (
    SELECT 1 FROM research_reviews WHERE finding_id = OLD.finding_id
)
BEGIN
    SELECT RAISE(ABORT, 'finding source provenance is closed after review');
END;

CREATE TRIGGER research_finding_sources_closed_after_review_delete
BEFORE DELETE ON research_finding_sources
WHEN EXISTS (
    SELECT 1 FROM research_reviews WHERE finding_id = OLD.finding_id
)
BEGIN
    SELECT RAISE(ABORT, 'finding source provenance is closed after review');
END;

CREATE TABLE research_adoptions (
    finding_id TEXT PRIMARY KEY REFERENCES research_findings(id) ON DELETE RESTRICT,
    owner_class TEXT NOT NULL
        CHECK (owner_class IN (
            'structured_knowledge',
            'raw_reference',
            'tracked_owner'
        )),
    owner_ref TEXT NOT NULL
        CHECK (length(trim(owner_ref)) BETWEEN 1 AND 1000),
    adopted_at TEXT NOT NULL
        CHECK (datetime(adopted_at) IS NOT NULL),
    owner_sha256 TEXT
        CHECK (
            owner_sha256 IS NULL
            OR (
                length(owner_sha256) = 64
                AND owner_sha256 NOT GLOB '*[^0-9a-f]*'
            )
        ),
    CHECK (
        (owner_class IN ('tracked_owner', 'raw_reference') AND owner_sha256 IS NOT NULL)
        OR
        owner_class = 'structured_knowledge'
    )
);

CREATE TABLE research_notifications (
    notification_id INTEGER PRIMARY KEY,
    finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE RESTRICT,
    notification_kind TEXT NOT NULL
        CHECK (notification_kind IN ('adopted', 'proposal')),
    event_revision INTEGER NOT NULL CHECK (event_revision >= 1),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'dispatching', 'failed', 'delivered', 'cancelled')),
    created_at TEXT NOT NULL
        CHECK (datetime(created_at) IS NOT NULL),
    attempt_token TEXT
        CHECK (attempt_token IS NULL OR length(trim(attempt_token)) BETWEEN 1 AND 200),
    attempted_at TEXT
        CHECK (attempted_at IS NULL OR datetime(attempted_at) IS NOT NULL),
    attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
    delivered_at TEXT
        CHECK (delivered_at IS NULL OR datetime(delivered_at) IS NOT NULL),
    transport_ref TEXT
        CHECK (transport_ref IS NULL OR length(trim(transport_ref)) BETWEEN 1 AND 1000),
    last_error TEXT
        CHECK (last_error IS NULL OR length(trim(last_error)) BETWEEN 1 AND 5000),
    cancelled_at TEXT
        CHECK (cancelled_at IS NULL OR datetime(cancelled_at) IS NOT NULL),
    cancellation_reason TEXT
        CHECK (
            cancellation_reason IS NULL
            OR length(trim(cancellation_reason)) BETWEEN 1 AND 5000
        ),
    UNIQUE (finding_id, notification_kind, event_revision),
    CHECK (
        (notification_kind = 'adopted' AND event_revision = 1)
        OR notification_kind = 'proposal'
    ),
    CHECK (
        (
            status = 'pending'
            AND attempt_token IS NULL
            AND attempted_at IS NULL
            AND attempt_count = 0
            AND delivered_at IS NULL
            AND transport_ref IS NULL
            AND last_error IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL
        )
        OR
        (
            status = 'dispatching'
            AND attempt_token IS NOT NULL
            AND attempted_at IS NOT NULL
            AND attempt_count >= 1
            AND delivered_at IS NULL
            AND transport_ref IS NULL
            AND last_error IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL
        )
        OR
        (
            status = 'failed'
            AND attempt_token IS NOT NULL
            AND attempted_at IS NOT NULL
            AND attempt_count >= 1
            AND delivered_at IS NULL
            AND transport_ref IS NULL
            AND last_error IS NOT NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL
        )
        OR
        (
            status = 'delivered'
            AND attempt_token IS NOT NULL
            AND attempted_at IS NOT NULL
            AND attempt_count >= 1
            AND delivered_at IS NOT NULL
            AND transport_ref IS NOT NULL
            AND last_error IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL
        )
        OR
        (
            status = 'cancelled'
            AND delivered_at IS NULL
            AND transport_ref IS NULL
            AND cancelled_at IS NOT NULL
            AND cancellation_reason IS NOT NULL
            AND (
                (
                    attempt_count = 0
                    AND attempt_token IS NULL
                    AND attempted_at IS NULL
                    AND last_error IS NULL
                )
                OR
                (
                    attempt_count >= 1
                    AND attempt_token IS NOT NULL
                    AND attempted_at IS NOT NULL
                )
            )
        )
    )
);

CREATE TRIGGER research_notifications_require_matching_event
BEFORE INSERT ON research_notifications
BEGIN
    SELECT CASE
        WHEN NEW.notification_kind = 'adopted'
         AND NEW.event_revision != 1
        THEN RAISE(ABORT, 'adopted notification revision must be one')
        WHEN NEW.notification_kind = 'adopted'
         AND NOT EXISTS (
             SELECT 1 FROM research_adoptions
             WHERE finding_id = NEW.finding_id
         )
        THEN RAISE(ABORT, 'adopted notification requires adoption')
        WHEN NEW.notification_kind = 'proposal'
         AND NOT EXISTS (
             SELECT 1
             FROM research_findings AS finding
             JOIN research_reviews AS review ON review.finding_id = finding.id
             WHERE finding.id = NEW.finding_id
               AND finding.routing_kind = 'new_owner_proposal'
               AND review.revision = NEW.event_revision
               AND review.decision = 'approved'
         )
        THEN RAISE(ABORT, 'proposal notification requires current approval')
    END;
END;

CREATE TRIGGER research_notifications_valid_transition
BEFORE UPDATE ON research_notifications
WHEN NOT (
    OLD.notification_id = NEW.notification_id
    AND OLD.finding_id = NEW.finding_id
    AND OLD.notification_kind = NEW.notification_kind
    AND OLD.event_revision = NEW.event_revision
    AND OLD.created_at = NEW.created_at
    AND (
        (
            OLD.status IN ('pending', 'failed')
            AND NEW.status = 'dispatching'
            AND NEW.attempt_count = OLD.attempt_count + 1
        )
        OR
        (
            OLD.status = 'dispatching'
            AND NEW.status IN ('failed', 'delivered')
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.attempt_token = OLD.attempt_token
            AND NEW.attempted_at = OLD.attempted_at
        )
        OR
        (
            OLD.status IN ('pending', 'failed', 'dispatching')
            AND NEW.status = 'cancelled'
            AND NEW.attempt_count = OLD.attempt_count
            AND NEW.attempt_token IS OLD.attempt_token
            AND NEW.attempted_at IS OLD.attempted_at
        )
    )
)
BEGIN
    SELECT RAISE(ABORT, 'invalid notification state transition');
END;

CREATE TRIGGER research_adoptions_require_exact_routing
BEFORE INSERT ON research_adoptions
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM research_findings AS finding
            WHERE finding.id = NEW.finding_id
              AND finding.proposed_owner = NEW.owner_ref
              AND finding.routing_kind = 'existing_owner'
              AND (
                  (NEW.owner_class = 'structured_knowledge' AND NEW.owner_ref IN (
                      'expertise_entries',
                      'marketing_method_entries',
                      'audience_language_entries'
                  ))
                  OR
                  (NEW.owner_class = 'raw_reference' AND NEW.owner_ref = 'format_reference_entries')
                  OR
                  (
                      NEW.owner_class = 'tracked_owner'
                      AND NEW.owner_ref NOT IN (
                          'expertise_entries',
                          'marketing_method_entries',
                          'audience_language_entries',
                          'format_reference_entries'
                      )
                  )
              )
        )
        THEN RAISE(ABORT, 'adoption owner does not match finding route')
    END;
END;

CREATE TRIGGER research_adoptions_require_approval_and_source
BEFORE INSERT ON research_adoptions
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM research_reviews AS review
            WHERE review.finding_id = NEW.finding_id
              AND review.revision = (
                  SELECT MAX(latest.revision)
                  FROM research_reviews AS latest
                  WHERE latest.finding_id = NEW.finding_id
              )
              AND review.decision = 'approved'
        )
        THEN RAISE(ABORT, 'approved review required')
    END;
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM research_finding_sources
            WHERE finding_id = NEW.finding_id
        )
        THEN RAISE(ABORT, 'source required before adoption')
    END;
END;

CREATE TRIGGER research_adoptions_enqueue_notification
AFTER INSERT ON research_adoptions
BEGIN
    INSERT INTO research_notifications (
        finding_id, notification_kind, event_revision, status, created_at
    ) VALUES (NEW.finding_id, 'adopted', 1, 'pending', NEW.adopted_at);
END;

CREATE TRIGGER research_reviews_enqueue_proposal_notification
AFTER INSERT ON research_reviews
WHEN NEW.decision = 'approved'
 AND EXISTS (
     SELECT 1
     FROM research_findings
     WHERE id = NEW.finding_id
       AND routing_kind = 'new_owner_proposal'
 )
BEGIN
    INSERT INTO research_notifications (
        finding_id, notification_kind, event_revision, status, created_at
    ) VALUES (NEW.finding_id, 'proposal', NEW.revision, 'pending', NEW.reviewed_at);
END;

CREATE TRIGGER research_reviews_cancel_stale_proposal_notifications
AFTER INSERT ON research_reviews
BEGIN
    UPDATE research_notifications
    SET status = 'cancelled', cancelled_at = NEW.reviewed_at,
        cancellation_reason = 'superseded by review revision ' || NEW.revision
    WHERE finding_id = NEW.finding_id
      AND notification_kind = 'proposal'
      AND event_revision < NEW.revision
      AND status IN ('pending', 'failed', 'dispatching');
END;

CREATE TABLE expertise_entries (
    finding_id TEXT PRIMARY KEY REFERENCES research_adoptions(finding_id) ON DELETE RESTRICT,
    topic TEXT NOT NULL
        CHECK (length(trim(topic)) BETWEEN 1 AND 200),
    claim TEXT NOT NULL
        CHECK (length(trim(claim)) BETWEEN 1 AND 5000),
    mechanism TEXT
        CHECK (mechanism IS NULL OR length(trim(mechanism)) BETWEEN 1 AND 5000),
    practical_application TEXT NOT NULL
        CHECK (length(trim(practical_application)) BETWEEN 1 AND 5000),
    scope_conditions TEXT NOT NULL
        CHECK (length(trim(scope_conditions)) BETWEEN 1 AND 5000),
    limitations TEXT NOT NULL
        CHECK (length(trim(limitations)) BETWEEN 1 AND 5000),
    evidence_status TEXT NOT NULL
        CHECK (evidence_status IN ('established', 'supported', 'preliminary', 'contested')),
    content_use TEXT NOT NULL
        CHECK (length(trim(content_use)) BETWEEN 1 AND 5000)
);

CREATE TABLE marketing_method_entries (
    finding_id TEXT PRIMARY KEY REFERENCES research_adoptions(finding_id) ON DELETE RESTRICT,
    method TEXT NOT NULL
        CHECK (length(trim(method)) BETWEEN 1 AND 5000),
    mechanism TEXT NOT NULL
        CHECK (length(trim(mechanism)) BETWEEN 1 AND 5000),
    application_context TEXT NOT NULL
        CHECK (length(trim(application_context)) BETWEEN 1 AND 5000),
    prerequisites TEXT NOT NULL
        CHECK (length(trim(prerequisites)) BETWEEN 1 AND 5000),
    limitations TEXT NOT NULL
        CHECK (length(trim(limitations)) BETWEEN 1 AND 5000),
    evidence_status TEXT NOT NULL
        CHECK (evidence_status IN ('established', 'supported', 'preliminary', 'contested')),
    proposed_test TEXT NOT NULL
        CHECK (length(trim(proposed_test)) BETWEEN 1 AND 5000)
);

CREATE TABLE audience_language_entries (
    finding_id TEXT PRIMARY KEY REFERENCES research_adoptions(finding_id) ON DELETE RESTRICT,
    expression TEXT NOT NULL
        CHECK (length(trim(expression)) BETWEEN 1 AND 5000),
    situation TEXT NOT NULL
        CHECK (length(trim(situation)) BETWEEN 1 AND 5000),
    source_context TEXT NOT NULL
        CHECK (length(trim(source_context)) BETWEEN 1 AND 2000),
    target_fit TEXT NOT NULL
        CHECK (length(trim(target_fit)) BETWEEN 1 AND 2000)
);

CREATE TABLE format_reference_entries (
    finding_id TEXT PRIMARY KEY REFERENCES research_adoptions(finding_id) ON DELETE RESTRICT,
    medium TEXT NOT NULL
        CHECK (medium IN ('slideshow', 'video')),
    format_id TEXT NOT NULL
        CHECK (
            length(format_id) BETWEEN 1 AND 100
            AND format_id NOT GLOB '*[^a-z0-9-]*'
        ),
    post_id TEXT NOT NULL
        CHECK (
            length(post_id) BETWEEN 1 AND 100
            AND post_id NOT GLOB '*[^a-zA-Z0-9_-]*'
        ),
    source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE RESTRICT,
    selection_reason TEXT NOT NULL
        CHECK (length(trim(selection_reason)) BETWEEN 1 AND 5000),
    UNIQUE (medium, format_id, post_id)
);

CREATE TABLE format_reference_assets (
    id TEXT PRIMARY KEY
        CHECK (length(id) BETWEEN 1 AND 64),
    finding_id TEXT NOT NULL REFERENCES format_reference_entries(finding_id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position > 0),
    local_path TEXT NOT NULL UNIQUE
        CHECK (
            length(trim(local_path)) BETWEEN 1 AND 2000
            AND instr(local_path, '..') = 0
            AND instr(local_path, char(92)) = 0
        ),
    media_sha256 TEXT NOT NULL
        CHECK (
            length(media_sha256) = 64
            AND media_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
    media_type TEXT NOT NULL
        CHECK (media_type IN ('image', 'video')),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    UNIQUE (finding_id, position),
    UNIQUE (media_sha256)
);

CREATE TRIGGER expertise_entries_owner_match
BEFORE INSERT ON expertise_entries
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM research_adoptions
            WHERE finding_id = NEW.finding_id
              AND owner_class = 'structured_knowledge'
              AND owner_ref = 'expertise_entries'
        )
        THEN RAISE(ABORT, 'expertise owner mismatch')
    END;
END;

CREATE TRIGGER marketing_method_entries_owner_match
BEFORE INSERT ON marketing_method_entries
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM research_adoptions
            WHERE finding_id = NEW.finding_id
              AND owner_class = 'structured_knowledge'
              AND owner_ref = 'marketing_method_entries'
        )
        THEN RAISE(ABORT, 'marketing method owner mismatch')
    END;
END;

CREATE TRIGGER audience_language_entries_owner_match
BEFORE INSERT ON audience_language_entries
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM research_adoptions
            WHERE finding_id = NEW.finding_id
              AND owner_class = 'structured_knowledge'
              AND owner_ref = 'audience_language_entries'
        )
        THEN RAISE(ABORT, 'audience language owner mismatch')
    END;
END;

CREATE TRIGGER format_reference_entries_owner_match
BEFORE INSERT ON format_reference_entries
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM research_adoptions
            WHERE finding_id = NEW.finding_id
              AND owner_class = 'raw_reference'
              AND owner_ref = 'format_reference_entries'
        )
        THEN RAISE(ABORT, 'format reference owner mismatch')
    END;
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM research_finding_sources
            WHERE finding_id = NEW.finding_id
              AND source_id = NEW.source_id
        )
        THEN RAISE(ABORT, 'format source must support its finding')
    END;
END;

CREATE TRIGGER format_reference_assets_path_match
BEFORE INSERT ON format_reference_assets
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (
            SELECT 1
            FROM format_reference_entries AS reference
            WHERE reference.finding_id = NEW.finding_id
              AND substr(
                  NEW.local_path,
                  1,
                  length(
                      'renderer/' || reference.medium || '/formats/' ||
                      reference.format_id || '/references/' || reference.post_id || '/'
                  )
              ) = (
                  'renderer/' || reference.medium || '/formats/' ||
                  reference.format_id || '/references/' || reference.post_id || '/'
              )
              AND length(NEW.local_path) > length(
                  'renderer/' || reference.medium || '/formats/' ||
                  reference.format_id || '/references/' || reference.post_id || '/'
              )
              AND instr(
                  substr(
                      NEW.local_path,
                      length(
                          'renderer/' || reference.medium || '/formats/' ||
                          reference.format_id || '/references/' || reference.post_id || '/'
                      ) + 1
                  ),
                  '/'
              ) = 0
        )
        THEN RAISE(ABORT, 'format reference asset path mismatch')
    END;
END;

CREATE TABLE research_withdrawals (
    finding_id TEXT PRIMARY KEY REFERENCES research_adoptions(finding_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL
        CHECK (length(trim(reason)) BETWEEN 1 AND 5000),
    actor_kind TEXT NOT NULL
        CHECK (actor_kind IN ('user', 'agent')),
    actor_evidence TEXT
        CHECK (actor_evidence IS NULL OR length(trim(actor_evidence)) BETWEEN 1 AND 1000),
    withdrawn_at TEXT NOT NULL
        CHECK (datetime(withdrawn_at) IS NOT NULL),
    owner_sha256_after TEXT
        CHECK (
            owner_sha256_after IS NULL
            OR (
                length(owner_sha256_after) = 64
                AND owner_sha256_after NOT GLOB '*[^0-9a-f]*'
            )
        ),
    CHECK (actor_kind = 'agent' OR actor_evidence IS NOT NULL)
);

CREATE TRIGGER research_withdrawals_require_owner_removal
BEFORE INSERT ON research_withdrawals
BEGIN
    SELECT CASE
        WHEN EXISTS (
            SELECT 1
            FROM research_adoptions AS adoption
            WHERE adoption.finding_id = NEW.finding_id
              AND adoption.owner_class = 'structured_knowledge'
              AND (
                  EXISTS (SELECT 1 FROM expertise_entries WHERE finding_id = NEW.finding_id)
                  OR EXISTS (SELECT 1 FROM marketing_method_entries WHERE finding_id = NEW.finding_id)
                  OR EXISTS (SELECT 1 FROM audience_language_entries WHERE finding_id = NEW.finding_id)
              )
        )
        THEN RAISE(ABORT, 'structured owner must be removed before withdrawal')
    END;
    SELECT CASE
        WHEN EXISTS (
            SELECT 1
            FROM research_adoptions AS adoption
            WHERE adoption.finding_id = NEW.finding_id
              AND adoption.owner_class = 'raw_reference'
              AND EXISTS (
                  SELECT 1 FROM format_reference_entries WHERE finding_id = NEW.finding_id
              )
        )
        THEN RAISE(ABORT, 'raw reference owner must be removed before withdrawal')
    END;
    SELECT CASE
        WHEN EXISTS (
            SELECT 1
            FROM research_adoptions AS adoption
            WHERE finding_id = NEW.finding_id
              AND owner_class = 'tracked_owner'
              AND (
                  NEW.owner_sha256_after IS NULL
                  OR NEW.owner_sha256_after = owner_sha256
              )
            )
            THEN RAISE(ABORT, 'tracked owner withdrawal requires a changed final checksum')
    END;
END;

CREATE TRIGGER research_withdrawals_cancel_pending_notification
AFTER INSERT ON research_withdrawals
BEGIN
    UPDATE research_notifications
    SET status = 'cancelled', cancelled_at = NEW.withdrawn_at,
        cancellation_reason = 'finding withdrawn before delivery'
    WHERE finding_id = NEW.finding_id
      AND notification_kind = 'adopted'
      AND status IN ('pending', 'failed', 'dispatching');
END;

CREATE TRIGGER research_withdrawals_immutable_update
BEFORE UPDATE ON research_withdrawals
BEGIN
    SELECT RAISE(ABORT, 'research withdrawals are immutable');
END;

CREATE TRIGGER research_withdrawals_immutable_delete
BEFORE DELETE ON research_withdrawals
BEGIN
    SELECT RAISE(ABORT, 'research withdrawals are immutable');
END;

CREATE TRIGGER research_reviews_immutable_update
BEFORE UPDATE ON research_reviews
BEGIN
    SELECT RAISE(ABORT, 'research reviews are immutable');
END;

CREATE TRIGGER research_reviews_immutable_delete
BEFORE DELETE ON research_reviews
BEGIN
    SELECT RAISE(ABORT, 'research reviews are immutable');
END;

CREATE TRIGGER research_reviews_closed_after_adoption
BEFORE INSERT ON research_reviews
WHEN EXISTS (
    SELECT 1
    FROM research_adoptions
    WHERE finding_id = NEW.finding_id
)
BEGIN
    SELECT RAISE(ABORT, 'review is closed after adoption');
END;

CREATE TRIGGER research_adoptions_immutable_update
BEFORE UPDATE ON research_adoptions
BEGIN
    SELECT RAISE(ABORT, 'research adoptions are immutable');
END;

CREATE TRIGGER research_adoptions_immutable_delete
BEFORE DELETE ON research_adoptions
BEGIN
    SELECT RAISE(ABORT, 'research adoptions are immutable');
END;

PRAGMA user_version = 8;

COMMIT;
