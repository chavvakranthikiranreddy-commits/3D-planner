import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ.setdefault("UPLOAD_DIR", f"{_tmp}/uploads")
os.environ.setdefault("API_TOKEN", "test-token")
