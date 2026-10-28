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

## Goals and success measures

### Product goals

- **Quick and clear event recording:** Record arrival and departure events quickly, with a clear result for staff.
- **Guardian notifications:** Notify the correct guardians through their chosen, available channels.
- **Collector verification:** Verify that a collector is approved before a pupil is released.
- **Traceable audit history:** Preserve a traceable record of scans, edits, exceptions, and notification delivery.
- **Safe offline operation:** Continue operating safely when a card is missing or connectivity is temporarily unavailable.

### Initial success measures

- At least 98% of valid online scans are recorded successfully within 3 seconds (excluding notification-provider delay).
- At least 99% of accepted events are associated with the correct pupil in pilot audits.
- At least 95% of eligible notification attempts are accepted by the selected provider; delivery rates are reported separately by channel.
- 100% of pickup authorization changes and event corrections have an actor, timestamp, and reason.
- Staff can complete the documented missing-card and offline procedures during a school drill.

Targets should be confirmed against pilot conditions and provider capabilities before being treated as service commitments.

## Guardian onboarding

- School creates a pupil record and invites each guardian using a verified contact method.
- Guardian proves control of the contact channel and accepts the school's privacy notice and applicable consent/acknowledgment flow.
- Guardian sees only linked pupil(s), can set notification preferences, and can request corrections or contact the school.
- The school—not the guardian app—approves changes to legal guardian status and pickup permissions.

## Departure and pickup workflow

1. Staff scans the pupil's card, or searches by name if the card is unavailable.
2. The app displays the pupil and active approved pickup contacts.
3. Staff selects the person collecting the pupil and follows the school's configured identity check (for example, matching a photo or checking an approved ID document).
4. Staff confirms release. The system records the collector selected, verification method, staff member, device, location/campus, and timestamp.
5. Guardians receive a departure alert including the collector's display name when the school has configured that disclosure.
6. If the collector is not approved, staff sees a clear block/escalation instruction. A school administrator can authorize an exception only with a reason and a preserved audit entry.

## Attendance events

- **Event types:** arrival, departure, manual arrival, manual departure, correction, and authorized exception.
- **Timestamps:** Store event timestamp in UTC and render in the campus timezone; retain server receipt time and device capture time where offline capture is supported.
- **Event attributes:** Record staff actor, device, campus/gate, pupil, event type, source (scan/search/offline), collector and verification method for departures, and correction reason where relevant.
- **Non-destructive corrections:** Preserve the original event when corrected; corrections create a linked event and are not destructive edits.
- **Operating safeguards:** Allow configurable operating sessions and prevent accidental arrival/departure mode errors with confirmation prompts.

## Offline or delayed sync

- If the device loses connectivity, the app may queue a signed event locally only if the device is managed and encrypted.
- The event must display Pending sync and must not claim that parents have been notified.
- Queue records are encrypted at rest, bound to the staff account/device, expire under a defined policy, and sync idempotently to prevent duplicates.
- Staff follows the school's paper/voice fallback procedure if the app cannot safely record an event. On reconnection, staff reconciles the manual log with an audit reason.
- Offline mode must not permit stale pickup permissions to be treated as current without an explicit school policy and visible warning.

## Dashboards and reports

- **Live views:** expected pupils, arrived, departed, not yet arrived, still on site, and exceptions.
- **Search and filter:** Search/filter by campus, class, date/session, pupil, event type, and status, based on role.
- **Exports:** Export attendance reports with role checks and audit logging.
- **Status indicators:** Show notification outcome and manual/offline indicators.
- **Daily reconciliation:** Provide daily reconciliation covering pupil event timeline, missing arrival/departure patterns, duplicate scan attempts, and unresolved exceptions.

## System and non-functional requirements

- **Availability:** Define a pilot service objective; target 99.5% monthly availability after the pilot, excluding planned maintenance and third-party provider outages, with clear degraded-mode procedures.
- **Performance:** Online scan lookup and event confirmation should complete within 3 seconds at the 95th percentile under expected school load.
- **Security:** Encrypt traffic in transit and sensitive data at rest; use managed secrets, least privilege, short-lived sessions, secure backups, dependency updates, and security logging that excludes unnecessary pupil data.
- **Privacy:** Minimize data, limit access by role/campus, support retention and deletion policies, and document every data recipient and processor.
- **Accessibility:** Support readable contrast, large tap targets, screen readers for guardian-facing views, and plain-language error messages.
- **Reliability:** Idempotent event writes, durable queues, backup/restore procedures, monitored notification-provider integrations, and reconciliation tools.
- **Compatibility:** Define minimum supported Android/iOS versions after selecting the implementation stack and validating school devices.
- **Localization:** Store timestamps in UTC, display local campus time, and plan for language, date, and phone-number formats required by launch locations.

## Data model (initial)

- **School:** name, policy settings, timezone, notification configuration
- **Campus:** school, name, address/reference, timezone override, gates
- **Pupil:** school ID, name, photo reference, class, campus, status
- **Guardian:** name, verified contacts, account status, preferences
- **PupilGuardian:** pupil, guardian, relationship, status, authority metadata
- **PickupContact:** pupil, name, relationship, verification data/reference, effective dates, status
- **Card:** pupil, random token hash/reference, issue/revoke timestamps, status
- **StaffUser:** identity, role, assigned campus, status, authentication metadata
- **Device:** managed device identifier, assigned staff/campus, last seen, status
- **AttendanceEvent:** pupil, type, timestamps, actor, device, campus, source, collector, verification method, correction link, reason
- **Notification:** event, guardian, channel, provider reference, status, timestamps, failure category
- **AuditEntry:** actor, action, object, timestamp, reason, before/after references as appropriate

## MVP scope and exclusions

### Include in MVP

- One school or a small pilot group, one or more campuses
- Staff sign-in and role permissions
- Pupil, guardian, class, and pickup-contact management
- PVC card QR generation, revocation, and scan flow
- Arrival/departure events and manual-card exception flow
- Push notifications plus one SMS provider, if available in the launch market
- Guardian pupil timeline and channel preferences
- Live dashboard, daily report, audit history, and basic exception handling
- Privacy notice, support process, backups, monitoring, and staff training materials

## Files

- `server.py` — API and static file server
- `app-data/gatewise.sqlite3` — included demo database; generated if absent
- `Start-Gatewise.ps1` — starts the server and opens the browser
- `index.html`, `styles.css`, `app.js` — web interface
- `pupil-import-template.csv` and `pupil-import-template.xlsx` — roster templates
