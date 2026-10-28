"""Local Gatewise MVP server. Uses only the Python standard library."""
from __future__ import annotations

import hashlib
import hmac
import base64
import csv
import io
import json
import os
import re
import secrets
import sqlite3
import time
import zipfile
import xml.etree.ElementTree as ET
import threading
from datetime import datetime, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("GATEWISE_DATA_DIR", ROOT / "app-data"))
DB_PATH = Path(os.environ.get("GATEWISE_DB_PATH", DATA / "gatewise.sqlite3"))
HOST = os.environ.get("GATEWISE_HOST", "127.0.0.1")
PORT = int(os.environ.get("GATEWISE_PORT", "8080"))
SESSION_SECONDS = 8 * 60 * 60
DEMO_EMAIL = "admin@northfield.school"
DEMO_PASSWORD = "GatewiseDemo!26"
IMPORT_STAGES = {}
IMPORT_LOCK = threading.Lock()
IMPORT_COLUMNS = ("pupil_id", "pupil_name", "class_name", "guardian_name")
MAX_IMPORT_BYTES = 8 * 1024 * 1024
MAX_IMPORT_ROWS = 5000


def now_local():
    return datetime.now().astimezone()


def password_hash(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    salt = salt or secrets.token_bytes(16)
    return salt, hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)


def db():
    DATA.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
          role TEXT NOT NULL, salt BLOB NOT NULL, password_hash BLOB NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS pupils (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, class_name TEXT NOT NULL,
          guardian TEXT NOT NULL, initials TEXT NOT NULL, color TEXT NOT NULL,
          photo TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS collectors (
          id INTEGER PRIMARY KEY AUTOINCREMENT, pupil_id TEXT NOT NULL REFERENCES pupils(id),
          name TEXT NOT NULL, relation TEXT NOT NULL, valid_until TEXT NOT NULL DEFAULT 'Ongoing', active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS pickup_requests (
          id TEXT PRIMARY KEY, pupil_id TEXT NOT NULL REFERENCES pupils(id), name TEXT NOT NULL,
          relation TEXT NOT NULL, requested_by TEXT NOT NULL, request_time TEXT NOT NULL,
          note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY, pupil_id TEXT NOT NULL REFERENCES pupils(id), type TEXT NOT NULL,
          event_time TEXT NOT NULL, event_date TEXT NOT NULL, created_ms INTEGER NOT NULL,
          staff TEXT NOT NULL, source TEXT NOT NULL, collector TEXT, verification TEXT,
          alert TEXT NOT NULL DEFAULT 'Demo only'
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
          action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS event_date_idx ON events(event_date, created_ms);
        CREATE INDEX IF NOT EXISTS collector_pupil_idx ON collectors(pupil_id, active);
        """)
        if not c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            salt, digest = password_hash(DEMO_PASSWORD)
            c.execute("INSERT INTO users(email,name,role,salt,password_hash) VALUES(?,?,?,?,?)",
                      (DEMO_EMAIL, "Amara Okafor", "admin", salt, digest))
        if not c.execute("SELECT 1 FROM pupils LIMIT 1").fetchone():
            pupils = [
              ("NF-1042","Zara Adeyemi","Grade 3A","Tomi Adeyemi","ZA","rose","👧🏽"),
              ("NF-1087","Daniel Mensah","Grade 2B","Ama Mensah","DM","mint","👦🏾"),
              ("NF-1103","Maya Okonkwo","Grade 4A","Chika Okonkwo","MO","sand","👧🏿"),
              ("NF-1139","Ethan Bello","Grade 1C","Sade Bello","EB","blue","👦🏽"),
              ("NF-1175","Nneka Eze","Grade 3A","Ifeoma Eze","NE","violet","👧🏾"),
              ("NF-1204","Samuel Adebayo","Grade 5B","Tunde Adebayo","SA","mint","👦🏿"),
              ("NF-1228","Lola James","Grade 2B","Kemi James","LJ","rose","👧🏽"),
              ("NF-1261","David Nwosu","Grade 4A","Ada Nwosu","DN","blue","👦🏾"),
              ("NF-1290","Amina Yusuf","Grade 1C","Bilkisu Yusuf","AY","sand","👧🏿"),
              ("NF-1315","Noah Peters","Grade 5B","Grace Peters","NP","violet","👦🏽")]
            c.executemany("INSERT INTO pupils(id,name,class_name,guardian,initials,color,photo) VALUES(?,?,?,?,?,?,?)", pupils)
            for pid, name, rel in [("NF-1042","Tomi Adeyemi","Mother"),("NF-1042","Kola Adeyemi","Father"),("NF-1087","Ama Mensah","Mother"),("NF-1103","Chika Okonkwo","Father"),("NF-1139","Sade Bello","Mother"),("NF-1175","Ifeoma Eze","Mother"),("NF-1204","Tunde Adebayo","Father"),("NF-1228","Kemi James","Mother"),("NF-1261","Ada Nwosu","Mother"),("NF-1290","Bilkisu Yusuf","Mother"),("NF-1315","Grace Peters","Mother")]:
                c.execute("INSERT INTO collectors(pupil_id,name,relation) VALUES(?,?,?)", (pid,name,rel))
            now = now_local()
            samples = [("NF-1175",34,"Grace"),("NF-1042",27,"Chinedu"),("NF-1087",19,"Grace"),("NF-1139",11,"Chinedu")]
            for i,(pid,ago,staff) in enumerate(samples):
                t = now.timestamp() - ago*60
                lt = datetime.fromtimestamp(t).astimezone()
                c.execute("INSERT INTO events(id,pupil_id,type,event_time,event_date,created_ms,staff,source,alert) VALUES(?,?,?,?,?,?,?,?,?)",
                          (f"seed-{i}",pid,"arrival",lt.strftime("%I:%M %p").lstrip("0"),lt.date().isoformat(),int(t*1000),staff,"Card scan","Demo only"))
            for rid,pid,name,rel,guardian,tm,note in [
                ("r1","NF-1042","Bola Adeyemi","Aunt","Tomi Adeyemi","Today, 8:42 AM","One-time pickup today. ID check required."),
                ("r2","NF-1087","Kojo Mensah","Uncle","Ama Mensah","Today, 9:06 AM","Temporary approval. Confirm the expiry with the guardian.")]:
                c.execute("INSERT INTO pickup_requests(id,pupil_id,name,relation,requested_by,request_time,note) VALUES(?,?,?,?,?,?,?)",(rid,pid,name,rel,guardian,tm,note))


def pupil_json(c, row):
    collectors = c.execute("SELECT id,name,relation,valid_until AS 'until' FROM collectors WHERE pupil_id=? AND active=1 AND (valid_until='Ongoing' OR date(valid_until)>=date('now','localtime')) ORDER BY id", (row["id"],)).fetchall()
    return {"id":row["id"],"name":row["name"],"className":row["class_name"],"guardian":row["guardian"],"initials":row["initials"],"color":row["color"],"photo":row["photo"],"collectors":[dict(x) for x in collectors]}


def state_json(c):
    pupils = [pupil_json(c,r) for r in c.execute("SELECT * FROM pupils WHERE active=1 ORDER BY name")]
    events = [dict(id=r["id"],pupilId=r["pupil_id"],type=r["type"],time=r["event_time"],date=r["event_date"],createdAt=r["created_ms"],staff=r["staff"],source=r["source"],collector=r["collector"],verification=r["verification"],alert=r["alert"]) for r in c.execute("SELECT * FROM events ORDER BY created_ms DESC LIMIT 150")]
    requests = [dict(id=r["id"],pupilId=r["pupil_id"],name=r["name"],relation=r["relation"],requestedBy=r["requested_by"],time=r["request_time"],note=r["note"]) for r in c.execute("SELECT * FROM pickup_requests WHERE status='pending' ORDER BY rowid")]
    return {"pupils":pupils,"events":events,"requests":requests,"school":{"name":"Northfield Academy","campus":"Primary campus","totalPupils":248},"notifications":"demo"}


def _column_number(ref):
    letters=re.match(r"[A-Z]+",ref or "")
    if not letters:return 0
    value=0
    for ch in letters.group(0):value=value*26+ord(ch)-64
    return value-1


def _xlsx_rows(raw):
    ns={"main":"http://schemas.openxmlformats.org/spreadsheetml/2006/main","rel":"http://schemas.openxmlformats.org/officeDocument/2006/relationships","pkg":"http://schemas.openxmlformats.org/package/2006/relationships"}
    try:
        z=zipfile.ZipFile(io.BytesIO(raw))
        if sum(i.file_size for i in z.infolist())>25*1024*1024:raise ValueError("The expanded workbook is too large.")
        names=set(z.namelist())
        if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:raise ValueError("This is not a valid XLSX workbook.")
        wb=ET.fromstring(z.read("xl/workbook.xml")); relroot=ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rels={r.attrib["Id"]:r.attrib["Target"] for r in relroot.findall("pkg:Relationship",ns)}
        sheet_target=None
        for sh in wb.findall("main:sheets/main:sheet",ns):
            if sh.attrib.get("name","").strip().casefold()=="pupils":
                target=rels.get(sh.attrib.get(f"{{{ns['rel']}}}id"))
                if target:
                    target=target.lstrip("/")
                    sheet_target=target if target.startswith("xl/") else "xl/"+target
                break
        if not sheet_target or sheet_target not in names:raise ValueError("The workbook must contain a sheet named Pupils.")
        strings=[]
        if "xl/sharedStrings.xml" in names:
            ss=ET.fromstring(z.read("xl/sharedStrings.xml"))
            strings=["".join(t.text or "" for t in si.findall(".//main:t",ns)) for si in ss.findall("main:si",ns)]
        root=ET.fromstring(z.read(sheet_target)); output=[]
        for row in root.findall("main:sheetData/main:row",ns):
            cells={}
            for cell in row.findall("main:c",ns):
                if cell.find("main:f",ns) is not None:raise ValueError("Formula cells are not supported. Paste values into the Pupils sheet and upload again.")
                ref=cell.attrib.get("r",""); idx=_column_number(ref)
                typ=cell.attrib.get("t"); v=cell.find("main:v",ns)
                if typ=="inlineStr":value="".join(t.text or "" for t in cell.findall(".//main:t",ns))
                elif v is None:value=""
                elif typ=="s":
                    try:value=strings[int(v.text or "0")]
                    except (ValueError,IndexError):raise ValueError("Workbook contains an invalid shared-string reference.")
                else:value=v.text or ""
                cells[idx]=value
            if cells:output.append([cells.get(i,"") for i in range(max(cells)+1)])
        return output
    except zipfile.BadZipFile:raise ValueError("The XLSX file is damaged or invalid.")


def parse_roster(raw, filename, c):
    if len(raw)>MAX_IMPORT_BYTES:raise ValueError("The file is larger than 8 MB.")
    suffix=Path(filename).suffix.casefold()
    if suffix==".csv":
        try:text=raw.decode("utf-8-sig")
        except UnicodeDecodeError:raise ValueError("Save the CSV as UTF-8 and upload it again.")
        try:rows=list(csv.reader(io.StringIO(text,newline="")))
        except csv.Error as exc:raise ValueError(f"Could not read CSV: {exc}")
    elif suffix==".xlsx":rows=_xlsx_rows(raw)
    else:raise ValueError("Choose a .csv or .xlsx file.")
    if not rows:raise ValueError("The roster file is empty.")
    headers=[str(v).strip().lower() for v in rows[0]]
    if len(headers)!=len(set(headers)):raise ValueError("The file has duplicate column headers.")
    missing=[name for name in IMPORT_COLUMNS if name not in headers]
    extra=[name for name in headers if name and name not in IMPORT_COLUMNS]
    if missing or extra:
        detail=[]
        if missing:detail.append("missing: "+", ".join(missing))
        if extra:detail.append("unexpected: "+", ".join(extra))
        raise ValueError("The header row must contain exactly pupil_id, pupil_name, class_name, guardian_name ("+"; ".join(detail)+").")
    if len(rows)-1>MAX_IMPORT_ROWS:raise ValueError(f"A file can contain at most {MAX_IMPORT_ROWS} pupils.")
    indexes={name:headers.index(name) for name in IMPORT_COLUMNS}; records=[]; errors=[]; seen={}
    existing={r[0] for r in c.execute("SELECT id FROM pupils WHERE active=1")}
    for number, values in enumerate(rows[1:],start=2):
        if not any(str(v).strip() for v in values):continue
        rec={k:(str(values[indexes[k]]) if indexes[k]<len(values) else "").strip() for k in IMPORT_COLUMNS}
        pid=rec["pupil_id"].upper(); rec["pupil_id"]=pid
        row_errors=[]
        if not pid or len(pid)>30 or not re.fullmatch(r"[A-Z0-9]+(?:-[A-Z0-9]+)*",pid):row_errors.append("pupil_id is required and may use letters, numbers, and hyphens.")
        elif pid in seen:row_errors.append(f"pupil_id duplicates row {seen[pid]} in this file.")
        elif pid in existing:row_errors.append("pupil_id already exists in Gatewise.")
        if not rec["pupil_name"] or len(rec["pupil_name"])>100:row_errors.append("pupil_name is required (maximum 100 characters).")
        if not rec["class_name"] or len(rec["class_name"])>30:row_errors.append("class_name is required (maximum 30 characters).")
        if not rec["guardian_name"] or len(rec["guardian_name"])>100:row_errors.append("guardian_name is required (maximum 100 characters).")
        if pid and pid not in seen:seen[pid]=number
        if row_errors:errors.append({"row":number,"pupil_id":pid,"messages":row_errors})
        else:records.append(rec)
    if not records and not errors:raise ValueError("Add at least one pupil row below the header.")
    return records,errors,len(rows)-1


def users_json(c):
    return [dict(id=r["id"],email=r["email"],name=r["name"],role=r["role"],active=bool(r["active"])) for r in c.execute("SELECT id,email,name,role,active FROM users ORDER BY name")]


class Handler(BaseHTTPRequestHandler):
    server_version = "GatewiseLocal/0.1"
    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_json(self, status, data, extra_headers=None):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        for k,v in (extra_headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(raw)

    def send_file(self, path):
        resolved = (ROOT / path).resolve()
        if ROOT.resolve() not in resolved.parents and resolved != ROOT.resolve(): return self.send_error(404)
        if not resolved.is_file(): return self.send_error(404)
        types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml"}
        raw=resolved.read_bytes(); self.send_response(200); self.send_header("Content-Type",types.get(resolved.suffix,"application/octet-stream")); self.send_header("Content-Length",str(len(raw))); self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Referrer-Policy","same-origin"); self.send_header("Content-Security-Policy","default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); self.end_headers(); self.wfile.write(raw)

    def read_json(self):
        n=int(self.headers.get("Content-Length","0"))
        if n>12*1024*1024: raise ValueError("Request is too large. Maximum request size is 12 MB.")
        return json.loads(self.rfile.read(n) or b"{}")

    def session_user(self):
        jar=cookies.SimpleCookie(self.headers.get("Cookie","")); morsel=jar.get("gw_session")
        if not morsel: return None
        token_hash=hashlib.sha256(morsel.value.encode()).hexdigest()
        with db() as c:
            row=c.execute("SELECT u.id,u.email,u.name,u.role,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1",(token_hash,)).fetchone()
            if not row: return None
            if row["expires_at"]<int(time.time()): c.execute("DELETE FROM sessions WHERE token_hash=?",(token_hash,)); return None
            return dict(row)

    def origin_ok(self):
        origin=self.headers.get("Origin")
        if not origin: return True
        parsed=urlparse(origin)
        return parsed.hostname in ("127.0.0.1","localhost") and parsed.port==PORT

    def require_user(self, roles=("admin","manager","viewer")):
        user=self.session_user()
        if not user: self.send_json(401,{"error":"Sign in to continue."}); return None
        if user["role"] not in roles: self.send_json(403,{"error":"You do not have permission to do that."}); return None
        return user

    def do_GET(self):
        path=unquote(urlparse(self.path).path)
        if path=="/api/me":
            user=self.session_user(); return self.send_json(200,{"user":{k:user[k] for k in ("id","email","name","role")} if user else None})
        if path=="/api/state":
            if not self.require_user(): return
            with db() as c: return self.send_json(200,state_json(c))
        if path=="/api/users":
            if not self.require_user(("admin",)):return
            with db() as c:return self.send_json(200,{"users":users_json(c)})
        if path=="/" or path=="/index.html": return self.send_file("index.html")
        if path in ("/app.js","/styles.css"): return self.send_file(path[1:])
        return self.send_error(404)

    def do_POST(self):
        path=unquote(urlparse(self.path).path)
        if not self.origin_ok(): return self.send_json(403,{"error":"Cross-origin request rejected."})
        try: body=self.read_json()
        except Exception as exc: return self.send_json(400,{"error":str(exc) or "Invalid JSON."})
        if path=="/api/login":
            email=str(body.get("email",""))[:200].strip().lower(); password=str(body.get("password",""))[:500]
            with db() as c:
                row=c.execute("SELECT * FROM users WHERE email=? AND active=1",(email,)).fetchone()
                if not row or not hmac.compare_digest(hashlib.pbkdf2_hmac("sha256",password.encode(),row["salt"],310_000),row["password_hash"]): return self.send_json(401,{"error":"Email or password is incorrect."})
                token=secrets.token_urlsafe(32); expiry=int(time.time())+SESSION_SECONDS
                c.execute("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),row["id"],expiry,int(time.time())))
                c.execute("DELETE FROM sessions WHERE expires_at<?",(int(time.time()),))
            cookie=f"gw_session={token}; Path=/; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Strict"
            with db() as c: state=state_json(c)
            return self.send_json(200,{"user":{"id":row["id"],"email":row["email"],"name":row["name"],"role":row["role"]},"state":state},{"Set-Cookie":cookie})
        if path=="/api/logout":
            jar=cookies.SimpleCookie(self.headers.get("Cookie","")); morsel=jar.get("gw_session")
            if morsel:
                with db() as c:c.execute("DELETE FROM sessions WHERE token_hash=?",(hashlib.sha256(morsel.value.encode()).hexdigest(),))
            return self.send_json(200,{"ok":True},{"Set-Cookie":"gw_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"})
        if path=="/api/import/preview":
            user=self.require_user(("admin","manager"))
            if not user:return
            try:
                filename=str(body.get("filename","roster.csv"))[:255]
                raw=base64.b64decode(str(body.get("fileBase64","")),validate=True)
                with db() as c:records,errors,row_count=parse_roster(raw,filename,c)
            except (ValueError,base64.binascii.Error) as exc:return self.send_json(400,{"error":str(exc)})
            if errors:return self.send_json(200,{"rowCount":row_count,"validCount":len(records),"errors":errors[:100],"errorCount":len(errors),"preview":records[:8],"token":None})
            token=secrets.token_urlsafe(24)
            with IMPORT_LOCK:
                expired=[k for k,v in IMPORT_STAGES.items() if v["expires"]<time.time()]
                for k in expired:IMPORT_STAGES.pop(k,None)
                IMPORT_STAGES[token]={"userId":user["id"],"expires":time.time()+600,"records":records}
            return self.send_json(200,{"rowCount":row_count,"validCount":len(records),"errors":[],"errorCount":0,"preview":records[:8],"token":token})
        if path=="/api/import/commit":
            user=self.require_user(("admin","manager"))
            if not user:return
            token=str(body.get("token",""))
            with IMPORT_LOCK:stage=IMPORT_STAGES.pop(token,None)
            if not stage or stage["userId"]!=user["id"] or stage["expires"]<time.time():return self.send_json(400,{"error":"The import preview expired. Upload the roster again."})
            try:return self.commit_import(user,stage["records"])
            except sqlite3.IntegrityError:return self.send_json(409,{"error":"A pupil ID now exists in Gatewise. Preview the roster again and resolve duplicate IDs."})
        if path=="/api/users":
            user=self.require_user(("admin",))
            if not user:return
            try:return self.create_user(user,body)
            except ValueError as exc:return self.send_json(400,{"error":str(exc)})
            except sqlite3.IntegrityError:return self.send_json(409,{"error":"A user with that email already exists."})
        if path.startswith("/api/users/"):
            user=self.require_user(("admin",))
            if not user:return
            try:return self.update_user(user,path.rsplit("/",1)[-1],body)
            except ValueError as exc:return self.send_json(400,{"error":str(exc)})
        user=self.require_user()
        if not user:return
        try:
            if path=="/api/events":
                user=self.require_user(("admin","manager"))
                if not user:return
                return self.create_event(user,body)
            if path=="/api/pupils":
                user=self.require_user(("admin","manager"))
                if not user:return
                return self.create_pupil(user,body)
            if path.startswith("/api/pickup/"):
                user=self.require_user(("admin","manager"))
                if not user:return
                return self.resolve_pickup(user,path.rsplit("/",1)[-1],body)
            return self.send_json(404,{"error":"Not found."})
        except ValueError as exc:return self.send_json(400,{"error":str(exc)})
        except sqlite3.IntegrityError:return self.send_json(409,{"error":"That record already exists or is no longer available."})

    def create_event(self,user,body):
        pid=str(body.get("pupilId",""))[:30].strip(); typ=str(body.get("type","")); source=str(body.get("source","Card scan"))[:50]
        if typ not in ("arrival","departure"): raise ValueError("Choose arrival or departure.")
        with db() as c:
            p=c.execute("SELECT * FROM pupils WHERE id=? AND active=1",(pid,)).fetchone()
            if not p: raise ValueError("Pupil ID not found.")
            prev=c.execute("SELECT type FROM events WHERE pupil_id=? AND event_date=? ORDER BY created_ms DESC LIMIT 1",(pid,now_local().date().isoformat())).fetchone()
            if typ=="arrival" and prev and prev["type"]=="arrival": raise ValueError(f"{p['name']} already has an arrival recorded today.")
            if typ=="departure" and (not prev or prev["type"]!="arrival"): raise ValueError(f"Record and verify {p['name']}'s arrival before departure.")
            collector=None; verification=None
            if typ=="departure":
                cid=body.get("collectorId")
                if cid is None: raise ValueError("Select an approved collector.")
                cr=c.execute("SELECT name FROM collectors WHERE id=? AND pupil_id=? AND active=1 AND (valid_until='Ongoing' OR date(valid_until)>=date('now','localtime'))",(int(cid),pid)).fetchone()
                if not cr: raise ValueError("That collector is not approved for this pupil.")
                collector=cr["name"]; verification=str(body.get("verification","Photo matched"))[:60]
            n=now_local(); eid=secrets.token_urlsafe(12)
            c.execute("INSERT INTO events(id,pupil_id,type,event_time,event_date,created_ms,staff,source,collector,verification,alert) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(eid,pid,typ,n.strftime("%I:%M %p").lstrip("0"),n.date().isoformat(),int(n.timestamp()*1000),user["name"],source,collector,verification,"Demo only"))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,reason,created_at) VALUES(?,?,?,?,?,?)",(user["id"],f"record_{typ}","event",eid,"",n.isoformat()))
            return self.send_json(201,{"ok":True,"eventId":eid,"alertStatus":"demo_only","state":state_json(c)})

    def create_pupil(self,user,body):
        name=str(body.get("name",""))[:100].strip(); pid=str(body.get("id",""))[:30].strip().upper(); cls=str(body.get("className",""))[:30].strip(); guardian=str(body.get("guardian",""))[:100].strip()
        if not name or not cls or not guardian: raise ValueError("Name, class, and guardian are required.")
        if not pid: pid="NF-"+str(secrets.randbelow(9000)+1000)
        if not pid.replace("-","").isalnum(): raise ValueError("Pupil ID may contain letters, numbers, and hyphens only.")
        colors=("rose","mint","sand","blue","violet"); initials="".join(x[0] for x in name.split()[:2]).upper()
        with db() as c:
            c.execute("INSERT INTO pupils(id,name,class_name,guardian,initials,color,photo) VALUES(?,?,?,?,?,?,?)",(pid,name,cls,guardian,initials,colors[int(time.time())%len(colors)],"♙"))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,created_at) VALUES(?,?,?,?,?)",(user["id"],"create","pupil",pid,now_local().isoformat()))
            return self.send_json(201,{"ok":True,"state":state_json(c)})

    def commit_import(self,user,records):
        colors=("rose","mint","sand","blue","violet"); now=now_local()
        with db() as c:
            for index,r in enumerate(records):
                name=r["pupil_name"].strip(); initials="".join(x[0] for x in name.split()[:2]).upper()
                c.execute("INSERT INTO pupils(id,name,class_name,guardian,initials,color,photo) VALUES(?,?,?,?,?,?,?)",(r["pupil_id"],name,r["class_name"].strip(),r["guardian_name"].strip(),initials,colors[index%len(colors)],"♙"))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,reason,created_at) VALUES(?,?,?,?,?,?)",(user["id"],"bulk_import","pupil_roster",secrets.token_hex(8),f"Imported {len(records)} pupils",now.isoformat()))
            return self.send_json(201,{"ok":True,"imported":len(records),"state":state_json(c)})

    def create_user(self,actor,body):
        name=str(body.get("name",""))[:100].strip(); email=str(body.get("email",""))[:200].strip().lower(); role=str(body.get("role","")); password=str(body.get("password",""))
        if not name:raise ValueError("Enter the user's name.")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email):raise ValueError("Enter a valid email address.")
        if role not in ("admin","manager","viewer"):raise ValueError("Choose admin, manager, or viewer.")
        if len(password)<12:raise ValueError("Temporary password must be at least 12 characters.")
        salt,digest=password_hash(password)
        with db() as c:
            cur=c.execute("INSERT INTO users(email,name,role,salt,password_hash) VALUES(?,?,?,?,?)",(email,name,role,salt,digest))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,reason,created_at) VALUES(?,?,?,?,?,?)",(actor["id"],"create_user","user",str(cur.lastrowid),role,now_local().isoformat()))
            return self.send_json(201,{"ok":True,"users":users_json(c)})

    def update_user(self,actor,raw_id,body):
        try:user_id=int(raw_id)
        except ValueError:raise ValueError("Invalid user ID.")
        role=body.get("role"); active=body.get("active")
        if role is not None and role not in ("admin","manager","viewer"):raise ValueError("Choose admin, manager, or viewer.")
        if active is not None and not isinstance(active,bool):raise ValueError("User status must be active or inactive.")
        if user_id==actor["id"] and (role not in (None,"admin") or active is False):raise ValueError("You cannot remove your own admin access.")
        with db() as c:
            row=c.execute("SELECT id,role,active FROM users WHERE id=?",(user_id,)).fetchone()
            if not row:return self.send_json(404,{"error":"User not found."})
            final_role=role or row["role"]; final_active=int(active if active is not None else row["active"])
            if row["role"]=="admin" and row["active"] and (final_role!="admin" or not final_active):
                admins=c.execute("SELECT count(*) FROM users WHERE role='admin' AND active=1").fetchone()[0]
                if admins<=1:raise ValueError("Keep at least one active administrator.")
            c.execute("UPDATE users SET role=?,active=? WHERE id=?",(final_role,final_active,user_id))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,reason,created_at) VALUES(?,?,?,?,?,?)",(actor["id"],"update_user","user",str(user_id),f"role={final_role}; active={final_active}",now_local().isoformat()))
            c.execute("DELETE FROM sessions WHERE user_id=? AND (?=0 OR ?!=?)",(user_id,final_active,final_role,row["role"]))
            return self.send_json(200,{"ok":True,"users":users_json(c)})

    def resolve_pickup(self,user,rid,body):
        action=body.get("action")
        if action not in ("approve","decline"): raise ValueError("Choose approve or decline.")
        with db() as c:
            r=c.execute("SELECT * FROM pickup_requests WHERE id=? AND status='pending'",(rid,)).fetchone()
            if not r: return self.send_json(404,{"error":"This request is no longer pending."})
            if action=="approve":
                exists=c.execute("SELECT 1 FROM collectors WHERE pupil_id=? AND lower(name)=lower(?) AND active=1",(r["pupil_id"],r["name"])).fetchone()
                valid_until=str(body.get("validUntil",""))
                try:
                    from datetime import date
                    expiry=date.fromisoformat(valid_until)
                except ValueError: raise ValueError("Choose a valid pickup approval expiry date.")
                if expiry < now_local().date(): raise ValueError("Pickup approval expiry cannot be in the past.")
                if not exists:c.execute("INSERT INTO collectors(pupil_id,name,relation,valid_until) VALUES(?,?,?,?)",(r["pupil_id"],r["name"],r["relation"],expiry.isoformat()))
                else:c.execute("UPDATE collectors SET valid_until=? WHERE pupil_id=? AND lower(name)=lower(?) AND active=1",(expiry.isoformat(),r["pupil_id"],r["name"]))
            c.execute("UPDATE pickup_requests SET status=? WHERE id=?",(action+"d" if action=="approve" else "declined",rid))
            c.execute("INSERT INTO audit_log(user_id,action,object_type,object_id,reason,created_at) VALUES(?,?,?,?,?,?)",(user["id"],f"pickup_{action}","pickup_request",rid,"School admin review",now_local().isoformat()))
            return self.send_json(200,{"ok":True,"state":state_json(c)})


if __name__ == "__main__":
    init_db()
    print("Gatewise is available at http://127.0.0.1:%s" % PORT)
    print("Demo staff sign-in: %s / %s" % (DEMO_EMAIL, DEMO_PASSWORD))
    print("Local demo only. Configure HTTPS, secret credentials, and production services before real school use.")
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
