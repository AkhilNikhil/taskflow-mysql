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

### 💻 Recommended Instance Sizing & Disk Configuration

| Instance Type | RAM | Recommended EBS Disk | Best Used For | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`t3.small` / `t2.small`** <br>*(Recommended)* | **2 GB** | **20 GB** | **Both Methods** (Source Build or Docker Hub) | **Optimal experience.** 2GB RAM handles `npm run build` and runs MySQL, Flask, React, and Adminer simultaneously with zero CPU throttling. |
| **`t3.micro` / `t2.micro`** <br>*(Free Tier)* | **1 GB** | **15 GB - 20 GB** | **Method 1 (Docker Hub Images)** | **Supported with caveats.** When launching instance in AWS Console, **change root disk from 8GB to 15GB–20GB**. Use 512MB swap. Use Method 1 to avoid burning CPU build credits. |

> ⚠️ **Important on 8GB Disks**: The default AWS 8GB EBS disk can easily run out of space (`Error 28: No space left on device`) if you build React from source while having a large swap file. If using an 8GB disk, use **Method 1** or run `docker builder prune -a -f` to clear build caches.

---

### 1. Connect to your EC2 Instance
```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2-PUBLIC-IP>
```

### 2. Optional: Configure 512MB Swap (Recommended for 1GB RAM Instances)
```bash
sudo fallocate -l 512M /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. Install Docker, Compose, Git & Curl (if not already installed)
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker ubuntu
newgrp docker
```

---

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

## 🖥️ Accessing TaskFlow in Your Browser

- **TaskFlow Web App**: Open your browser to:
  ```text
  http://<YOUR-EC2-PUBLIC-IP>
  ```
  *(If you left `FRONTEND_PORT=8080`, open `http://<YOUR-EC2-PUBLIC-IP>:8080`)*

---

## 🛡️ Database Management & Accessing Adminer Web UI

You can manage your live database in the browser using the integrated **Adminer** dashboard.

### 🌐 Accessing Adminer in Your Browser

#### Option A: Secure SSH Tunnel (Recommended for Production)
Because Adminer is bound strictly to `127.0.0.1` in production for security, open an encrypted SSH tunnel from your local laptop terminal:
```bash
ssh -i /path/to/your-key.pem -L 8081:localhost:8081 ubuntu@<YOUR-EC2-PUBLIC-IP>
```
Now, open your laptop browser to:
👉 **`http://localhost:8081`**

#### Option B: Direct Browser Access
If you opened port `8081` in your AWS Security Group and bound Adminer to `0.0.0.0`, navigate to:
👉 **`http://<YOUR-EC2-PUBLIC-IP>:8081`**

---

### 🔑 Adminer Login Credentials
Once the login page appears, enter:
- **System**: `MySQL`
- **Server**: `db` *(the internal Docker service name)*
- **Username**: `taskflow`
- **Password**: *(The `MYSQL_PASSWORD` value you defined in `.env`)*
- **Database**: `taskflow`

Click **Login** to inspect tables, view rows, and run live SQL queries.

---

### CLI Database Inspection (Inside Container):
```bash
# Prompts securely for password:
docker exec -it taskflow-mysql-db mysql -u taskflow -p taskflow
```

---

## 🔧 Comprehensive Cloud Troubleshooting & Diagnostics Manual

This section documents every error message, root cause, and copy-paste solution encountered when deploying TaskFlow on AWS EC2 or local Docker.

---

### 1. `ERR_CONNECTION_TIMED_OUT` when accessing `http://<EC2-PUBLIC-IP>:8081` or Port 80
- **Symptom**: Browser spins for 30 seconds and fails with `ERR_CONNECTION_TIMED_OUT`.
- **Root Cause**: The **AWS Security Group** inbound firewall is blocking packets on that port. AWS drops blocked packets silently.
- **Solution A (Open Port in AWS Console)**:
  1. Go to **AWS EC2 Console** ➔ **Instances** ➔ select your instance.
  2. Click the **Security** tab ➔ Click your **Security Group** name.
  3. Click **Edit inbound rules** ➔ Click **Add rule**:
     - For Web App: **HTTP** | Port `80` | Source `0.0.0.0/0` (Anywhere)
     - For Web App (Dev Port): **Custom TCP** | Port `8080` | Source `0.0.0.0/0`
     - For Adminer UI: **Custom TCP** | Port `8081` | Source `0.0.0.0/0` (or `My IP`)
  4. Click **Save rules**. Traffic connects instantly.
- **Solution B (Access Securely via SSH Tunnel — Zero Firewall Changes)**:
  Open a tunnel from your local laptop terminal:
  ```bash
  ssh -i /path/to/your-key.pem -L 8081:localhost:8081 ubuntu@<YOUR-EC2-PUBLIC-IP>
  ```
  Now open `http://localhost:8081` on your laptop browser.

---

### 2. `ERROR 28: No space left on device` / `Container taskflow-mysql-db is unhealthy`
- **Symptom**: MySQL stops with `[ERROR] [MY-012640] [InnoDB] Error number 28 means 'No space left on device'` and container loops in `Restarting (1)`.
- **Root Cause**: The default AWS 8GB root disk filled to 100% capacity due to building Vite/React from source (`npm install` cache) and/or an oversized 2GB swap file.
- **Immediate Copy-Paste Fix**:
  ```bash
  # 1. Resize swap to 512M (immediately frees 1.5GB of disk)
  sudo swapoff /swapfile && sudo fallocate -l 512M /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile

  # 2. Prune Docker build cache (frees ~1GB to 2GB)
  docker builder prune -a -f

  # 3. Check that you have at least 2GB free
  df -h /

  # 4. Wipe broken partial database volume and restart
  cd ~/taskflow-mysql
  docker compose down -v
  docker compose up -d
  ```

---

### 3. `curl: (7) Failed to connect to localhost port 80: Connection refused`
- **Symptom**: Port 80 fails to connect, but port 8080 works.
- **Root Cause**: The `.env` file has `FRONTEND_PORT=8080` (the default local conflict-prevention port) instead of `FRONTEND_PORT=80`.
- **Solution**:
  ```bash
  # In ~/taskflow-mysql/.env, change FRONTEND_PORT:
  sed -i 's/FRONTEND_PORT=8080/FRONTEND_PORT=80/' .env
  sed -i 's/BACKEND_PORT=5001/BACKEND_PORT=5000/' .env

  # Recreate containers with new port mappings:
  docker compose up -d
  ```

---

### 4. Adminer Shows: `Access denied for user 'taskflow'@'%'` or `Connection refused`
- **Symptom**: Adminer displays a red error on login.
- **Root Cause & Fixes**:
  1. **Server field must be `db`**: Inside Docker, MySQL is addressed by its service name `db`, **NOT** `localhost`.
  2. **Password Mismatch**: The password in Adminer must match the exact `MYSQL_PASSWORD` in your `.env` file. Inspect it via:
     ```bash
     grep MYSQL_PASSWORD ~/taskflow-mysql/.env
     ```
  3. **System field**: Must be set to `MySQL`.

---

### 5. EC2 Instance / SSH is Sluggish & Freezing
- **Symptom**: Commands lag in SSH, terminal output freezes.
- **Root Cause**:
  1. Building from source on a `t2.micro` burns through AWS CPU burst credits, causing AWS to throttle CPU to 10–20%.
  2. 1GB RAM is at 90% capacity with 0MB swap.
- **Solution**:
  1. Add 512MB Swap:
     ```bash
     sudo fallocate -l 512M /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
     ```
  2. Switch to **Method 1 (Docker Hub Images)** via `docker-compose.hub.yml` so the server never builds from source.
  3. Or upgrade to a **`t3.small`** (2GB RAM, 20GB Disk) for a butter-smooth experience.

---

### 6. Database Dirty Volume Loop: `--initialize specified but data directory has files in it`
- **Symptom**: MySQL crashed on its first boot, and now refuses to start with `[ERROR] [MY-010457] [Server] --initialize specified but the data directory has files in it. Aborting.`
- **Root Cause**: An aborted startup left half-written tables in `/var/lib/mysql`.
- **Solution**:
  ```bash
  cd ~/taskflow-mysql
  # Purge the corrupted volume
  docker compose down -v
  # Re-launch cleanly
  docker compose up -d
  ```

---

### 7. Changes to `.env` Are Not Reflected in Containers
- **Symptom**: You edited `.env`, but the app is still using the old password or port.
- **Root Cause**: Docker Compose does not recreate running containers if the `docker-compose.yml` definition didn't change.
- **Solution**:
  ```bash
  docker compose up -d --force-recreate
  ```

---

### 8. Vite Build Fails with `JavaScript heap out of memory` (OOM Killer)
- **Symptom**: Running `docker compose up -d --build` fails during `npm run build` with `Killed` or code 137.
- **Root Cause**: Node.js Vite compiler exceeded the 1GB RAM limit on `t2.micro`.
- **Solution**:
  - Enable swap memory (`sudo swapon /swapfile`).
  - Or deploy via **Method 1 (Docker Hub Pre-built Images)**:
    ```bash
    curl -sSL https://raw.githubusercontent.com/AkhilNikhil/taskflow-mysql/main/docker-compose.hub.yml -o docker-compose.yml
    docker compose up -d
    ```
