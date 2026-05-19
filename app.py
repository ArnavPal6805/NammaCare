from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import pandas as pd
import os

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

DB_FILE = 'NammaCareData.xlsx'
SHEETS = [
    'Senior_Citizens', 'Caretakers', 'Volunteers', 'Doctors', 'Admins',
    'Medications', 'MedicationLogs', 'Appointments', 'Contacts', 'HealthLogs', 
    'Documents', 'CheckIns', 'Requests', 'ActiveSOS', 'SOSHistory', 'VolunteerXP', 'Notifications', 'Rewards'
]

def init_db():
    if not os.path.exists(DB_FILE):
        with pd.ExcelWriter(DB_FILE, engine='openpyxl') as writer:
            for sheet in SHEETS:
                if sheet in ['Senior_Citizens', 'Caretakers', 'Volunteers', 'Doctors', 'Admins']:
                    pd.DataFrame(columns=['uid', 'password', 'role', 'name', 'dob', 'address', 'phone', 'emergency', 'status']).to_excel(writer, sheet_name=sheet, index=False)
                else:
                    pd.DataFrame().to_excel(writer, sheet_name=sheet, index=False)

init_db()

def get_role_sheet(role):
    mapping = {
        'Senior Citizen': 'Senior_Citizens',
        'Caretaker': 'Caretakers',
        'Volunteer': 'Volunteers',
        'Admin': 'Admins',
        'Doctor': 'Doctors'
    }
    return mapping.get(role, 'Senior_Citizens')

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_file(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not Found", 404

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    uid = str(data.get('uid'))
    password = str(data.get('password'))
    role = data.get('role')
    profile = data.get('profile', {})
    
    sheet = get_role_sheet(role)
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    df = all_sheets[sheet]
    
    if not df[df['uid'] == uid].empty:
        return jsonify({'error': 'User already registered for this role.'}), 409
        
    status = 'Pending' if role == 'Volunteer' else 'Active'
    
    new_user = pd.DataFrame([{
        'uid': uid, 'password': password, 'role': role,
        'name': profile.get('name', uid),
        'dob': profile.get('dob', ''),
        'address': profile.get('address', ''),
        'phone': profile.get('phone', uid),
        'emergency': profile.get('emergency', ''),
        'status': status
    }])
    
    all_sheets[sheet] = pd.concat([df, new_user], ignore_index=True)
    
    with pd.ExcelWriter(DB_FILE, engine='openpyxl') as writer:
        for s_name, s_df in all_sheets.items():
            s_df.to_excel(writer, sheet_name=s_name, index=False)
            
    return jsonify({'success': True, 'user': {'uid': uid, 'role': role, 'profile': profile}}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    uid = str(data.get('uid'))
    password = str(data.get('password'))
    
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    
    for sheet in ['Senior_Citizens', 'Caretakers', 'Volunteers', 'Doctors', 'Admins']:
        if sheet in all_sheets:
            df = all_sheets[sheet]
            user = df[(df['uid'] == uid) & (df['password'] == password)]
            
            if not user.empty:
                user_dict = user.iloc[0].fillna('').to_dict()
                user_status = user_dict.get('status', 'Active') or 'Active'
                
                if user_status == 'Blocked':
                    return jsonify({'error': 'Account is blocked by Admin.'}), 403
                if user_status == 'Pending':
                    return jsonify({'error': 'Registration is pending Admin approval.'}), 403
                    
                profile = {
                    'name': user_dict.get('name', ''),
                    'dob': user_dict.get('dob', ''),
                    'address': user_dict.get('address', ''),
                    'phone': user_dict.get('phone', ''),
                    'emergency': user_dict.get('emergency', '')
                }
                
                found_role = user_dict.get('role', '')
                if not found_role:
                    role_map = {'Senior_Citizens': 'Senior Citizen', 'Caretakers': 'Caretaker', 'Volunteers': 'Volunteer', 'Doctors': 'Doctor', 'Admins': 'Admin'}
                    found_role = role_map.get(sheet, 'Senior Citizen')
                    
                return jsonify({'success': True, 'user': {'uid': uid, 'role': found_role, 'profile': profile}}), 200
                
    return jsonify({'error': 'Invalid Credentials.'}), 401

@app.route('/api/profile', methods=['PUT'])
def update_profile():
    data = request.json
    uid = str(data.get('uid'))
    role = data.get('role')
    profile = data.get('profile', {})
    
    sheet = get_role_sheet(role)
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    df = all_sheets[sheet]
    
    idx = df.index[df['uid'] == uid].tolist()
    if idx:
        for k in ['name', 'dob', 'address', 'phone', 'emergency']:
            if k in profile:
                df.at[idx[0], k] = profile[k]
                
    with pd.ExcelWriter(DB_FILE, engine='openpyxl') as writer:
        for s_name, s_df in all_sheets.items():
            s_df.to_excel(writer, sheet_name=s_name, index=False)
            
    return jsonify({'success': True, 'profile': profile}), 200

@app.route('/api/users', methods=['GET'])
def get_users():
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    users = []
    for sheet in ['Senior_Citizens', 'Caretakers', 'Volunteers', 'Doctors', 'Admins']:
        df = all_sheets[sheet].fillna('')
        for _, row in df.iterrows():
            if not row.get('uid'): continue
            profile = {
                'name': row.get('name', ''),
                'dob': row.get('dob', ''),
                'address': row.get('address', ''),
                'phone': row.get('phone', ''),
                'emergency': row.get('emergency', '')
            }
            users.append({
                'uid': str(row.get('uid', '')),
                'role': row.get('role', ''),
                'status': row.get('status', 'Active'),
                'profile': profile
            })
    return jsonify({'users': users}), 200

@app.route('/api/admin/status', methods=['PUT'])
def update_status():
    data = request.json
    uid = str(data.get('uid'))
    role = data.get('role')
    status = data.get('status')
    
    sheet = get_role_sheet(role)
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    df = all_sheets[sheet]
    
    idx = df.index[df['uid'] == uid].tolist()
    if idx:
        df.at[idx[0], 'status'] = status
        
    with pd.ExcelWriter(DB_FILE, engine='openpyxl') as writer:
        for s_name, s_df in all_sheets.items():
            s_df.to_excel(writer, sheet_name=s_name, index=False)
            
    return jsonify({'success': True}), 200

@app.route('/api/db', methods=['GET'])
def get_db():
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None)
    db_json = {}
    
    for key in ['Medications', 'MedicationLogs', 'Appointments', 'Contacts', 'HealthLogs', 'Documents', 'CheckIns', 'Requests', 'ActiveSOS', 'SOSHistory', 'VolunteerXP', 'Notifications', 'Rewards']:
        df = all_sheets[key].fillna('')
        records = df.to_dict('records')
        
        for r in records:
            if 'user' in r and r['user'] != '':
                val = r['user']
                r['user'] = str(int(val)) if isinstance(val, float) else str(val)
            else:
                if 'user' in r: r['user'] = None
                
            if 'seniorId' in r and r['seniorId'] != '':
                val = r['seniorId']
                r['seniorId'] = str(int(val)) if isinstance(val, float) else str(val)
            else:
                if 'seniorId' in r: r['seniorId'] = None
                
            if 'forUser' in r and r['forUser'] != '':
                val = r['forUser']
                r['forUser'] = str(int(val)) if isinstance(val, float) else str(val)
            else:
                if 'forUser' in r: r['forUser'] = None
        
        if key == 'VolunteerXP':
            xp_dict = {}
            for r in records:
                if 'userId' in r and r['userId'] != '' and 'points' in r:
                    val = r['userId']
                    uid = str(int(val)) if isinstance(val, float) else str(val)
                    xp_dict[uid] = int(r['points'] if r['points'] != '' else 0)
            db_json['volunteerXP'] = xp_dict
        elif key == 'SOSHistory':
            db_json['sosHistory'] = records
        else:
            mapped_key = key[0].lower() + key[1:]
            db_json[mapped_key] = records
            
    return jsonify(db_json), 200

@app.route('/api/db', methods=['POST'])
def save_db():
    data = request.json
    all_sheets = pd.read_excel(DB_FILE, sheet_name=None, dtype=str)
    
    # Safely convert to dataframe or empty dataframe
    def to_df(data_list):
        if not data_list: return pd.DataFrame()
        return pd.DataFrame(data_list)

    if 'medications' in data: all_sheets['Medications'] = to_df(data['medications'])
    if 'medicationLogs' in data: all_sheets['MedicationLogs'] = to_df(data['medicationLogs'])
    if 'appointments' in data: all_sheets['Appointments'] = to_df(data['appointments'])
    if 'contacts' in data: all_sheets['Contacts'] = to_df(data['contacts'])
    if 'healthLogs' in data: all_sheets['HealthLogs'] = to_df(data['healthLogs'])
    if 'documents' in data: all_sheets['Documents'] = to_df(data['documents'])
    if 'checkIns' in data: all_sheets['CheckIns'] = to_df(data['checkIns'])
    if 'requests' in data: all_sheets['Requests'] = to_df(data['requests'])
    if 'activeSOS' in data: all_sheets['ActiveSOS'] = to_df(data['activeSOS'])
    if 'sOSHistory' in data: all_sheets['SOSHistory'] = to_df(data['sOSHistory'])
    if 'sosHistory' in data: all_sheets['SOSHistory'] = to_df(data['sosHistory']) # catch lowercase s
    if 'notifications' in data: all_sheets['Notifications'] = to_df(data['notifications'])
    if 'rewards' in data: all_sheets['Rewards'] = to_df(data['rewards'])
    
    if 'volunteerXP' in data:
        xp_list = [{'userId': str(k), 'points': int(v)} for k, v in data['volunteerXP'].items()]
        all_sheets['VolunteerXP'] = to_df(xp_list)
        
    with pd.ExcelWriter(DB_FILE, engine='openpyxl') as writer:
        for s_name, s_df in all_sheets.items():
            s_df.to_excel(writer, sheet_name=s_name, index=False)
            
    return jsonify({'success': True}), 200

if __name__ == '__main__':
    print("Starting Flask Server. View site at: http://127.0.0.1:3000")
    app.run(host='0.0.0.0', port=3000, debug=True)
