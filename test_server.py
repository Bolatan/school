import unittest
import os
import tempfile
import json
import io
import base64
import sqlite3
import urllib.request
import urllib.error
import http.cookiejar
from pathlib import Path
import threading
import time

# Set up environment variables for testing before importing server
temp_dir = tempfile.TemporaryDirectory()
os.environ["GATEWISE_DATA_DIR"] = temp_dir.name
os.environ["GATEWISE_DB_PATH"] = str(Path(temp_dir.name) / "test_gatewise.sqlite3")
os.environ["GATEWISE_PORT"] = "8888"

import server

class ServerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init_db()
        cls.httpd = server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()
        cls.base_url = f"http://{server.HOST}:{server.PORT}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        temp_dir.cleanup()

    def make_request(self, path, method="GET", data=None, cookies_dict=None):
        url = self.base_url + path
        headers = {}
        if cookies_dict:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies_dict.items())
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            body = None

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as response:
                res_body = response.read().decode("utf-8")
                res_cookies = {}
                set_cookie_headers = response.headers.get_all("Set-Cookie") or []
                for header in set_cookie_headers:
                    morsel = header.split(";")[0]
                    if "=" in morsel:
                        k, v = morsel.split("=", 1)
                        res_cookies[k.strip()] = v.strip()
                return response.status, json.loads(res_body) if res_body else {}, res_cookies
        except urllib.error.HTTPError as e:
            res_body = e.read().decode("utf-8")
            try:
                err_data = json.loads(res_body)
            except Exception:
                err_data = {"error": res_body}
            return e.code, err_data, {}

    def login(self, email=server.DEMO_EMAIL, password=server.DEMO_PASSWORD):
        status, data, res_cookies = self.make_request("/api/login", method="POST", data={
            "email": email,
            "password": password
        })
        self.assertEqual(status, 200)
        return res_cookies.get("gw_session")

    def test_login_success_and_logout(self):
        session_token = self.login()
        self.assertIsNotNone(session_token)

        # Test GET /api/me with cookie
        status, data, _ = self.make_request("/api/me", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 200)
        self.assertEqual(data["user"]["email"], server.DEMO_EMAIL)

        # Logout
        status, logout_data, res_cookies = self.make_request("/api/logout", method="POST", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 200)

        # Test GET /api/me after logout
        status, data, _ = self.make_request("/api/me", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 200)
        self.assertIsNone(data["user"])

    def test_login_failure(self):
        status, data, _ = self.make_request("/api/login", method="POST", data={
            "email": server.DEMO_EMAIL,
            "password": "WrongPassword!"
        })
        self.assertEqual(status, 401)
        self.assertIn("error", data)

    def test_get_state_unauthorized(self):
        status, data, _ = self.make_request("/api/state")
        self.assertEqual(status, 401)

    def test_get_state_authorized(self):
        session_token = self.login()
        status, data, _ = self.make_request("/api/state", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 200)
        self.assertIn("pupils", data)
        self.assertIn("events", data)
        self.assertIn("requests", data)

    def test_create_pupil_and_events(self):
        session_token = self.login()
        # Create a new pupil
        status, data, _ = self.make_request("/api/pupils", method="POST", cookies_dict={"gw_session": session_token}, data={
            "name": "Test Child",
            "id": "NF-9999",
            "className": "Grade 3A",
            "guardian": "Test Parent"
        })
        self.assertEqual(status, 201)
        self.assertTrue(data["ok"])

        # Record arrival
        status, data, _ = self.make_request("/api/events", method="POST", cookies_dict={"gw_session": session_token}, data={
            "pupilId": "NF-9999",
            "type": "arrival",
            "source": "Card scan"
        })
        self.assertEqual(status, 201)

        # Record duplicate arrival today (should fail)
        status, data, _ = self.make_request("/api/events", method="POST", cookies_dict={"gw_session": session_token}, data={
            "pupilId": "NF-9999",
            "type": "arrival",
            "source": "Card scan"
        })
        self.assertEqual(status, 400)
        self.assertIn("already has an arrival recorded today", data["error"])

    def test_roster_import_preview_and_commit(self):
        session_token = self.login()
        csv_content = "pupil_id,pupil_name,class_name,guardian_name\nNF-8001,Alice Smith,Grade 1A,Bob Smith\nNF-8002,Charlie Brown,Grade 1A,Snoopy\n"
        b64_content = base64.b64encode(csv_content.encode("utf-8")).decode("utf-8")

        # Preview
        status, data, _ = self.make_request("/api/import/preview", method="POST", cookies_dict={"gw_session": session_token}, data={
            "filename": "roster.csv",
            "fileBase64": b64_content
        })
        self.assertEqual(status, 200)
        self.assertEqual(data["validCount"], 2)
        token = data["token"]
        self.assertIsNotNone(token)

        # Commit
        status, data, _ = self.make_request("/api/import/commit", method="POST", cookies_dict={"gw_session": session_token}, data={
            "token": token
        })
        self.assertEqual(status, 201)
        self.assertEqual(data["imported"], 2)

    def test_pickup_approval(self):
        session_token = self.login()
        # Resolve request r1
        status, data, _ = self.make_request("/api/pickup/r1", method="POST", cookies_dict={"gw_session": session_token}, data={
            "action": "approve",
            "validUntil": "2030-12-31"
        })
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_user_management(self):
        session_token = self.login()
        # Create user
        status, data, _ = self.make_request("/api/users", method="POST", cookies_dict={"gw_session": session_token}, data={
            "name": "Manager User",
            "email": "manager@northfield.school",
            "role": "manager",
            "password": "Password12345!"
        })
        self.assertEqual(status, 201)

        # Find manager ID
        users = data["users"]
        mgr = next(u for u in users if u["email"] == "manager@northfield.school")

        # Update role
        status, data, _ = self.make_request(f"/api/users/{mgr['id']}", method="POST", cookies_dict={"gw_session": session_token}, data={
            "role": "viewer",
            "active": True
        })
        self.assertEqual(status, 200)

    def test_manual_entry_reasons_and_departure_collector(self):
        session_token = self.login()
        # Create pupil
        status, data, _ = self.make_request("/api/pupils", method="POST", cookies_dict={"gw_session": session_token}, data={
            "name": "Manual Pupil",
            "id": "NF-7777",
            "className": "Grade 2B",
            "guardian": "Manual Guardian"
        })
        self.assertEqual(status, 201)

        # Record manual arrival due to card_missing
        status, data, _ = self.make_request("/api/events", method="POST", cookies_dict={"gw_session": session_token}, data={
            "pupilId": "NF-7777",
            "type": "arrival",
            "source": "Manual entry",
            "reason": "card_missing"
        })
        self.assertEqual(status, 201)
        event = next(e for e in data["state"]["events"] if e["id"] == data["eventId"])
        self.assertTrue(event["manualEntry"])
        self.assertEqual(event["reason"], "card_missing")

        # Attempt departure without collector (should fail)
        status, data, _ = self.make_request("/api/events", method="POST", cookies_dict={"gw_session": session_token}, data={
            "pupilId": "NF-7777",
            "type": "departure",
            "source": "Manual entry",
            "reason": "card_unreadable"
        })
        self.assertEqual(status, 400)
        self.assertIn("Select an approved collector", data["error"])

        # Add approved collector
        with server.db() as c:
            c.execute("INSERT INTO collectors(pupil_id, name, relation) VALUES(?,?,?)", ("NF-7777", "Manual Guardian", "Mother"))
            cid = c.execute("SELECT id FROM collectors WHERE pupil_id='NF-7777'").fetchone()["id"]

        # Record manual departure with approved collector
        status, data, _ = self.make_request("/api/events", method="POST", cookies_dict={"gw_session": session_token}, data={
            "pupilId": "NF-7777",
            "type": "departure",
            "source": "Manual entry",
            "reason": "card_unreadable",
            "collectorId": cid,
            "verification": "Photo matched"
        })
        self.assertEqual(status, 201)
        event = next(e for e in data["state"]["events"] if e["id"] == data["eventId"])
        self.assertTrue(event["manualEntry"])
        self.assertEqual(event["reason"], "card_unreadable")
        self.assertEqual(event["collector"], "Manual Guardian")

    def test_trailing_slash_and_static_template_and_activity_export(self):
        session_token = self.login()
        # Test GET /api/state/ with trailing slash
        status, data, _ = self.make_request("/api/state/", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 200)
        self.assertIn("pupils", data)

        # Test POST /api/login/ with trailing slash
        status, data, _ = self.make_request("/api/login/", method="POST", data={
            "email": server.DEMO_EMAIL,
            "password": server.DEMO_PASSWORD
        })
        self.assertEqual(status, 200)

        # Test static template file serving
        url = self.base_url + "/pupil-import-template.csv"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode("utf-8")
            self.assertIn("pupil_id,pupil_name,class_name,guardian_name", content)

        # Test POST /api/export/activity
        status, data, _ = self.make_request("/api/export/activity", method="POST", cookies_dict={"gw_session": session_token}, data={})
        self.assertEqual(status, 200)
        self.assertTrue(data.get("ok"))

        # Test unknown /api/ route returns JSON 404
        status, data, _ = self.make_request("/api/unknown_endpoint", cookies_dict={"gw_session": session_token})
        self.assertEqual(status, 404)
        self.assertEqual(data.get("error"), "Endpoint not found.")

if __name__ == "__main__":
    unittest.main()
