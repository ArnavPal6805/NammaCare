# NammaCare — Project README

This document summarizes the NammaCare project state (sprints, completed/remaining tasks), technologies, database design, file-by-file responsibilities, core implementation logic, and instructions to run the project locally.

---

**Project Overview**:
- NammaCare is a lightweight senior-guardian system providing: Emergency SOS, Help Requests, Volunteer tasking, Caretaker monitoring, Medicine reminders, Appointments, Health tracking, Document storage and a simple Admin console.
- UI: static HTML/CSS + `app.js` for frontend logic. Backend: Flask (`app.py`) using an Excel file (`NammaCareData.xlsx`) as the datastore.

**Sprint Summaries**
- **Sprint-1 (MVP)** — Completed: login/register, profile management, SOS flow, help request creation, volunteer accept/reject/complete, caretaker dashboard and monitoring. (See `sprint_1_2_status.txt`.)
- **Sprint-2** — Completed: medicine reminders, appointments, notifications, emergency contacts (CRUD), notification generation & badge, basic volunteer rewards. (See `sprint_1_2_status.txt`.)
- **Sprint-3** — Completed: health logs & charts, daily check-in system (alert caretakers), document mock upload & storage, volunteer XP/rewards, admin dashboard for approvals and analytics. (See `sprint_3_status.txt`.)

**Completed / Remaining (high level)**
- Completed: core flows above; frontend interactivity and local+backend DB sync; admin approval flows; notification & reminder logic.
- Remaining / Known limitations:
  - No secure password storage (plain text in Excel). Consider hashing (bcrypt).
  - Excel-based backend has concurrency and scaling limitations.
  - No authentication tokens/session JWTs — session is stored in browser `sessionStorage`.
  - File upload in documents is simulated (no real file storage).
  - Service Worker exists but is unregistered/disabled in `app.js` (PWA functionality limited).

---

**Technologies Used**
- Frontend: HTML, CSS (`styles.css`), vanilla JavaScript (`app.js`). Uses Chart.js for charts (dynamically in `app.js`).
- Backend: Python 3, Flask, Flask-CORS, Pandas, Openpyxl (Excel read/write).
- Storage: `NammaCareData.xlsx` (Excel workbook with multiple sheets). Session state: browser `sessionStorage` for fast UI response.
- Dev / run: virtualenv, `run.sh` convenience script.

---

**Database / Data Model**
- File: `NammaCareData.xlsx` created by `app.py:init_db()` if missing.
- Sheets (created by backend):
  - `Senior_Citizens`, `Caretakers`, `Volunteers`, `Doctors`, `Admins` — user tables with columns: `uid`, `password`, `role`, `name`, `dob`, `address`, `phone`, `emergency`, `status`.
  - `Medications`, `MedicationLogs`, `Appointments`, `Contacts`, `HealthLogs`, `Documents`, `CheckIns`, `Requests`, `ActiveSOS`, `SOSHistory`, `VolunteerXP`, `Notifications`, `Rewards` — feature tables. Columns vary and are handled flexibly in code (Pandas DataFrames).

Data flow summary:
- Frontend reads `window.AppDB` by calling GET `/api/db` at startup; falls back to `sessionStorage` local DB when backend is unreachable.
- `app.js` exposes `getDB()` / `saveDB()` which persist state to `sessionStorage` and POST the full DB to `/api/db` to save to Excel.
- Authentication flows call `/api/register` and `/api/login` (Flask). Profile updates call `/api/profile`. Admin status updates call `/api/admin/status`.

---

**File-by-file (what each file is for & key logic)**
- `app.py` — Flask backend and Excel persistence
  - Initializes `NammaCareData.xlsx` with required sheets if missing.
  - Endpoints:
    - `GET /` and `GET /<path>`: serve static files.
    - `POST /api/register`: register a user into role-sheet (sets `Pending` for volunteers, `Active` otherwise).
    - `POST /api/login`: lookup across user sheets, validates `uid` and `password`, checks `status` (Blocked/Pending).
    - `PUT /api/profile`: update user profile fields in the appropriate sheet.
    - `GET /api/users`: return flattened user list for admin/caretaker views.
    - `PUT /api/admin/status`: change a user `status` (Active/Blocked/Pending).
    - `GET /api/db`: returns DB JSON for feature sheets (normalizes numeric ids into strings where needed).
    - `POST /api/db`: receives full/partial DB JSON from frontend and writes sheets back to Excel (safely converts `volunteerXP` map into `VolunteerXP` sheet rows).
  - Notes: Uses Pandas + openpyxl; Excel is treated as the canonical on-disk store.

- `app.js` — Primary frontend logic
  - Manages `State` (auth role, userId, profile) persisted in `sessionStorage`.
  - Maintains an in-memory `AppDB` (shadow of Excel) and helpers `getDB()`/`saveDB()`.
  - Authentication: login/register flows with client-side input validation (phone/email format, password policy). On success it stores `State`.
  - SOS: confirm modal, create SOS record (id like `SOS-1234`), capture geolocation, add to `activeSOS`, send notifications to caretakers.
  - Help Requests: create requests with `priority` (Normal/Urgent), stored in `requests` list.
  - Volunteer flows: view pending requests, accept/reject/complete, reward points are stored in `rewards` and `VolunteerXP` persisted server-side.
  - Notifications: `notifications` array, `addNotification()` pushes and `updateNotificationBadge()` updates UI badge.
  - Medicine reminders: periodic check (`startMedicationTick`) every 10s in dev, compares system time with medication times and creates reminders/notifications, logs medication taken/skipped.
  - Appointments: create `appointments` entries, notify 30 minutes before event.
  - Contacts: CRUD emergency contact entries.
  - Health & Check-ins: log `healthLogs` and `checkIns`, build charts using Chart.js in `renderHealth()`.
  - Documents: simulated upload flow storing `documents` metadata.
  - Admin: `renderAdmin()` queries `/api/users`, shows analytics and user approval buttons.

- `index.html` — Landing/hero and quick role links; uses `app.js` router to navigate.
- `login.html` — Login / Register UI. `app.js` handles form and toggling between login/register.
- HTML views (other files):
  - `sos.html`, `help-request.html`, `volunteer.html`, `caretaker.html`, `medicine.html`, `appointments.html`, `contacts.html`, `health.html`, `documents.html`, `admin.html`, `profile.html`, `contacts.html`, `medicine.html`, `appointments.html`, `volunteer.html`, `caretaker.html` — each contains markup and UI elements wired to `app.js` functions for the respective features.
- `styles.css` — Global styling, theming variables, responsive rules (mobile-first adjustments). Provides brand colors and layout utilities used by the UI.
- `sw.js` — Basic Service Worker; current implementation clears caches and passes through fetch — PWA is disabled/unregistered by `app.js` by design.
- `run.sh` — Simple helper script to create/activate a Python virtualenv and run `app.py` (installs `requirements.txt` on first run).
- `requirements.txt` — Python dependencies: `flask`, `flask-cors`, `pandas`, `openpyxl`.

---

**How to run locally**
1) Ensure Python 3 is installed.
2) From project root run:

```bash
./run.sh
```

or manually:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

3) Open http://127.0.0.1:3000 in the browser.

Notes: `run.sh` will create `venv` and install deps if missing. `app.py` will initialize `NammaCareData.xlsx` automatically.

---

**Implementation details & important behaviors**
- The server uses Excel as a simple database: every write rewrites all sheets using `pandas.ExcelWriter` — this is simple but not suitable for concurrent writes or production scale.
- Passwords are stored as plain text inside the Excel file — treat this repository as a prototype; add hashing and proper auth (JWT/Flask-Login) before real deployments.
- Frontend `app.js` keeps a local fast copy in `sessionStorage` (`nammaCareDB`) and attempts to sync to backend using `/api/db` on `saveDB()`; the server accepts a JSON representation and writes sheets back.
- Timers: medication and appointment reminders run using `setInterval` and compare times in local device timezone. The demo tick runs every 10 seconds for testing.
- Notifications: Uses in-page notification UI and Web Notification API (requests permission on load). For device push you would wire a push service and enable SW caching/logic.

---

**Security & Next steps (recommended improvements)**
1. Replace Excel with a proper database (SQLite/Postgres) for concurrency and safer updates.
2. Hash passwords (bcrypt) and implement proper session management (JWT or server sessions).
3. Implement file uploads to a storage backend (local + secure folder or cloud) and store references in the database.
4. Harden APIs: validate inputs server-side, rate-limit key endpoints, add role-based authorization for admin endpoints.
5. Improve PWA support: register service worker, implement offline caching, and push notifications via a server push service.

---

If you want, I can:
- generate a shorter developer README focused on how to extend the backend to SQLite and add user hashing (suggested next PR), or
- commit this README and run the app locally to validate the flows.

---

File created by: automated project documentation script.
