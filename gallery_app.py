"""Minimal web UI for organising an iPhone gallery into Year/Month folders.

Run:  python gallery_app.py   then open http://127.0.0.1:8765
Only the Python standard library is required (ExifTool is used if found).
"""
import json
import mimetypes
import os
import shutil
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# ================== CONFIG ==================
HOST, PORT = "127.0.0.1", 8765
DEFAULT_SOURCE = ""
DEFAULT_DEST = ""
HERE = Path(__file__).parent
EXIFTOOL_CANDIDATES = [HERE / "ExifTool" / "exiftool.exe", Path(r"D:\ExifTool\exiftool.exe")]
MEDIA_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".gif", ".webp",
             ".mov", ".mp4", ".m4v", ".aae", ".dng"}
IMAGE_PREVIEW_EXT = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".dng"}
# ===========================================

EXIFTOOL = next((str(p) for p in EXIFTOOL_CANDIDATES if p.exists()), None)

# Optional: Pillow preview support
try:
    from PIL import Image, ImageOps
    PIL_OK = True
except ImportError:
    PIL_OK = False

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_OK = True
except ImportError:
    HEIC_OK = False

CACHE_DIR = HERE / ".preview_cache"
thumbnail_semaphore = threading.Semaphore(max(2, min(4, (os.cpu_count() or 2))))


def image_preview(p, width):
    """Convert an image (HEIC, JPG, PNG, etc.) to a fast cached JPEG thumbnail."""
    if not PIL_OK or not width:
        return p
    ext = p.suffix.lower()
    if ext not in IMAGE_PREVIEW_EXT:
        return p
    if ext in (".heic", ".heif") and not HEIC_OK:
        return p

    import hashlib
    import tempfile
    CACHE_DIR.mkdir(exist_ok=True)
    key = hashlib.md5(f"{p}|{p.stat().st_mtime_ns}|{width}".encode()).hexdigest()
    out = CACHE_DIR / f"{key}.jpg"
    if out.exists():
        return out

    try:
        with thumbnail_semaphore:
            if out.exists():
                return out
            with Image.open(p) as im:
                if ext in (".jpg", ".jpeg"):
                    try:
                        im.draft("RGB", (width, width))
                    except Exception:
                        pass
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((width, width))
                with tempfile.NamedTemporaryFile(dir=CACHE_DIR, delete=False, suffix=".tmp") as tmp:
                    tmp_path = Path(tmp.name)
                    im.save(tmp, "JPEG", quality=80)
                tmp_path.replace(out)
        return out
    except Exception:
        return p
allowed_roots = set()          # folders the browser may read files from
job = {"running": False, "events": [], "done": False, "error": None}
job_lock = threading.Lock()


def list_media(root):
    if not root or not str(root).strip():
        return []
    root = Path(root).resolve()
    if not root.is_dir():
        return []
    items = []
    for p in root.rglob("*"):
        if any(part.startswith(".") for part in p.parts):
            continue
        if p.is_file() and p.suffix.lower() in MEDIA_EXT:
            items.append(p)
    return items


def format_duration(dur):
    if not dur:
        return None
    dur_str = str(dur).strip()
    if dur_str.endswith(" s"):
        try:
            sec = int(float(dur_str[:-2]))
            m, s = divmod(sec, 60)
            h, m = divmod(m, 60)
            return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        except Exception:
            return dur_str
    parts = dur_str.split(":")
    if len(parts) == 3:
        try:
            h = int(parts[0])
            m = int(parts[1])
            s = int(float(parts[2]))
            return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
        except Exception:
            pass
    return dur_str


def exif_metadata(root):
    """Return {resolved path string: {'date': datetime, 'duration': str}} using ExifTool."""
    if not EXIFTOOL or not root or not str(root).strip():
        return {}
    root = Path(root).resolve()
    if not root.is_dir():
        return {}
    cmd = [EXIFTOOL, "-j", "-r", "-DateTimeOriginal", "-CreateDate", "-MediaCreateDate", "-Duration", str(root)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=1800).stdout
        data = json.loads(out) if out else []
    except Exception:
        return {}
    result = {}
    for m in data:
        path_key = str(Path(m.get("SourceFile", "")).resolve())
        d = None
        for key in ("DateTimeOriginal", "CreateDate", "MediaCreateDate"):
            val = m.get(key)
            if not val:
                continue
            try:
                dt = datetime.strptime(str(val)[:19], "%Y:%m:%d %H:%M:%S")
                if dt.year > 1970:
                    d = dt
                    break
            except ValueError:
                continue
        raw_dur = m.get("Duration")
        result[path_key] = {"date": d, "duration": format_duration(raw_dur)}
    return result


def scan(root, with_dates=True):
    if not root or not str(root).strip():
        raise ValueError("Please select a folder.")
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError(f"Not a folder: {root}")
    allowed_roots.add(str(root))
    meta_dict = exif_metadata(root) if with_dates else {}
    items = []
    for p in list_media(root):
        key = str(p.resolve())
        m = meta_dict.get(key, {})
        d = m.get("date")
        duration = m.get("duration")
        source = "exif"
        if d is None:
            d = datetime.fromtimestamp(p.stat().st_mtime)
            source = "file"
        items.append({"path": str(p), "name": p.name, "size": p.stat().st_size,
                      "date": d.strftime("%Y-%m-%d %H:%M"), "dateSource": source,
                      "duration": duration})
    items.sort(key=lambda i: i["date"], reverse=True)
    return items


def scan_organised(root):
    """Dest folder already organised: group by its Year/Month folders."""
    if not root or not str(root).strip():
        return []
    root = Path(root).resolve()
    if not root.is_dir():
        return []
    allowed_roots.add(str(root))
    items = []
    for p in list_media(root):
        try:
            rel = p.relative_to(root).parts
            folder = "/".join(rel[:-1]) or "(root)"
            items.append({"path": str(p), "name": p.name, "folder": folder, "size": p.stat().st_size})
        except Exception:
            continue
    items.sort(key=lambda i: (i["folder"], i["name"]), reverse=True)
    return items


def safe_copy(src, dest, move):
    dest.parent.mkdir(parents=True, exist_ok=True)
    final, n = dest, 1
    while final.exists():
        final = dest.with_stem(f"{dest.stem}_{n}")
        n += 1
    (shutil.move if move else shutil.copy2)(str(src), str(final))
    return final


def folder_for(date_str, layout):
    """Relative target folder for a 'YYYY-MM-DD HH:MM' date string."""
    year, month = date_str[:4], date_str[5:7]
    if layout == "y":
        return year
    if layout == "ymn":
        return f"{year}/{month} - {datetime(int(year), int(month), 1).strftime('%B')}"
    return f"{year}/{month}"


def run_job(files, dest, move, layout="ym"):
    """files: [{"path": ..., "date": "YYYY-MM-DD HH:MM"}] - the selection made in the UI."""
    try:
        items = []
        for f in files:
            p = Path(f["path"]).resolve()
            if p.is_file() and any(str(p).startswith(r) for r in allowed_roots):
                items.append({"path": str(p), "date": f["date"]})
        allowed_roots.add(str(Path(dest).resolve()))
        Path(dest).mkdir(parents=True, exist_ok=True)
        with job_lock:
            job["events"].append({"type": "start", "total": len(items)})
        for it in items:
            src = Path(it["path"])
            if not src.exists():
                continue
            folder = folder_for(it["date"], layout)
            target = safe_copy(src, Path(dest) / folder / src.name, move)
            with job_lock:
                job["events"].append({"type": "file", "name": src.name, "folder": folder,
                                      "path": str(target)})
        with job_lock:
            job["done"] = True
    except Exception as e:
        with job_lock:
            job["error"] = str(e)
            job["done"] = True
    finally:
        job["running"] = False


def media_info(path):
    """Full metadata for one file: basic file facts plus every ExifTool tag, grouped."""
    if not path or not str(path).strip():
        raise ValueError("File not available")
    p = Path(path).resolve()
    if not p.is_file() or not any(str(p).startswith(r) for r in allowed_roots):
        raise ValueError("File not available")
    st = p.stat()
    groups = {"File": {
        "Name": p.name,
        "Folder": str(p.parent),
        "Size": f"{st.st_size / 1048576:.2f} MB ({st.st_size:,} bytes)",
        "Modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
    }}
    if EXIFTOOL:
        try:
            out = subprocess.run([EXIFTOOL, "-j", "-G", "-a", "-charset", "filename=utf8", str(p)],
                                 capture_output=True, text=True, encoding="utf-8", timeout=60).stdout
            tags = json.loads(out)[0] if out else {}
        except Exception:
            tags = {}
        for key, val in tags.items():
            group, _, name = key.partition(":")
            if not name or group == "ExifTool" or key == "SourceFile":
                continue
            groups.setdefault(group, {})[name] = val if isinstance(val, (str, int, float)) else json.dumps(val)
    return groups


def pick_folder():
    import tkinter
    from tkinter import filedialog
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askdirectory()
    root.destroy()
    return path


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/":
                body = (HERE / "index.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif url.path == "/api/config":
                self.send_json({"source": DEFAULT_SOURCE, "dest": DEFAULT_DEST,
                                "exiftool": bool(EXIFTOOL)})
            elif url.path == "/api/scan":
                self.send_json(scan(q["path"]))
            elif url.path == "/api/organised":
                self.send_json(scan_organised(q["path"]))
            elif url.path == "/api/info":
                self.send_json(media_info(q["path"]))
            elif url.path == "/api/pick":
                self.send_json({"path": pick_folder()})
            elif url.path == "/api/open_folder":
                target = Path(q["path"]).resolve()
                if not target.is_dir():
                    raise ValueError(f"Folder not found: {target}")
                allowed_roots.add(str(target))
                subprocess.Popen(["explorer.exe", str(target)])
                self.send_json({"ok": True})
            elif url.path == "/api/progress":
                start = int(q.get("from", 0))
                with job_lock:
                    self.send_json({"events": job["events"][start:], "done": job["done"],
                                    "error": job["error"]})
            elif url.path == "/file":
                self.serve_file(q["path"], int(q.get("w", 0)))
            else:
                static_file = (HERE / url.path.lstrip("/")).resolve()
                if static_file.is_file() and str(static_file).startswith(str(HERE.resolve())):
                    mime, _ = mimetypes.guess_type(static_file.name)
                    body = static_file.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", f"{mime or 'text/plain'}; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_error(404)
        except Exception as e:
            self.send_json({"error": str(e)}, 400)

    def do_POST(self):
        if urlparse(self.path).path != "/api/organise":
            return self.send_error(404)
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        with job_lock:
            if job["running"]:
                return self.send_json({"error": "A job is already running"}, 409)
            job.update(running=True, events=[], done=False, error=None)
        threading.Thread(target=run_job, args=(data["files"], data["dest"],
                                               bool(data.get("move")), data.get("layout", "ym")), daemon=True).start()
        self.send_json({"ok": True})

    def serve_file(self, path, width=0):
        if not path or not str(path).strip():
            return self.send_error(400)
        p = Path(path).resolve()
        if not p.is_file() or not any(str(p).startswith(r) for r in allowed_roots):
            return self.send_error(403)
        if width or p.suffix.lower() in (".heic", ".heif"):
            try:
                p = image_preview(p, width or 2400)
            except Exception:
                pass
        try:
            size = p.stat().st_size
        except OSError:
            return self.send_error(404)
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range", "")
        if rng.startswith("bytes="):          # needed for video seeking
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(size - int(b), 0)
            end = int(b) if a and b else size - 1
            end = min(end, size - 1)
            code = 206
        length = max(end - start + 1, 0)
        self.send_response(code)
        self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        try:
            with open(p, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


if __name__ == "__main__":
    print(f"ExifTool: {EXIFTOOL or 'not found (falling back to file dates)'}")
    print(f"Open http://{HOST}:{PORT}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    threading.Timer(0.8, lambda: webbrowser.open(f"http://{HOST}:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
