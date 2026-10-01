# TaskFlow MySQL: Technical Interview & Live Coding Practice Guide

Welcome to your personalized, step-by-step preparation workbook. This document breaks down every configuration file line-by-line so that if an interviewer asks:
> *"Can you write a Dockerfile or Docker Compose file for me from scratch and explain why you chose each directive?"*

...you can type it out smoothly and explain every single decision with absolute clarity.

---

## 📑 TABLE OF CONTENTS & STUDY MODULES

1. [Module 1: Backend Dockerfile (Flask + Gunicorn)](#module-1-backend-dockerfile)
2. [Module 2: Frontend Multi-Stage Dockerfile (React 19 + Nginx)](#module-2-frontend-multi-stage-dockerfile)
3. [Module 3: Nginx Reverse Proxy Configuration (`nginx.conf`)](#module-3-nginx-reverse-proxy)
4. [Module 4: Writing `docker-compose.yml` Block-by-Block](#module-4-writing-docker-composeyml-block-by-block)
5. [Module 5: Live Coding Drill (Empty Template for Rehearsal)](#module-5-live-coding-drill)
6. [Module 6: "Why Did You Use That?" Quick-Fire Flashcards](#module-6-why-did-you-use-that-flashcards)

---

## MODULE 1: Backend Dockerfile

### The Code
```dockerfile
# 1. Base Image
FROM python:3.12-slim

# 2. Environment Variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# 3. Working Directory
WORKDIR /app

# 4. Install System & Python Dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy Application Source Code
COPY . .

# 6. Expose Port & Launch Command
EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "120", "run:app"]
```

### Line-by-Line "Why Did We Use It?" Explanation

| Directive | Why We Used It (What to Tell the Interviewer) |
| :--- | :--- |
| `FROM python:3.12-slim` | **Minimizes attack surface and image size.** `python:3.12` full image is ~1GB; `python:3.12-slim` is only ~150MB because it strips out unnecessary build compilers and man pages while retaining standard C libraries. |
| `ENV PYTHONDONTWRITEBYTECODE=1` | Prevents Python from writing `.pyc` compiled bytecode files to disk, saving space in container layers. |
| `ENV PYTHONUNBUFFERED=1` | Forces Python standard output (`stdout`/`stderr`) to flush straight to terminal logs immediately without buffering, which ensures real-time Docker logging with `docker compose logs -f`. |
| `WORKDIR /app` | Sets a clean execution directory. Avoids polluting container root `/`. |
| `COPY requirements.txt .`<br>`RUN pip install ...` | **Docker Layer Caching optimization.** By copying only `requirements.txt` before the rest of the source code, Docker caches the installed packages. Future code edits rebuild in 2 seconds rather than re-downloading packages every time. |
| `--no-cache-dir` | Prevents pip from caching wheels in `/root/.cache`, reducing image size by 30–50MB. |
| `EXPOSE 5000` | Documentation directive indicating the container expects traffic on port 5000. |
| `gunicorn ... --workers 4` | **Production WSGI server.** Flask's built-in `flask run` dev server is single-threaded and drops connections under concurrency. Gunicorn runs 4 pre-forked worker processes to handle multiple parallel requests. |

---

## MODULE 2: Frontend Multi-Stage Dockerfile

### The Code
```dockerfile
# ==========================================
# Stage 1: Build the React Application
# ==========================================
FROM node:20-alpine AS build

WORKDIR /app

# Leverage caching for npm dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build static bundle
COPY . .
RUN npm run build

# ==========================================
# Stage 2: Production Nginx Server
# ==========================================
FROM nginx:1.27-alpine

# Copy built static assets from Stage 1 into Nginx web root
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx reverse proxy configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

### Line-by-Line "Why Did We Use It?" Explanation

| Directive | Why We Used It (What to Tell the Interviewer) |
| :--- | :--- |
| `AS build` (Multi-stage build) | **Security and Extreme Size Reduction.** Node.js, `npm`, and `node_modules` are only needed at build time. The final production image contains **only Nginx and compiled HTML/JS/CSS** (total image size drops from ~900MB down to ~30MB). |
| `npm ci` instead of `npm install` | `npm ci` (Clean Install) is strictly deterministic and installs dependencies directly from `package-lock.json` without updating versions, ensuring builds are reproducible across different machines. |
| `FROM nginx:1.27-alpine` | Alpine Linux is ultra-lightweight (~5MB base). Nginx handles static file serving at high concurrency with low memory consumption (~15MB RAM). |
| `COPY --from=build /app/dist ...` | Pulls the compiled Vite output directly from Stage 1. None of the source TypeScript/JSX or node_modules leak into production. |
| `CMD ["nginx", "-g", "daemon off;"]` | Keeps Nginx running in the foreground so the Docker container remains alive. If Nginx daemonized to the background, Docker would assume the process finished and exit immediately. |

---

## MODULE 3: Nginx Reverse Proxy (`nginx.conf`)

### The Code
```nginx
server {
    listen 80;
    server_name localhost;

    # 1. Serve Static Frontend Files
    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    # 2. Reverse Proxy API Calls to Flask Backend
    location /api/ {
        proxy_pass http://backend:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Line-by-Line "Why Did We Use It?" Explanation

| Directive | Why We Used It (What to Tell the Interviewer) |
| :--- | :--- |
| `try_files $uri $uri/ /index.html;` | **Crucial for Single-Page Apps (React Router / Client-side routing).** If a user refreshes on `/dashboard` or `/teams`, Nginx looks for a real file on disk. When not found, it falls back to `/index.html` so React handles the route instead of throwing a 404 error. |
| `location /api/ { proxy_pass http://backend:5000; }` | **Eliminates CORS and solves AWS EC2 Dynamic IP issues.** The browser communicates with relative URLs (`/api/tasks`). Nginx forwards requests internally across Docker's bridge network directly to `backend:5000`. Even if EC2 changes public IPs, the frontend never breaks. |
| `proxy_set_header X-Real-IP ...` | Passes the client's actual originating IP address to Flask (otherwise Flask would think all requests come from Nginx's internal container IP). |

---

## MODULE 4: Writing `docker-compose.yml` Block-by-Block

### 💡 Crucial Concept: `build:` (Local) vs `image:` (Production / Cloud)

In modern DevOps, you have **two Compose files** for two different environments:

1. **`docker-compose.yml` (Local Development)**:
   - Uses `build: context: ./backend` and `build: context: ./frontend`.
   - Used on your development laptop when you are actively writing and modifying code.

2. **`docker-compose.hub.yml` (Production / EC2 Deployment)**:
   - Uses `image: akhilbm/taskflow-backend:v1.0` and `image: akhilbm/taskflow-frontend:v1.0`.
   - Used when deploying to AWS EC2, Render, or staging servers.
   - **Why?** Because you do **not** need to install Git, Node.js, or copy source code to EC2. The server pulls your ready-to-run images in 20 seconds. Low-RAM instances like `t2.micro` will never crash from compiling code.

---

### The Complete Composition (Local Multi-Container Build)
```yaml
services:
  # ----------------------------------------------------
  # 1. MySQL 8.0 Database
  # ----------------------------------------------------
  db:
    image: mysql:8.0
    container_name: taskflow-mysql-db
    restart: unless-stopped
    command: --default-authentication-plugin=mysql_native_password
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-taskflow}
      MYSQL_USER: ${MYSQL_USER:-taskflow}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    ports:
      - "${MYSQL_PORT:-3306}:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h localhost -u $$MYSQL_USER -p$$MYSQL_PASSWORD || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

  # ----------------------------------------------------
  # 2. Flask Gunicorn Backend
  # ----------------------------------------------------
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: taskflow-mysql-backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      PORT: 5000
      DATABASE_URL: mysql+pymysql://${MYSQL_USER:-taskflow}:${MYSQL_PASSWORD}@db:3306/${MYSQL_DATABASE:-taskflow}
      ROOT_ARCHITECT_EMAIL: ${ROOT_ARCHITECT_EMAIL}
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGINS: "*"
    ports:
      - "${BACKEND_PORT:-5001}:5000"

  # ----------------------------------------------------
  # 3. React + Nginx Frontend
  # ----------------------------------------------------
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: taskflow-mysql-frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "${FRONTEND_PORT:-8080}:80"

  # ----------------------------------------------------
  # 4. Adminer Database UI
  # ----------------------------------------------------
  db-ui:
    image: adminer:latest
    container_name: taskflow-mysql-ui
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      ADMINER_DEFAULT_SERVER: db
    ports:
      - "127.0.0.1:${DB_UI_PORT:-8081}:8080"

volumes:
  mysql_data:
    driver: local
```

### Key Questions the Interviewer Might Ask on Docker Compose

#### Q1: "Why do you have `command: --default-authentication-plugin=mysql_native_password`?"
> *"MySQL 8.0 defaulted to `caching_sha2_password` authentication, which older Python drivers and PyMySQL versions struggle with over certain connection formats. Setting `mysql_native_password` guarantees reliable, standard challenge-response handshakes without SSL handshaking errors."*

#### Q2: "What is `depends_on: condition: service_healthy` and why not just `depends_on: - db`?"
> *"Standard `depends_on: - db` only waits until the MySQL container process is started, NOT until MySQL is actually ready to accept queries. MySQL takes 5–15 seconds to initialize storage tables on startup. `condition: service_healthy` ensures Flask does not launch until the `mysqladmin ping` healthcheck passes, completely preventing backend boot crash loops."*

#### Q3: "Why did you bind Adminer to `127.0.0.1:8081:8080` instead of `8081:8080`?"
> *"In production environments like AWS EC2, exposing Adminer on `0.0.0.0:8081` leaves a database management login screen open to internet automated bots. Binding strictly to `127.0.0.1` ensures it is accessible only locally on the host or over an encrypted SSH tunnel (`ssh -L 8081:localhost:8081`)."*

---

## MODULE 5: Live Coding Drill (Blank Template)

When you want to practice writing it from memory, try filling in this skeleton:

```yaml
services:
  db:
    image: # ???
    restart: # ???
    command: # ???
    environment:
      # ???
    volumes:
      # ???
    healthcheck:
      # ???

  backend:
    build: # ???
    depends_on:
      # ???
    environment:
      # ???

  frontend:
    build: # ???
    ports:
      # ???

volumes:
  # ???
```

---

## MODULE 6: "Why Did You Use That?" Flashcards

| Question | Your 10-Second Confident Answer |
| :--- | :--- |
| **Why Docker instead of installing Python and MySQL directly on the EC2 host?** | *"Zero environment drift. A single compose file spins up the exact same verified environment on Windows, Mac, Linux, EC2, or staging with one command."* |
| **Why Werkzeug PBKDF2 instead of plain MD5 or SHA256?** | *"Plain SHA256 is fast, making it vulnerable to brute force and rainbow table attacks. PBKDF2 uses thousands of key-stretching iterations with random salt, conforming to modern NIST standards."* |
| **Why PyMySQL instead of MySQLdb?** | *"PyMySQL is a 100% pure Python client. MySQLdb requires native C compilation libraries (`libmysqlclient-dev`), which would balloon our Docker image size and cause cross-platform compilation errors."* |
| **Why Gunicorn instead of Flask's built-in server?** | *"Flask's development server is single-threaded and explicitly warns not to use it in production. Gunicorn provides master-worker process pooling with worker auto-recovery."* |
