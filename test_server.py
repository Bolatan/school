import unittest
import os
import json
import tempfile
import server

class TestGatewiseServer(unittest.TestCase):
    def setUp(self):
        self.temp_db_fd, self.temp_db_path = tempfile.mkstemp()
        server.DB_PATH = server.Path(self.temp_db_path)
        server.init_db()

    def tearDown(self):
        os.close(self.temp_db_fd)
        if os.path.exists(self.temp_db_path):
            os.remove(self.temp_db_path)

    def test_database_initialization_and_seed(self):
        with server.db() as c:
            users = c.execute("SELECT * FROM users").fetchall()
            self.assertGreaterEqual(len(users), 1)
            pupils = c.execute("SELECT * FROM pupils").fetchall()
            self.assertEqual(len(pupils), 10)
            collectors = c.execute("SELECT * FROM collectors").fetchall()
            self.assertGreaterEqual(len(collectors), 10)
            events = c.execute("SELECT * FROM events").fetchall()
            self.assertEqual(len(events), 4)

    def test_password_hash_and_verification(self):
        salt, digest = server.password_hash("TestPassword!123")
        self.assertEqual(len(salt), 16)
        salt2, digest2 = server.password_hash("TestPassword!123", salt)
        self.assertEqual(digest, digest2)

    def test_pupil_json_structure(self):
        with server.db() as c:
            p = c.execute("SELECT * FROM pupils WHERE id='NF-1042'").fetchone()
            p_json = server.pupil_json(c, p)
            self.assertEqual(p_json["id"], "NF-1042")
            self.assertEqual(p_json["name"], "Zara Adeyemi")
            self.assertIn("guardianPhone", p_json)
            self.assertIn("preferredChannel", p_json)
            self.assertGreaterEqual(len(p_json["collectors"]), 2)

    def test_state_json_includes_notifications_and_audit(self):
        with server.db() as c:
            state = server.state_json(c)
            self.assertIn("pupils", state)
            self.assertIn("events", state)
            self.assertIn("requests", state)
            self.assertIn("notificationsList", state)
            self.assertIn("auditLogs", state)

    def test_event_creation_and_notification(self):
        user = {"id": 1, "name": "Amara Okafor", "role": "admin"}
        body = {"pupilId": "NF-1204", "type": "arrival", "source": "Card scan"}

        handler = server.Handler.__new__(server.Handler)
        handler.send_json = lambda status, data, extra_headers=None: (status, data)
        status, data = handler.create_event(user, body)
        self.assertEqual(status, 201)
        self.assertTrue(data["ok"])

        # Check notification logged
        with server.db() as c:
            notifs = c.execute("SELECT * FROM notifications WHERE pupil_id='NF-1204'").fetchall()
            self.assertGreaterEqual(len(notifs), 1)

    def test_batch_events_sync(self):
        user = {"id": 1, "name": "Amara Okafor", "role": "admin"}
        body = {
            "events": [
                {"pupilId": "NF-1228", "type": "arrival", "source": "Offline QR"},
                {"pupilId": "NF-1261", "type": "arrival", "source": "Offline QR"}
            ]
        }

        handler = server.Handler.__new__(server.Handler)
        handler.send_json = lambda status, data, extra_headers=None: (status, data)
        status, data = handler.create_events_batch(user, body)
        self.assertEqual(status, 200)
        self.assertEqual(data["synced"], 2)

    def test_update_pupil_contacts(self):
        user = {"id": 1, "name": "Amara Okafor", "role": "admin"}
        body = {
            "id": "NF-1042",
            "guardianPhone": "+1 555-9999",
            "guardianEmail": "newemail@example.com",
            "preferredChannel": "whatsapp"
        }
        handler = server.Handler.__new__(server.Handler)
        handler.send_json = lambda status, data, extra_headers=None: (status, data)
        status, data = handler.update_pupil(user, body)
        self.assertEqual(status, 200)

        with server.db() as c:
            p = c.execute("SELECT * FROM pupils WHERE id='NF-1042'").fetchone()
            self.assertEqual(p["guardian_phone"], "+1 555-9999")
            self.assertEqual(p["preferred_channel"], "whatsapp")

if __name__ == "__main__":
    unittest.main()
