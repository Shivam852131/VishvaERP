# Vishva ERP — Production Security Hardening & Deployment Checklist

This document outlines mandatory and recommended hardening procedures for deploying **Vishva ERP** to production environments (Docker, AWS, Render, Vercel, or VPS).

---

## 1. Environment & Secret Management

- [ ] **Enforce `NODE_ENV=production`**:
  - Setting `NODE_ENV=production` enables strict JWT secret validation, activates Helmet CSP headers, and disables development debug responses.
- [ ] **Generate High-Entropy Production Secrets**:
  - Never use default or development keys in production. Generate distinct secrets using:
    ```bash
    openssl rand -hex 64
    ```
  - Required variables to generate:
    - `JWT_SECRET`
    - `JWT_REFRESH_SECRET`
    - `SUPER_ADMIN_PASSWORD` (Change immediately upon initial bootstrap)
    - `RAZORPAY_KEY_SECRET`
- [ ] **Safe Storage of Production `.env`**:
  - Ensure `.env` is never committed to Git (verified in `.gitignore`).
  - Store secrets in cloud secret managers (AWS Secrets Manager, Doppler, Render Environment Secrets, or GitHub Actions Secrets for CI/CD).

---

## 2. Database Hardening (MongoDB Atlas)

- [ ] **Network Access List (IP Whitelist)**:
  - Remove `0.0.0.0/0` (allow access from anywhere) in MongoDB Atlas Network Access.
  - Whitelist only the static outbound IP addresses of your backend application servers.
- [ ] **Least-Privilege Database User**:
  - Do not use the Atlas project owner account for application connections.
  - Create a dedicated database user with `readWrite` permissions scoped strictly to the `vishvaerp` database.
- [ ] **Enforce TLS/SSL Connections**:
  - Verify that the connection URI begins with `mongodb+srv://` and includes `ssl=true` or TLS options.
- [ ] **Automated Backups & Point-in-Time Recovery**:
  - Enable Continuous Cloud Backups in MongoDB Atlas with daily snapshots and a 7-day retention minimum.

---

## 3. Reverse Proxy & Network Security

- [ ] **Enforce HTTPS (TLS 1.2+)**:
  - Terminate SSL/TLS at Cloudflare, Nginx, or cloud load balancer.
  - Redirect all HTTP traffic (`port 80`) to HTTPS (`port 443`).
- [ ] **HSTS (HTTP Strict Transport Security)**:
  - Ensure the reverse proxy sends:
    ```nginx
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    ```
- [ ] **Trusted Proxy Configuration**:
  - In `backend/server.js`, `app.set('trust proxy', 2)` is configured. Adjust the hop count according to your infrastructure (e.g. 1 for direct Nginx, 2 for Cloudflare -> Nginx).

---

## 4. File Upload & Storage Security

- [ ] **Directory Permissions**:
  - Confine the `backend/uploads/` directory to read/write permissions for the application user only (`chmod 750 backend/uploads`).
- [ ] **Prevent Direct Script Execution**:
  - Configure Nginx to disallow executing PHP, Python, or shell scripts in the uploads path:
    ```nginx
    location /uploads/ {
        # Serve static assets only; disallow script execution
        types { }
        default_type application/octet-stream;
    }
    ```
- [ ] **Cloud Object Storage (Recommended for Scale)**:
  - For high-volume production deployments, configure AWS S3 or Cloudflare R2 with private bucket ACLs and presigned download URLs.

---

## 5. Payments & Webhooks (Razorpay)

- [ ] **Configure Live Webhook Secret**:
  - Set `RAZORPAY_WEBHOOK_SECRET` in your production environment variables.
  - Register the webhook URL `https://your-domain.com/api/razorpay/webhook` in the Razorpay Dashboard.
  - Select events: `payment.captured`, `payment.failed`, `order.paid`.
- [ ] **Verify Server-Side Payment Status**:
  - Ensure student fees and subscription activations always check Razorpay HMAC signatures before granting access.

---

## 6. Monitoring, Logging & Incident Response

- [ ] **Log Retention & Rotation**:
  - Application logs in `backend/logs/` (Winston) should be rotated daily with maximum file size limits (e.g. 20MB) and a 30-day retention policy.
- [ ] **Health Monitoring**:
  - Monitor the `/api/health` endpoint with an external uptime service (e.g., UptimeRobot, Datadog, or Better Uptime).
- [ ] **Audit Logs**:
  - Regularly inspect `auditlogs` in MongoDB for administrative role modifications and cross-college queries.

---

## 7. Pre-Deployment Verification Command

Run the security test suite before every release:
```bash
npm run test:security
```
All 11 tests must pass before approving production deployment.
