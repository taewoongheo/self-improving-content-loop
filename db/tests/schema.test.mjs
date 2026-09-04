import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const schemaPath = path.join(repoRoot, "db/schema.sql");

async function withDatabase(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-schema-test-"));
  const databasePath = path.join(directory, "test.sqlite");

  try {
    const applied = spawnSync("sqlite3", [databasePath], {
      input: readFileSync(schemaPath, "utf8"),
      encoding: "utf8",
    });
    assert.equal(applied.status, 0, applied.stderr);
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function query(databasePath, sql) {
  return execFileSync("sqlite3", ["-json", databasePath, sql], {
    encoding: "utf8",
  });
}

function insertContent(
  databasePath,
  copywritingVersion,
  messageVersion = "1",
  formatId = "example-format",
  medium = "slideshow",
  copySnapshotJson = '{"slides":[["hook"]]}',
  finalProjectPath,
  contentId,
) {
  const suffix = `${copywritingVersion}-${messageVersion}`.replace(
    /[^a-z0-9]/gi,
    "-",
  );
  const id = contentId ?? `c-${suffix}`;
  const projectPath = finalProjectPath
    ?? `renderer/${medium}/formats/${formatId}/contents/${id}.json`;

  return spawnSync("sqlite3", [databasePath], {
    input: `
      INSERT INTO contents (
        id,
        hypothesis_id,
        medium,
        format_id,
        message_id,
        message_version,
        copywriting_version,
        caption,
        copy_snapshot_json,
        final_project_path,
        final_project_sha256
      ) VALUES (
        '${id}',
        'h-1',
        '${medium}',
        '${formatId}',
        'msg-example',
        ${messageVersion},
        ${copywritingVersion},
        'caption',
        '${copySnapshotJson.replaceAll("'", "''")}',
        '${projectPath}',
        '${"b".repeat(64)}'
      );
    `,
    encoding: "utf8",
  });
}

function insertResult(databasePath, collectionSource) {
  return spawnSync("sqlite3", [databasePath], {
    input: `
      INSERT INTO content_results (
        content_id,
        target_hours,
        collected_at,
        collection_source
      ) VALUES (
        'c-1-1',
        24,
        '2026-07-18T00:00:00Z',
        ${collectionSource}
      );
    `,
    encoding: "utf8",
  });
}

test("hypotheses require a concise immutable decision reason", async () => {
  await withDatabase(async (databasePath) => {
    const columns = JSON.parse(query(databasePath, "PRAGMA table_info(hypotheses);"));
    const decisionReason = columns.find((column) => column.name === "decision_reason");

    assert.ok(decisionReason);
    assert.equal(decisionReason.notnull, 1);

    for (const reason of ["NULL", "''", "'   '", `'${"x".repeat(201)}'`]) {
      const inserted = spawnSync("sqlite3", [databasePath], {
        input: `
          INSERT INTO hypotheses (id, statement, decision_reason)
          VALUES ('h-invalid', 'root', ${reason});
        `,
        encoding: "utf8",
      });
      assert.notEqual(inserted.status, 0, `accepted ${reason}`);
      assert.match(inserted.stderr, /(NOT NULL|CHECK) constraint failed/);
    }

    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Selected to test the current bottleneck.');
    `]);

    const rewritten = spawnSync("sqlite3", [databasePath], {
      input: `
        UPDATE hypotheses
        SET decision_reason = 'A later explanation.'
        WHERE id = 'h-1';
      `,
      encoding: "utf8",
    });
    assert.notEqual(rewritten.status, 0);
    assert.match(rewritten.stderr, /decision reason cannot change/);
  });
});

test("contents records medium-scoped format, strategy versions, copy, and project identity", async () => {
  await withDatabase(async (databasePath) => {
    const columns = JSON.parse(query(databasePath, "PRAGMA table_info(contents);"));
    const copywritingVersion = columns.find(
      (column) => column.name === "copywriting_version",
    );
    const formatId = columns.find((column) => column.name === "format_id");
    const medium = columns.find((column) => column.name === "medium");
    const copySnapshotJson = columns.find(
      (column) => column.name === "copy_snapshot_json",
    );

    assert.ok(copywritingVersion);
    assert.equal(copywritingVersion.notnull, 1);
    assert.ok(formatId);
    assert.equal(formatId.notnull, 1);
    assert.ok(medium);
    assert.equal(medium.notnull, 1);
    assert.ok(copySnapshotJson);
    assert.equal(copySnapshotJson.notnull, 1);
    assert.equal(columns.some((column) => column.name === "slide_copy_json"), false);

    for (const removedColumn of ["imagery_version", "template_path", "template_sha256"]) {
      assert.equal(columns.some((column) => column.name === removedColumn), false);
    }
  });
});

test("contents rejects unsafe format IDs", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const formatId of ["", "Example", "../example", "example/reference", "example space"]) {
      const inserted = insertContent(databasePath, "1", "1", formatId);
      assert.notEqual(inserted.status, 0, `accepted ${formatId}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("contents rejects IDs that are unsafe as direct project filenames", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const [version, contentId] of [
      ["1", ""],
      ["2", "../outside"],
      ["3", "nested/id"],
      ["4", "id\\file"],
      ["5", "id.json"],
      ["6", "space id"],
    ]) {
      const inserted = insertContent(
        databasePath,
        version,
        "1",
        "example-format",
        "slideshow",
        '{"slides":[["hook"]]}',
        undefined,
        contentId,
      );
      assert.notEqual(inserted.status, 0, `accepted ${JSON.stringify(contentId)}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("contents accepts only slideshow and video media", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const medium of ["", "photo", "Video", "../video"]) {
      const inserted = insertContent(
        databasePath,
        "1",
        "1",
        "example-format",
        medium,
      );
      assert.notEqual(inserted.status, 0, `accepted ${medium}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("contents requires the project path to match medium and format", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const [version, finalProjectPath] of [
      ["1", "renderer/video/formats/example-format/contents/c-1-1.json"],
      ["2", "renderer/slideshow/formats/other-format/contents/c-2-1.json"],
      ["3", "renderer/slideshow/contents/c-3-1.json"],
      ["4", "renderer/slideshow/formats/example-format/contents/nested/c-4-1.json"],
      ["5", "renderer/slideshow/formats/example-format/contents/../../c-5-1.json"],
      ["6", "renderer/slideshow/formats/example-format/contents/c-6-1\\outside.json"],
    ]) {
      const inserted = insertContent(
        databasePath,
        version,
        "1",
        "example-format",
        "slideshow",
        '{"slides":[["hook"]]}',
        finalProjectPath,
      );
      assert.notEqual(inserted.status, 0, `accepted ${finalProjectPath}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("contents accepts positive integer strategy versions", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    const inserted = insertContent(databasePath, "1", "1");

    assert.equal(inserted.status, 0, inserted.stderr);
  });
});

test("slideshow contents require ordered non-empty text arrays for every slide", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const copySnapshotJson of [
      "{}",
      '{"slides":[]}',
      '{"slides":["hook"]}',
      '{"slides":[[1]]}',
      '{"slides":[[]]}',
      '{"slides":[[""]]}',
      '{"slides":[["   "]]}',
      '{"slides":[["hook"]],"spoken_text":[]}',
      '{"slides":[["first"]],"slides":[["second"]]}',
    ]) {
      const inserted = insertContent(
        databasePath,
        "1",
        "1",
        "example-format",
        "slideshow",
        copySnapshotJson,
      );
      assert.notEqual(inserted.status, 0, `accepted ${copySnapshotJson}`);
      assert.match(inserted.stderr, /copy_snapshot_json/);
    }
  });
});

test("video contents preserve exact on-screen and spoken copy without requiring either channel", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const [version, copySnapshotJson] of [
      ["1", '{"on_screen_text":[],"spoken_text":[]}'],
      ["2", '{"on_screen_text":["overlay"],"spoken_text":[]}'],
      ["3", '{"on_screen_text":[],"spoken_text":["voiceover"]}'],
      ["4", '{"on_screen_text":["overlay"],"spoken_text":["voiceover"]}'],
    ]) {
      const inserted = insertContent(
        databasePath,
        version,
        "1",
        "example-format",
        "video",
        copySnapshotJson,
      );
      assert.equal(inserted.status, 0, inserted.stderr);
    }

    for (const copySnapshotJson of [
      "{}",
      '{"on_screen_text":[],"spoken_text":"voiceover"}',
      '{"on_screen_text":[1],"spoken_text":[]}',
      '{"on_screen_text":[""],"spoken_text":[]}',
      '{"on_screen_text":["   "],"spoken_text":[]}',
      '{"on_screen_text":[],"spoken_text":[1]}',
      '{"on_screen_text":[],"spoken_text":[""]}',
      '{"on_screen_text":[],"spoken_text":[],"slides":[]}',
      '{"on_screen_text":[],"on_screen_text":["overlay"],"spoken_text":[]}',
      '{"on_screen_text":[],"spoken_text":[],"spoken_text":["voiceover"]}',
    ]) {
      const inserted = insertContent(
        databasePath,
        "5",
        "1",
        "example-format",
        "video",
        copySnapshotJson,
      );
      assert.notEqual(inserted.status, 0, `accepted ${copySnapshotJson}`);
      assert.match(inserted.stderr, /copy_snapshot_json/);
    }
  });
});

test("content medium updates require an atomically matching copy snapshot and project path", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);
    assert.equal(insertContent(databasePath, "1").status, 0);

    const invalidTransition = spawnSync("sqlite3", [databasePath], {
      input: `
        UPDATE contents
        SET medium = 'video'
        WHERE id = 'c-1-1';
      `,
      encoding: "utf8",
    });
    assert.notEqual(invalidTransition.status, 0);

    execFileSync("sqlite3", [databasePath, `
      UPDATE contents
      SET medium = 'video',
          copy_snapshot_json = '{"on_screen_text":[],"spoken_text":[]}',
          final_project_path = 'renderer/video/formats/example-format/contents/c-1-1.json'
      WHERE id = 'c-1-1';
    `]);

    const duplicateKeyUpdate = spawnSync("sqlite3", [databasePath], {
      input: `
        UPDATE contents
        SET copy_snapshot_json = '{"on_screen_text":[],"spoken_text":[],"spoken_text":["voiceover"]}'
        WHERE id = 'c-1-1';
      `,
      encoding: "utf8",
    });
    assert.notEqual(duplicateKeyUpdate.status, 0);
    assert.match(duplicateKeyUpdate.stderr, /copy_snapshot_json/);

    execFileSync("sqlite3", [databasePath, `
      UPDATE contents
      SET medium = 'slideshow',
          copy_snapshot_json = '{"slides":[["hook"]]}',
          final_project_path = 'renderer/slideshow/formats/example-format/contents/c-1-1.json'
      WHERE id = 'c-1-1';
    `]);
  });
});

test("closed hypotheses cannot be reopened", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
      UPDATE hypotheses
      SET closed_at = '2026-07-18T00:00:00Z', closure_reason = 'closed'
      WHERE id = 'h-1';
    `]);

    const reopened = spawnSync("sqlite3", [databasePath], {
      input: `
        UPDATE hypotheses
        SET closed_at = NULL, closure_reason = NULL
        WHERE id = 'h-1';
      `,
      encoding: "utf8",
    });
    assert.notEqual(reopened.status, 0);
    assert.match(reopened.stderr, /closed hypothesis cannot be reopened/);
  });
});

test("content results require normalized collection provenance", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);
    const content = insertContent(databasePath, "1", "1");
    assert.equal(content.status, 0, content.stderr);

    const columns = JSON.parse(query(databasePath, "PRAGMA table_info(content_results);"));
    const collectionSource = columns.find((column) => column.name === "collection_source");
    assert.ok(collectionSource);
    assert.equal(collectionSource.notnull, 1);

    for (const source of ["NULL", "''", "'   '"]) {
      const inserted = insertResult(databasePath, source);
      assert.notEqual(inserted.status, 0, `accepted ${source}`);
      assert.match(inserted.stderr, /(NOT NULL|CHECK) constraint failed/);
    }

    const inserted = insertResult(databasePath, "'TikWM public API'");
    assert.equal(inserted.status, 0, inserted.stderr);
  });
});

test("contents rejects invalid copywriting versions", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const version of ["0", "-1", "1.5", "'1'", "'1.0'", "'abc'"]) {
      const inserted = insertContent(databasePath, version);
      assert.notEqual(inserted.status, 0, `accepted ${version}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("contents rejects invalid message versions", async () => {
  await withDatabase(async (databasePath) => {
    execFileSync("sqlite3", [databasePath, `
      INSERT INTO hypotheses (id, statement, decision_reason)
      VALUES ('h-1', 'root', 'Test fixture.');
    `]);

    for (const version of ["0", "-1", "1.5", "'1'", "'1.0'", "'abc'"]) {
      const inserted = insertContent(databasePath, "1", version);
      assert.notEqual(inserted.status, 0, `accepted ${version}`);
      assert.match(inserted.stderr, /CHECK constraint failed/);
    }
  });
});

test("schema version identifies the current structure", async () => {
  await withDatabase(async (databasePath) => {
    const version = query(databasePath, "PRAGMA user_version;").trim();
    assert.equal(version, '[{"user_version":17}]');
  });
});
