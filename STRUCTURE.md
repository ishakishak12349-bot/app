# Abdo-Sit — هيكل المشروع

```
abdo-sit/
├── docker-compose.yml
├── .env.example
├── README.md
├── database/
│   └── schema.sql              # مخطط PostgreSQL + فهارس + بيانات أولية
├── api/                        # الواجهة الخلفية المشتركة (المتجر + الإدارة)
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── db.js
│       ├── middleware/         # auth (JWT)، rate-limit، تسجيل النشاط
│       └── routes/             # apps, categories, reviews, downloads, auth, stats, users
├── store/                      # النظام 1: متجر Abdo-Sit (PWA)
│   ├── Dockerfile
│   ├── index.html              # الرئيسية + البحث + التصنيفات + التفاصيل
│   ├── css/style.css           # Glassmorphism + Neon + Dark
│   ├── js/app.js               # الراوتر + الصفحات + كشف الجهاز
│   ├── manifest.json
│   └── sw.js                   # Service Worker
├── admin/                      # النظام 2: لوحة التحكم
│   ├── Dockerfile
│   ├── index.html
│   ├── css/admin.css
│   └── js/admin.js
└── upload-service/             # النظام 3: خدمة الرفع والتخزين
    ├── Dockerfile
    ├── package.json
    ├── public/index.html       # واجهة السحب والإفلات
    └── src/server.js           # رفع مجزأ + استئناف + API Key + QR + عداد
```

## المعمارية
- **PostgreSQL**: مصدر الحقيقة الوحيد.
- **api (Node/Express)**: يخدم المتجر والإدارة، مع JWT و2FA (TOTP).
- **upload-service**: خدمة منفصلة تحمي الرفع بمفتاح API، وتخدم التنزيل مع عداد.
- **nginx داخل صور المتجر/الإدارة**: لخدمة الملفات الثابتة؛ ويمكن وضع Cloudflare أمام الخدمة كـ CDN.
