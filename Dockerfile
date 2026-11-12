# Stage 1 — Build React + CesiumJS 3D Frontend
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 — FastAPI + MOLA 32ppd Planetary Backend + Static SPA Server
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Download NASA PDS MGS MOLA 32ppd global DEM (~132 MB) if not already mounted
RUN mkdir -p /app/data && \
    if [ ! -f /app/data/mola_32ppd.img ]; then \
      curl -fSL "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/megt90n000fb.img" -o /app/data/mola_32ppd.img; \
    fi

WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
