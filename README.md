# NammaCare - Elder Support Grid

## 🚀 Project Overview & Concept
NammaCare is a state-of-the-art hybrid Progressive Web Application (PWA) and elder support grid specifically tailored for senior citizens residing in Bangalore. It is engineered to bridge the gap between elderly independence and rapid emergency response. Operating on a robust Supabase Cloud architecture, the platform handles multi-role relational state processing in real-time. By integrating real-world Twilio cellular SMS telemetry, NammaCare ensures instantaneous, life-saving alerts and a deeply connected ecosystem of seniors, caretakers, medical professionals, and local volunteers.

---

## 📂 Project Architecture & File Directory Map
The codebase has been refactored into a high-performance, strictly delineated structure:

* **`main.py`**: Our asynchronous, token-protected FastAPI backend router layer handling secure transactions with our Supabase PostgreSQL instances and executing automated live dynamic routing thresholds for Twilio SMS payloads.
* **`app.js`**: Our single-page app (SPA) frontend controller shell managing the local UI view toggles, local-cache validations, Chart.js trend canvas rendering blocks, and handling the active Supabase Auth / Google OAuth session states.
* **`manifest.json`**: Mobile operating system application metadata controlling standalone, full-screen PWA installation properties across Android and iOS environments.
* **`sw.js`**: Our background caching service worker engine mapping offline asset bundles, ensuring rapid application load times, and prepping system-tray notifications capabilities.

---

## 🏃 Complete 3-Sprint Lifecycle Breakdown
The platform was built and evaluated across three distinct, agile engineering sprints:

* **Sprint-1 (Core MVP & Unified Portal Architecture):** 
  Role-isolated registration gateway routing, dynamic profile setups, help requests, real-time relational caretaker linking, and the critical emergency SOS panic loop.
* **Sprint-2 (Reminders, Bookings, & Notifications Tray):** 
  Medication scheduling triggers, clinical appointment bookings directory, notification log tracking tables, and emergency contact lifecycle rules.
* **Sprint-3 (Advanced Cloud Diagnostics & Verifications):** 
  Live health vitals graph mapping, daily check-in loops, cloud document vault metadata storage buffers, gamified volunteer XP calculations, and the administrator account monitoring panels.

---

## 🖥️ Dashboard Access & Role Credentials Guide
NammaCare utilizes a dynamic, unified Single-Page Application layout. Access to specialized interfaces is governed strictly by the user's registered role profile:

* **Senior Citizen Portal:** Accessed by selecting 'Senior Citizen' at registration or logging in. 
  *(Houses SOS button, Help Request Form, Medication logs, Appointment booker, Check-In toggle, Contacts, Health trends, Document Vault).*
* **Caretaker Command:** Accessed via Caretaker login. Displays unique Family Link Code. 
  *(Houses Dynamic SOS system banner, Vitals trends graphs, Missed medication alert feeds, Linked family registry list, Shared documents array).*
* **Volunteer Dispatch:** Accessed via Volunteer profile. 
  *(Houses Open community tasks board, Accepted active route maps, and Global XP Leaderboard).*
* **Doctor Agenda:** Accessed via Doctor profile. 
  *(Houses Today's calendar schedule grid and Upcoming consultation lists matched strictly to their registered name string).*
* **Admin Controller HQ:** Gated strictly via our backend email authentication and role-gate validation rules.

---

## 🚶 Detailed Consumer Walkthrough & Testing Guide
To perform a complete cross-functional test of the real-time cloud architecture, follow this synchronous workflow:

* **Step A (Caretaker Setup):** 
  Register a Caretaker profile -> Navigate to the dashboard -> Note down their unique Family Link Code.
* **Step B (Senior Linking):** 
  Register a new Senior Citizen -> Input the Caretaker's code during onboarding -> Click the Emergency SOS button -> Verify dynamic Twilio routing logs in the backend and the active blinking caretaker command banner on the Caretaker's dashboard.
* **Step C (Community Operations):** 
  Submit a Help Request from the Senior's view -> Log out and log into a verified Volunteer account -> Claim the open task on the dispatch board -> Mark the task as complete -> Verify Volunteer local XP increases instantly on the global scoreboard ranks.

---

## 🔑 Environment Reference Parameters (.env)
To boot the production cloud infrastructure locally or on deployment servers (like Render), the following `.env` configuration must be present at the root level:

```env
# Supabase Core Keys
SUPABASE_URL=[Your Supabase Cloud Cluster Project URL]
SUPABASE_KEY=[Your Supabase Publishable / Anon Key String for the frontend]
SUPABASE_SERVICE_ROLE_KEY=[Your Supabase Service Role Key for backend writes]

# Real-World Twilio Cellular Telemetry
TWILIO_ACCOUNT_SID=AC5072477eb0401dcfd265bb47edfb9466
TWILIO_AUTH_TOKEN=40709ea6bbf6e1f85dd0ddd76aef45b2
TWILIO_FROM_NUMBER=+14155238886
```

## Recent Changes (May 2026)

- Fixed backend RLS/auth issues: the service-role client is preserved for server-side writes so database updates (medications, SOS, help requests, check-ins) no longer fail due to downgraded auth.
- Switched notification delivery to SMTP email for caretakers and admins; added profile email resolution with auth fallback.
- Rewrote `reset_test_data.py` to safely delete demo data and explicitly recreate the admin profile (preserves only the admin account).
- Fixed admin approval persistence: admin status updates now persist to the `profiles` table.
- Normalized request status comparisons (case-insensitive) and updated UI to refresh dashboards after mutations.
- Changed SOS/UI text and notification routing to use email instead of SMS for demo purposes.
- Removed several legacy/demo files from the repository to keep the tree focused.

If you rely on the old demo SQL scripts, see `supabase_demo_reset.sql` for a single-statement reset alternative.

---

If you'd like, I can also remove additional files or archive them into a `docs/archived/` folder instead of deleting. Reply with your preference.
