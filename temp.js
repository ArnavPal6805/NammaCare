const DB_SCHEMA = {
    users: [],
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

// Remove PWA and unregister Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
            console.log('ServiceWorker unregistered.');
        }
    });
}

if(!sessionStorage.getItem('nammaCareDB')) {
    sessionStorage.setItem('nammaCareDB', JSON.stringify(DB_SCHEMA));
}

window.AppDB = null;

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
        config.supabase_anon_key
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

function getDB() { 
    let db = window.AppDB || JSON.parse(sessionStorage.getItem('nammaCareDB')) || {}; 
    if(!db.medications) db.medications = [];
    if(!db.medicationLogs) db.medicationLogs = [];
    if(!db.appointments) db.appointments = [];
    if(!db.contacts) db.contacts = [];
    if(!db.notifications) db.notifications = [];
    if(!db.healthLogs) db.healthLogs = [];
    if(!db.checkIns) db.checkIns = [];
    if(!db.documents) db.documents = [];
    if(!db.rewards) db.rewards = [];
    if(!db.requests) db.requests = [];
    if(!db.activeSOS) db.activeSOS = [];
    if(!db.sosHistory) db.sosHistory = [];
    if(!db.volunteerXP) db.volunteerXP = {};
    return db;
}

function saveDB(db) { 
    window.AppDB = db;
    sessionStorage.setItem('nammaCareDB', JSON.stringify(db)); 
    fetch(`${API_BASE_URL}/api/db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db)
    }).catch(e => console.error("Sync error:", e));
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
        Volunteer: 'volunteer-view',
        Caretaker: 'caretaker-view',
        Admin: 'admin-view'
    };

    return dashboardMap[normalizedRole] || 'profile-view';
}

function normalizeRole(role) {
    const value = String(role || '').trim();

    if (value === 'Caretaker/Family' || value === 'Caretaker/Family Member') {
        return 'Caretaker';
    }

    if (value === 'Senior' || value === 'Senior Citizen') {
        return 'Senior Citizen';
    }

    if (value === 'Volunteer' || value === 'Volunteer Helper') {
        return 'Volunteer';
    }

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

function applyProfileToState(user, profile) {
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
    State.accessToken = safeProfile.access_token || State.accessToken || null;
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

    const db = getDB();
    const nextUser = {
        uid: user.id,
        role: nextRole,
        status: 'Active',
        profile: {
            ...(State.profile || {}),
            name: displayName,
            full_name: displayName,
            email: State.email,
            role: nextRole,
            avatar_url: avatarUrl,
            picture: avatarUrl,
        }
    };
    db.users = (db.users || []).filter(existing => existing.uid !== user.id);
    db.users.push(nextUser);
    saveDB(db);
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


function ensureOnboardingStyles() {
    if (document.getElementById('onboarding-styles')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'onboarding-styles';
    style.textContent = `
        #onboarding-overlay {
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: rgba(5, 8, 16, 0.95);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
        }

        #onboarding-overlay.hidden {
            display: none !important;
        }

        .onboarding-card {
            width: min(500px, 100%);
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 2rem;
            box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
            padding: 2.5rem;
            animation: onboardingPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        @keyframes onboardingPop {
            from { transform: scale(0.9); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }

        .onboarding-title {
            font-size: 2rem;
            font-weight: 800;
            margin-bottom: 0.5rem;
            background: linear-gradient(to right, #fff, #888);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }

        .onboarding-subtitle {
            color: #888;
            margin-bottom: 2rem;
            font-size: 0.95rem;
        }

        .onboarding-grid {
            display: grid;
            gap: 1.25rem;
        }

        .onboarding-actions {
            margin-top: 2rem;
        }

        body.onboarding-lock {
            overflow: hidden;
async function signInWithGoogle() {
    try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/login.html'
            }
        });
        if (error) throw error;
    } catch (error) {
        console.error('Google OAuth failed:', error);
        alert('Google login failed: ' + error.message);
    }

async function initializeAuthListener() {
    const client = await ensureSupabaseClient();
    
    client.auth.onAuthStateChange(async (event, session) => {
        try {
            if (event === 'SIGNED_OUT') {
                resetAuthState();
                sessionStorage.removeItem('nammaCareState');
                if (typeof app !== 'undefined') app.updateHeader();
                window.location.href = 'index.html';
                return;
            }

            if (event === 'SIGNED_IN' && session?.user) {
                const user = session.user;
                console.log('User signed in:', user.email);

                // --- STAGED DATA REHYDRATION ---
                const stagedData = localStorage.getItem('staged_onboarding_data');
                if (stagedData) {
                    console.log('Rehydrating staged registration data...');
                    const profileData = JSON.parse(stagedData);
                    
                    const payload = {
                        full_name: profileData.name,
                        phone: profileData.phone,
                        dob: profileData.dob,
                        role: profileData.role,
                        address: profileData.address,
                        email: user.email
                    };

                    try {
                        const response = await fetch(`${API_BASE_URL}/api/profile/${user.id}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${session.access_token}`
                            },
                            body: JSON.stringify(payload)
                        });
