# Mars Atlas — NASA Space Apps 2026: Interplanetary Survival Guide

Run in two terminals:

```bash
# 1. Backend (Python / FastAPI) → http://127.0.0.1:8000/docs
cd backend && ../.venv/bin/uvicorn main:app --reload --port 8000

# 2. Frontend (React + Cesium) → http://localhost:5173
cd frontend && npm run dev
```

First time on a new machine: `python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt` and `cd frontend && npm install`.

Check the Mars clock math: `cd backend && ../.venv/bin/python test_mars_time.py`
