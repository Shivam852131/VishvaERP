# 🚀 Vishva ERP — AI-Powered Multi-College Platform

An enterprise-grade, Multi-tenant SaaS ERP platform built using the MERN stack (MongoDB, Express, Vanilla JS + Tailwind, Node.js) with Socket.io real-time chat, and an OpenAI-integrated AI Tools Hub.

## ✨ Features

* **Multi-Tenant System:** One backend, multiple isolated colleges. SuperAdmin controls global, CollegeAdmin accesses their own scope.
* **Role-Based Architecture:** 5 unique dashboard flows (SuperAdmin, CollegeAdmin, Faculty, Student, Parent).
* **Glassmorphism UI:** Stunning design with auto dark-mode toggle.
* **10 Core ERP Modules:** Attendance, Fees, Exams/Results, Library, etc.
* **AI Tools Hub:** AI Chatbot, AI Exam Generator, AI Notes Generator, and Doubt Solver.
* **Real-time Comms:** Socket.io messaging subsystem.

## 🚀 How to Run

1. Make sure you have **Node.js** and **MongoDB** installed.
2. Ensure MongoDB is running locally (`mongodb://localhost:27017`) or update `.env` with your Atlas URI.
3. Just double-click on `START.bat` (Windows).

Alternatively:
```bash
npm install
npm run dev
```
Then open `http://localhost:5000` in your browser.

## MongoDB Health

The backend uses an advanced MongoDB connection manager with retry, pooling, ping checks, connection event logging, and graceful shutdown.

- API health: `GET /api/health`
- Database health: `GET /api/health/db`
- Configure pooling/retry settings in `.env` using the `MONGO_*` variables from `.env.example`.

## Cross-Platform (Web + Android + iOS)

Vishva ERP ships as an **Advanced Single-Codebase Solution** using **Capacitor + PWA**. Updates made to the web layer are instantly reflected across all native apps.

### 🌟 Advanced App Features
*   **Native Feel**: Platform-specific bottom navigation, haptic feedback, and centered headers for iOS.
*   **Multi-Device Push**: Integrated Firebase messaging for real-time campus alerts.
*   **Smart Installation**: Landing page automatically detects device and suggests PWA or APK.
*   **Offline Mode**: Full PWA support with intelligent caching for academic records.
*   **Store Ready**: Pre-configured with unique bundle IDs, Privacy Policy, and publishing guides.

- **Web PWA**: Installable via Chrome/Safari ("Add to Home Screen").
- **Android App**: `npm run android:sync` → `npm run aab:release` (Build Play Store AAB).
- **iOS App**: `npm run ios:sync` → open in Xcode (macOS required for final sign).

Full guide: [STORE_PUBLISHING.md](./STORE_PUBLISHING.md)  
APK Build: [APK_BUILD.md](./APK_BUILD.md)

## Automated E2E Tests

Install the Playwright browser once:
```bash
npm run test:e2e:install
```

Run the smoke suite:
```bash
npm run test:e2e
```

Run it with a visible browser:
```bash
npm run test:e2e:headed
```

Optional environment variables:
- `E2E_BASE_URL` defaults to `http://localhost:3000`
- `E2E_SUPERADMIN_EMAIL` defaults to `superadmin@vishvaerp.com`
- `E2E_SUPERADMIN_PASSWORD` defaults to `SuperAdmin@123`

The suite creates `QA*` tenant data during execution and removes it afterward.

## 🔐 Default Test Credentials

* **Super Admin**: superadmin@vishvaerp.com / SuperAdmin@123
* Use the "Hover for admin credentials" hint on the login page for quick testing.

## 🤖 AI Setup

To activate real AI instead of the mock fallback, open the `.env` file and set:
`OPENAI_API_KEY=your_actual_key_here`

Enjoy managing your campus!
