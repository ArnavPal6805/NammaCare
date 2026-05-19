from supabase_client import supabase

try:
    # Attempt to fetch data from the profiles table we just created
    response = supabase.table("profiles").select("*").limit(1).execute()
    print("✅ Connection successful! Python successfully talked to Supabase.")
    print("Database Response:", response.data)
except Exception as e:
    print("❌ Connection failed!")
    print("Error details:", e)