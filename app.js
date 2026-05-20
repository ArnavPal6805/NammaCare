// ─── PWA Service Worker Registration ─────────────────────────────────────────
// Service worker registration disabled for Phase 1 restoration.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
        .then(registrations => registrations.forEach(reg => reg.unregister()))
        .catch(err => console.warn('Service worker cleanup failed:', err));
}
/*
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('NammaCare Cloud Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('PWA Service Worker installation failed:', err));
    });
}
*/

// ─── Local Cache State (sessionStorage) ──────────────────────────────────────
// Non-migrated modules still use a local cache. Medications/health/profile are
// handled through dedicated backend API endpoints.
const DB_SCHEMA = {
    requests: [],
    sosHistory: [],
    activeSOS: [],
    medications: [],
    medicationLogs: [],
    appointments: [],
    contacts: [],
    notifications: [],
    healthLogs: [],
    checkIns: [],
    documents: [],
    rewards: []
};

if (!sessionStorage.getItem('nammaCareDB')) {
    sessionStorage.setItem('nammaCareDB', JSON.stringify(DB_SCHEMA));
}

const API_BASE_URL = 'http://127.0.0.1:8000';

let supabaseClient = null;

async function ensureSupabaseClient() {
    if (supabaseClient) {
        return supabaseClient;
    }

    await ensureSupabaseLibrary();

    const response = await fetch(`${API_BASE_URL}/api/public-config`);
    if (!response.ok) {
        throw new Error(`Unable to load Supabase config: ${response.status}`);
    }

    const config = await response.json();
    if (!config.supabase_url || !config.supabase_anon_key) {
        throw new Error('Missing Supabase configuration from backend.');
    }

    supabaseClient = window.supabase.createClient(
        config.supabase_url,
        config.supabase_anon_key,
        {
            auth: {
                storage: window.sessionStorage,
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true
            }
        }
    );
    window.supabaseClient = supabaseClient;
    console.log('app.js loaded - supabase client created?', !!supabaseClient);

    return supabaseClient;
}

async function ensureSupabaseLibrary() {
    if (window.supabase) {
        return window.supabase;
    }

    if (!window.__supabaseScriptPromise) {
        window.__supabaseScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = () => resolve(window.supabase);
            script.onerror = () => reject(new Error('Failed to load Supabase browser SDK'));
            document.head.appendChild(script);
        });
    }

    return window.__supabaseScriptPromise;
}

function getLocalCache() {
    const raw = sessionStorage.getItem('nammaCareDB');
    const db  = raw ? JSON.parse(raw) : {};
    const keys = ['medications','medicationLogs','appointments','contacts',
                  'notifications','healthLogs','checkIns','documents',
                  'rewards','requests','activeSOS','sosHistory'];
    for (const k of keys) { if (!db[k]) db[k] = []; }
    return db;
}

function persistLocalCache(db) {
    sessionStorage.setItem('nammaCareDB', JSON.stringify(db));
}

function getStoredAccessToken() {
    for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
        try {
            const raw = sessionStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : null;
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token && token.split('.').length === 3) return token;
        } catch (_) {
            // Ignore unrelated sessionStorage entries.
        }
    }
    return null;
}

function authHeaders(extra = {}) {
    const token = State.accessToken || getStoredAccessToken();
    if (token) {
        State.accessToken = token;
        saveState();
    }
    return {
        ...extra,
        Authorization: `Bearer ${token || ''}`
    };
}

async function fetchMedicationsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    const response = await fetch(`${API_BASE_URL}/api/medications`, {
        headers: authHeaders()
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch medications: ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.medications) ? payload.medications : [];
}

async function fetchHealthLogsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    const response = await fetch(`${API_BASE_URL}/api/health/logs`, {
        headers: authHeaders()
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch health logs: ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.health_logs) ? payload.health_logs : [];
}

async function fetchHelpRequests() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/requests`, {
            headers: (State.accessToken || getStoredAccessToken()) ? authHeaders() : {}
        });
        if (!response.ok) {
            return [];
        }

        const payload = await response.json();
        return Array.isArray(payload.requests) ? payload.requests : [];
    } catch (err) {
        console.warn('Failed to load help requests from backend:', err);
        return [];
    }
}

function normalizeRequestStatus(status) {
    return String(status || '').trim().toLowerCase();
}

async function fetchSOSHistoryFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/sos/history`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.events) ? payload.events : [];
    } catch (err) {
        console.warn('Failed to load SOS history from backend:', err);
        return [];
    }
}

async function fetchMedicationLogsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/medications/log`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.logs) ? payload.logs : [];
    } catch (err) {
        console.warn('Failed to load medication logs from backend:', err);
        return [];
    }
}

async function fetchDocumentsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/documents`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.documents) ? payload.documents : [];
    } catch (err) {
        console.warn('Failed to load documents from backend:', err);
        return [];
    }
}

async function fetchCaretakerSeniorsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/caretaker/seniors`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.seniors) ? payload.seniors : [];
    } catch (err) {
        console.warn('Failed to load linked seniors from backend:', err);
        return [];
    }
}

async function fetchUsersFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.users) ? payload.users : [];
    } catch (err) {
        console.warn('Failed to load users from backend:', err);
        return [];
    }
}

async function fetchContactsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/contacts`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.contacts) ? payload.contacts : [];
    } catch (err) {
        console.warn('Failed to load contacts from backend:', err);
        return [];
    }
}

async function fetchDoctorsFromApi() {
    if (!State.accessToken && !getStoredAccessToken()) {
        return [];
    }
    try {
        const response = await fetch(`${API_BASE_URL}/api/doctors`, {
            headers: authHeaders()
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json();
        return Array.isArray(payload.doctors) ? payload.doctors : [];
    } catch (err) {
        console.warn('Failed to load doctors from backend:', err);
        return [];
    }
}

async function createHelpRequest(payload) {
    if (!State.accessToken && !getStoredAccessToken()) {
        throw new Error('Missing access token for help request creation.');
    }

    const response = await fetch(`${API_BASE_URL}/api/requests`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Help request creation failed with status ${response.status}`);
    }

    return response.json();
}

// --- App State (Persisted session storage for active user) ---
let fallbackState = {
    role: null,
    userId: null,
    email: null,
    fullName: null,
    avatarUrl: null,
    accessToken: null,
    isRegistering: false,
    requiresOnboarding: false,
    profile: null
};

const savedState = sessionStorage.getItem('nammaCareState');
const State = savedState ? JSON.parse(savedState) : fallbackState;

// Save state hook
function saveState() {
    sessionStorage.setItem('nammaCareState', JSON.stringify(State));
}

function resetAuthState() {
    State.role = null;
    State.userId = null;
    State.email = null;
    State.fullName = null;
    State.avatarUrl = null;
    State.accessToken = null;
    State.isRegistering = false;
    State.requiresOnboarding = false;
    State.profile = null;
}

function getDashboardForRole(role) {
    const normalizedRole = normalizeRole(role);
    const dashboardMap = {
        'Senior Citizen': 'profile-view',
        Volunteer:        'volunteer-view',
        Caretaker:        'caretaker-view',
        Doctor:           'doctor-view',
        Admin:            'admin-view'
    };
    return dashboardMap[normalizedRole] || 'profile-view';
}

function normalizeRole(role) {
    const value = String(role || '').trim();
    if (value === 'Caretaker/Family' || value === 'Caretaker/Family Member') return 'Caretaker';
    if (value === 'Senior' || value === 'Senior Citizen') return 'Senior Citizen';
    if (value === 'Volunteer' || value === 'Volunteer Helper') return 'Volunteer';
    if (value === 'Doctor' || value === 'Dr.' || value === 'Physician') return 'Doctor';
    return value || 'Senior Citizen';
}

function isLandingPage() {
    return (
        window.location.pathname.endsWith('index.html') ||
        window.location.pathname.endsWith('login.html') ||
        window.location.pathname.includes('login.html') ||
        window.location.pathname === '/' ||
        window.location.pathname === ''
    );
}

function isOAuthCallback() {
    return (
        window.location.search.includes('code=') ||
        window.location.search.includes('error=') ||
        window.location.hash.includes('access_token=') ||
        window.location.hash.includes('error=')
    );
}

function applyProfileToState(user, profile, accessToken = null) {
    if (!user) {
        return;
    }

    // Ensure profile and metadata are at least empty objects to avoid null property access
    const safeProfile = profile || {};
    const metadata = user.user_metadata || {};
    const previousProfile = State.profile || {};

    const displayName = (
        safeProfile.full_name ||
        safeProfile.name ||
        metadata.full_name ||
        metadata.name ||
        metadata.preferred_username ||
        previousProfile.full_name ||
        previousProfile.name ||
        user.email ||
        'Google User'
    );
    
    const avatarUrl = safeProfile.avatar_url || safeProfile.picture || metadata.avatar_url || metadata.picture || previousProfile.avatar_url || previousProfile.picture || '';
    const nextRole = normalizeRole(safeProfile.role || metadata.role || State.role || 'Senior Citizen');

    State.userId = user.id;
    State.email = user.email || metadata.email || null;
    State.fullName = displayName;
    State.avatarUrl = avatarUrl;
    State.accessToken = accessToken || safeProfile.access_token || State.accessToken || null;
    State.role = nextRole;
    State.requiresOnboarding = false;
    State.profile = {
        ...previousProfile,
        ...safeProfile,
        name: displayName,
        full_name: displayName,
        email: State.email,
        role: nextRole,
        avatar_url: avatarUrl,
        picture: avatarUrl
    };

    saveState();

    // Profile is the source of truth in Supabase — no local DB sync needed.
}

function getDisplayName() {
    return (
        State.fullName ||
        State.profile?.full_name ||
        State.profile?.name ||
        State.email ||
        'Google User'
    );
}

function getAvatarUrl() {
    const displayName = getDisplayName();
    return (
        State.avatarUrl ||
        State.profile?.avatar_url ||
        State.profile?.picture ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=00D2FF&color=ffffff`
    );
}



async function signInWithGoogle() {
    try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/login.html',
                queryParams: {
                    prompt: 'select_account'
                }
            }
        });
        if (error) throw error;
    } catch (error) {
        console.error('Google OAuth failed:', error);
        alert('Google login failed: ' + error.message);
    }
}

async function initializeAuthListener() {
    const client = await ensureSupabaseClient();

    client.auth.onAuthStateChange(async (event, session) => {
        try {
            const path = window.location.pathname;
            const onLoginPage     = path.includes('login.html');
            const onIndexPage     = path.endsWith('index.html') || path === '/' || path === '';
            const onDashboardPage = !onLoginPage && !onIndexPage;

            // ── SIGN OUT ─────────────────────────────────────────────────
            if (event === 'SIGNED_OUT') {
                resetAuthState();
                sessionStorage.removeItem('nammaCareState');
                if (typeof app !== 'undefined') app.updateHeader();
                window.location.href = 'index.html';
                return;
            }

            if (!session?.user) return;
            const user  = session.user;
            const token = session.access_token;
            State.accessToken = token;
            saveState();
            console.log(`[Auth] ${event} for`, user.email);

            // ── TOKEN_REFRESHED / INITIAL_SESSION ─────────────────────────
            // These fire on every page load for already-logged-in users.
            // On dashboard pages: silently re-hydrate state, no redirect.
            // On login/index pages: treat like SIGNED_IN (navigate to dashboard).
            if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
                if (onDashboardPage) {
                    // Already on the right page — just keep state fresh.
                    try {
                        const res = await fetch(`http://127.0.0.1:8000/api/profile/${user.id}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (res.ok) {
                            const profile = await res.json();
                            applyProfileToState(user, profile, token);
                            app.updateHeader();
                            app.renderUserDashboard(profile);
                        } else if (res.status === 404) {
                            window.location.href = 'login.html?mode=register';
                        }
                    } catch (err) {
                        console.error('[Auth] Silent hydration failed:', err);
                    }
                    return; // Do NOT navigate away from the dashboard page
                }
                // On login/index: fall through to full SIGNED_IN logic below.
            }

            // ── SIGNED_IN (+ login/index pages for TOKEN_REFRESHED fallthrough) ──

            // ----- STAGED DATA REHYDRATION (Google OAuth post-redirect) -----
            const stagedRaw = localStorage.getItem('staged_onboarding_data');
            if (stagedRaw && event === 'SIGNED_IN') {
                console.log('[Auth] Rehydrating staged registration data...');
                try {
                    const profileData = JSON.parse(stagedRaw);
                    const payload = {
                        full_name: profileData.name,
                        username:  profileData.username || user.email.split('@')[0],
                        phone:     profileData.phone,
                        dob:       profileData.dob    || undefined,
                        role:      profileData.role,
                        address:   profileData.address || undefined,
                        family_link_code_input: profileData.family_link_code_input || undefined
                    };
                    const res = await fetch(`http://127.0.0.1:8000/api/profile/${user.id}`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body:    JSON.stringify(payload)
                    });
                    if (res.ok) {
                        const profile = await res.json();
                        localStorage.removeItem('staged_onboarding_data');
                        applyProfileToState(user, profile, token);
                        app.updateHeader();
                        app.router(getDashboardForRole(profile.role));
                        return;
                    } else {
                        console.error('[Auth] Staged profile creation failed:', await res.text());
                    }
                } catch (err) {
                    console.error('[Auth] Error in staged data rehydration:', err);
                }
            }

            // ----- FETCH EXISTING PROFILE -----
            try {
                const res = await fetch(`http://127.0.0.1:8000/api/profile/${user.id}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (res.ok) {
                    const profile = await res.json();
                    applyProfileToState(user, profile, token);
                    app.updateHeader();

                    if (onDashboardPage) {
                        // Already on a dashboard page — hydrate UI only
                        app.renderUserDashboard(profile);
                    } else {
                        // On login/index — hide auth forms, navigate to role dashboard
                        window._loginInProgress = false;
                        const loginView    = document.getElementById('login-view');
                        const registerView = document.getElementById('register-view');
                        if (loginView)    loginView.style.display    = 'none';
                        if (registerView) registerView.style.display = 'none';
                        app.router(getDashboardForRole(profile.role));
                    }

                } else if (res.status === 404) {
                    // ⚠️ Only redirect to register if we are NOT actively in the middle
                    // of creating a profile (registration race condition guard).
                    if (window._registrationInProgress || window._loginInProgress) {
                        console.log('[Auth] 404 ignored — auth flow in progress.');
                        return;
                    }
                    console.log('[Auth] No profile found — showing registration panel.');
                    if (onDashboardPage) {
                        window.location.href = 'login.html?mode=register';
                    } else {
                        if (typeof app !== 'undefined') app.toggleAuthMode('register');
                    }
                } else {
                    console.error('[Auth] Profile fetch error:', res.status, await res.text());
                }
            } catch (err) {
                console.error('[Auth] Profile fetch network error:', err);
            }

        } catch (err) {
            console.error('[Auth] Unhandled auth state listener error:', err);
        }
    });
}

async function handleSignOut() {
    try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.signOut();

        if (error) {
            throw error;
        }
    } catch (error) {
        console.error('Sign-out failed:', error);
    } finally {
        resetAuthState();
        sessionStorage.removeItem('nammaCareState');

        if (typeof app !== 'undefined') {
            app.updateHeader();
        }

        window.location.href = 'index.html';
    }
}

// --- DOM Elements ---
const DOM = {
    views: document.querySelectorAll('.view'),
    navLinks: document.getElementById('nav-links'),
    navControls: document.getElementById('nav-controls'),
    
    // Auth
    authTitle: document.getElementById('auth-title'),
    authError: document.getElementById('auth-error'),
    authErrorMsg: document.getElementById('auth-error-message'),
    authForm: document.getElementById('auth-form'),
    roleBtns: document.querySelectorAll('.role-btn'),
    authSwitchText: document.getElementById('auth-switch-text'),
    authSwitchAction: document.getElementById('auth-switch-action'),
    authSubmitBtn: document.getElementById('auth-submit-btn'),

    // SOS
    sosIdle: document.getElementById('sos-idle'),
    sosActivePanel: document.getElementById('sos-active'),
    sosModal: document.getElementById('sos-modal'),
    sosHistoryList: document.getElementById('sos-history-list'),
    
    // Help Request
    citReqList: document.getElementById('citizen-requests-list'),
    urgencyBtns: document.querySelectorAll('.urgency-btn'),
    helpSuccessAlert: document.getElementById('help-success-alert'),

    renderUserDashboard(profile) {
        if (!profile) return;
        const role = normalizeRole(profile.role || 'Senior Citizen');
        const main = document.querySelector('main');
        if (!main) return;

        // Hide home hero sections and landing view components on index.html
        const homeView = document.getElementById('home-view');
        if (homeView) homeView.style.display = 'none';

        // Hide login/register panel on login.html
        const loginView = document.getElementById('login-view');
        if (loginView) loginView.style.display = 'none';
        const registerView = document.getElementById('register-view');
        if (registerView) registerView.style.display = 'none';

        // Remove previous dashboard
        const existing = document.getElementById('dynamic-dashboard');
        if (existing) existing.remove();

        const dash = document.createElement('section');
        dash.id = 'dynamic-dashboard';
        dash.style.cssText = 'padding:2rem; max-width:1100px; margin:0 auto; z-index: 10; position: relative;';

        // Inject dynamic styles
        let styleTag = document.getElementById('dynamic-dashboard-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'dynamic-dashboard-styles';
            styleTag.innerHTML = `
                .nc-tab-bar {
                    display: flex;
                    gap: 0.75rem;
                    flex-wrap: wrap;
                    margin-bottom: 2rem;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    padding-bottom: 1rem;
                }
                .nc-tab {
                    background: rgba(255, 255, 255, 0.03);
                    color: var(--text-muted);
                    border: 1px solid var(--border-light);
                    padding: 0.75rem 1.5rem;
                    border-radius: 50px;
                    font-weight: 600;
                    font-size: 0.9rem;
                    cursor: pointer;
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .nc-tab:hover {
                    background: rgba(255, 255, 255, 0.08);
                    color: #fff;
                    transform: translateY(-1px);
                }
                .nc-tab.active {
                    background: linear-gradient(135deg, var(--c-blue), var(--c-green));
                    color: #fff;
                    border-color: transparent;
                    box-shadow: 0 0 20px rgba(0, 210, 255, 0.3);
                }
                .nc-tab.active[data-tab="sos"], .nc-tab.active[data-tab="care-alerts"] {
                    background: linear-gradient(135deg, #ff003c, #ff6b6b);
                    box-shadow: 0 0 20px rgba(255, 0, 60, 0.3);
                }
                .nc-panel {
                    transition: all 0.3s ease;
                }
                .nc-panel.hidden {
                    display: none !important;
                }
                .dashboard-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                    gap: 1.5rem;
                    margin-top: 1rem;
                }
            `;
            document.head.appendChild(styleTag);
        }

        if (role === 'Senior Citizen') {
            dash.innerHTML = `
<div style="margin-bottom:1.5rem; text-align: left;">
  <h1 style="font-size:2.5rem;font-weight:900;color:#fff;">Welcome, ${profile.full_name || 'Senior'} 👋</h1>
  <p style="color:var(--text-muted);">Senior Command Center — Bangalore Support Grid</p>
</div>
<div id="senior-tab-bar" class="nc-tab-bar">
  <button class="nc-tab active" data-tab="sos">🚨 Emergency SOS</button>
  <button class="nc-tab" data-tab="help">📋 Help Request</button>
  <button class="nc-tab" data-tab="meds">💊 Medications</button>
  <button class="nc-tab" data-tab="appts">🏥 Appointments</button>
  <button class="nc-tab" data-tab="checkin">✅ Check-In</button>
  <button class="nc-tab" data-tab="contacts">📞 Contacts</button>
  <button class="nc-tab" data-tab="health">📈 Health Trends</button>
  <button class="nc-tab" data-tab="docs">📄 Documents</button>
</div>

<div id="tab-sos" class="nc-panel glass-panel" style="padding:2.5rem; text-align:center; border-color:rgba(255,0,122,0.4); box-shadow:0 0 30px rgba(255,0,122,0.15); margin-bottom: 2rem;">
  <h2 class="text-white font-black mb-2" style="font-size:2rem;">Emergency SOS Command</h2>
  <p style="color:var(--text-muted); margin-bottom:2rem; font-size:1.1rem;">Press the button below to instantly broadcast an emergency to your caretaker and emergency contacts.</p>
  <button id="sos-button" class="sos-trigger" style="margin: 2rem auto;">
    <div class="sos-trigger-glow"></div>
    <span class="sos-trigger-text">SOS</span>
    <span class="sos-trigger-sub">Trigger Alert</span>
  </button>
  <div id="sos-status" style="margin-top:2rem; font-size:1.1rem; font-weight:700; color: var(--text-muted);">Ready to safeguard.</div>
</div>

<div id="tab-help" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 class="text-white font-bold mb-2">Raise a Help Request</h2>
  <p class="text-muted mb-6">Need assistance with daily tasks? Our volunteers are ready to help.</p>
  
  <div class="form-group">
    <label>Service Type</label>
    <select id="help-type" class="input-field" style="margin-bottom:1rem; background: var(--bg-card);">
      <option>Grocery Pickup</option>
      <option>Medicine Pickup</option>
      <option>Medical Escort</option>
      <option>Home Cleaning</option>
      <option>Other Help</option>
    </select>
  </div>
  
  <div class="form-group">
    <label>Description</label>
    <textarea id="help-desc" class="input-field" placeholder="Please describe what you need in detail..." style="min-height:100px; margin-bottom:1rem;"></textarea>
  </div>

  <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;" class="mb-4">
    <div class="form-group">
      <label>Preferred Date/Time</label>
      <input type="datetime-local" id="help-datetime" class="input-field" required>
    </div>
    <div class="form-group">
      <label>Urgency Level</label>
      <select id="help-urgency" class="input-field" style="background: var(--bg-card);">
        <option value="Normal">Normal</option>
        <option value="Urgent">Urgent 🚨</option>
      </select>
    </div>
  </div>
  
  <button class="btn btn-primary" onclick="app.submitHelpRequest()">Submit Help Request</button>
  <div id="help-feedback" style="margin-top:1.5rem; font-weight:bold; font-size:1.1rem;"></div>

  <h3 class="text-white font-bold mt-8 mb-4">Past Help Requests</h3>
  <div id="senior-help-list" style="color:var(--text-muted);">Loading requests...</div>
</div>

<div id="tab-meds" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:0.5rem;">Medication Tracker Scheduler</h2>
  <p class="text-muted mb-6">Schedule medicine intake and confirm when taken or skipped.</p>
  <form id="med-form" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:.75rem;align-items:end;margin-bottom:2rem;">
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Medicine Name</label>
      <input id="med-name" class="input-field" placeholder="Name" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Dosage</label>
      <input id="med-dosage" class="input-field" placeholder="Dosage" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Frequency</label>
      <select id="med-freq" class="input-field" style="background:var(--bg-input);">
        <option value="Daily">Daily</option>
        <option value="Weekly">Weekly</option>
        <option value="Twice Daily">Twice Daily</option>
      </select>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Intake Time</label>
      <input id="med-time" class="input-field" type="time" required>
    </div>
    <button class="btn btn-primary" type="submit">Schedule</button>
  </form>
  <h3 style="color:#fff;margin-bottom:1rem;">Active Medication List</h3>
  <div id="med-list"></div>
</div>

<div id="tab-appts" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:0.5rem;">Doctor Appointments</h2>
  <p class="text-muted mb-6">Directory checking and booking confirmation with notification reminders.</p>
  <form id="appt-form" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.75rem;align-items:end;margin-bottom:2rem;">
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Select Specialization Directory</label>
      <select id="appt-doctor" class="input-field" style="background:var(--bg-input);" required>
        <option value="">Loading registered doctors...</option>
      </select>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Preferred Date</label>
      <input id="appt-date" class="input-field" type="date" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Preferred Time</label>
      <input id="appt-time" class="input-field" type="time" required>
    </div>
    <button class="btn btn-primary" type="submit">Book Slot</button>
  </form>
  <h3 style="color:#fff;margin-bottom:1rem;">My Confirmed Appointments</h3>
  <div id="appt-list"></div>
</div>

<div id="tab-checkin" class="nc-panel glass-panel hidden" style="padding:2.5rem; text-align:center;">
  <h2 style="color:#fff;margin-bottom:.5rem;">Daily Safety Check-In</h2>
  <p style="color:var(--text-muted);margin-bottom:2rem;font-size:1.1rem;">Confirm you are safe today. If not clicked daily, caretaker is automatically notified.</p>
  <button class="btn btn-primary" style="font-size:1.3rem;padding:1.2rem 3.5rem;border-radius:999px;box-shadow:0 0 30px rgba(0,255,157,0.3);" onclick="app.submitCheckIn()">✅ I Am Safe Today</button>
  <div id="checkin-status" class="hidden" style="margin-top:2rem;color:var(--c-green);font-size:1.2rem;font-weight:700;">
    ✅ Daily safety status recorded. Caretaker notified of your safety!
  </div>
</div>

<div id="tab-contacts" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Emergency Contacts</h2>
  <form id="contact-form" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.75rem;align-items:end;margin-bottom:2rem;">
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Contact Name</label>
      <input id="con-name" class="input-field" placeholder="Name" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Relationship</label>
      <input id="con-rel" class="input-field" placeholder="Relationship" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Phone Number</label>
      <input id="con-phone" class="input-field" placeholder="Phone Number" required>
    </div>
    <div style="display:flex;align-items:center;gap:0.3rem;">
      <input type="checkbox" id="con-primary" style="width:1.2rem;height:1.2rem;cursor:pointer;">
      <label for="con-primary" style="margin:0;font-size:0.8rem;color:#fff;">Primary</label>
    </div>
    <button class="btn btn-primary" type="submit">Add Contact</button>
  </form>
  <div id="contact-list"></div>
</div>

<div id="tab-health" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:0.5rem;">Log Daily Health Readings</h2>
  <p class="text-muted mb-6">Enter health readings. If readings exceed threshold, caretakers will receive alert triggers.</p>
  <form id="health-form" style="display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;align-items:end;margin-bottom:2rem;">
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Blood Pressure (Systolic/Diastolic)</label>
      <input id="health-bp" class="input-field" placeholder="e.g. 120/80" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Sugar Level (mg/dL)</label>
      <input id="health-sugar" class="input-field" type="number" placeholder="Sugar Level (mg/dL)" required>
    </div>
    <button class="btn btn-primary" type="submit">Submit Reading</button>
  </form>
  <h3 style="color:#fff;margin-bottom:1rem;">My Health Trend Graph</h3>
  <div style="height: 300px; position: relative;">
    <canvas id="healthChart" style="max-height:300px;"></canvas>
  </div>
</div>

<div id="tab-docs" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:0.5rem;">Medical Document Vault</h2>
  <p class="text-muted mb-6">Securely upload prescriptions, reports, and bills. View and download anytime.</p>
  <form id="doc-form" style="display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;align-items:end;margin-bottom:2rem;">
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Document Title</label>
      <input id="doc-title" class="input-field" placeholder="Document Title (e.g. Prescription May)" required>
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Select File</label>
      <input id="doc-file" class="input-field" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">
    </div>
    <div>
      <label style="color:var(--text-muted);font-size:0.75rem;font-weight:900;text-transform:uppercase;">Category</label>
      <select id="doc-cat" class="input-field" required>
        <option value="Prescription">Prescription</option>
        <option value="Lab Report">Lab Report</option>
        <option value="Insurance">Insurance</option>
        <option value="Other">Other</option>
      </select>
    </div>
    <button class="btn btn-primary" type="submit">Upload</button>
  </form>
  <h3 style="color:#fff;margin-bottom:1rem;">My Documents Vault</h3>
  <div id="doc-list"></div>
</div>`;

        } else if (role === 'Caretaker') {
            dash.innerHTML = `
<div style="margin-bottom:1.5rem; text-align: left;">
  <h1 style="font-size:2.5rem;font-weight:900;color:#fff;">Care Command Command Center</h1>
  <p style="color:var(--text-muted);">Family Link Code: <span style="font-family:monospace;font-size:1.5rem;color:var(--c-blue);letter-spacing:.15em;font-weight:900;">${profile.family_link_code || 'NC-????'}</span></p>
</div>

<div id="sos-system-banner" class="alert-banner" style="margin-bottom: 2rem;">
  <!-- Instantly updating SOS system status banner -->
</div>

<div id="care-tab-bar" class="nc-tab-bar">
  <button class="nc-tab active" data-tab="care-alerts">🔔 SOS Alerts</button>
  <button class="nc-tab" data-tab="care-health">📈 Health Trends</button>
  <button class="nc-tab" data-tab="care-meds">⚠️ Missed Meds</button>
  <button class="nc-tab" data-tab="care-seniors">👥 Linked Seniors</button>
  <button class="nc-tab" data-tab="care-docs">📄 Shared Docs</button>
</div>

<div id="tab-care-alerts" class="nc-panel glass-panel" style="padding:2rem; border-color:var(--c-pink); text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Active Emergency SOS Alerts</h2>
  <div id="care-sos-feed" style="color:var(--text-muted);">Monitoring for emergency signals...</div>
</div>

<div id="tab-care-health" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Linked Senior Health Graph</h2>
  <div style="height:320px; position:relative;">
    <canvas id="healthChart" style="max-height:300px;"></canvas>
  </div>
</div>

<div id="tab-care-meds" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1.5rem;">Missed Medication Alert Feed</h2>
  <div id="care-med-feed" style="color:var(--text-muted);">No skipped medications logged yet.</div>
</div>

<div id="tab-care-seniors" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1.5rem;">Linked Seniors</h2>
  <div id="care-seniors-list" style="color:var(--text-muted);">Loading seniors...</div>
</div>

<div id="tab-care-docs" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1.5rem;">Patients' Shared Documents Vault</h2>
  <div id="doc-list" style="color:var(--text-muted);">Loading documents...</div>
</div>`;

        } else if (role === 'Volunteer') {
            dash.innerHTML = `
<div style="margin-bottom:1.5rem; text-align: left;">
  <h1 style="font-size:2.5rem;font-weight:900;color:#fff;">Volunteer Dispatch — ${profile.full_name || 'Volunteer'}</h1>
  <p style="color:var(--text-muted);">Bangalore Rapid Assistance Grid</p>
</div>
<div id="vol-tab-bar" class="nc-tab-bar">
  <button class="nc-tab active" data-tab="vol-tasks">📦 Open Tasks</button>
  <button class="nc-tab" data-tab="vol-active">🏃 My Active Tasks</button>
  <button class="nc-tab" data-tab="vol-xp">⭐ XP & Leaderboard</button>
</div>

<div id="tab-vol-tasks" class="nc-panel" style="text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Available Community Tasks</h2>
  <div id="vol-task-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;"></div>
</div>

<div id="tab-vol-active" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">My Accepted Active Tasks</h2>
  <div id="vol-active-list" style="color:var(--text-muted);">No active tasks.</div>
</div>

<div id="tab-vol-xp" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Your Personal Volunteer XP</h2>
  <div style="font-size:3.5rem;font-weight:900;color:var(--c-green);text-shadow:0 0 20px rgba(0,255,157,0.3);margin-bottom:2rem;" id="vol-xp-count">0 XP</div>
  <h3 style="color:#fff;margin-bottom:1rem;">Global Volunteer Leaderboard</h3>
  <div id="vol-leaderboard" style="color:var(--text-muted);">Loading leaderboard...</div>
</div>`;

        } else if (role === 'Doctor') {
            dash.innerHTML = `
<div style="margin-bottom:1.5rem; text-align: left;">
  <h1 style="font-size:2.5rem;font-weight:900;color:#fff;">${profile.full_name || 'Doctor'} - Appointment Agenda</h1>
  <p style="color:var(--text-muted);">Medical Practitioner Command Center</p>
</div>
<div id="doc-tab-bar" class="nc-tab-bar">
  <button class="nc-tab active" data-tab="doc-today">📅 Today's Schedule</button>
  <button class="nc-tab" data-tab="doc-upcoming">🗓️ Upcoming Appointments</button>
</div>

<div id="tab-doc-today" class="nc-panel glass-panel" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Today's Calendar Agenda</h2>
  <div id="doc-today-list" style="color:var(--text-muted);">Loading appointments...</div>
</div>

<div id="tab-doc-upcoming" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Upcoming Appointments</h2>
  <div id="doc-upcoming-list" style="color:var(--text-muted);">Loading...</div>
</div>`;

        } else if (role === 'Admin') {
            dash.innerHTML = `
<div style="margin-bottom:1.5rem; text-align: left;">
  <h1 style="font-size:2.5rem;font-weight:900;color:#fff;">Admin Management Portal</h1>
  <p style="color:var(--text-muted);">Central Operational Diagnostics Dashboard</p>
</div>
<div id="admin-tab-bar" class="nc-tab-bar">
  <button class="nc-tab active" data-tab="adm-stats">📊 Operational Stats</button>
  <button class="nc-tab" data-tab="adm-users">👤 User Control</button>
  <button class="nc-tab" data-tab="adm-sos">🚨 Emergency SOS Log</button>
  <button class="nc-tab" data-tab="adm-verifications">👥 Volunteer Verification</button>
</div>

<div id="tab-adm-stats" class="nc-panel" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.5rem; text-align: center;">
  <div class="glass-panel text-center" style="padding:2rem;border-color:var(--c-blue);"><div style="font-size:3rem;font-weight:900;color:var(--c-blue);" id="stat-seniors">—</div><p style="color:var(--text-muted);font-weight:700;margin-top:0.5rem;">Active Seniors</p></div>
  <div class="glass-panel text-center" style="padding:2rem;border-color:var(--c-green);"><div style="font-size:3rem;font-weight:900;color:var(--c-green);" id="stat-vols">—</div><p style="color:var(--text-muted);font-weight:700;margin-top:0.5rem;">Verified Volunteers</p></div>
  <div class="glass-panel text-center" style="padding:2rem;border-color:var(--c-pink);"><div style="font-size:3rem;font-weight:900;color:var(--c-pink);" id="stat-sos">—</div><p style="color:var(--text-muted);font-weight:700;margin-top:0.5rem;">Active SOS alerts</p></div>
  <div class="glass-panel text-center" style="padding:2rem;border-color:var(--c-yellow);"><div style="font-size:3rem;font-weight:900;color:var(--c-yellow);" id="stat-pending">—</div><p style="color:var(--text-muted);font-weight:700;margin-top:0.5rem;">Pending Requests</p></div>
</div>

<div id="tab-adm-users" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">User Directory & Status Flagging</h2>
  <div id="admin-user-table" style="color:var(--text-muted);">Loading users...</div>
</div>

<div id="tab-adm-sos" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">SOS History Logs</h2>
  <div id="admin-sos-log" style="color:var(--text-muted);">Loading log files...</div>
</div>

<div id="tab-adm-verifications" class="nc-panel glass-panel hidden" style="padding:2rem; text-align: left;">
  <h2 style="color:#fff;margin-bottom:1rem;">Volunteer Approval & Verification Grid</h2>
  <div id="admin-volunteer-verifications" style="color:var(--text-muted);">Loading verifications...</div>
</div>`;
        }

        main.prepend(dash);

        // ── Wire up tab switching for this dashboard ─────────────────────
        const tabBarId = {
            'Senior Citizen': 'senior-tab-bar',
            Caretaker: 'care-tab-bar',
            Volunteer: 'vol-tab-bar',
            Doctor: 'doc-tab-bar',
            Admin: 'admin-tab-bar'
        }[role];

        const tabBar = document.getElementById(tabBarId);
        if (tabBar) {
            tabBar.querySelectorAll('.nc-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    tabBar.querySelectorAll('.nc-tab').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const target = btn.dataset.tab;
                    dash.querySelectorAll('.nc-panel').forEach(panel => {
                        panel.id === `tab-${target}`
                            ? panel.classList.remove('hidden')
                            : panel.classList.add('hidden');
                    });
                    // Switch handling
                    if (target === 'health')       app.renderHealth();
                    if (target === 'care-health')  app.renderHealth();
                    if (target === 'adm-users')    app._loadAdminUsers();
                    if (target === 'adm-stats')    app._loadAdminStats();
                    if (target === 'adm-sos')      app._loadAdminSOS();
                    if (target === 'adm-verifications') app._loadAdminVerifications();
                    if (target === 'vol-tasks')    app._loadVolTasks();
                    if (target === 'vol-active')   app._loadVolActiveTasks();
                    if (target === 'vol-xp')       app._loadLeaderboard();
                    if (target === 'care-seniors') app._loadLinkedSeniors(profile);
                    if (target === 'care-meds')    app._loadCareMeds();
                    if (target === 'care-docs')    app.renderDocuments();
                    if (target === 'docs')         app.renderDocuments();
                });
            });
        }

        // ── Bind SOS button ───────────────────────────────────────────────
        const sosBtn = document.getElementById('sos-button');
        if (sosBtn) sosBtn.addEventListener('click', () => app.dispatchSOSAlert());

        // ── Bind forms dynamically ─────────────────────────────────────────
        const medForm = document.getElementById('med-form');
        if (medForm) medForm.addEventListener('submit', e => app.submitMedicine(e));
        const apptForm = document.getElementById('appt-form');
        if (apptForm) apptForm.addEventListener('submit', e => app.submitAppointment(e));
        if (document.getElementById('appt-doctor')) app.populateDoctorSelect();
        const contactForm = document.getElementById('contact-form');
        if (contactForm) contactForm.addEventListener('submit', e => app.submitContact(e));
        const healthForm = document.getElementById('health-form');
        if (healthForm) healthForm.addEventListener('submit', e => app.submitHealth(e));
        const docForm = document.getElementById('doc-form');
        if (docForm) docForm.addEventListener('submit', e => app.submitDocument(e));

        // ── Auto-load first-tab data ──────────────────────────────────────
        if (role === 'Senior Citizen') { 
            app.renderMedications(); 
            app.renderAppointments(); 
            app.renderContacts();
            app.renderSeniorHelpRequests();
        }
        if (role === 'Caretaker')      { 
            app._loadCareSOS(profile); 
            app._loadCareMeds();
        }
        if (role === 'Volunteer')      { 
            app._loadVolTasks(); 
        }
        if (role === 'Admin')          { 
            app._loadAdminStats(); 
        }
        if (role === 'Doctor')         { 
            app._loadDoctorAppts(profile); 
        }
    },

    async submitHelpRequest(e) {
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }

        const category = document.getElementById('help-type')?.value || document.getElementById('req-category')?.value;
        const description = document.getElementById('help-desc')?.value || document.getElementById('req-desc')?.value || '';
        const priority = document.getElementById('help-urgency')?.value || this.selectedUrgency || 'Normal';
        const fb = document.getElementById('help-feedback');

        if (!category) {
            return;
        }

        try {
            await createHelpRequest({
                category,
                priority,
                description
            });

            if (fb) {
                fb.innerHTML = '<span style="color:var(--c-green); font-weight:700;">✅ Request submitted to Community Network!</span>';
                setTimeout(() => { if(fb) fb.innerHTML = ''; }, 4000);
            }
            if(DOM.helpSuccessAlert) {
                DOM.helpSuccessAlert.classList.remove('hidden');
                setTimeout(() => DOM.helpSuccessAlert.classList.add('hidden'), 4000);
            }
            const helpDesc = document.getElementById('help-desc');
            if (helpDesc) helpDesc.value = '';
            if (e && e.target && typeof e.target.reset === 'function') {
                e.target.reset();
            }
            await this.renderSeniorHelpRequests();
            await this._loadVolTasks();
            await this.refreshLiveDashboardData();
        } catch (err) {
            console.warn('Backend request creation failed:', err);
            if (fb) {
                fb.innerHTML = '<span style="color:var(--c-pink); font-weight:700;">Unable to submit request right now.</span>';
            }
        }
    },

    async renderSeniorHelpRequests() {
        const list = document.getElementById('senior-help-list');
        if (!list) return;
        const requests = (await fetchHelpRequests()).filter(r => (r.senior_id || r.seniorId) === State.userId);
        list.innerHTML = requests.length
            ? requests.map(r => `
                <div class="glass-panel" style="padding:1rem;margin-bottom:1rem;border-left:4px solid ${r.status === 'Completed' ? 'var(--c-green)' : r.status === 'Accepted' ? 'var(--c-blue)' : 'var(--c-yellow)'};">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <b style="color:#fff;font-size:1.1rem;">${r.title || r.category || r.type}</b>
                        <span class="badge ${r.status === 'Completed' ? 'badge-green' : r.status === 'Accepted' ? 'badge-blue' : 'badge-yellow'}">${r.status}</span>
                    </div>
                    <p style="color:var(--text-muted);font-size:0.9rem;margin:0.5rem 0;">${r.description || r.desc || ''}</p>
                    <p style="color:var(--text-muted);font-size:0.75rem;margin:0;">Scheduled: ${new Date(r.created_at || r.ts || Date.now()).toLocaleString()}</p>
                </div>
            `).join('')
            : '<p style="color:var(--text-muted);">No help requests submitted yet.</p>';
    },

    async refreshLiveDashboardData() {
        if (!State.userId) return;

        const role = normalizeRole(State.role || 'Senior Citizen');

        if (role === 'Senior Citizen') {
            await Promise.allSettled([
                this.renderSeniorHelpRequests(),
                this.renderSOSHistory(),
                this.renderMedications(),
                this.renderAppointments(),
                this.renderContacts(),
            ]);
            return;
        }

        if (role === 'Caretaker') {
            await Promise.allSettled([
                this._loadCareSOS(State.profile),
                this._loadCareMeds(),
                this._loadLinkedSeniors(State.profile),
            ]);
            return;
        }

        if (role === 'Volunteer') {
            await Promise.allSettled([
                this._loadVolTasks(),
                this._loadVolActiveTasks(),
                this._loadLeaderboard(),
            ]);
            return;
        }

        if (role === 'Admin') {
            await Promise.allSettled([
                this._loadAdminStats(),
                this._loadAdminUsers(),
                this._loadAdminVerifications(),
                this._loadAdminSOS(),
            ]);
            return;
        }

        if (role === 'Doctor') {
            await Promise.allSettled([
                this._loadDoctorAppts(State.profile),
            ]);
        }
    },

    submitCheckIn() {
        (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/checkin`, {
                    method: 'POST',
                    headers: authHeaders()
                });

                if (!response.ok) {
                    throw new Error(`Check-in failed: ${response.status}`);
                }

                await this.addNotification(`Daily safety check-in confirmed by Senior Citizen.`, null, 'Caretaker');
                const statusEl = document.getElementById('checkin-status');
                if(statusEl) statusEl.classList.remove('hidden');
                await this.refreshLiveDashboardData();
            } catch (error) {
                console.error('Failed to submit check-in:', error);
                alert('Unable to submit check-in right now.');
            }
        })();
    },

    async _loadCareSOS(profile) {
        const el = document.getElementById('care-sos-feed');
        const banner = document.getElementById('sos-system-banner');
        const active = await fetchSOSHistoryFromApi();
        
        if (el) {
            el.innerHTML = active.length
                ? active.map(s => `
                    <div class="glass-panel" style="padding:1rem;margin-bottom:.75rem;border-color:var(--c-pink);display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <b style="color:var(--c-pink);">🚨 SOS EMERGENCY ALERT</b>
                            <p style="color:#fff;margin:0.25rem 0 0;">Patient ID: <b>${s.user_id || s.userId || 'Unknown'}</b></p>
                            <p style="color:var(--text-muted);font-size:0.75rem;margin:0;">Triggered at: ${new Date(s.created_at || s.ts || Date.now()).toLocaleTimeString()}</p>
                        </div>
                        <span class="badge badge-pink">ACTIVE</span>
                    </div>
                  `).join('')
                : '<p style="color:var(--c-green);font-weight:700;">✅ No active emergency SOS alerts currently.</p>';
        }

        if (banner) {
            if (active.length > 0) {
                banner.style.borderColor = 'var(--c-pink)';
                banner.style.background = 'rgba(255, 0, 122, 0.1)';
                banner.style.boxShadow = '0 0 30px rgba(255, 0, 122, 0.3)';
                banner.innerHTML = `
                    <div style="display:flex;align-items:center;gap:1.5rem;">
                        <span class="pulse-icon" style="background:var(--c-pink);color:#fff;margin:0;font-size:1.5rem;width:50px;height:50px;display:flex;align-items:center;justify-content:center;border-radius:50%;">🚨</span>
                        <div>
                            <h3 style="color:var(--c-pink);font-weight:900;margin:0;">CRITICAL: ACTIVE SOS ALERT DETECTED</h3>
                            <p style="color:#fff;margin:0.25rem 0 0;font-size:0.95rem;">A senior citizen in your response grid has triggered an SOS alert! Immediate action required.</p>
                        </div>
                    </div>
                `;
            } else {
                banner.style.borderColor = 'var(--c-green)';
                banner.style.background = 'rgba(0, 255, 157, 0.05)';
                banner.style.boxShadow = '0 0 20px rgba(0, 255, 157, 0.1)';
                banner.innerHTML = `
                    <div style="display:flex;align-items:center;gap:1.5rem;">
                        <span style="background:rgba(0, 255, 157, 0.1);color:var(--c-green);border-radius:50%;padding:0.75rem;font-size:1.5rem;display:flex;align-items:center;justify-content:center;width:50px;height:50px;">✅</span>
                        <div>
                            <h3 style="color:var(--c-green);font-weight:700;margin:0;">System Grid Secure</h3>
                            <p style="color:var(--text-muted);margin:0.25rem 0 0;font-size:0.95rem;">Monitoring linked seniors in real-time. No active emergencies detected.</p>
                        </div>
                    </div>
                `;
            }
        }
    },

    resolveCareSOS(id) {
        fetch(`${API_BASE_URL}/api/sos/${id}/resolve`, {
            method: 'PUT',
            headers: authHeaders()
        })
            .then(() => app._loadCareSOS(State.profile))
            .catch(err => console.warn('Failed to resolve SOS event:', err));
    },

    async _loadLinkedSeniors(profile) {
        const el = document.getElementById('care-seniors-list');
        if (!el) return;

        el.innerHTML = '<p style="color:var(--text-muted); padding:1rem;">Fetching linked family members from grid...</p>';
        try {
            const seniors = await fetchCaretakerSeniorsFromApi();
            el.innerHTML = seniors.length
                ? seniors.map(s => `
                    <div class="glass-panel" style="padding:1.5rem; border-color:var(--c-blue); margin-bottom:0.75rem; text-align:left;">
                        <h3 style="color:#fff; margin-bottom:0.5rem; font-weight:700;">${s.full_name || 'Senior Citizen'}</h3>
                        <p style="color:var(--text-muted); margin:0;"><strong>Status:</strong> <span class="badge badge-green" style="background:rgba(0,255,157,0.15); color:var(--c-green); border:1px solid var(--c-green); font-size:0.75rem; padding:0.1rem 0.4rem;">${s.status || 'Active'}</span></p>
                        <p style="color:var(--text-muted); margin:0.25rem 0 0; font-size:0.9rem;"><strong>Phone:</strong> ${s.phone || 'Not provided'}</p>
                        <p style="color:var(--text-muted); margin:0.25rem 0 0; font-size:0.9rem;"><strong>Address:</strong> ${s.address || 'Not provided'}</p>
                    </div>
                `).join('')
                : '<p style="color:var(--text-muted); padding:1rem;">No senior citizens linked to your Family Code yet.</p>';
        } catch (err) {
            console.error(err);
            el.innerHTML = '<p class="text-pink" style="padding:1rem;">Error loading linked family grid.</p>';
        }
    },

    async _loadVolTasks() {
        const grid = document.getElementById('vol-task-grid');
        if (!grid) return;
        const tasks = (await fetchHelpRequests()).filter(r => normalizeRequestStatus(r.status) === 'pending');
        grid.innerHTML = tasks.length
            ? tasks.map(t => `
                <div class="glass-panel" style="padding:1.5rem;border-color:var(--c-green);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                        <b style="color:#fff;font-size:1.15rem;">${t.category || t.type}</b>
                        <span class="badge ${t.priority === 'Urgent' ? 'badge-pink' : 'badge-green'}">${t.priority || t.urgency || 'Normal'}</span>
                    </div>
                    <p style="color:var(--text-muted);font-size:.9rem;margin:.5rem 0;">${t.description || t.desc || 'No description provided.'}</p>
                    <p style="color:var(--text-muted);font-size:.75rem;margin:.25rem 0 1rem;">Preferred: ${new Date(t.created_at || t.ts || Date.now()).toLocaleString()}</p>
                    <button class="btn btn-primary" style="width:100%;margin-top:.5rem;" onclick="app._acceptVolTask('${t.id}')">Accept Task (+10 XP)</button>
                </div>
              `).join('')
            : '<p style="color:var(--text-muted);padding:2rem;text-align:center;width:100%;">No pending community tasks available currently.</p>';
    },

    async _acceptVolTask(id) {
        try {
            await fetch(`${API_BASE_URL}/api/requests/${id}/claim`, {
                method: 'PUT',
                headers: authHeaders()
            });

            await app._loadVolTasks();
            await app._loadVolActiveTasks();
            await app._loadLeaderboard();
        } catch (error) {
            console.warn('Failed to claim task:', error);
        }
    },

    async _loadVolActiveTasks() {
        const list = document.getElementById('vol-active-list');
        if (!list) return;
        const active = (await fetchHelpRequests()).filter(r => (r.volunteer_id || r.volunteerId) === State.userId && r.status === 'Accepted');
        list.innerHTML = active.length
            ? active.map(t => `
                <div class="glass-panel" style="padding:1.5rem;margin-bottom:1rem;border-color:var(--c-blue);">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                        <b style="color:#fff;font-size:1.15rem;">${t.category || t.type}</b>
                        <span class="badge ${t.status === 'Completed' ? 'badge-green' : 'badge-blue'}">${t.status}</span>
                    </div>
                    <p style="color:var(--text-muted);margin:0.5rem 0;">${t.description || t.desc || ''}</p>
                    ${t.status === 'Accepted' ? `
                      <button class="btn btn-primary" style="padding:0.5rem 1rem;font-size:0.85rem;margin-top:0.5rem;" onclick="app._completeVolTask('${t.id}')">Mark As Completed (+20 XP)</button>
                    ` : ''}
                </div>
            `).join('')
            : '<p style="color:var(--text-muted);">No active tasks accepted yet.</p>';
    },

    async _completeVolTask(id) {
        try {
            await fetch(`${API_BASE_URL}/api/requests/${id}/complete`, {
                method: 'PUT',
                headers: authHeaders()
            });

            await app._loadVolTasks();
            await app._loadVolActiveTasks();
            await app._loadLeaderboard();
        } catch (error) {
            console.warn('Failed to complete task:', error);
        }
    },

    async _loadLeaderboard() {
        const el = document.getElementById('vol-leaderboard');
        if (!el) return;

        const requests = await fetchHelpRequests();
        const completed = requests.filter(r => r.status === 'Completed' && (r.volunteer_id || r.volunteerId));
        const users = await fetchUsersFromApi();

        const nameById = {};
        users.forEach(user => {
            const id = user.id || user.uid;
            if (id) {
                nameById[String(id)] = user.full_name || user.username || 'Volunteer';
            }
        });

        const completedByVolunteer = {};
        completed.forEach(req => {
            const volunteerId = String(req.volunteer_id || req.volunteerId || '');
            if (!volunteerId) return;
            completedByVolunteer[volunteerId] = (completedByVolunteer[volunteerId] || 0) + 1;
        });

        const rows = Object.entries(completedByVolunteer).map(([volunteerId, count]) => ({
            volunteerId,
            name: nameById[volunteerId] || 'Volunteer',
            xp: count * 20,
            isMe: volunteerId === String(State.userId)
        }));

        if (!rows.find(row => row.volunteerId === String(State.userId))) {
            rows.push({
                volunteerId: String(State.userId),
                name: State.profile?.full_name || 'Volunteer',
                xp: 0,
                isMe: true
            });
        }

        rows.sort((a, b) => b.xp - a.xp);

        const myXp = (completedByVolunteer[String(State.userId)] || 0) * 20;
        const xpEl = document.getElementById('vol-xp-count');
        if (xpEl) {
            xpEl.textContent = `${myXp} XP`;
        }

        el.innerHTML = rows.length ? rows.map((u, i) => `
            <div class="glass-panel" style="padding:0.75rem 1.5rem;margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;border-color:${u.isMe ? 'var(--c-green)' : 'var(--border-light)'};">
                <div>
                    <span style="font-weight:900;color:var(--text-muted);margin-right:1rem;">#${i+1}</span>
                    <b style="color:${u.isMe ? 'var(--c-green)' : '#fff'};">${u.name}</b>
                </div>
                <span class="badge ${u.isMe ? 'badge-green' : 'badge-blue'}">${u.xp} XP</span>
            </div>
        `).join('') : '<p style="color:var(--text-muted);">No completed volunteer tasks yet.</p>';
    },

    async _loadCareMeds() {
        const feed = document.getElementById('care-med-feed');
        if (!feed) return;
        const logs = (await fetchMedicationLogsFromApi()).filter(l => l.status === 'Skipped');
        feed.innerHTML = logs.length
            ? logs.map(l => `
                <div class="glass-panel" style="padding:1rem;margin-bottom:.75rem;border-left:4px solid var(--c-pink);">
                    <b style="color:var(--c-pink);">⚠️ Skipped</b> — Patient skipped <b>${l.med_name || l.name || 'Medication'}</b> at ${new Date(l.logged_at || l.time || Date.now()).toLocaleString()}
                </div>
            `).join('')
            : '<p style="color:var(--c-green);font-weight:700;">✅ No missed medications flagged.</p>';
    },

    async _loadDoctorAppts(profile) {
        const todayEl = document.getElementById('doc-today-list');
        const upcomingEl = document.getElementById('doc-upcoming-list');
        let appts = [];

        try {
            const response = await fetch(`${API_BASE_URL}/api/appointments`, {
                headers: authHeaders()
            });
            if (response.ok) {
                const payload = await response.json();
                appts = Array.isArray(payload.appointments) ? payload.appointments : [];
            }
        } catch (error) {
            console.warn('Failed to load doctor appointments:', error);
        }
        
        if (todayEl) {
            todayEl.innerHTML = appts.length
                ? appts.map(a => `
                    <div class="glass-panel" style="padding:1.5rem;margin-bottom:.75rem;border-left:4px solid var(--c-green);">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <b style="color:#fff;font-size:1.1rem;">${new Date(a.date).toLocaleDateString()} at ${a.time || '10:00 AM'}</b>
                            <span class="badge badge-green">${a.status}</span>
                        </div>
                        <p style="color:var(--text-muted);margin:0.5rem 0 0;">Patient: <b>${a.patient_name || a.patientName || 'Senior Citizen'}</b> — Specialization: ${(a.doctor || '').split('(')[1]?.replace(')', '') || 'General Checkup'}</p>
                    </div>
                  `).join('')
                : '<p style="color:var(--text-muted);">No appointments scheduled in today\'s agenda.</p>';
        }

        if (upcomingEl) {
            upcomingEl.innerHTML = appts.length
                ? appts.map(a => `
                    <div class="glass-panel" style="padding:1.5rem;margin-bottom:.75rem;border-left:4px solid var(--c-blue);">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <b style="color:#fff;font-size:1.1rem;">${new Date(a.date).toLocaleDateString()} at ${a.time || '10:00 AM'}</b>
                            <span class="badge badge-blue">${a.status}</span>
                        </div>
                        <p style="color:var(--text-muted);margin:0.5rem 0 0;">Patient: <b>${a.patient_name || a.patientName || 'Senior Citizen'}</b> — Practicant: ${a.doctor}</p>
                    </div>
                  `).join('')
                : '<p style="color:var(--text-muted);">No upcoming appointments scheduled.</p>';
        }
    },

    async _loadAdminStats() {
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/stats`, { headers: authHeaders() });
            if (!res.ok) return;
            const d = await res.json();
            const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v ?? '—'; };
            set('stat-seniors', d.total_seniors);
            set('stat-vols',    d.total_volunteers);
            set('stat-sos',     d.active_sos);
            set('stat-pending', d.pending_requests);
        } catch { /* stats unavailable */ }
    },

    async _loadAdminUsers() {
        const el = document.getElementById('admin-user-table');
        if (!el) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/users`, { headers: authHeaders() });
            if (!res.ok) { el.textContent = 'Could not load users.'; return; }
            const { users } = await res.json();
            el.innerHTML = users.map(u => `
<div class="glass-panel" style="display:flex;justify-content:space-between;align-items:center;padding:1rem;margin-bottom:.75rem;">
  <div>
    <b style="color:#fff;">${u.full_name||u.username||'User'}</b> 
    <span style="color:var(--text-muted);font-size:.8rem;margin-left:0.5rem;">(${u.role})</span>
    <span class="badge ${u.status === 'Blocked' ? 'badge-pink' : 'badge-green'}" style="margin-left:0.5rem;">${u.status || 'Active'}</span>
  </div>
  <div style="display:flex;gap:.5rem;">
    <button class="btn btn-outline" style="padding:.4rem .9rem;font-size:.8rem;color:var(--c-pink);border-color:var(--c-pink);" onclick="app._adminBlock('${u.id}')">Block Account</button>
  </div>
</div>`).join('') || '<p>No users found.</p>';
        } catch { el.textContent = 'Backend unavailable.'; }
    },

    async _adminBlock(uid) {
        try {
            await fetch(`${API_BASE_URL}/api/admin/status`, { 
                method:'PUT', 
                headers: authHeaders({ 'Content-Type':'application/json' }), 
                body: JSON.stringify({ uid, status:'Blocked' }) 
            });
            app._loadAdminUsers();
            app._loadAdminVerifications();
        } catch { alert('Failed to block user.'); }
    },

    async _loadAdminSOS() {
        const el = document.getElementById('admin-sos-log');
        if (!el) return;
        const hist = await fetchSOSHistoryFromApi();
        el.innerHTML = hist.length
            ? hist.map(s => `<div class="glass-panel" style="padding:.75rem;margin-bottom:.5rem;"><b style="color:var(--c-pink);">🚨 SOS TRIGGERED</b> — User ID: ${s.user_id || s.userId} — logged at ${new Date(s.created_at || s.ts || Date.now()).toLocaleString()}</div>`).join('')
            : '<p style="color:var(--text-muted);">No historic SOS event logs recorded.</p>';
    },

    async _loadAdminVerifications() {
        const el = document.getElementById('admin-volunteer-verifications');
        if (!el) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/users`, { headers: authHeaders() });
            if (!res.ok) { el.textContent = 'Could not load pending verifications.'; return; }
            const { users } = await res.json();
                        const volunteers = users.filter(u => u.role === 'Volunteer' && u.status !== 'Verified');
            el.innerHTML = volunteers.length ? volunteers.map(u => `
<div class="glass-panel" style="display:flex;justify-content:space-between;align-items:center;padding:1rem;margin-bottom:.75rem;">
  <div>
    <b style="color:#fff;">${u.full_name||u.username||'Volunteer'}</b> 
    <span style="color:var(--text-muted);font-size:.8rem;">(Phone: ${u.phone || 'None'})</span>
    <span class="badge ${u.status === 'Verified' ? 'badge-green' : 'badge-yellow'}" style="margin-left:0.5rem;">${u.status || 'Pending'}</span>
  </div>
  <div style="display:flex;gap:.5rem;">
    ${u.status !== 'Verified' ? `<button class="btn btn-primary" style="padding:.4rem .9rem;font-size:.8rem;" onclick="app._adminApproveVolunteer('${u.id}')">Approve</button>` : ''}
    <button class="btn btn-outline" style="padding:.4rem .9rem;font-size:.8rem;color:var(--c-pink);border-color:var(--c-pink);" onclick="app._adminBlock('${u.id}')">Block</button>
  </div>
</div>`).join('') : '<p>No pending volunteers found.</p>';
        } catch {
            el.textContent = 'Backend unavailable.';
        }
    },

    async _adminApproveVolunteer(uid) {
        try {
            await fetch(`${API_BASE_URL}/api/admin/status`, { 
                method:'PUT', 
                headers: authHeaders({ 'Content-Type':'application/json' }), 
                body: JSON.stringify({ uid, status:'Verified' }) 
            });
            app._loadAdminVerifications();
            app._loadAdminUsers();
        } catch { 
            alert('Failed to verify volunteer.'); 
        }
    },

    router(viewId) {
        if (State.userId) {
            console.log(`[Router SPA] Handling view: ${viewId} inline.`);
            
            // Hide normal landing/auth views
            const homeView = document.getElementById('home-view');
            if (homeView) homeView.style.display = 'none';
            const loginView = document.getElementById('login-view');
            if (loginView) loginView.style.display = 'none';
            const registerView = document.getElementById('register-view');
            if (registerView) registerView.style.display = 'none';

            // Ensure dynamic dashboard is rendered if we have the profile in state
            if (State.profile) {
                app.renderUserDashboard(State.profile);
            }

            // Map viewId to tab names for inline tab switching
            const viewToTabMap = {
                // Senior
                'sos-view': 'sos',
                'help-request-view': 'help',
                'medicine-view': 'meds',
                'appointments-view': 'appts',
                'health-view': 'health',
                'documents-view': 'docs',
                // Caretaker
                'caretaker-view': 'care-alerts',
                // Volunteer
                'volunteer-view': 'vol-tasks',
                // Admin
                'admin-view': 'adm-stats',
            };

            const tabName = viewToTabMap[viewId];
            if (tabName) {
                const role = normalizeRole(State.role || 'Senior Citizen');
                const tabBarId = {
                    'Senior Citizen': 'senior-tab-bar',
                    Caretaker: 'care-tab-bar',
                    Volunteer: 'vol-tab-bar',
                    Doctor: 'doc-tab-bar',
                    Admin: 'admin-tab-bar'
                }[role];

                const tabBar = document.getElementById(tabBarId);
                if (tabBar) {
                    const tabBtn = tabBar.querySelector(`[data-tab="${tabName}"]`);
                    if (tabBtn) {
                        tabBtn.click();
                    } else if (role === 'Caretaker' && tabName === 'meds') {
                        const careMedsBtn = tabBar.querySelector(`[data-tab="care-meds"]`);
                        if (careMedsBtn) careMedsBtn.click();
                    } else if (role === 'Caretaker' && tabName === 'health') {
                        const careHealthBtn = tabBar.querySelector(`[data-tab="care-health"]`);
                        if (careHealthBtn) careHealthBtn.click();
                    } else if (role === 'Caretaker' && tabName === 'docs') {
                        const careDocsBtn = tabBar.querySelector(`[data-tab="care-docs"]`);
                        if (careDocsBtn) careDocsBtn.click();
                    }
                }
            }
            return;
        }

        if (!State.userId) {
            const pages = {
                'home-view': 'index.html',
                'login-view': 'login.html',
                'register-view': 'login.html?mode=register'
            };
            const targetPage = pages[viewId];
            if (targetPage) {
                const currentPath = window.location.pathname;
                if (!currentPath.includes(targetPage.split('?')[0])) {
                    console.log(`[Router Nav] Navigating external to ${targetPage}`);
                    window.location.href = targetPage;
                }
            }
        }
    },

    updateHeader() {
        if(!DOM.navLinks || !DOM.navControls) return;
        DOM.navLinks.innerHTML = '';
        DOM.navControls.innerHTML = '';

        const activeRole = State.role ? normalizeRole(State.role) : null;

        if (!activeRole) {
            DOM.navLinks.innerHTML = `<a href="#" class="btn btn-outline text-pink" style="padding:0.6rem 1rem; font-size:0.85rem;" onclick="app.router('sos-view')">EMERGENCY SOS</a>`;
            DOM.navControls.innerHTML = `<a href="#" class="btn btn-primary" style="padding:0.6rem 1rem; font-size:0.85rem;" onclick="app.router('login-view')">Login / Register</a>`;
            return;
        }

        // Shared
        DOM.navLinks.innerHTML += `<a href="#" class="text-pink" onclick="app.router('sos-view')">EMERGENCY SOS</a>`;

        if (activeRole === 'Senior Citizen') {
            DOM.navLinks.innerHTML += `<a href="#" class="text-blue" onclick="app.router('help-request-view')">Request Help</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-green" onclick="app.router('medicine-view')">Meds</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-pink" onclick="app.router('appointments-view')">Appointments</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-yellow" onclick="app.router('health-view')">Health</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-blue" onclick="app.router('documents-view')">Docs</a>`;
        } else if (activeRole === 'Volunteer') {
            DOM.navLinks.innerHTML += `<a href="#" class="text-green" onclick="app.router('volunteer-view')">Volunteer Tasks</a>`;
        } else if (activeRole === 'Caretaker') {
            DOM.navLinks.innerHTML += `<a href="#" class="text-blue" onclick="app.router('caretaker-view')">Care Command</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-green" onclick="app.router('medicine-view')">Meds</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-pink" onclick="app.router('appointments-view')">Appointments</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-yellow" onclick="app.router('health-view')">Health</a>`;
            DOM.navLinks.innerHTML += `<a href="#" class="text-blue" onclick="app.router('documents-view')">Docs</a>`;
        } else if (activeRole === 'Admin') {
            DOM.navLinks.innerHTML += `<a href="#" class="text-pink" onclick="app.router('admin-view')">Admin Dashboard</a>`;
        }

        const displayName = getDisplayName();
        const avatarUrl = getAvatarUrl();

        DOM.navControls.innerHTML = `
            <div style="background: var(--bg-input); padding: 0.5rem 1rem; border-radius: 50px; border: 1px solid var(--border-light); display: flex; gap: 1rem; align-items: center;">
                <div style="display:flex; align-items:center; gap:0.75rem; min-width:0;">
                    <img src="${avatarUrl}" alt="${displayName}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=00D2FF&color=ffffff'" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:1px solid var(--border-light); flex-shrink:0;">
                    <div style="min-width:0;">
                        <div class="text-white font-bold text-sm" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:160px;">${displayName}</div>
                        <div class="text-muted text-xs" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:160px;">${State.email || ''}</div>
                    </div>
                </div>
                <div class="notification-container" style="position: relative; cursor: pointer;">
                    <span style="font-size: 1.2rem;" onclick="app.toggleNotifications()">🔔</span>
                    <span id="notif-badge" class="badge-pink" style="position: absolute; top: -5px; right: -10px; font-size: 0.6rem; padding: 0.1rem 0.3rem; border-radius: 50%; display: none;">0</span>
                    <div id="notif-dropdown" class="glass-panel hidden" style="position: absolute; top: 30px; right: -50px; width: 300px; padding: 1rem; z-index: 200;">
                        <h4 class="text-white font-bold mb-2">Notifications</h4>
                        <div id="notif-list" style="max-height: 200px; overflow-y: auto;">
                            <p class="text-muted text-sm text-center">No notifications.</p>
                        </div>
                    </div>
                </div>
                <a href="#" class="text-muted font-bold text-sm" onclick="app.router('profile-view')" style="text-decoration:none;">[${State.role}]</a>
                <div style="width: 1px; height: 16px; background: var(--border-light);"></div>
                <button class="btn-text text-pink font-bold text-sm" onclick="app.logout()">LOGOUT</button>
            </div>
        `;
        if(this.updateNotificationBadge) this.updateNotificationBadge();
    },

    // --- Authentication ---
    selectedRole: 'Senior Citizen',
    renderAuthRoleSelect() {
        DOM.roleBtns.forEach(btn => {
            btn.onclick = () => {
                DOM.roleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedRole = btn.dataset.role;
                if (State.isRegistering && DOM.authTitle) {
                    const rT = this.selectedRole === 'Senior Citizen' ? 'Senior' : this.selectedRole;
                    DOM.authTitle.innerText = `Register as ${rT}`;
                }
            };
        });
    },

    registerMode: null, // 'google' or 'email'
    setRegisterMode(mode) {
        this.registerMode = mode;
        if (mode) sessionStorage.setItem('nammaCare_regMode', mode);
        else sessionStorage.removeItem('nammaCare_regMode');
    },

    async handleAuth(e, mode) {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.dataset.originalText = submitBtn.innerText;
            submitBtn.innerText = 'Processing...';
        }

        try {
            const client = await ensureSupabaseClient();
        
        if (mode === 'login') {
            window._loginInProgress = true;
            const identifier = document.getElementById('login-userid')?.value;
            const password = document.getElementById('login-password')?.value;

            const { error, data } = await client.auth.signInWithPassword({
                email: identifier.includes('@') ? identifier : undefined,
                phone: !identifier.includes('@') ? identifier : undefined,
                password: password
            });
            
            if (error || !data.user) {
                window._loginInProgress = false;
                console.error('Supabase login failed:', error?.message);
                alert('Login failed: ' + (error?.message || 'Invalid credentials'));
            } else {
                console.log('Supabase login successful');
                // Don't set _loginInProgress to false here; let auth listener handle navigation
            }
        } else if (mode === 'register') {
            const currentMode = app.registerMode || sessionStorage.getItem('nammaCare_regMode');
            console.log('HandleAuth: Registering with mode:', currentMode);
            const formData = {
                name: document.getElementById('reg-name').value,
                username: document.getElementById('reg-username')?.value,
                phone: document.getElementById('reg-phone').value,
                dob: document.getElementById('reg-dob').value,
                role: document.getElementById('reg-role').value,
                address: document.getElementById('reg-address').value,
                email: document.getElementById('reg-userid').value,
                password: document.getElementById('reg-password').value,
                family_link_code_input: document.getElementById('reg-family-link')?.value || undefined
            };

            if (currentMode === 'google') {
                console.log('Google Mode detected. Staging data...');
                localStorage.setItem('staged_onboarding_data', JSON.stringify(formData));
                await app.signInWithGoogle();
            } else {
                console.log('Email Mode detected. Proceeding with signup...');
                // EMAIL REGISTRATION
                const email = formData.email;
                const password = formData.password;

                if (!email || !password) {
                    alert('Email and Password are required.');
                    return;
                }

                let sessionData = await client.auth.getSession();
                let userId = sessionData.data?.session?.user?.id;
                let sessionToUse = sessionData.data?.session;

                if (!userId) {
                    window._registrationInProgress = true;
                    const { data, error } = await client.auth.signUp({
                        email: email,
                        password: password
                    });

                    if (error) {
                        window._registrationInProgress = false;
                        if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already exists') || error.message.toLowerCase().includes('user already exists')) {
                            const { data: signInData, error: signInErr } = await client.auth.signInWithPassword({ email, password });
                            if (signInErr) {
                                alert('Registration failed: Email already taken, and could not log in to complete profile. ' + signInErr.message);
                                return;
                            }
                            userId = signInData.user.id;
                            sessionToUse = signInData.session;
                        } else {
                            alert('Registration failed: ' + error.message);
                            return;
                        }
                    } else if (data?.user) {
                        userId = data.user.id;
                        sessionToUse = data.session || (await client.auth.getSession()).data?.session;
                    }
                }

                if (userId) {
                    const token = sessionToUse?.access_token;
                    if (!token) {
                        window._registrationInProgress = false;
                        alert(
                            'Your account was created but a session could not be established. ' +
                            'Please sign in directly with your email and password.'
                        );
                        return;
                    }

                    // ── Build the ProfileCreate payload matching our Pydantic schema exactly ──
                    const noCaretakerEl = document.getElementById('no-caretaker-checkbox');
                    const profilePayload = {
                        full_name:                formData.name,
                        username:                 formData.username  || email.split('@')[0],
                        phone:                    formData.phone,
                        role:                     formData.role,
                        dob:                      formData.dob      || null,
                        address:                  formData.address  || null,
                        assign_community_caretaker: noCaretakerEl ? noCaretakerEl.checked : false,
                        family_link_code_input:   (formData.family_link_code_input &&
                                                   formData.family_link_code_input.trim())
                                                    ? formData.family_link_code_input.trim()
                                                    : null
                    };
                    // Strip null values — FastAPI ignores them but keep it clean
                    Object.keys(profilePayload).forEach(k => {
                        if (profilePayload[k] === null) delete profilePayload[k];
                    });

                    const response = await fetch(
                        `${API_BASE_URL}/api/profile/${userId}`,
                        {
                            method:  'POST',
                            headers: {
                                'Content-Type':  'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify(profilePayload)
                        }
                    );

                    const profileRes = await response.json();
                    if (!response.ok) {
                        window._registrationInProgress = false;
                        const detail = profileRes?.detail;
                        const msg = Array.isArray(detail)
                            ? detail.map(d => d.msg).join(', ')
                            : (typeof detail === 'string' ? detail : JSON.stringify(profileRes));
                        alert('Profile setup failed: ' + msg);
                    } else {
                        window._registrationInProgress = false;

                        // Hydrate in-memory state from the canonical Supabase row
                        applyProfileToState(
                            { id: userId, email, user_metadata: { role: profileRes.role } },
                            profileRes,
                            token
                        );
                        app.updateHeader();

                        // Dismiss auth panels
                        const loginView    = document.getElementById('login-view');
                        const registerView = document.getElementById('register-view');
                        if (loginView)    loginView.style.display    = 'none';
                        if (registerView) registerView.style.display = 'none';

                        // Navigate to the role-specific dashboard
                        app.router(getDashboardForRole(profileRes.role));
                    }
                }
            }
        }
        } catch (err) {
            window._registrationInProgress = false;
            console.error('Auth handler error:', err);
            alert('An error occurred: ' + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = submitBtn.dataset.originalText || 'Submit';
            }
        }
    },

    toggleAuthMode(mode) {
        const loginView = document.getElementById('login-view');
        const registerView = document.getElementById('register-view');

        if (!mode) {
            mode = State.isRegistering ? 'login' : 'register';
        }

        if (mode === 'register') {
            if (loginView) loginView.style.display = 'none';
            if (registerView) registerView.style.display = 'block';
            this.setRegisterMode(null);
            localStorage.removeItem('staged_onboarding_data');
            sessionStorage.removeItem('nammaCare_regMode');
            State.isRegistering = true;
        } else {
            if (loginView) loginView.style.display = 'block';
            if (registerView) registerView.style.display = 'none';
            State.isRegistering = false;
        }
        saveState();
    },

    signInWithGoogle() {
        signInWithGoogle();
    },

    showError(msg) {
        if(DOM.authError) DOM.authError.classList.remove('hidden');
        if(DOM.authForm) DOM.authForm.classList.add('hidden');
        if(DOM.authErrorMsg) DOM.authErrorMsg.innerText = msg;
    },

    clearError() {
        DOM.authError.classList.add('hidden');
        DOM.authForm.classList.remove('hidden');
    },

    togglePassword() {
        const pInput = document.getElementById('auth-password');
        if (pInput.type === 'password') {
            pInput.type = 'text';
        } else {
            pInput.type = 'password';
        }
    },

    logout() {
        return handleSignOut();
    },

    // --- Profile Editing ---
    async toggleProfileEdit() {
        const btn = document.getElementById('profile-edit-btn');
        const inputs = document.querySelectorAll('.input-field');
        const alertBox = document.getElementById('profile-verification-alert');

        const isEditing = btn.innerText === 'Save Profile';

        if (isEditing) {
            State.profile = {
                name: document.getElementById('prof-name').value,
                dob: document.getElementById('prof-dob').value,
                address: document.getElementById('prof-address').value,
                phone: document.getElementById('prof-phone').value,
                emergency: document.getElementById('prof-emergency').value
            };
            saveState();

            fetch(`${API_BASE_URL}/api/profile/${State.userId}`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    full_name: State.profile.name,
                    dob: State.profile.dob,
                    address: State.profile.address,
                    phone: State.profile.phone
                })
            }).catch(e => console.error('Failed to sync profile:', e));

            btn.innerText = 'Edit Information';
            btn.classList.remove('text-black');
            btn.style.background = '';
            inputs.forEach(i => i.disabled = true);
            if(alertBox) alertBox.classList.remove('hidden');
        } else {
            btn.innerText = 'Save Profile';
            btn.style.background = 'var(--c-green)';
            btn.classList.add('text-black');
            inputs.forEach(i => i.disabled = false);
            if(alertBox) alertBox.classList.add('hidden');
        }
    },

    renderProfile() {
        if(document.getElementById('prof-name') && State.profile) {
            document.getElementById('prof-name').value = State.profile.name;
            document.getElementById('prof-dob').value = State.profile.dob;
            document.getElementById('prof-address').value = State.profile.address;
            document.getElementById('prof-phone').value = State.profile.phone;
            document.getElementById('prof-emergency').value = State.profile.emergency;
        }
    },

    // --- SOS Logic ---
    showSOSModal() {
        DOM.sosModal.classList.remove('hidden');
    },
    hideSOSModal() {
        if(DOM.sosModal) DOM.sosModal.classList.add('hidden');
    },
    confirmSOS(type) {
        this.hideSOSModal();

        this.addNotification(`SOS Initiated: ${type}`, State.userId);
        this.addNotification('URGENT SOS TRIGGERED: Patient Deploy!', null, 'Caretaker');

        if(DOM.sosIdle) DOM.sosIdle.classList.add('hidden');
        if(document.getElementById('sos-history')) document.getElementById('sos-history').classList.add('hidden');
        if(DOM.sosActivePanel) DOM.sosActivePanel.classList.remove('hidden');

        if(document.getElementById('sos-req-id')) document.getElementById('sos-req-id').innerText = `SOS-${Date.now()}`;
        if(document.getElementById('sos-req-type')) document.getElementById('sos-req-type').innerText = type;
        if(document.getElementById('sos-req-loc')) document.getElementById('sos-req-loc').innerText = 'Dispatching via live GPS...';

        this.dispatchSOSAlert().finally(() => {
            this._loadCareSOS(State.profile);
            this.renderSOSHistory();
        });
    },
    cancelSOS() {
        if(DOM.sosIdle) DOM.sosIdle.classList.add('hidden');
        if(document.getElementById('sos-history')) document.getElementById('sos-history').classList.remove('hidden');
        if(DOM.sosActivePanel) DOM.sosActivePanel.classList.add('hidden');
        this.renderSOSHistory();
        this._loadCareSOS(State.profile);
    },
    
    async dispatchSOSAlert() {
        console.log("SOS Button clicked. Initiating GPS Handshake...");
        
        const options = {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        };

        const successCallback = async (position) => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;
            console.log(`GPS Acquired: ${latitude}, ${longitude}`);
            
            try {
                const response = await fetch(`${API_BASE_URL}/api/sos/trigger`, {
                    method: 'POST',
                    headers: authHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        latitude: latitude,
                        longitude: longitude
                    })
                });
                
                if (response.ok) {
                    console.log("SOS triggered successfully via API.");
                    alert("Emergency alert sent to caretaker via email.");
                } else {
                    console.error("Failed to trigger SOS:", await response.text());
                }
            } catch (err) {
                console.error("Error triggering SOS API:", err);
            }
        };

        const errorCallback = async (error) => {
            console.warn("Live GPS acquisition failed or timed out.", error);
            alert("Live GPS is required for SOS. Please allow location access and try again.");
        };

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(successCallback, errorCallback, options);
        } else {
            errorCallback(new Error("Geolocation not supported by browser."));
        }
    },

    async renderSOSHistory() {
        if(!DOM.sosHistoryList) return;
        const events = await fetchSOSHistoryFromApi();
        const myHistory = events.filter(h => (h.user_id || h.userId) === State.userId);
        
        DOM.sosHistoryList.innerHTML = myHistory.length ? myHistory.map(h => `
            <div class="history-item">
                <div>
                    <h4 class="text-white font-bold text-lg">Emergency SOS</h4>
                    <p class="text-muted text-sm mt-1">${new Date(h.created_at || h.ts || Date.now()).toLocaleString()}</p>
                </div>
                <span class="badge ${h.resolved ? 'badge-green' : 'badge-pink'} uppercase">${h.resolved ? 'Resolved' : 'Active'}</span>
            </div>
        `).join('') : '<p class="text-muted text-center pt-4">No past emergencies triggered.</p>';
    },

    // --- Help Requests (Citizen) ---
    selectedUrgency: 'Normal',
    setUrgency(btn, val) {
        DOM.urgencyBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedUrgency = val;
    },

    submitHelpRequestForm(e) {
        return this.submitHelpRequest(e);
    },

    async renderCitizenRequests() {
        if(!DOM.citReqList) return;
        const liveRequests = await fetchHelpRequests();
        const myReqs = liveRequests.filter(r => (r.senior_id || r.seniorId) === State.userId);

        DOM.citReqList.innerHTML = myReqs.length ? myReqs.map(req => {
            let colorClass = req.status === 'Completed' ? 'badge-green' : (req.status === 'Accepted' ? 'badge-blue' : 'badge-yellow');
            return `
            <div class="glass-panel" style="padding: 1.5rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 class="text-white font-bold text-xl">${req.category || req.type || 'Help Request'}</h4>
                    <p class="text-muted text-sm mt-1">${req.priority} Priority  ${req.time || req.ts || ''}</p>
                </div>
                <span class="badge ${colorClass} uppercase">${req.status}</span>
            </div>
        `}).join('') : '<p class="text-muted text-center pt-4">No active requests.</p>';
    },

    // --- Volunteer Tracking ---
    async renderVolunteerTasks() {
        const pendingTasksEl = document.getElementById('vol-pending-tasks');
        const activeTasksEl = document.getElementById('vol-active-tasks');
        const pendingCountEl = document.getElementById('vol-pending-count');
        const activeCountEl = document.getElementById('vol-active-count');
        if(!pendingTasksEl || !activeTasksEl || !pendingCountEl || !activeCountEl) return;
        const liveRequests = await fetchHelpRequests();
        const pending = liveRequests.filter(r => r.status === 'Pending');
        const active = liveRequests.filter(r => r.status === 'Accepted');

        pendingCountEl.innerText = pending.length;
        activeCountEl.innerText = active.length;
        
        const pointsEl = document.getElementById('vol-points');
        if(pointsEl) pointsEl.innerText = '0';

        pendingTasksEl.innerHTML = pending.length ? pending.map(req => this.buildTaskCard(req, 'pending')).join('') : this.emptyBox('Grid clear. No pending requests.');
        activeTasksEl.innerHTML = active.length ? active.map(req => this.buildTaskCard(req, 'assigned')).join('') : this.emptyBox('Queue empty. Time to step up.');
    },

    buildTaskCard(req, mode) {
        const pColor = req.priority === 'Urgent' ? 'badge-pink' : 'badge-blue';
        const buttonHTML = mode === 'pending' ? 
            `<div style="display:flex; gap:0.5rem; margin-top:1rem;">
                <button class="btn-task-action" style="flex:1;" onclick="app.volAccept('${req.id}')">Accept Mission</button>
                <button class="btn-task-action border-pink text-pink" style="flex:1; border-color:var(--c-pink); color:var(--c-pink); background:rgba(255,0,122,0.1);" onclick="app.volReject('${req.id}')">Reject</button>
             </div>` :
            `<div class="task-status-route"> Active Accepted Route</div>
             <button class="btn-task-action btn-task-complete" onclick="app.volComplete('${req.id}')">Mark Completed</button>`;

        return `
            <div class="task-card ${mode === 'assigned' ? 'assigned' : ''}">
                <div class="task-header">
                    <h4 class="text-xl font-bold text-white">${req.category || req.type || 'Help Request'}</h4>
                    <span class="badge ${pColor}">${req.priority}</span>
                </div>
                <p class="task-time"> ${req.time || req.ts || ''}</p>
                <div class="task-desc"><strong class="text-muted uppercase">Brief:</strong> ${req.description || req.desc || 'Local assistance needed.'}</div>
                ${buttonHTML}
            </div>
        `;
    },

    emptyBox(msg) {
        return `<div style="padding: 2rem; border: 2px dashed var(--border-light); border-radius: 1.5rem; text-align: center; color: var(--text-muted); font-weight: bold;">${msg}</div>`;
    },

    volAccept(id) {
        fetch(`${API_BASE_URL}/api/requests/${id}/claim`, {
            method: 'PUT',
            headers: authHeaders()
        }).then(() => this.renderVolunteerTasks()).catch(err => console.warn('Failed to claim request:', err));
    },

    volReject(id) {
        fetch(`${API_BASE_URL}/api/requests/${id}/reject`, {
            method: 'PUT',
            headers: authHeaders()
        }).then(() => this.renderVolunteerTasks()).catch(err => console.warn('Failed to reject request:', err));
    },
    
    volComplete(id) {
        fetch(`${API_BASE_URL}/api/requests/${id}/complete`, {
            method: 'PUT',
            headers: authHeaders()
        }).then(() => this.renderVolunteerTasks()).catch(err => console.warn('Failed to complete request:', err));
    },

    // --- Caretaker Tracking ---
    async renderCaretakerTasks() {
        const careReqList = document.getElementById('care-requests-list');
        if(!careReqList) return;

        const careTitle = document.getElementById('care-dashboard-title');
        if (careTitle && State.profile) {
            const displayName = (State.profile.full_name || State.profile.name || 'Caretaker').split(' ')[0];
            careTitle.innerText = `Command Overview - ${displayName}`;
        }

        const activeSeniors = await fetchCaretakerSeniorsFromApi();

        const careProfileHtml = document.getElementById('care-patient-profile');
        if(careProfileHtml && activeSeniors.length > 0) {
            careProfileHtml.innerHTML = activeSeniors.map(sen => `
                <div style="margin-bottom:0.75rem; padding: 1rem; background: rgba(255,255,255,0.02); border: 1px solid var(--border-light); border-radius: 0.75rem; text-align:left;">
                    <strong class="text-white text-lg">${sen.full_name || 'Senior Citizen'}</strong>
                    <span class="text-xs text-blue ml-2" style="color:var(--c-blue);">(ID: ${sen.id})</span><br>
                    <span class="text-muted block mt-1" style="display:block; margin-top:0.25rem; font-size:0.9rem;">📌 Address: ${sen.address || 'Not specified'}</span>
                    <span class="text-pink block mt-1" style="display:block; margin-top:0.25rem; font-size:0.9rem; color:var(--c-pink);">📞 Phone: ${sen.phone || 'Not specified'}</span>
                </div>
            `).join('');
        } else if (careProfileHtml) {
            careProfileHtml.innerHTML = '<span class="text-muted" style="padding:1rem; display:block;">No senior citizens linked to your Family Code yet.</span>';
        }

        // Real-Time Active SOS Lookup from live database rows
        const sosEvents = await fetchSOSHistoryFromApi();
        const activeSOS = sosEvents.filter(event => !event.resolved);

        const activeSOSContainer = document.getElementById('care-sos-feed');
        if (activeSOSContainer) {
            if(activeSOS.length > 0) {
                const currentSOS = activeSOS[0];
                activeSOSContainer.innerHTML = `
                    <div class="alert-error" style="border: 1px solid var(--c-pink); box-shadow: 0 0 30px rgba(255,0,122,0.3); background: rgba(255,0,122,0.15); padding:1.5rem; border-radius:1rem; text-align:left; margin-bottom:2rem;">
                        <h2 class="text-xl font-black text-pink flex-align mb-2" style="color:var(--c-pink); font-weight:900; margin-bottom:0.5rem;">🚨 ACTIVE SOS DISPATCH EN-ROUTE</h2>
                        <p style="color:#fff; margin:0;">Senior ID Account: <strong>${currentSOS.user_id}</strong> has issued an emergency beacon!</p>
                        <p style="color:var(--text-muted); font-size:0.85rem; margin-top:0.25rem;">Coordinates: ${currentSOS.latitude}, ${currentSOS.longitude}</p>
                    </div>
                `;
            } else {
                activeSOSContainer.innerHTML = `
                    <div style="background: rgba(255,255,255,0.02); padding: 1.5rem; border: 1px dashed var(--border-light); border-radius: 1.5rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center; color: var(--text-muted);">
                        <p class="font-bold" style="margin:0;">No active family SOS alerts. System secure.</p>
                        <span class="text-blue font-bold text-xs uppercase" style="color:var(--c-blue); font-weight:900;">ONLINE</span>
                    </div>
                `;
            }
        }

        // Live Help Requests feed filtered strictly by linked relationship scopes
        const liveRequests = await fetchHelpRequests();
        const linkedSeniorIds = activeSeniors.map(s => s.id);
        const familyRequests = liveRequests.filter(r => linkedSeniorIds.includes(r.senior_id || r.seniorId));

        careReqList.innerHTML = familyRequests.length ? familyRequests.map(req => `
            <div style="background: rgba(255,255,255,0.02); padding: 1.5rem; border-radius: 1.5rem; border: 1px solid var(--border-light); border-left: 4px solid var(--c-blue); margin-bottom: 1rem; text-align:left;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                    <h4 class="text-white font-bold text-lg" style="margin:0;">${req.category || req.type}</h4>
                    <span class="badge badge-mono uppercase">${req.status}</span>
                </div>
                <p class="text-muted mt-2 text-sm" style="margin: 0.5rem 0 0; color:var(--text-muted);">${req.description || 'Assistance requested by your linked senior citizen relative.'}</p>
            </div>
        `).join('') : '<p class="text-muted text-center pt-8" style="padding:2rem; color:var(--text-muted);">No help requests actively logged by your linked family members.</p>';

        // Skipped Medication Feed tracking directly from Supabase logs
        const careMedAlerts = document.getElementById('care-med-feed');
        if(careMedAlerts) {
            const logs = await fetchMedicationLogsFromApi();
            const skippedMeds = logs.filter(l => l.status === 'Skipped');
            careMedAlerts.innerHTML = skippedMeds.length ? skippedMeds.map(log => `
                <div style="background: rgba(255,255,255,0.02); border:1px solid var(--border-light); padding: 1rem; border-radius: 1rem; border-left: 4px solid var(--c-pink); margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; text-align:left;">
                    <div>
                        <h4 class="text-white font-bold" style="margin:0;">${log.med_name || 'Prescribed Pill'}</h4>
                        <p class="text-muted text-sm" style="margin:0.25rem 0 0; font-size:0.85rem;">Logged at: ${new Date(log.logged_at).toLocaleTimeString()}</p>
                    </div>
                    <span class="badge badge-pink" style="background:rgba(255,0,122,0.15); color:var(--c-pink); border:1px solid var(--c-pink);">SKIPPED</span>
                </div>
            `).join('') : '<p class="text-muted text-center pt-4" style="padding:1rem; color:var(--text-muted);">No medication log anomalies recorded.</p>';
        }
    },

    // ==========================================
    // SPRINT-2: NOTIFICATIONS
    // ==========================================
    toggleNotifications() {
        const drop = document.getElementById('notif-dropdown');
        if(drop) {
            drop.classList.toggle('hidden');
            if(!drop.classList.contains('hidden')) {
                fetch(`${API_BASE_URL}/api/notifications/read`, {
                    method: 'PUT',
                    headers: authHeaders()
                }).catch(() => {});
                this.updateNotificationBadge();
            }
        }
    },
    async updateNotificationBadge() {
        if(!State.userId) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/notifications`, {
                headers: authHeaders()
            });
            if (!response.ok) return;

            const payload = await response.json();
            const notifications = Array.isArray(payload.notifications) ? payload.notifications : [];
            const badge = document.getElementById('notif-badge');
            const unreadCount = notifications.filter(n => !n.is_read).length;

            if(badge) {
                if(unreadCount > 0) {
                    badge.style.display = 'block';
                    badge.innerText = unreadCount;
                } else {
                    badge.style.display = 'none';
                }
            }

            const list = document.getElementById('notif-list');
            if(list) {
                if(notifications.length > 0) {
                    list.innerHTML = notifications.map(n => `
                        <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
                            <span class="text-green text-xs font-bold">${new Date(n.created_at || Date.now()).toLocaleTimeString()}</span>
                            <p class="text-sm text-white">${n.message}</p>
                        </div>
                    `).join('');
                } else {
                    list.innerHTML = '<p class="text-muted text-sm text-center">No notifications.</p>';
                }
            }
        } catch (error) {
            console.warn('Failed to load notifications:', error);
        }
    },
    async addNotification(message, forUser = null, forRole = null) {
        try {
            const linkedCaretakerId = forRole === 'Caretaker' ? State.profile?.linked_caretaker_id || null : null;
            const userId = forUser || linkedCaretakerId;
            const roleTarget = userId ? null : forRole;

            const response = await fetch(`${API_BASE_URL}/api/notifications`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    message,
                    user_id: userId,
                    role_target: roleTarget
                })
            });
            if (!response.ok) {
                throw new Error(`Notification create failed: ${response.status}`);
            }
            await this.updateNotificationBadge();
        } catch (error) {
            console.warn('Failed to save notification:', error);
        }
    },

    // ==========================================
    // SPRINT-2: MEDICINE REMINDER
    // ==========================================
    startMedicationTick() {
        setInterval(() => {
            if(!State.userId) return;
            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:MM
            let db = getLocalCache();
            let changed = false;
            
            db.medications.forEach(med => {
                if(med.user === State.userId && med.time === timeStr) {
                    if(!med.lastNotified || med.lastNotified !== new Date().toLocaleDateString()) {
                        med.lastNotified = new Date().toLocaleDateString();
                        changed = true;
                        
                        this.addNotification(`Time for medication: ${med.name} (${med.dosage})`, State.userId);
                        if(State.role === 'Caretaker') {
                            this.addNotification(`Patient Med Due: ${med.name}`, null, 'Caretaker');
                        }
                        
                        if ("Notification" in window && Notification.permission === 'granted') {
                            new Notification('Medication Reminder', { body: `It's time for ${med.name}` });
                        }
                    }
                }
            });

            // Appointment Reminders (30 minutes before)
            const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
            db.appointments.forEach(appt => {
                if(appt.user === State.userId && appt.status === 'Confirmed' && appt.date === todayStr) {
                    const [h, m] = appt.time.split(':').map(Number);
                    const apptTime = new Date(now);
                    apptTime.setHours(h, m, 0, 0);
                    
                    const diffMs = apptTime - now;
                    // If within 30 minutes
                    if(diffMs > 0 && diffMs <= 30 * 60000) {
                        if(!appt.lastNotified || appt.lastNotified !== todayStr) {
                            appt.lastNotified = todayStr;
                            changed = true;
                            
                            this.addNotification(`Reminder: Appointment with ${appt.doctor} in 30 mins!`, State.userId);
                            if(State.role === 'Caretaker') {
                                this.addNotification(`Patient Appt Reminder: ${appt.doctor} in 30 mins`, null, 'Caretaker');
                            }
                            if ("Notification" in window && Notification.permission === 'granted') {
                                new Notification('Appointment Reminder', { body: `Upcoming Appointment: ${appt.doctor}` });
                            }
                        }
                    }
                }
            });

            // Daily Check-In Missing Alert
            if (State.role === 'Senior Citizen' && now.getHours() >= 18) { // 6 PM
                const localeToday = now.toLocaleDateString();
                const hasCheckedIn = db.checkIns.find(c => c.user === State.userId && c.date === localeToday);
                if (!hasCheckedIn) {
                    const alertKey = 'checkin_alert_' + localeToday;
                    if (!sessionStorage.getItem(alertKey)) {
                        sessionStorage.setItem(alertKey, 'true');
                        this.addNotification(`URGENT: Patient has not checked in today!`, null, 'Caretaker');
                        this.addNotification(`Please click "I am Safe" in Health Dashboard!`, State.userId);
                    }
                }
            }

            if(changed) persistLocalCache(db);
            this.refreshLiveDashboardData();
        }, 10000); // check every 10s
    },
    async submitMedicine(e) {
        e.preventDefault();
        const name = document.getElementById('med-name').value;
        const dosage = document.getElementById('med-dosage').value;
        const freq = document.getElementById('med-freq').value;
        const time = document.getElementById('med-time').value;

        try {
            const response = await fetch(`${API_BASE_URL}/api/medications`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    name,
                    dosage,
                    frequency: freq,
                    intake_time: time
                })
            });

            if (!response.ok) {
                throw new Error(`Medication create failed: ${response.status}`);
            }

            if(e.target) e.target.reset();
            await this.renderMedications();
            if(document.getElementById('help-success-alert')) {
                 document.getElementById('help-success-alert').innerText = "Medication added successfully.";
                 document.getElementById('help-success-alert').classList.remove('hidden');
                 setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
            }
        } catch (error) {
            console.error('Failed to save medication:', error);
            alert('Unable to save medication right now.');
        }
    },
    async renderMedications() {
        const list = document.getElementById('med-list');
        if(!list) return;

        try {
            const meds = await fetchMedicationsFromApi();

            list.innerHTML = meds.length ? meds.map(med => {
                const escapedName = String(med.name || '').replace(/'/g, "\\'");
                return `
            <div class="glass-panel" style="padding: 1rem; margin-bottom: 1rem;">
                <h4 class="text-white font-bold text-lg">${med.name}</h4>
                <p class="text-muted text-sm">${med.dosage}  ${med.frequency}  ${med.intake_time}</p>
                <div class="mt-4 flex-align">
                    <button class="btn-task-action" style="padding: 0.5rem; font-size: 0.8rem;" onclick="app.logMedicine('${med.id}', 'Taken', '${escapedName}')">Take Now</button>
                    <button class="btn-task-action" style="padding: 0.5rem; font-size: 0.8rem; border-color: var(--c-pink); color: var(--c-pink); background: rgba(255,0,122,0.1);" onclick="app.logMedicine('${med.id}', 'Skipped', '${escapedName}')">Skip</button>
                </div>
            </div>`;
            }).join('') : '<p class="text-muted text-center pt-4">No medications added.</p>';
        } catch (error) {
            console.error('Failed to load medications:', error);
            list.innerHTML = '<p class="text-muted text-center pt-4">Unable to load medications.</p>';
        }
    },
    async logMedicine(id, status, medName = '') {
        try {
            const response = await fetch(`${API_BASE_URL}/api/medications/log`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    med_id: String(id),
                    med_name: medName,
                    status
                })
            });

            if (!response.ok) {
                throw new Error(`Medication log failed: ${response.status}`);
            }

            if(status === 'Skipped') {
                this.addNotification(`Patient Skipped Medication: ${medName}`, null, 'Caretaker');
            } else {
                this.addNotification(`Patient Taken Medication: ${medName}`, null, 'Caretaker');
            }
            if(document.getElementById('help-success-alert')) {
                 document.getElementById('help-success-alert').innerText = "Medication status logged.";
                 document.getElementById('help-success-alert').classList.remove('hidden');
                 setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
            }
        } catch (error) {
            console.error('Failed to save medication log:', error);
            alert('Unable to log medication status right now.');
        }
    },

    // ==========================================
    // SPRINT-2: APPOINTMENTS
    // ==========================================
    async populateDoctorSelect() {
        const sel = document.getElementById('appt-doctor');
        if (!sel) return;

        const doctors = await fetchDoctorsFromApi();
        sel.innerHTML = doctors.length
            ? doctors.map(doc => `<option value="${doc.id}">${doc.full_name}</option>`).join('')
            : '<option value="">No registered doctors available</option>';
    },

    async submitAppointment(e) {
        e.preventDefault();
        const sel = document.getElementById('appt-doctor');
        if (!sel.value) {
            alert('No registered doctor is available for booking yet.');
            return;
        }
        const docName = sel.options[sel.selectedIndex].text;
        const doctorId = sel.value;
        const date = document.getElementById('appt-date').value;
        const time = document.getElementById('appt-time').value;

        try {
            const response = await fetch(`${API_BASE_URL}/api/appointments`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    doctor: docName,
                    doctor_id: doctorId,
                    date,
                    time
                })
            });

            if (!response.ok) {
                throw new Error(`Appointment create failed: ${response.status}`);
            }

            this.addNotification(`New Appointment Confirmed: ${docName} on ${date}`, State.userId);
            this.addNotification(`Patient Booked Appointment: ${docName}`, null, 'Caretaker');

            if(e.target) e.target.reset();
            await this.renderAppointments();
            if(document.getElementById('help-success-alert')) {
                 document.getElementById('help-success-alert').innerText = 'Appointment confirmed.';
                 document.getElementById('help-success-alert').classList.remove('hidden');
                 setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
            }
        } catch (error) {
            console.error('Failed to save appointment:', error);
            alert('Unable to book appointment right now.');
        }
    },
    async renderAppointments() {
        const list = document.getElementById('appt-list');
        const dashList = document.getElementById('dash-appt-list'); 
        if(!list && !dashList) return;

        let appts = [];
        try {
            const response = await fetch(`${API_BASE_URL}/api/appointments`, {
                headers: authHeaders()
            });
            if (response.ok) {
                const payload = await response.json();
                appts = Array.isArray(payload.appointments) ? payload.appointments : [];
            }
        } catch (error) {
            console.error('Failed to load appointments:', error);
        }

        const html = appts.length ? appts.map(a => `
            <div class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; border-left: 4px solid var(--c-pink);">
                <h4 class="text-white font-bold text-lg">${a.doctor}</h4>
                <p class="text-muted text-sm">${a.date} at ${a.time}</p>
                <span class="badge badge-pink mt-2 inline-block">${a.status}</span>
            </div>
        `).join('') : '<p class="text-muted text-center pt-4">No upcoming appointments.</p>';

        if(list) list.innerHTML = html;
        if(dashList) dashList.innerHTML = html;
    },

    // ==========================================
    // SPRINT-2: CONTACTS
    // ==========================================
    async submitContact(e) {
        e.preventDefault();
        const name = document.getElementById('con-name').value;
        const rel = document.getElementById('con-rel').value;
        const phone = document.getElementById('con-phone').value;
        const primary = document.getElementById('con-primary').checked;

        try {
            const response = await fetch(`${API_BASE_URL}/api/contacts`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    name,
                    relationship: rel,
                    phone,
                    is_primary: primary
                })
            });

            if (!response.ok) {
                throw new Error(`Contact create failed: ${response.status}`);
            }

            if(e.target) e.target.reset();
            await this.renderContacts();
        } catch (error) {
            console.error('Failed to save contact:', error);
            alert('Unable to save emergency contact right now.');
        }
    },
    async renderContacts() {
        const list = document.getElementById('contact-list');
        if(!list) return;
        const cons = await fetchContactsFromApi();

        list.innerHTML = cons.length ? cons.map(c => `
            <div class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; border-left: 4px solid ${(c.is_primary || c.primary) ? 'var(--c-blue)' : 'var(--border-light)'};">
                <div style="display:flex; justify-content:space-between;">
                    <h4 class="text-white font-bold text-lg">${c.name}</h4>
                    ${(c.is_primary || c.primary) ? '<span class="badge badge-blue">Primary</span>' : ''}
                </div>
                <p class="text-muted text-sm">${c.relationship || c.rel || ''}  ${c.phone}</p>
                <div class="mt-4">
                    <button class="btn-task-action" style="padding: 0.5rem; font-size: 0.8rem;" onclick="app.testAlert('${c.phone}')">Test Alert</button>
                    <button class="btn-task-action border-pink text-pink" style="padding: 0.5rem; font-size: 0.8rem; border-color: var(--c-pink); color: var(--c-pink); background: rgba(255,0,122,0.1);" onclick="app.deleteContact('${c.id}')">Delete</button>
                </div>
            </div>
        `).join('') : '<p class="text-muted text-center pt-4">No emergency contacts added.</p>';
    },
    async deleteContact(id) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/contacts/${id}`, {
                method: 'DELETE',
                headers: authHeaders()
            });

            if (!response.ok) {
                throw new Error(`Contact delete failed: ${response.status}`);
            }
            await this.renderContacts();
        } catch (error) {
            console.error('Failed to delete contact:', error);
            alert('Unable to delete contact right now.');
        }
    },
    testAlert(phone) {
        this.addNotification(`Test SOS sent to +91 ${phone}`, State.userId);
        if(document.getElementById('help-success-alert')) {
             document.getElementById('help-success-alert').innerText = "Test Alert broadcasted successfully!";
             document.getElementById('help-success-alert').classList.remove('hidden');
             setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
        }
    },

    // ==========================================
    // SPRINT-3: HEALTH & CHECK-IN
    // ==========================================
    logCheckIn() {
        this.submitCheckIn();
    },
    async submitHealth(e) {
        e.preventDefault();
        const bp = document.getElementById('health-bp').value;
        const sugar = Number(document.getElementById('health-sugar').value);

        try {
            const response = await fetch(`${API_BASE_URL}/api/health/logs`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    blood_pressure: bp,
                    sugar_level: sugar
                })
            });

            if (!response.ok) {
                throw new Error(`Health log failed: ${response.status}`);
            }

            const sys = parseInt((bp || '').split('/')[0] || 0, 10);
            if(sys > 140 || sugar > 150) {
                this.addNotification(`High Health Reading Alert for Patient`, null, 'Caretaker');
                this.addNotification(`Your reading is high. Caretaker notified.`, State.userId);
            }

            if(e.target) e.target.reset();
            await this.renderHealth();
            if(document.getElementById('help-success-alert')) {
                 document.getElementById('help-success-alert').classList.remove('hidden');
                 setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
            }
        } catch (error) {
            console.error('Failed to save health reading:', error);
            alert('Unable to save health reading right now.');
        }
    },
    async renderHealth() {
        const checkinStatus = document.getElementById('checkin-status');
        try {
            const response = await fetch(`${API_BASE_URL}/api/checkin`, {
                headers: authHeaders()
            });
            if (response.ok) {
                const payload = await response.json();
                if(checkinStatus && payload.checked_in) {
                    checkinStatus.classList.remove('hidden');
                }
            }
        } catch (error) {
            console.warn('Failed to load check-in state:', error);
        }

        const chartCanvas = document.getElementById('healthChart');
        if(chartCanvas) {
            let logs = [];
            try {
                logs = await fetchHealthLogsFromApi();
            } catch (error) {
                console.error('Failed to load health logs from backend:', error);
                logs = [];
            }

            const labels = logs.map(l => {
                const when = l.created_at || l.date;
                return when ? new Date(when).toLocaleDateString() : '';
            });
            const sugarData = logs.map(l => Number(l.sugar_level ?? l.sugar ?? 0));
            const bpData = logs.map(l => {
                const raw = String(l.blood_pressure || l.bp || '0/0');
                return parseInt(raw.split('/')[0] || 0, 10);
            });

            if(window.healthChartInstance) window.healthChartInstance.destroy();
            
            window.healthChartInstance = new Chart(chartCanvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'Sugar (mg/dL)', data: sugarData, borderColor: '#00ffaa', fill: false },
                        { label: 'BP Systolic', data: bpData, borderColor: '#ff007a', fill: false }
                    ]
                },
                options: { maintainAspectRatio: false, scales: { y: { beginAtZero: false } } }
            });
        }
    },

    // ==========================================
    // SPRINT-3: MEDICAL DOCUMENTS
    // ==========================================
    async submitDocument(e) {
        e.preventDefault();
        const file = document.getElementById('doc-file')?.files?.[0];
        const titleInput = document.getElementById('doc-title');
        const title = titleInput.value || file?.name || 'Medical Document';
        const cat = document.getElementById('doc-cat').value;

        try {
            const response = await fetch(`${API_BASE_URL}/api/documents`, {
                method: 'POST',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    title,
                    category: cat
                })
            });

            if (!response.ok) {
                throw new Error(`Document upload failed: ${response.status}`);
            }

            if (file) {
                sessionStorage.setItem(`nammaCareDocumentFile:${title}`, file.name);
            }
            if(e.target) e.target.reset();
            await this.renderDocuments();
            if(document.getElementById('help-success-alert')) {
                 document.getElementById('help-success-alert').classList.remove('hidden');
                 setTimeout(() => document.getElementById('help-success-alert').classList.add('hidden'), 4000);
            }
        } catch (error) {
            console.error('Failed to save document metadata:', error);
            alert('Unable to save document right now.');
        }
    },
    async renderDocuments() {
        const list = document.getElementById('doc-list');
        if(!list) return;
        const docs = await fetchDocumentsFromApi();

        list.innerHTML = docs.length ? docs.map(d => `
            <div class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 class="text-white font-bold">${d.title}</h4>
                    <p class="text-muted text-sm">${d.category || d.cat || 'Other'}  ${new Date(d.uploaded_at || d.date || Date.now()).toLocaleDateString()}</p>
                </div>
                <button class="btn-task-action" style="padding: 0.5rem;" onclick="alert('Downloading: ${d.title}')">Download</button>
            </div>
        `).join('') : '<p class="text-muted text-center pt-4">No documents stored.</p>';
    },

    // ==========================================
    // SPRINT-3: ADMIN MANAGEMENT
    // ==========================================
    async renderAdmin() {
        const adminView = document.getElementById('admin-view');
        if(!adminView) return;
        
        // Fix: Declare db securely locally to stop the unhandled reference crash
        const db = getLocalCache(); 

        try {
            const res = await fetch(`${API_BASE_URL}/api/admin/stats`, { headers: authHeaders() });
            if (res.ok) {
                const stats = await res.json();
                const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v ?? '—'; };
                set('stat-sos', stats.active_sos);
                set('stat-reqs', stats.pending_requests);
                set('stat-alerts', stats.active_sos);
                set('stat-seniors', stats.total_seniors);
                set('stat-pending', stats.pending_requests);
            }
        } catch (error) {
            console.warn('Failed to load admin stats:', error);
        }

        try {
            const res = await fetch(`${API_BASE_URL}/api/users`, { headers: authHeaders() });
            const data = await res.json();
            const users = data.users || [];
            
            const volsEl = document.getElementById('stat-vols');
                if (volsEl) volsEl.innerText = users.filter(u => u.role === 'Volunteer' && u.status === 'Verified').length;

            const list = document.getElementById('admin-users-list');
            if (list) {
                list.innerHTML = users.length ? users.map(u => `
                <div class="glass-panel" style="padding: 1rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${u.status === 'Blocked' ? 'var(--c-pink)' : (u.status === 'Pending' ? 'var(--c-yellow)' : 'var(--c-green)')}; text-align:left;">
                    <div>
                        <h4 class="text-white font-bold">${u.full_name || u.username || u.id} <span class="badge badge-mono ml-2" style="background:rgba(255,255,255,0.05);">${u.role}</span></h4>
                        <p class="text-muted text-sm" style="margin-top:0.25rem; margin-bottom:0;">Status: ${u.status} | Phone: ${u.phone || 'N/A'}</p>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        ${u.status === 'Pending' ? `<button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem;" onclick="app.adminUpdateUser('${u.id}', '${u.role}', '${u.role === 'Volunteer' ? 'Verified' : 'Active'}')">Approve</button>` : ''}
                        ${u.status !== 'Blocked' ? `<button class="btn btn-outline border-pink text-pink" style="padding:0.4rem 0.8rem; font-size:0.8rem; border-color:var(--c-pink); color:var(--c-pink); background:transparent;" onclick="app._adminBlock('${u.id}')">Block</button>` : ''}
                    </div>
                </div>
                `).join('') : '<p style="padding:1rem; color:var(--text-muted);">No users registered in system database.</p>';
            }
            
            // Re-render Analytics Doughnut Chart using actual database counts
            const chartCanvas = document.getElementById('analyticsChart');
            if(chartCanvas) {
                if(window.analyticsChartInstance) window.analyticsChartInstance.destroy();
                
                const requests = await fetchHelpRequests();
                const pending = requests.filter(r => normalizeRequestStatus(r.status) === 'pending').length;
                const assigned = requests.filter(r => normalizeRequestStatus(r.status) === 'accepted').length;
                const completed = requests.filter(r => normalizeRequestStatus(r.status) === 'completed').length;
                
                window.analyticsChartInstance = new Chart(chartCanvas, {
                    type: 'doughnut',
                    data: {
                        labels: ['Pending', 'Accepted', 'Completed'],
                        datasets: [{
                            data: [pending, assigned, completed],
                            backgroundColor: ['#ffcc00', '#00d5ff', '#00ffaa'],
                            borderWidth: 0
                        }]
                    },
                    options: { maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'right', labels: { color: 'white' } } } }
                });
            }

        } catch(e) {
            console.error('Admin view render synchronization failure:', e);
        }
    },
    async adminUpdateUser(uid, role, status) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/status`, {
                method: 'PUT',
                headers: authHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ uid, role, status })
            });
            if (!response.ok) {
                throw new Error(`Admin status update failed: ${response.status}`);
            }
            await this.renderAdmin();
            await this._loadAdminVerifications();
        } catch(e) {
            console.error(e);
            alert("Failed to update status.");
        }
    }
};

const app = DOM;

// Expose handlers for inline HTML onclick attributes.
window.app = app;
window.signInWithGoogle = signInWithGoogle;
window.handleSignOut = handleSignOut;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded: initializing app');
    await ensureSupabaseClient();

    if ("Notification" in window && Notification.permission !== 'denied' && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }

    await initializeAuthListener();
    app.renderAuthRoleSelect();
    app.updateHeader();
    app.startMedicationTick();

    const sosButton = document.getElementById('sos-button');
    if(sosButton) {
        sosButton.addEventListener('click', app.dispatchSOSAlert.bind(app));
    }
});
