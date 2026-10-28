# Gatewise local MVP

Gatewise is a locally runnable school arrival and dismissal demo with a Python standard-library server, SQLite database, staff sign-in, roster import, and role-based staff accounts. No package installation is required; Windows needs Python 3.

## Start the app on Windows

1. Extract the ZIP to a writable folder.
2. Run `Start-Gatewise.ps1` (or from PowerShell: `powershell -ExecutionPolicy Bypass -File .\Start-Gatewise.ps1`).
3. Open `http://127.0.0.1:8080` if it does not open automatically.
4. Sign in with the demo administrator:
   - Email: `admin@northfield.school`
   - Password: `GatewiseDemo!26`

The first start creates `app-data/gatewise.sqlite3`. This ZIP includes a demo database with fictional sample data and a demo admin account. The database persists. To reset the demo, stop the server and remove the database file; it will be recreated at next start. Keep a backup before replacing or editing a database.

## Uploading pupils

From **Pupils**, choose **Upload roster** and select a `.csv` or `.xlsx` file. The CSV template is `pupil-import-template.csv`; the Excel template is `pupil-import-template.xlsx` (use its **Pupils** sheet). The required headers are exactly:

`pupil_id,pupil_name,class_name,guardian_name`

Use one pupil per row. IDs must be unique, and every field is required. Upload first displays a preview. The import is all-or-nothing: any invalid or duplicate row blocks the commit. Maximum file size is 8 MB and maximum roster size is 5,000 pupils. Existing pupil IDs are rejected. XLSX files must contain a sheet named `Pupils` and are parsed with Python's built-in ZIP/XML libraries.

## Users and roles

| Role | Main responsibilities | Access boundaries |
|---|---|---|
| Parent/guardian | View linked pupils, receive event alerts, manage own contact preferences, request record correction | Only linked pupils; cannot edit school attendance or pickup approvals directly |
| Authorized collector | May collect a pupil when approved by a guardian/school | No general app account required in MVP; identity checked by staff against school policy |
| Gate/attendance staff | Scan cards, record events, verify collector, resolve basic exceptions | Assigned campus and operational actions only |
| Teacher | View relevant class attendance and report exceptions | Class-level access as configured; no unnecessary contact details |
| School administrator | Manage pupils, guardians, pickup permissions, staff, devices, reports | Campus scope; sensitive changes are audited |
| Platform support | Diagnose service issues | Time-limited, logged, least-privilege access; no routine browsing of pupil records |

## Staff accounts and roles

Only an **Admin** can open **User management**, create accounts, change roles, or disable/enable accounts. An administrator sets a temporary initial password of at least 12 characters and shares it privately. Password reset is not implemented in this MVP.

| Role | Access |
| --- | --- |
| Admin | View records, operate gates, manage pupils and roster imports, manage staff accounts and roles |
| Manager | View records, operate gates, manage pupils and roster imports, handle pickup approvals |
| View only | View dashboard, pupils, pickup records, and activity; cannot record events, edit pupils, approve pickups, import rosters, or manage accounts |

These permissions are enforced by the server as well as reflected in the interface. Disable an account to prevent future sign-ins; existing sessions are revoked when a user’s role or status changes.

## Included features

- Staff login with salted PBKDF2 password hashes and server-side sessions
- SQLite records for pupils, guardians/collectors, pickup requests, attendance, sessions, and admin audit history
- Card scanning where supported, plus manual pupil ID lookup
- Arrival/departure events with approved pickup collector selection
- Activity history and CSV export
- CSV/XLSX roster preview, validation, duplicate detection, and atomic import
- Admin-managed staff users with Admin, Manager, and View only roles

## Local MVP security and limitations

This is a development MVP and is not ready for real school operations. It binds to `127.0.0.1`; notifications are not sent. SMS, push, and WhatsApp require provider configuration, guardian opt-in, delivery retries, and receipts. The QR demo reference currently uses pupil IDs and must be replaced by random, revocable tokens before use with real children. Guardian accounts, verified guardian-to-pupil linking, MFA, HTTPS deployment, production monitoring, encrypted backups, and formal privacy/security review are not included.

Do not enter real pupil or guardian data or rely on this app for actual child handover. Before a pilot, complete security and privacy review, configure secure hosting, verify guardian identity/relationships, set retention and backup policies, and rehearse offline and emergency procedures.

## Initial success measures

- At least 98% of valid online scans are recorded successfully within 3 seconds (excluding notification-provider delay).
- At least 99% of accepted events are associated with the correct pupil in pilot audits.
- At least 95% of eligible notification attempts are accepted by the selected provider; delivery rates are reported separately by channel.
- 100% of pickup authorization changes and event corrections have an actor, timestamp, and reason.
- Staff can complete the documented missing-card and offline procedures during a school drill.

Targets should be confirmed against pilot conditions and provider capabilities before being treated as service commitments.

## Files

- `server.py` — API and static file server
- `app-data/gatewise.sqlite3` — included demo database; generated if absent
- `Start-Gatewise.ps1` — starts the server and opens the browser
- `index.html`, `styles.css`, `app.js` — web interface
- `pupil-import-template.csv` and `pupil-import-template.xlsx` — roster templates
