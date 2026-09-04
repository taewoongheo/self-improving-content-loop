import json
import mimetypes
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "db" / "hypothesis-loop.sqlite"
STATIC_ROOT = Path(__file__).resolve().parent


def _connect_read_only(db_path):
    uri = "file:{}?mode=ro".format(Path(db_path).resolve().as_posix())
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def load_tree(db_path=DEFAULT_DB_PATH):
    with _connect_read_only(db_path) as connection:
        hypotheses = [dict(row) for row in connection.execute(
            "SELECT * FROM hypotheses ORDER BY created_at, id"
        )]
        contents = [dict(row) for row in connection.execute(
            "SELECT * FROM contents ORDER BY id"
        )]
        results = [dict(row) for row in connection.execute(
            """
            SELECT id, content_id, target_hours, collected_at,
                   views, likes, comments, shares, saves,
                   observed_summary, interpretation, limitations,
                   collection_source
            FROM content_results
            ORDER BY content_id, target_hours
            """
        )]
        evidence = [dict(row) for row in connection.execute(
            """
            SELECT he.hypothesis_id, cr.id AS result_id, cr.content_id,
                   cr.target_hours, cr.observed_summary, cr.interpretation,
                   cr.limitations
            FROM hypothesis_evidence he
            JOIN content_results cr ON cr.id = he.content_result_id
            ORDER BY he.hypothesis_id, cr.content_id, cr.target_hours
            """
        )]

    results_by_content = {}
    for result in results:
        results_by_content.setdefault(result["content_id"], {})[
            str(result["target_hours"])
        ] = result

    contents_by_hypothesis = {}
    for content in contents:
        content["copy_snapshot"] = json.loads(content.pop("copy_snapshot_json"))
        content["checkpoints"] = {
            checkpoint: results_by_content.get(content["id"], {}).get(checkpoint)
            for checkpoint in ("24", "48", "72")
        }
        contents_by_hypothesis.setdefault(content["hypothesis_id"], []).append(content)

    evidence_by_hypothesis = {}
    for item in evidence:
        evidence_by_hypothesis.setdefault(item["hypothesis_id"], []).append(item)

    nodes = {}
    for hypothesis in hypotheses:
        node = {
            "id": hypothesis["id"],
            "parent_id": hypothesis["parent_hypothesis_id"],
            "axis": hypothesis["change_axis"],
            "statement": hypothesis["statement"],
            "decision_reason": hypothesis["decision_reason"],
            "last_evaluated_at": hypothesis["last_evaluated_at"],
            "created_at": hypothesis["created_at"],
            "closed_at": hypothesis["closed_at"],
            "closure_reason": hypothesis["closure_reason"],
            "contents": contents_by_hypothesis.get(hypothesis["id"], []),
            "evidence": evidence_by_hypothesis.get(hypothesis["id"], []),
            "children": [],
        }
        nodes[node["id"]] = node

    roots = []
    for node in nodes.values():
        parent = nodes.get(node["parent_id"])
        if parent is None:
            roots.append(node)
        else:
            parent["children"].append(node)

    def derive_state(node):
        if node["children"]:
            node["state"] = "branched"
        elif node["closed_at"]:
            node["state"] = "closed"
        else:
            node["state"] = "active"
        for child in node["children"]:
            derive_state(child)

    for root in roots:
        derive_state(root)

    return {
        "summary": {
            "hypotheses": len(hypotheses),
            "active_leaves": sum(
                1 for node in nodes.values() if node.get("state") == "active"
            ),
            "contents": len(contents),
            "published": sum(1 for content in contents if content["published_at"]),
        },
        "roots": roots,
    }


class ViewerHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/tree":
            try:
                payload = json.dumps(load_tree(), ensure_ascii=False).encode("utf-8")
            except (OSError, sqlite3.Error) as error:
                self._send_json({"error": str(error)}, 500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        relative_path = "index.html" if path == "/" else path.lstrip("/")
        file_path = (STATIC_ROOT / relative_path).resolve()
        if STATIC_ROOT not in file_path.parents and file_path != STATIC_ROOT:
            self.send_error(404)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        body = file_path.read_bytes()
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        self.send_error(405, "Viewer is read-only")

    def _send_json(self, data, status):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        print("[viewer] " + format % args)


def serve(host="127.0.0.1", port=4174):
    server = ThreadingHTTPServer((host, port), ViewerHandler)
    print("Hypothesis viewer: http://{}:{}".format(host, port))
    print("Database (read-only): {}".format(DEFAULT_DB_PATH))
    server.serve_forever()


if __name__ == "__main__":
    serve()
