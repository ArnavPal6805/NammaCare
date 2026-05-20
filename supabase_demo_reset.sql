-- NammaCare full demo reset for Supabase SQL Editor.
-- Run only in the project you use for the recorded demo.

begin;

delete from public.system_notifications;
delete from public.sos_events;
delete from public.check_ins;
delete from public.health_logs;
delete from public.medical_documents;
delete from public.medication_logs;
delete from public.medications;
delete from public.appointments;
delete from public.help_requests;
delete from public.emergency_contacts;
delete from public.profiles;
delete from auth.users;

commit;
