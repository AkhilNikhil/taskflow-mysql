# 📋 TaskFlow MySQL — Complete Commands & Operations Guide
> **All-in-one Reference** for Local Development, EC2 Production, MySQL Data Inspection, and Troubleshooting.  
> Last updated: 2026-09-29

---

## 📑 Table of Contents

1. [Quick Access URLs & Credentials](#1-quick-access-urls--credentials)
2. [Live Data Inspection (MySQL Queries & One-Liners)](#2-live-data-inspection-mysql-queries--one-liners)
3. [Step-by-Step Feature Workflows & Verification](#3-step-by-step-feature-workflows--verification)
4. [EC2 Server Commands (Production)](#4-ec2-server-commands-production)
5. [Local Development Commands (Windows / PowerShell)](#5-local-development-commands-windows--powershell)
6. [Container Shell & Debugging Commands](#6-container-shell--debugging-commands)
7. [API Direct Curl Tests](#7-api-direct-curl-tests)
8. [Docker Cleanup & Reset Commands](#8-docker-cleanup--reset-commands)

---

## 1. Quick Access URLs & Credentials

### 🌐 Access URLs

| Environment | Service | URL | Notes |
|---|---|---|---|
| **EC2 (Production)** | Web App (Frontend) | `http://<EC2-PUBLIC-IP>` | Port 80 (standard HTTP) |
| **EC2 (Production)** | Health Check | `http://<EC2-PUBLIC-IP>/api/health` | Proxied via Nginx |
| **EC2 (Production)** | Direct Backend API | `http://<EC2-PUBLIC-IP>:5000` | Port 5000 on host |
| **Local (Dev)** | Web App (Frontend) | `http://localhost:8080` | Port 8080 |
| **Local (Dev)** | Health Check | `http://localhost:5001/api/health` | Backend port 5001 |

### 🔑 Credentials Reference

| Component | Key / Field | Default Value | Description |
|---|---|---|---|
| **Root Admin** | Email | `akhilbm13@gmail.com` | Automatically promoted to `ARCHITECT` upon registration |
| **MySQL DB** | Hostname (internal) | `db` | Docker bridge network alias |
| **MySQL DB** | Port | `3306` | Standard MySQL port |
| **MySQL DB** | Database Name | `taskflow` | Application database |
| **MySQL DB** | App User | `taskflow` | Main application user |
| **MySQL DB** | App Password | `taskflowpass123` | Password for `taskflow` user |
| **MySQL DB** | Root Password | `rootpassword123` | MySQL administrative password |
| **Backend** | JWT Secret | `taskflow-super-secure-jwt-secret-key-2026` | Token signing key |

---

## 2. Live Data Inspection (MySQL Queries & One-Liners)

> 💡 Run these commands from your EC2 or local terminal to inspect what is happening inside the database in real time as you create users, teams, and tasks!

### ⚡ Quick One-Liner Inspections (Run directly in terminal)

#### 1. View all Registered Users & their System Roles
```bash
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
  "SELECT id, email, display_name, system_role, account_status, created_at FROM users ORDER BY created_at DESC;"
```

#### 2. View all Teams Created
```bash
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
  "SELECT t.id, t.name, t.description, u.email AS created_by_email, t.created_at FROM teams t LEFT JOIN users u ON t.created_by = u.id ORDER BY t.created_at DESC;"
```

#### 3. View Team Memberships (Who belongs to which team)
```bash
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
  "SELECT tm.id AS membership_id, t.name AS team_name, u.email AS member_email, tm.team_role, tm.joined_at FROM team_members tm JOIN teams t ON tm.team_id = t.id JOIN users u ON tm.user_id = u.id ORDER BY t.name, tm.joined_at;"
```

#### 4. View all Tasks & Assignments
```bash
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
  "SELECT t.id, t.title, t.priority, t.status, COALESCE(tm.name, 'Personal') AS scope, COALESCE(u.email, 'Unassigned') AS assigned_to, creator.email AS created_by FROM tasks t LEFT JOIN teams tm ON t.assigned_team_id = tm.id LEFT JOIN users u ON t.assigned_user_id = u.id LEFT JOIN users creator ON t.created_by = creator.id ORDER BY t.created_at DESC;"
```

#### 5. Quick Table Counts (Summary)
```bash
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
  "SELECT (SELECT COUNT(*) FROM users) AS total_users, (SELECT COUNT(*) FROM teams) AS total_teams, (SELECT COUNT(*) FROM team_members) AS total_memberships, (SELECT COUNT(*) FROM tasks) AS total_tasks;"
```

---

### 🖥️ Interactive MySQL Shell

If you prefer an interactive SQL prompt:

```bash
# Connect as app user
docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow

# OR connect as root
docker exec -it taskflow-mysql-db mysql -u root -prootpassword123 taskflow
```

Inside the MySQL prompt:
```sql
-- See all tables
SHOW TABLES;

-- Inspect schema of each table
DESCRIBE users;
DESCRIBE teams;
DESCRIBE team_members;
DESCRIBE tasks;

-- Look at specific records
SELECT email, system_role, account_status FROM users;
SELECT * FROM teams;
SELECT * FROM tasks WHERE status = 'PENDING';

-- Exit prompt
EXIT;
```

---

### ⏱️ Live Real-Time Watcher (EC2 / Linux)

Keep an auto-updating live table on your screen that refreshes every 2 seconds while you click around in the browser:

```bash
# Watch Users & Roles in real-time
watch -n 2 "docker exec taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e 'SELECT email, system_role, account_status FROM users;'"

# Watch Tasks in real-time
watch -n 2 "docker exec taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e 'SELECT title, status, priority, assigned_team_id, assigned_user_id FROM tasks ORDER BY created_at DESC LIMIT 10;'"
```
*(Press `Ctrl + C` to stop watching)*

---

## 3. Step-by-Step Feature Workflows & Verification

### 👑 Workflow A: Promoting a User to ADMIN

1. **Step 1: Architect Logs In**
   - Log in with the root architect email: `akhilbm13@gmail.com`.
   - The top header will display the golden **ARCHITECT** badge and the **Admin Console** tab will appear.
2. **Step 2: Change Role in Admin Console**
   - Click the **Admin Console** tab.
   - Find the user row in the table.
   - In the dropdown, change `USER` to `ADMIN`.
3. **Step 3: Confirm in MySQL immediately**
   ```bash
   docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
     "SELECT email, system_role FROM users WHERE email='user_email@example.com';"
   ```
4. **Step 4: The Promoted User MUST Re-Login (Important!)**
   - The promoted user's browser has an active JWT session with `"role": "USER"`.
   - That user must click **Sign Out** and then **Sign In** again.
   - Their new session token will now carry `"role": "ADMIN"`, unlocking administrative controls!

---

### 👥 Workflow B: Creating a Team & Assigning Tasks

1. **Step 1: Create the Team**
   - Go to the **Teams** tab.
   - Enter a team name (e.g. `DevOps`) and click **Create Team**.
   - You are automatically set as the team **LEADER**.
2. **Step 2: Invite / Add Teammates (Mandatory before assigning tasks)**
   - Click on your new team in the left panel.
   - In the **Add Team Member** section, enter the registered email address of your teammate.
   - Select role (`MEMBER` or `LEADER`) and click **Add Member**.
   - Verify in MySQL:
     ```bash
     docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
       "SELECT t.name, u.email, tm.team_role FROM team_members tm JOIN teams t ON tm.team_id = t.id JOIN users u ON tm.user_id = u.id;"
     ```
3. **Step 3: Create & Assign Task**
   - Go back to the **Tasks** tab.
   - In **Team Scope**, select `#DevOps`.
   - In **Assign to User**, select your teammate's name from the dropdown.
   - Click **+ Add Task**.
   - Verify in MySQL:
     ```bash
     docker exec -it taskflow-mysql-db mysql -u taskflow -ptaskflowpass123 taskflow -e \
       "SELECT t.title, tm.name AS team, u.email AS assigned_to FROM tasks t LEFT JOIN teams tm ON t.assigned_team_id = tm.id LEFT JOIN users u ON t.assigned_user_id = u.id;"
     ```

---

## 4. EC2 Server Commands (Production)

> 💡 **Make it simple on EC2**: If your file is currently named `docker-compose.hub.yml`, rename it once to the standard name:
> ```bash
> mv ~/taskflow/docker-compose.hub.yml ~/taskflow/docker-compose.yml
> ```
> Now you never need to type `-f` flags again!

### 📦 Push Updated Images to Docker Hub (From Local Machine)

After rebuilding locally with code changes, tag and push to Docker Hub:

```powershell
# Tag images with your Docker Hub repository
docker tag taskflow-mysql-backend:latest akhilbm/taskflow-backend:v1.0
docker tag taskflow-mysql-frontend:latest akhilbm/taskflow-frontend:v1.0

# Push to Docker Hub
docker push akhilbm/taskflow-backend:v1.0
docker push akhilbm/taskflow-frontend:v1.0
```

---

### 🚀 Deploy / Pull Latest Images on EC2

```bash
cd ~/taskflow

# 1. Pull latest Docker Hub images
docker compose pull

# 2. Start all containers in background
docker compose up -d

# 3. Check health status (all 3 must show healthy/running)
docker compose ps
```

### 🔄 Zero-Downtime Service Restarts

```bash
# Update and recreate only frontend (DB & backend stay up)
docker compose up -d --no-deps --force-recreate frontend

# Update and recreate only backend (DB & frontend stay up)
docker compose up -d --no-deps --force-recreate backend
```

### 📜 View Logs on EC2

```bash
# Tail all container logs live
docker compose logs -f

# Tail backend logs (last 50 lines + follow)
docker compose logs -f --tail=50 backend

# Tail frontend logs
docker compose logs -f --tail=50 frontend

# Tail MySQL logs
docker compose logs -f --tail=50 db
```

### 🛑 Stop & Restart Stack

```bash
# Stop containers safely (data in MySQL is preserved)
docker compose down

# Start containers again
docker compose up -d
```

### 💥 Full Database Reset (Wipe & Re-init Clean)

```bash
# Stop containers and delete the MySQL data volume
docker compose down -v

# Start clean stack (MySQL re-initializes tables fresh)
docker compose up -d
```


---

## 5. Local Development Commands (Windows / PowerShell)

### 📁 Navigate to Project Folder
```powershell
cd "c:\Users\anush\Desktop\project-full-stack\taskflow-mysql"
```

### 🐳 Build & Run Locally
```powershell
# Build and run with local Dockerfile changes
docker compose up --build -d

# Start without rebuilding
docker compose up -d

# Check running containers
docker compose ps

# View live logs
docker compose logs -f

# Stop all containers
docker compose down

# Stop and wipe database volume (clean reset)
docker compose down -v
```

---

## 6. Container Shell & Debugging Commands

### 🐚 Shell Into Running Containers

```bash
# 1. Backend Flask container (Python / environment)
docker exec -it taskflow-mysql-backend bash

# 2. Frontend Nginx container (alpine sh)
docker exec -it taskflow-mysql-frontend sh

# 3. MySQL Database container
docker exec -it taskflow-mysql-db bash
```

### 🔍 Check Injected Environment Variables
```bash
# Verify environment variables inside backend container
docker exec -it taskflow-mysql-backend env | grep -E "DATABASE|JWT|PORT|CORS|ROOT_ARCHITECT"
```

---

## 7. API Direct Curl Tests

Test backend endpoints directly using `curl`:

```bash
# 1. Health Check
curl http://localhost/api/health

# 2. Register a new user
curl -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@example.com","password":"Password123!","display_name":"Test User"}'

# 3. Login
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@example.com","password":"Password123!"}'
```

---

## 8. Docker Cleanup & Reset Commands

```bash
# Remove all stopped containers
docker container prune -f

# Remove unused/dangling Docker images
docker image prune -a -f

# Inspect Docker disk space
docker system df

# Complete Docker purge (containers, images, volumes, networks)
docker system prune -a --volumes -f
```
