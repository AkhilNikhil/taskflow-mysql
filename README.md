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

## 🔧 Comprehensive Troubleshooting Guide

### 1. `ERROR 28: No space left on device` / `container taskflow-mysql-db is unhealthy`
- **Cause**: The EC2 root EBS volume (typically 8GB) ran out of disk space due to Docker build cache, downloaded images, and/or a 2GB swap file.
- **Solution**:
  ```bash
  # 1. Resize swap to 512M to free 1.5GB of disk
  sudo swapoff /swapfile && sudo fallocate -l 512M /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile

  # 2. Prune Docker build cache to free ~1GB
  docker builder prune -a -f

  # 3. Wipe broken partial database volume and restart
  cd ~/taskflow-mysql
  docker compose down -v
  docker compose up -d
  ```

---

### 2. Backend Reports `(health: starting)`
- **Cause**: Normal Docker startup behavior. The backend healthcheck in `Dockerfile` uses a 30-second interval.
- **Solution**: Wait 30 seconds and re-run `docker compose ps`. It will automatically change to `(healthy)`.

---

### 3. Browser Shows `ERR_CONNECTION_TIMED_OUT` or Cannot Connect
- **Check AWS Security Group**:
  - In AWS EC2 Console ➔ **Security Groups** ➔ **Edit Inbound Rules**:
    - Add **HTTP** (Port `80`) from Source `0.0.0.0/0`.
    - If running on port 8080, add **Custom TCP** (Port `8080`) from Source `0.0.0.0/0`.
- **Check Port Mapping in `.env`**:
  - Ensure `FRONTEND_PORT=80` in `.env` if accessing directly via `http://<EC2-PUBLIC-IP>`.

---

### 4. How to Completely Reset & Reinitialize the Database
If you ever want to wipe all test data and let TaskFlow re-initialize cleanly:
```bash
cd ~/taskflow-mysql
docker compose down -v
docker compose up -d
```
```
