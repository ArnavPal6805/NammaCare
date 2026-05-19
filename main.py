"""FastAPI backend for NammaCare Supabase integration.

This module exposes profile read/update endpoints backed by the Supabase
`profiles` table. It is designed to replace the earlier Flask + Excel backend.
"""

from __future__ import annotations

import logging
import os
import random
import string
from datetime import date
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict
from twilio.rest import Client

from supabase_client import supabase


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("nammacare.backend")
bearer_scheme = HTTPBearer()

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "AC5072477eb0401dcfd265bb47edfb9466")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "40709ea6bbf6e1f85dd0ddd76aef45b2")
TWILIO_FROM_NUMBER = os.getenv("TWILIO_FROM_NUMBER", "+14155238886")

try:
    twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
except Exception as e:
    logger.warning("Twilio client initialization failed: %s", e)
    twilio_client = None

class ProfileUpdate(BaseModel):
    """Editable fields for a Supabase profile row."""

    model_config = ConfigDict(extra="allow")

    full_name: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    dob: Optional[str] = None
    address: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None
    email: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    family_link_code_input: Optional[str] = None

class ProfileCreate(ProfileUpdate):
    """Required fields for onboarding a brand-new profile row."""

    model_config = ConfigDict(extra="allow")

    full_name: str
    username: str
    phone: str
    role: str
    # If True, skip family_link_code_input and flag the profile for admin
    # assignment to a community caretaker pool.
    assign_community_caretaker: bool = False


class SOSTrigger(BaseModel):
    latitude: float
    longitude: float
    caretaker_phone: str


class CaretakerAssignment(BaseModel):
    """Payload for admin-driven caretaker assignment."""

    senior_id: str
    caretaker_id: str


class MedicationCreate(BaseModel):
    name: str
    dosage: str
    frequency: str
    intake_time: str


class MedicationLogCreate(BaseModel):
    med_id: str
    med_name: str
    status: str


class MedicalDocumentCreate(BaseModel):
    title: str
    category: str


class EmergencyContactCreate(BaseModel):
    name: str
    relationship: str
    phone: str
    is_primary: bool = False


class HealthLogCreate(BaseModel):
    blood_pressure: str
    sugar_level: float


class AppointmentCreate(BaseModel):
    doctor: str
    date: str
    time: str


class AdminStatusUpdate(BaseModel):
    uid: str
    status: str


class NotificationCreate(BaseModel):
    message: str
    user_id: Optional[str] = None
    role_target: Optional[str] = None



async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> Any:
    """Validate a Supabase JWT and return the verified user object."""

    token = credentials.credentials

    try:
        response = await run_in_threadpool(supabase.auth.get_user, token)
        current_user = getattr(response, "user", None) or response.get("user")

        if current_user is None:
            raise ValueError("Supabase did not return a verified user.")

        return current_user
    except Exception as exc:
        logger.warning("Invalid Supabase credentials: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired credentials",
        ) from exc


app = FastAPI(
    title="NammaCare Backend",
    description="FastAPI server for Supabase-backed profile operations.",
    version="1.0.0",
)

# Allow local frontend pages, development servers, and file:// origins.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://.*|null)$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Columns accepted by the Supabase `profiles` table.
# Keep this set in sync with your migration schema.
_PROFILES_COLS = frozenset({
    "id", "full_name", "username", "role", "phone", "email",
    "dob", "address", "latitude", "longitude",
    "family_link_code", "linked_caretaker_id",
    "needs_caretaker_assignment", "status",
})


def _select_profile_row(user_id: str) -> Dict[str, Any]:
    """Fetch a single profile row from Supabase.

    Raises:
        LookupError: If no matching profile exists.
        RuntimeError: For any unexpected Supabase client issue.
    """
    try:
        response = supabase.table("profiles").select("*").eq("id", user_id).execute()
        rows = response.data or []
        if rows:
            return rows[0]
    except Exception as exc:
        logger.exception("Supabase select failed for user_id=%s", user_id)
        raise RuntimeError(f"Database read error for user_id={user_id}") from exc

    raise LookupError(f"No profile found for user_id={user_id}")


def _update_profile_row(user_id: str, update_data: Dict[str, Any]) -> Dict[str, Any]:
    """Update a single profile row in Supabase and return the updated record.

    Raises:
        LookupError: If the target row does not exist after the update.
        RuntimeError: For any unexpected Supabase client issue.
    """
    # Restrict to known columns to prevent accidental injection.
    safe_payload = {k: v for k, v in update_data.items() if k in _PROFILES_COLS}

    try:
        response = (
            supabase.table("profiles")
            .update(safe_payload)
            .eq("id", user_id)
            .select("*")
            .execute()
        )
        rows = response.data or []
        if rows:
            return rows[0]
    except Exception as exc:
        logger.exception("Supabase update failed for user_id=%s", user_id)
        raise RuntimeError(f"Database write error for user_id={user_id}") from exc

    raise LookupError(f"No profile found for user_id={user_id}")


def _upsert_profile_row(user_id: str, profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update a single profile row in Supabase and return the stored record.

    Raises:
        RuntimeError: For any unexpected Supabase client issue.
    """
    # Build a payload restricted to known columns only.
    payload: Dict[str, Any] = {"id": user_id}
    for key, value in profile_data.items():
        if key in _PROFILES_COLS and value is not None:
            payload[key] = value

    try:
        response = (
            supabase.table("profiles")
            .upsert(payload, on_conflict="id")
            .select("*")
            .execute()
        )
        rows = response.data or []
        if rows:
            return rows[0]
    except Exception as exc:
        logger.exception("Supabase upsert failed for user_id=%s", user_id)
        raise RuntimeError(f"Database write error for user_id={user_id}") from exc

    # Should not be reached, but return the attempted payload as a last resort.
    return payload


@app.get("/")
async def root() -> Dict[str, str]:
    """Health-style root endpoint for quick backend checks."""

    return {"message": "NammaCare FastAPI backend is running."}


@app.get("/api/public-config")
async def public_config() -> Dict[str, str]:
    """Expose public Supabase configuration for the frontend."""

    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_KEY", ""),
    }


@app.get("/api/users")
async def list_users(current_user: Any = Depends(get_current_user)) -> Dict[str, Any]:
    """Return live profile users for caretaker/admin dashboards."""
    _ = current_user
    try:
        response = await run_in_threadpool(
            lambda: supabase.table("profiles").select("*").execute()
        )
        profiles = response.data or []
        users = [
            {
                "id": row.get("id"),
                "uid": row.get("id"),
                "full_name": row.get("full_name"),
                "username": row.get("username"),
                "role": row.get("role"),
                "phone": row.get("phone"),
                "status": row.get("status", "Active"),
                "profile": row,
            }
            for row in profiles
        ]
        return {"users": users}
    except Exception as exc:
        logger.exception("Failed to fetch users from profiles table.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load users.",
        ) from exc


@app.put("/api/admin/status")
async def update_user_status(
    payload: AdminStatusUpdate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Update profile status directly in Supabase profiles table."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    if caller_profile.get("role") != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users may update account status.",
        )

    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("profiles")
            .update({"status": payload.status})
            .eq("id", payload.uid)
            .select("*")
            .execute()
        )
        rows = response.data or []
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User not found for id={payload.uid}.",
            )
        row = rows[0]
        return {
            "ok": True,
            "user": {
                "id": row.get("id"),
                "uid": row.get("id"),
                "full_name": row.get("full_name"),
                "username": row.get("username"),
                "role": row.get("role"),
                "phone": row.get("phone"),
                "status": row.get("status", "Active"),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to update status for uid=%s", payload.uid)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user status.",
        ) from exc


@app.get("/api/admin/stats")
async def get_admin_stats(current_user: Any = Depends(get_current_user)) -> Dict[str, Any]:
    """Return live system analytics metrics from actual PostgreSQL rows."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    if caller_profile.get("role") != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users can view system stats.",
        )

    try:
        p_res = await run_in_threadpool(lambda: supabase.table("profiles").select("id, role").execute())
        profiles = p_res.data or []
        
        req_res = await run_in_threadpool(lambda: supabase.table("help_requests").select("id, status").execute())
        requests = req_res.data or []
        
        sos_res = await run_in_threadpool(lambda: supabase.table("sos_events").select("id").eq("resolved", False).execute())
        active_sos = len(sos_res.data or [])
    except Exception as exc:
        logger.error(f"Admin stats database query failure: {exc}")
        profiles, requests, active_sos = [], [], 0

    return {
        "total_seniors": sum(1 for p in profiles if p.get("role") == "Senior Citizen"),
        "total_volunteers": sum(1 for p in profiles if p.get("role") == "Volunteer"),
        "active_sos": active_sos,
        "pending_requests": sum(1 for r in requests if r.get("status") == "Pending"),
    }


@app.post("/api/checkin")
async def create_check_in(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Insert a once-per-day safety check-in for the authenticated user."""
    user_id = str(current_user.id)
    checkin_data = {
        "user_id": user_id,
        "checked_in_date": str(date.today()),
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("check_ins")
            .upsert(checkin_data, on_conflict="user_id,checked_in_date", ignore_duplicates=True)
            .execute()
        )
        rows = response.data or []
        return {
            "success": True,
            "checked_in": True,
            "created": bool(rows),
        }
    except Exception as exc:
        logger.exception("Failed to create check-in for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save check-in.",
        ) from exc


@app.get("/api/checkin")
async def get_check_in_status(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return whether the authenticated user has checked in today."""
    user_id = str(current_user.id)
    today = str(date.today())
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("check_ins")
            .select("id")
            .eq("user_id", user_id)
            .eq("checked_in_date", today)
            .limit(1)
            .execute()
        )
        return {"checked_in": bool(response.data or [])}
    except Exception as exc:
        logger.exception("Failed to fetch check-in status for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load check-in status.",
        ) from exc


@app.post("/api/notifications")
async def create_notification(
    payload: NotificationCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a system notification targeted by user or role."""
    _ = current_user
    notification_data = {
        "message": payload.message,
        "user_id": payload.user_id,
        "role_target": payload.role_target,
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("system_notifications").insert(notification_data).execute()
        )
        rows = response.data or []
        return {"success": True, "notification": rows[0] if rows else notification_data}
    except Exception as exc:
        logger.exception("Failed to create system notification.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create notification.",
        ) from exc


@app.get("/api/notifications")
async def list_notifications(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return latest notifications targeted to the current user or role."""
    user_id = str(current_user.id)
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, user_id)
    except Exception:
        caller_profile = {}

    role = caller_profile.get("role")

    try:
        user_response = await run_in_threadpool(
            lambda: supabase
            .table("system_notifications")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(15)
            .execute()
        )
        user_rows = user_response.data or []

        role_rows = []
        if role:
            role_response = await run_in_threadpool(
                lambda: supabase
                .table("system_notifications")
                .select("*")
                .eq("role_target", role)
                .order("created_at", desc=True)
                .limit(15)
                .execute()
            )
            role_rows = role_response.data or []

        merged = {}
        for item in user_rows + role_rows:
            key = str(item.get("id")) if item.get("id") is not None else f"{item.get('message')}|{item.get('created_at')}"
            merged[key] = item

        notifications = sorted(
            merged.values(),
            key=lambda item: item.get("created_at") or "",
            reverse=True,
        )[:15]
        return {"notifications": notifications}
    except Exception as exc:
        logger.exception("Failed to load notifications for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load notifications.",
        ) from exc


@app.put("/api/notifications/read")
async def mark_notifications_read(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Mark notifications as read for the current user and role."""
    user_id = str(current_user.id)
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, user_id)
    except Exception:
        caller_profile = {}
    role = caller_profile.get("role")

    try:
        await run_in_threadpool(
            lambda: supabase
            .table("system_notifications")
            .update({"is_read": True})
            .eq("user_id", user_id)
            .execute()
        )
        if role:
            await run_in_threadpool(
                lambda: supabase
                .table("system_notifications")
                .update({"is_read": True})
                .eq("role_target", role)
                .execute()
            )
        return {"success": True}
    except Exception as exc:
        logger.exception("Failed to mark notifications read for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update notifications.",
        ) from exc


@app.get("/api/admin/users")
async def get_admin_users(current_user: Any = Depends(get_current_user)) -> Dict[str, Any]:
    """Return all system user profiles with their flagged status."""
    try:
        response = await run_in_threadpool(
            lambda: supabase.table("profiles").select("*").execute()
        )
        profiles = response.data or []
    except Exception as exc:
        logger.warning("Failed to fetch profiles for admin users: %s", exc)
        profiles = []

    users_list = []
    for p in profiles:
        uid = p.get("id")
        users_list.append({
            "id": uid,
            "uid": uid,
            "full_name": p.get("full_name"),
            "username": p.get("username"),
            "role": p.get("role"),
            "phone": p.get("phone"),
            "status": p.get("status", "Active"),
            "profile": p,
        })

    return {"users": users_list}


@app.get("/api/profile/{user_id}")
async def get_profile(
    user_id: UUID,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return the profile details for a specific user UUID."""

    if str(user_id) != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: You cannot access or modify another user's data",
        )

    try:
        profile = await run_in_threadpool(_select_profile_row, str(user_id))
        return profile
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@app.post("/api/medications")
async def create_medication(
    payload: MedicationCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a medication record for the authenticated user."""
    medication_data = {
        "user_id": str(current_user.id),
        "name": payload.name,
        "dosage": payload.dosage,
        "frequency": payload.frequency,
        "intake_time": payload.intake_time,
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("medications").insert(medication_data).execute()
        )
        rows = response.data or []
        return {"success": True, "data": rows[0] if rows else medication_data}
    except Exception as exc:
        logger.exception("Failed to create medication for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save medication.",
        ) from exc


@app.get("/api/medications")
async def list_medications(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return medications for the authenticated user."""
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("medications")
            .select("*")
            .eq("user_id", str(current_user.id))
            .order("created_at", desc=True)
            .execute()
        )
        return {"medications": response.data or []}
    except Exception as exc:
        logger.exception("Failed to fetch medications for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load medications.",
        ) from exc


@app.post("/api/medications/log")
async def create_medication_log(
    payload: MedicationLogCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a medication intake log entry."""
    log_data = {
        "user_id": str(current_user.id),
        "med_name": payload.med_name,
        "status": payload.status,
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("medication_logs").insert(log_data).execute()
        )
        rows = response.data or []
        return {"success": True, "data": rows[0] if rows else log_data}
    except Exception as exc:
        logger.exception("Failed to create medication log for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save medication log.",
        ) from exc


@app.get("/api/medications/log")
async def list_medication_logs(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return medication logs for the caller or linked seniors if caller is a caretaker."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    try:
        if caller_profile.get("role") == "Caretaker":
            linked_response = await run_in_threadpool(
                lambda: supabase
                .table("profiles")
                .select("id")
                .eq("linked_caretaker_id", str(current_user.id))
                .execute()
            )
            linked_ids = [str(row.get("id")) for row in (linked_response.data or []) if row.get("id")]
            if not linked_ids:
                return {"logs": []}

            response = await run_in_threadpool(
                lambda: supabase
                .table("medication_logs")
                .select("*")
                .in_("user_id", linked_ids)
                .order("logged_at", desc=True)
                .limit(100)
                .execute()
            )
        else:
            response = await run_in_threadpool(
                lambda: supabase
                .table("medication_logs")
                .select("*")
                .eq("user_id", str(current_user.id))
                .order("logged_at", desc=True)
                .limit(100)
                .execute()
            )

        return {"logs": response.data or []}
    except Exception as exc:
        logger.exception("Failed to fetch medication logs for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load medication logs.",
        ) from exc


@app.post("/api/documents")
async def create_medical_document(
    payload: MedicalDocumentCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Store medical document metadata for the authenticated user."""
    document_data = {
        "user_id": str(current_user.id),
        "title": payload.title,
        "category": payload.category,
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("medical_documents").insert(document_data).execute()
        )
        rows = response.data or []
        return {"success": True, "data": rows[0] if rows else document_data}
    except Exception as exc:
        logger.exception("Failed to create medical document for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save document metadata.",
        ) from exc


@app.get("/api/documents")
async def list_medical_documents(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return medical document metadata for the user or linked seniors if caller is caretaker."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    try:
        if caller_profile.get("role") == "Caretaker":
            linked_response = await run_in_threadpool(
                lambda: supabase
                .table("profiles")
                .select("id")
                .eq("linked_caretaker_id", str(current_user.id))
                .execute()
            )
            linked_ids = [str(row.get("id")) for row in (linked_response.data or []) if row.get("id")]
            if not linked_ids:
                return {"documents": []}

            response = await run_in_threadpool(
                lambda: supabase
                .table("medical_documents")
                .select("*")
                .in_("user_id", linked_ids)
                .order("uploaded_at", desc=True)
                .execute()
            )
        else:
            response = await run_in_threadpool(
                lambda: supabase
                .table("medical_documents")
                .select("*")
                .eq("user_id", str(current_user.id))
                .order("uploaded_at", desc=True)
                .execute()
            )

        return {"documents": response.data or []}
    except Exception as exc:
        logger.exception("Failed to fetch documents for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load documents.",
        ) from exc


@app.post("/api/appointments")
async def create_appointment(
    payload: AppointmentCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create an appointment for the authenticated senior user."""
    try:
        profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        profile = {}

    appointment_data = {
        "user_id": str(current_user.id),
        "patient_name": profile.get("full_name") or "Senior Citizen",
        "doctor": payload.doctor,
        "date": payload.date,
        "time": payload.time,
        "status": "Confirmed",
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("appointments").insert(appointment_data).execute()
        )
        rows = response.data or []
        return {"success": True, "data": rows[0] if rows else appointment_data}
    except Exception as exc:
        logger.exception("Failed to create appointment for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save appointment.",
        ) from exc


@app.get("/api/appointments")
async def list_appointments(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return appointments for the active user; doctors receive matching doctor schedule."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    role = caller_profile.get("role")

    try:
        if role == "Doctor":
            doctor_designation = (caller_profile.get("full_name") or "").strip()
            if not doctor_designation:
                return {"appointments": []}

            response = await run_in_threadpool(
                lambda: supabase
                .table("appointments")
                .select("*")
                .eq("doctor", doctor_designation)
                .order("date", desc=False)
                .execute()
            )
            rows = response.data or []
        else:
            response = await run_in_threadpool(
                lambda: supabase
                .table("appointments")
                .select("*")
                .eq("user_id", str(current_user.id))
                .order("date", desc=False)
                .execute()
            )
            rows = response.data or []

        return {"appointments": rows}
    except Exception as exc:
        logger.exception("Failed to fetch appointments for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load appointments.",
        ) from exc


@app.get("/api/caretaker/seniors")
async def list_caretaker_seniors(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return actual seniors linked to the authenticated caretaker from PostgreSQL columns."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    if caller_profile.get("role") != "Caretaker":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only caretakers can access linked seniors.",
        )

    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("profiles")
            .select("id, full_name, phone, address, status")
            .eq("role", "Senior Citizen")
            .eq("linked_caretaker_id", str(current_user.id))
            .order("full_name", desc=False)
            .execute()
        )
        return {"seniors": response.data or []}
    except Exception as exc:
        logger.exception("Failed to fetch linked seniors for caretaker_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load linked seniors from cloud database.",
        ) from exc


@app.post("/api/health/logs")
async def create_health_log(
    payload: HealthLogCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a health log entry and emit warning telemetry on high readings."""
    systolic = 0
    try:
        systolic = int(str(payload.blood_pressure).split("/")[0].strip())
    except Exception:
        systolic = 0

    health_data = {
        "user_id": str(current_user.id),
        "blood_pressure": payload.blood_pressure,
        "sugar_level": payload.sugar_level,
    }

    if systolic > 140 or payload.sugar_level > 150:
        logger.warning(
            "High health reading detected | user_id=%s | blood_pressure=%s | sugar_level=%s",
            current_user.id,
            payload.blood_pressure,
            payload.sugar_level,
        )

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("health_logs").insert(health_data).execute()
        )
        rows = response.data or []
        return {"success": True, "data": rows[0] if rows else health_data}
    except Exception as exc:
        logger.exception("Failed to create health log for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save health log.",
        ) from exc


@app.get("/api/health/logs")
async def list_health_logs(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return up to 7 latest health logs for the authenticated senior or linked caretaker scope."""
    try:
        caller_profile = await run_in_threadpool(_select_profile_row, str(current_user.id))
    except Exception:
        caller_profile = {}

    target_user_ids = [str(current_user.id)]
    if caller_profile.get("role") == "Caretaker":
        try:
            response = await run_in_threadpool(
                lambda: supabase
                .table("profiles")
                .select("id")
                .eq("linked_caretaker_id", str(current_user.id))
                .execute()
            )
            linked_rows = response.data or []
            linked_ids = [str(row.get("id")) for row in linked_rows if row.get("id")]
            if linked_ids:
                target_user_ids = linked_ids
        except Exception:
            logger.warning("Failed to resolve linked seniors for caretaker_id=%s", current_user.id)

    try:
        if len(target_user_ids) == 1:
            response = await run_in_threadpool(
                lambda: supabase
                .table("health_logs")
                .select("*")
                .eq("user_id", target_user_ids[0])
                .order("created_at", desc=True)
                .limit(7)
                .execute()
            )
        else:
            response = await run_in_threadpool(
                lambda: supabase
                .table("health_logs")
                .select("*")
                .in_("user_id", target_user_ids)
                .order("created_at", desc=True)
                .limit(7)
                .execute()
            )

        return {"health_logs": response.data or []}
    except Exception as exc:
        logger.exception("Failed to fetch health logs for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load health logs.",
        ) from exc


@app.post("/api/contacts")
async def create_emergency_contact(
    payload: EmergencyContactCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create an emergency contact for the authenticated user."""
    user_id = str(current_user.id)
    try:
        if payload.is_primary:
            await run_in_threadpool(
                lambda: supabase
                .table("emergency_contacts")
                .update({"is_primary": False})
                .eq("user_id", user_id)
                .execute()
            )

        response = await run_in_threadpool(
            lambda: supabase
            .table("emergency_contacts")
            .insert(
                {
                    "user_id": user_id,
                    "name": payload.name,
                    "relationship": payload.relationship,
                    "phone": payload.phone,
                    "is_primary": payload.is_primary,
                }
            )
            .execute()
        )
        rows = response.data or []
        return {"success": True, "contact": rows[0] if rows else None}
    except Exception as exc:
        logger.exception("Failed to create emergency contact for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create emergency contact.",
        ) from exc


@app.get("/api/contacts")
async def list_emergency_contacts(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """List emergency contacts for the authenticated user."""
    user_id = str(current_user.id)
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("emergency_contacts")
            .select("*")
            .eq("user_id", user_id)
            .order("is_primary", desc=True)
            .order("created_at", desc=False)
            .execute()
        )
        return {"contacts": response.data or []}
    except Exception as exc:
        logger.exception("Failed to list emergency contacts for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load emergency contacts.",
        ) from exc


@app.delete("/api/contacts/{contact_id}")
async def delete_emergency_contact(
    contact_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Delete an emergency contact owned by the authenticated user."""
    user_id = str(current_user.id)
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("emergency_contacts")
            .delete()
            .eq("id", contact_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not (response.data or []):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found.")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to delete emergency contact_id=%s for user_id=%s", contact_id, user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete emergency contact.",
        ) from exc
@app.put("/api/profile/{user_id}")
async def update_profile(
    user_id: UUID,
    payload: ProfileUpdate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Update editable profile fields for a specific user UUID."""

    if str(user_id) != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: You cannot access or modify another user's data",
        )

    update_data = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one editable field: full_name, phone, dob, or address.",
        )

    user_email = getattr(current_user, "email", None)
    if update_data.get("role") == "Admin" and user_email != "admin@nammacare.org":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized: Admin role can only be assigned to admin@nammacare.org",
        )

    try:
        updated_profile = await run_in_threadpool(
            _update_profile_row,
            str(user_id),
            update_data,
        )
        return updated_profile
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive logging path
        logger.exception("Failed to update profile for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected database error occurred while updating the profile.",
        ) from exc


@app.post("/api/profile/{user_id}")
async def create_profile(
    user_id: UUID,
    payload: ProfileCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create a profile row for a brand-new authenticated user."""

    if str(user_id) != str(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permission denied: You cannot access or modify another user's data",
        )

    profile_data = {
        key: value
        for key, value in payload.model_dump(exclude_unset=True).items()
        if value is not None
    }

    if not profile_data.get("full_name") or not profile_data.get("phone") or not profile_data.get("role"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="full_name, phone, and role are required.",
        )

    # ------------------------------------------------------------------ #
    #  Role-specific logic & Secure Admin Override                        #
    # ------------------------------------------------------------------ #
    assign_community = profile_data.pop("assign_community_caretaker", False)

    # Secure Admin Auto-Promotion Rule
    user_email = getattr(current_user, "email", None)
    if user_email == "admin@nammacare.org":
        profile_data["role"] = "Admin"
        logger.info(
            "User %s securely auto-promoted to Admin via email authorization gateway.", user_id
        )

    elif profile_data["role"] == "Admin" and user_email != "admin@nammacare.org":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Intrusion Blocker: Unauthorized email cannot register as an Administrator.",
        )

    elif profile_data["role"] == "Caretaker":
        # Generate a unique, human-readable family link code for this caretaker.
        profile_data["family_link_code"] = (
            f"NC-{''.join(random.choices(string.ascii_uppercase + string.digits, k=4))}"
        )

    elif profile_data["role"] == "Senior Citizen":
        if assign_community:
            # Senior requested community-pool assignment: flag the row and
            # leave linked_caretaker_id NULL for admin to fill later.
            profile_data["needs_caretaker_assignment"] = True
            logger.info(
                "Senior %s flagged for community caretaker assignment.", user_id
            )
        elif profile_data.get("family_link_code_input"):
            # Senior supplied an explicit family link code — validate and link.
            link_code = profile_data["family_link_code_input"]
            try:
                response = await run_in_threadpool(
                    lambda: supabase
                    .table("profiles")
                    .select("id")
                    .eq("family_link_code", link_code)
                    .execute()
                )
                rows = response.data or []
                if not rows:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Invalid family link code — no matching caretaker found.",
                    )
                profile_data["linked_caretaker_id"] = rows[0]["id"]
            except HTTPException:
                raise
            except Exception as exc:
                logger.exception("Failed to validate family_link_code for user_id=%s", user_id)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Error validating family link code.",
                ) from exc

    # Remove the input-only helper field before writing to Supabase.
    profile_data.pop("family_link_code_input", None)

    try:
        created_profile = await run_in_threadpool(
            _upsert_profile_row,
            str(user_id),
            profile_data,
        )
        return created_profile
    except RuntimeError as exc:
        logger.exception("Failed to create profile for user_id=%s", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected database error occurred while creating the profile.",
        ) from exc


@app.put("/api/admin/assign-caretaker")
async def admin_assign_caretaker(
    payload: CaretakerAssignment,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Admin endpoint: link a community-pool senior to a specific caretaker.

    Clears the `needs_caretaker_assignment` flag and sets `linked_caretaker_id`
    on the senior's profile row.

    Only authenticated admins (or the backend itself) should call this.
    The caller's role is validated against the `profiles` table.
    """
    # Verify the calling user has Admin role.
    try:
        caller_profile = await run_in_threadpool(
            _select_profile_row, str(current_user.id)
        )
    except LookupError:
        caller_profile = {}

    if caller_profile.get("role") != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admin users may perform caretaker assignments.",
        )

    senior_id   = payload.senior_id
    caretaker_id = payload.caretaker_id

    # Verify the target caretaker actually exists and has the Caretaker role.
    try:
        caretaker_profile = await run_in_threadpool(
            _select_profile_row, caretaker_id
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Caretaker profile not found for id={caretaker_id}.",
        )

    if caretaker_profile.get("role") != "Caretaker":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The target user is not registered as a Caretaker.",
        )

    update_payload = {
        "linked_caretaker_id": caretaker_id,
        "needs_caretaker_assignment": False,
    }

    try:
        updated_senior = await run_in_threadpool(
            _update_profile_row, senior_id, update_payload
        )
    except LookupError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Senior profile not found for id={senior_id}.",
        )
    except RuntimeError as exc:
        logger.exception(
            "Failed to assign caretaker %s to senior %s", caretaker_id, senior_id
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error during caretaker assignment.",
        ) from exc

    logger.info(
        "Admin %s assigned caretaker %s to senior %s.",
        current_user.id, caretaker_id, senior_id,
    )
    return {
        "ok": True,
        "senior_id": senior_id,
        "caretaker_id": caretaker_id,
        "updated_profile": updated_senior,
    }


# ------------------------------------------------------------------ #
#  Help Request Endpoints (persisted in Supabase)                     #
# ------------------------------------------------------------------ #

class HelpRequestCreate(BaseModel):
    category: str
    priority: str
    description: Optional[str] = None


@app.post("/api/requests")
async def create_help_request(
    payload: HelpRequestCreate,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Insert a live help ticket directly into our Supabase help_requests table."""
    request_data = {
        "senior_id": str(current_user.id),
        "category": payload.category,
        "priority": payload.priority,
        "description": payload.description,
        "status": "Pending",
    }

    try:
        response = await run_in_threadpool(
            lambda: supabase.table("help_requests").insert(request_data).execute()
        )
        return {"success": True, "data": response.data[0]}
    except Exception as exc:
        logger.exception("Help request generation failed.")
        raise HTTPException(status_code=500, detail="Failed to save request to Postgre solution") from exc


@app.get("/api/requests")
async def list_help_requests(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return all help requests from Supabase."""
    _ = current_user
    try:
        response = await run_in_threadpool(
            lambda: supabase.table("help_requests").select("*").execute()
        )
        return {"requests": response.data or []}
    except Exception as exc:
        logger.exception("Failed to load help requests.")
        raise HTTPException(status_code=500, detail="Failed to load requests from database.") from exc


@app.put("/api/requests/{request_id}/claim")
async def claim_help_request(
    request_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Volunteer claims a pending help request."""
    try:
        lookup = await run_in_threadpool(
            lambda: supabase.table("help_requests").select("*").eq("id", request_id).execute()
        )
        rows = lookup.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Request not found.")

        target = rows[0]
        if target.get("status") != "Pending":
            raise HTTPException(status_code=400, detail="Request is not available for claiming.")

        updated = await run_in_threadpool(
            lambda: supabase.table("help_requests").update({"status": "Assigned", "volunteer_id": str(current_user.id)}).eq("id", request_id).execute()
        )
        return {"success": True, "request": updated.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to claim help request %s.", request_id)
        raise HTTPException(status_code=500, detail="Database error during request claim.") from exc


@app.put("/api/requests/{request_id}/reject")
async def reject_help_request(
    request_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Volunteer rejects a pending help request."""
    try:
        lookup = await run_in_threadpool(
            lambda: supabase.table("help_requests").select("*").eq("id", request_id).execute()
        )
        rows = lookup.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Request not found.")

        updated = await run_in_threadpool(
            lambda: supabase.table("help_requests").update({"status": "Rejected"}).eq("id", request_id).execute()
        )
        return {"success": True, "request": updated.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to reject help request %s.", request_id)
        raise HTTPException(status_code=500, detail="Database error during request rejection.") from exc


@app.put("/api/requests/{request_id}/complete")
async def complete_help_request(
    request_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Volunteer marks a help request as completed."""
    try:
        lookup = await run_in_threadpool(
            lambda: supabase.table("help_requests").select("*").eq("id", request_id).execute()
        )
        rows = lookup.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Request not found.")

        updated = await run_in_threadpool(
            lambda: supabase.table("help_requests").update({"status": "Completed"}).eq("id", request_id).execute()
        )
        return {"success": True, "request": updated.data[0]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to complete help request %s.", request_id)
        raise HTTPException(status_code=500, detail="Database error during request completion.") from exc


@app.post("/api/sos/trigger")
async def trigger_sos(
    payload: SOSTrigger,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Trigger an emergency SOS SMS via Twilio."""
    if not twilio_client:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Twilio client is not configured on the server."}
        )

    try:
        profile = _select_profile_row(str(current_user.id))
        user_name = profile.get("full_name", "Unknown User")
        target_phone = payload.caretaker_phone
        
        # Check if senior is linked to a caretaker and retrieve their registered phone number
        linked_id = profile.get("linked_caretaker_id")
        if linked_id:
            try:
                caretaker_profile = _select_profile_row(str(linked_id))
                if caretaker_profile.get("phone"):
                    target_phone = caretaker_profile["phone"]
                    logger.info("Dynamically routing SOS alert to linked caretaker: %s", target_phone)
            except Exception as link_exc:
                logger.warning("Could not resolve caretaker phone for ID %s: %s", linked_id, link_exc)
    except Exception:
        user_name = "Unknown User"
        target_phone = payload.caretaker_phone

    message_body = f"EMERGENCY: Senior Citizen {user_name} has triggered an SOS! Live Location: https://www.google.com/maps?q={payload.latitude},{payload.longitude}"

    def _send_sms():
        return twilio_client.messages.create(
            body=message_body,
            from_=TWILIO_FROM_NUMBER,
            to=target_phone
        )

    try:
        await run_in_threadpool(_send_sms)
        # Persist SOS events in Supabase for caretaker/admin feeds.
        try:
            await run_in_threadpool(
                lambda: supabase.table("sos_events").insert({
                    "user_id": str(current_user.id),
                    "latitude": payload.latitude,
                    "longitude": payload.longitude,
                    "resolved": False,
                }).execute()
            )
        except Exception as persist_exc:
            logger.warning("SOS event persistence failed: %s", persist_exc)
        return {"success": True, "message": "SOS alert sent successfully."}
    except Exception as exc:
        logger.exception("Failed to send SOS SMS via Twilio.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Failed to dispatch SOS alert.", "details": str(exc)},
        ) from exc


@app.get("/api/sos/history")
async def list_sos_history(
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Return unresolved SOS events for caretaker/admin feeds."""
    _ = current_user
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("sos_events")
            .select("*")
            .eq("resolved", False)
            .order("created_at", desc=True)
            .limit(30)
            .execute()
        )
        return {"events": response.data or []}
    except Exception as exc:
        logger.warning("Failed to load SOS history from Supabase: %s", exc)
        return {"events": []}


@app.put("/api/sos/{event_id}/resolve")
async def resolve_sos_event(
    event_id: str,
    current_user: Any = Depends(get_current_user),
) -> Dict[str, Any]:
    """Mark a SOS event as resolved."""
    _ = current_user
    try:
        response = await run_in_threadpool(
            lambda: supabase
            .table("sos_events")
            .update({"resolved": True})
            .eq("id", event_id)
            .select("*")
            .execute()
        )
        return {"success": True, "event": (response.data or [None])[0]}
    except Exception as exc:
        logger.exception("Failed to resolve SOS event %s", event_id)
        raise HTTPException(status_code=500, detail="Failed to resolve SOS event.") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
