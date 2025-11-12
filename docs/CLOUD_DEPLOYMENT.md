# Cloud Deployment Guide - FREE Tier

Acest sistem poate rula complet GRATUIT în cloud folosind servicii free tier!

## 🎯 Platforme Folosite (TOATE GRATUITE)

### 1. **Render.com** - Pentru aplicații Node.js
- ✅ FREE tier pentru 750 ore/lună
- ✅ Deploy automat din GitHub
- ✅ HTTPS inclus gratuit
- ✅ Logs și monitoring

### 2. **Aiven.io** - Pentru databases
- ✅ PostgreSQL gratuit (1GB)
- ✅ Redis gratuit (30MB)
- ✅ Kafka gratuit (10GB/lună)
- ✅ Backup automat

### 3. **Upstash** - Redis alternativ
- ✅ Serverless Redis gratuit
- ✅ 10,000 comenzi/zi
- ✅ REST API

---

## 📋 Pași pentru Deploy COMPLET AUTOMAT

### Step 1: Setup Aiven (Databases - 5 minute)

1. **Mergi la**: https://aiven.io/
2. **Sign up gratuit** (cu GitHub sau email)
3. **Creează servicii FREE**:

   **PostgreSQL:**
   ```
   - Service: PostgreSQL
   - Cloud: AWS / Frankfurt
   - Plan: Startup-4 (FREE)
   - Service name: notification-postgres
   ```

   **Redis:**
   ```
   - Service: Redis
   - Cloud: AWS / Frankfurt
   - Plan: Startup-4 (FREE)
   - Service name: notification-redis
   ```

   **Kafka:**
   ```
   - Service: Apache Kafka
   - Cloud: AWS / Frankfurt
   - Plan: Startup-2 (FREE)
   - Service name: notification-kafka
   ```

4. **Copiază connection strings** (le vei folosi mai târziu)

---

### Step 2: Setup Render (Applications - 10 minute)

1. **Mergi la**: https://render.com/
2. **Sign up gratuit** cu GitHub
3. **Conectează repo-ul**: `AduAdrian/notification-system`

4. **Creează servicii (Blueprint Deploy)**:

   **Opțiunea 1 - Deploy automat cu render.yaml:**
   ```bash
   # Render va detecta automat fișierul render.yaml din repo
   # Click "New" → "Blueprint"
   # Selectează repo-ul notification-system
   # Render va crea automat toate cele 6 servicii!
   ```

   **Opțiunea 2 - Manual pentru fiecare service:**

   **a) Notification Service (API):**
   ```
   - Type: Web Service
   - Name: notification-api
   - Build Command: cd services/notification-service && npm install && npm run build
   - Start Command: cd services/notification-service && node dist/index.js
   - Plan: Free
   ```

   **b) Channel Orchestrator:**
   ```
   - Type: Background Worker
   - Name: channel-orchestrator
   - Build: cd services/channel-orchestrator && npm install && npm run build
   - Start: cd services/channel-orchestrator && node dist/index.js
   ```

   **c) Email Service:**
   ```
   - Type: Background Worker
   - Name: email-service
   - Similar build/start commands
   ```

   **d) SMS Service:**
   ```
   - Type: Background Worker
   - Name: sms-service
   ```

   **e) Push Service:**
   ```
   - Type: Background Worker
   - Name: push-service
   ```

   **f) In-App Service (SSE):**
   ```
   - Type: Web Service
   - Name: inapp-service
   - Port: 3004
   ```

---

### Step 3: Configurare Environment Variables

În Render, pentru fiecare service, adaugă ENV vars:

**Notification Service:**
```env
DB_HOST=<aiven-postgres-host>
DB_PORT=5432
DB_NAME=defaultdb
DB_USER=avnadmin
DB_PASSWORD=<aiven-postgres-password>
REDIS_URL=<aiven-redis-url>
KAFKA_BROKERS=<aiven-kafka-broker>
JWT_SECRET=<generat-automat-de-render>
```

**Channel Orchestrator:**
```env
KAFKA_BROKERS=<aiven-kafka-broker>
MONGODB_URI=<mongodb-uri>
```

**Email Service:**
```env
KAFKA_BROKERS=<aiven-kafka-broker>
SENDGRID_API_KEY=<your-sendgrid-key>
```

**SMS Service:**
```env
KAFKA_BROKERS=<aiven-kafka-broker>
TWILIO_ACCOUNT_SID=<your-twilio-sid>
TWILIO_AUTH_TOKEN=<your-twilio-token>
```

**Push & In-App:**
- Similar cu Kafka brokers

---

### Step 4: Initialize Database

**SSH în Render service:**
```bash
# Render > notification-api > Shell

# Run schema
psql $DATABASE_URL -f infrastructure/database/schema.sql
```

**SAU folosește Aiven Web Console:**
1. Aiven Dashboard > PostgreSQL > Query Editor
2. Copy-paste conținutul din `infrastructure/database/schema.sql`
3. Execute

---

## 🚀 Deploy Process

### Automat cu GitHub:

Render detectează automat push-uri pe `master`:

```bash
git add .
git commit -m "Deploy to production"
git push origin master

# Render va:
# 1. Detecta push-ul
# 2. Build toate serviciile
# 3. Deploy automat
# 4. Va fi live în ~5-10 minute
```

---

## 📊 Costuri (TOTUL GRATUIT)

| Service | Provider | Plan | Cost |
|---------|----------|------|------|
| Notification API | Render | Free | $0 |
| 5x Workers | Render | Free | $0 |
| PostgreSQL | Aiven | Startup-4 | $0 |
| Redis | Aiven | Startup-4 | $0 |
| Kafka | Aiven | Startup-2 | $0 |
| **TOTAL** | | | **$0/lună** |

**Limitări FREE tier:**
- Render: Servicii "sleep" după 15 min inactivitate
- Aiven: 1GB PostgreSQL, 30MB Redis, 10GB Kafka
- Perfect pentru dezvoltare, testing, MVP

---

## 🌐 URLs După Deploy

```
https://notification-api.onrender.com - Main API
https://notification-api.onrender.com/health - Health check
https://inapp-service.onrender.com/events/:userId - SSE endpoint
```

---

## 🔧 Troubleshooting

**Servicii "sleeping":**
- FREE tier: servicii sleep după 15 min
- Primul request durează ~30s (cold start)
- Soluție: Folosește https://uptimerobot.com gratuit pentru ping

**Build fails:**
```bash
# Verifică logs în Render Dashboard
# Cele mai comune: missing dependencies

# Fix: Update package.json cu toate deps
npm install --save <missing-package>
git push
```

**Database connection:**
```bash
# Verifică connection string în Aiven
# Format: postgresql://user:pass@host:port/db?sslmode=require
```

---

## ✅ Verificare Deploy

```bash
# Test API
curl https://notification-api.onrender.com/health

# Test notification
curl -X POST https://notification-api.onrender.com/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "channels": ["email"],
    "message": "Test notification"
  }'
```

---

## 🎉 SUCCESS!

Când toate serviciile sunt "Active" în Render Dashboard:
- ✅ 6 microservices running
- ✅ PostgreSQL, Redis, Kafka connected
- ✅ HTTPS enabled
- ✅ Auto-deploy configured
- ✅ Logs & monitoring active

**SISTEMUL E LIVE ÎN CLOUD - 100% GRATUIT!** 🚀
