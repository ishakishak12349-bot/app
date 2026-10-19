# Abdo-Sit

## الوضع الافتراضي: المتجر مربوط ببوتك (`/api/products`)

المتجر (`store/`) يجلب التطبيقات من `https://my-sit.onrender.com/api/products`.
ما تضيفه أو تحذفه من بوت بايثون يظهر أو يختفي في المتجر تلقائياً.

```bash
docker compose up -d --build      # المتجر على http://localhost:8080
```
- الإعدادات (رابط الـ API، «عن المطور»، أسماء التصنيفات): `store/config.js`
- بدون Docker: انشر مجلد `store/` كما هو على Netlify أو GitHub Pages.
- **مهم:** فعّل CORS في بوت بايثون (`pip install flask-cors` ثم `CORS(app)`)، وإلا لن يستطيع المتجر قراءة البيانات.

## الوضع الكامل (اختياري): قاعدة بيانات + لوحة إدارة + خدمة رفع

`store-full/` و`admin/` و`upload-service/` و`api/` هي النظام الأول الكامل. يعمل بدلاً من البوت:
```bash
cp .env.example .env
docker compose --profile full up -d --build   # المتجر الكامل :8082 ، الإدارة :8081 ، الرفع :4000
```

---
(الدليل التفصيلي للوضع الكامل أدناه)


منصة من 3 أنظمة مترابطة: **المتجر** (PWA) + **لوحة الإدارة** + **خدمة الرفع والتخزين**، فوق PostgreSQL.

| الخدمة | المنفذ | الوصف |
|---|---|---|
| `store` | 8080 | المتجر العام (nginx + SPA، يمرّر `/api` إلى الـ API) |
| `admin` | 8081 | لوحة التحكم (JWT + 2FA) |
| `upload` | 4000 | رفع مجزأ/استئناف، تنزيل مباشر + عداد، QR |
| `api` | داخلي | Express + PostgreSQL (لا يُعرَّض للخارج) |
| `db` | داخلي | PostgreSQL 16 |

هيكل المجلدات في [STRUCTURE.md](STRUCTURE.md).

## التشغيل المحلي (أمر واحد)

```bash
cp .env.example .env
# عدّل القيم: كلمات المرور، JWT_SECRET، UPLOAD_API_KEY
openssl rand -hex 32     # استعمله لـ UPLOAD_API_KEY وJWT_SECRET
docker compose up -d --build
```

ثم:
- المتجر: http://localhost:8080
- الإدارة: http://localhost:8081 — الدخول بـ `ADMIN_EMAIL` / `ADMIN_PASSWORD` (يُنشأ الحساب تلقائياً عند أول تشغيل)
- خدمة الرفع (واجهة مستقلة): http://localhost:4000

> الخدمات ترفض الإقلاع إذا بقيت القيم الافتراضية `change_me…` — هذا مقصود.

## أول استخدام

1. ادخل لوحة الإدارة ← **الإعدادات** ← الصق `UPLOAD_API_KEY` (يُحفظ في الجلسة فقط).
2. فعّل **2FA** من نفس الصفحة (امسح الـ QR بـ Google Authenticator).
3. عدّل صفحة «عن المطور».
4. **رفع تطبيق**: الاسم، الوصف (محرر نصوص)، الأيقونة، حتى 8 صور، ملف لكل نظام (APK/EXE/ZIP/DMG)، ثم نشر فوري أو مجدول.

## النشر على سيرفر (VPS) خطوة بخطوة

1. سيرفر Ubuntu 22.04+ مع Docker: `curl -fsSL https://get.docker.com | sh`
2. انسخ المشروع إلى السيرفر وأنشئ `.env`، مع ضبط:
   - `PUBLIC_STORE_URL=https://store.example.com`
   - `PUBLIC_UPLOAD_URL=https://files.example.com`
3. ضع **Caddy** أو nginx أمام الخدمات لـ HTTPS. مثال Caddyfile:
   ```
   store.example.com { reverse_proxy localhost:8080 }
   admin.example.com { reverse_proxy localhost:8081 }
   files.example.com { reverse_proxy localhost:4000 }
   ```
4. في `docker-compose.yml` اجعل المنافذ مربوطة على `127.0.0.1` فقط (مثلاً `"127.0.0.1:8080:80"`) حتى لا يُعرَّض إلا عبر Caddy.
5. **CDN**: ضع Cloudflare أمام `files.example.com` (الملفات تُخدم بـ `Cache-Control: immutable` ودعم Range)، أو اضبط `CDN_BASE_URL` إن كان لديك نطاق CDN.
6. احمِ لوحة الإدارة بإضافة طبقة ثانية (Cloudflare Access أو قائمة IP) — يُنصح بذلك بشدة.
7. نسخ احتياطي: `docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup.sql` ومجلد وحدة التخزين `uploads`.

## الأمان المُطبَّق

- كلمات المرور bcrypt (12)، JWT لمدة 8 ساعات، قفل الحساب 15 دقيقة بعد 5 محاولات فاشلة، تحديد معدل الطلبات.
- 2FA (TOTP)، تنظيف HTML للوصف (sanitize-html)، استعلامات SQL مُعلَّمة.
- الرفع بمفتاح API فقط (مقارنة ثابتة الزمن + حد للمحاولات)، قائمة امتدادات مسموحة، حد 2GB، أسماء ملفات معقّمة.
- المتجر يمرّر لخدمة الرفع طلبات **GET فقط** (QR والملفات).

## ملاحظات

- تقييم بدون تعليق يُعتمد مباشرة؛ التعليق النصي ينتظر موافقتك من لوحة الإدارة.
- الشارات (جديد/مميز/محدّث/الأكثر تحميلاً) تُحسب تلقائياً من البيانات.
- لمشاركة تطبيق مع Open Graph: `https://store.example.com/share/<slug>`، و`/sitemap.xml` يسرد كل التطبيقات.
- ملفات iOS (`.ipa`) لا تُثبَّت مباشرة من الويب على أجهزة iPhone؛ يلزم توقيع/TestFlight.
