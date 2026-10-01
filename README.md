# TaskFlow - Standalone MySQL 8.0 & Native JWT Edition

## 🎯 Project Overview
This repository contains the standalone, fully self-contained edition of **TaskFlow**. It replaces external BaaS dependencies (like Supabase, PostgreSQL cloud instances, and external email confirmation services) with a battle-tested, locally-orchestrated stack:
- **Database**: **MySQL 8.0** with persistent Docker volumes and automatic table initialization.
- **Backend**: **Flask 3.1** on Python 3.12, utilizing native password hashing (`werkzeug.security`) and signed **JWT (HS256)** token authentication.
- **Frontend**: **React 19** + **Vite 6** served via **Nginx** reverse proxy.
- **Zero Public IP Configuration**: The browser communicates with relative `/api/` endpoints. Nginx internally reverse-proxies requests to `http://backend:5000/api/`. When the EC2 public IP changes, the frontend continues to work with zero configuration updates.

### 🐳 Published Docker Hub Images
This project is packaged and published to Docker Hub for instant 1-command cloud deployments:
- **Backend API**: [`akhilbm/taskflow-backend:v1.0`](https://hub.docker.com/r/akhilbm/taskflow-backend) (and `:latest`)
- **Frontend SPA**: [`akhilbm/taskflow-frontend:v1.0`](https://hub.docker.com/r/akhilbm/taskflow-frontend) (and `:latest`)
- **Database**: Official `mysql:8.0`
- **Database UI**: Official `adminer:latest`

---

## 🏗️ Architecture

```
+-----------------------------------------------------------------+
|                       Docker Host (EC2 / Local)                 |
|                                                                 |
|   +-------------------+    /api/    +-----------------------+   |
|   |  frontend (Nginx) | ----------> |   backend (Flask API) |   |
|   |  Port: 80 / 8080  |             |   Port: 5000 / 5001   |   |
|   +-------------------+             +-----------------------+   |
|                                                 |               |
|                                                 | PyMySQL       |
|                                                 v               |
|                                     +-----------------------+   |
|                                     |    db (MySQL 8.0)     |   |
|                                     |    Port: 3306         |   |
|                                     |    Volume: mysql_data |   |
|                                     +-----------------------+   |
+-----------------------------------------------------------------+
```

---

## ⚡ Quickstart (Local)

### 1. Launch All Services
```bash
docker compose up -d --build
```

### 2. Verify Container Health
```bash
docker compose ps
```
All three containers (`taskflow-mysql-db`, `taskflow-mysql-backend`, `taskflow-mysql-frontend`) will report healthy/running.

### 3. Access TaskFlow
Open your browser to:
```
http://localhost:8080
```
*(Port 8080 is used locally so it doesn't conflict with any legacy containers on port 80).*

### 4. Create an Account
1. Click **Sign Up**.
2. Enter your Name, Email, and Password.
3. Click **Register** &rarr; You are **immediately authenticated** with a native JWT token and taken to the workspace dashboard. No email verification or third-party links required.
4. The first user to register automatically receives the **ARCHITECT** super-admin role!

### 5. Access Database Web Dashboard (Adminer)
Open your browser to:
```
http://localhost:8081
```
- **System**: `MySQL`
- **Server**: `db` (pre-filled)
- **Username**: `taskflow`
- **Password**: *(The `MYSQL_PASSWORD` you set in your `.env`)*
- **Database**: `taskflow`

Provides a Supabase-like visual dashboard to inspect tables, view rows, and edit data directly in your browser.

---

## 🚀 AWS EC2 Deployment Runbook

### Prerequisites
- An Ubuntu 24.04 LTS EC2 Instance (t3.micro or t3.small)
- Inbound Security Group Rules:
  - Port `80` (HTTP)
  - Port `22` (SSH)

### 1. Connect to your EC2 Instance
```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

### 2. Install Docker & Docker Compose (if not already installed)
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu
newgrp docker
```

### 🚀 Choose Your Deployment Method

You can deploy TaskFlow on EC2 in **two different ways**, depending on your workflow:

---

#### 🔹 Method 1: Instant Cloud Deployment via Docker Hub (Fastest — 30 Seconds)
> **Best for**: Production servers, EC2, staging, and demo environments.  
> **Advantage**: **No Git cloning or source code needed on EC2.** It pulls pre-built optimized images directly from Docker Hub, eliminating build times and saving memory on small instances (like `t2.micro`).

```bash
# 1. Create a clean project folder
mkdir -p ~/taskflow-mysql && cd ~/taskflow-mysql

# 2. Configure production credentials
cat << 'EOF' > .env
MYSQL_ROOT_PASSWORD=your_secure_root_password_here
MYSQL_DATABASE=taskflow
MYSQL_USER=taskflow
MYSQL_PASSWORD=your_secure_db_password_here
ROOT_ARCHITECT_EMAIL=akhilbm13@gmail.com
JWT_SECRET=your_jwt_secret_random_hex_string_here
FRONTEND_PORT=80
BACKEND_PORT=5000
DB_UI_PORT=8081
EOF

# 3. Download the production Compose file (configured to pull from Docker Hub)
curl -sSL https://raw.githubusercontent.com/AkhilNikhil/taskflow-mysql/main/docker-compose.hub.yml -o docker-compose.yml

# 4. Pull pre-built images and start the stack
docker compose up -d

# 5. Verify health
docker compose ps
curl http://localhost/api/health
```

---

#### 🔹 Method 2: Deployment via Cloning Git Repository & Building From Source
> **Best for**: Development, code contributions, and testing custom code changes directly on the host.  
> **Advantage**: Full access to all raw source files (`/backend`, `/frontend`) and ability to rebuild containers locally.

```bash
# 1. Clone your GitHub repository
git clone https://github.com/AkhilNikhil/taskflow-mysql.git
cd taskflow-mysql

# 2. Set up your environment file
cp .env.example .env
# Edit .env with your secure production passwords:
# nano .env

# 3. Build Docker images from local source and launch
docker compose up -d --build

# 4. Verify health
docker compose ps
curl http://localhost/api/health
```

---

## 🛡️ Database Management & Inspections

### Connect directly to MySQL inside the container:
```bash
# Prompts securely for password
docker exec -it taskflow-mysql-db mysql -u taskflow -p taskflow
```

### Useful SQL Queries:
```sql
-- View all registered users
SELECT id, email, display_name, system_role, account_status, created_at FROM users;

-- View created teams
SELECT id, name, active_status, created_at FROM teams;

-- View tasks
SELECT id, title, status, priority, owner_user_id FROM tasks;
```
