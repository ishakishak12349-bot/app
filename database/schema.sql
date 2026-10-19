-- Abdo-Sit database schema (PostgreSQL 14+)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE app_platform AS ENUM ('android', 'ios', 'windows', 'mac', 'linux', 'web');
CREATE TYPE app_status   AS ENUM ('draft', 'scheduled', 'published', 'hidden');
CREATE TYPE review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE media_kind   AS ENUM ('icon', 'screenshot', 'video', 'file', 'banner');

-- ---------- admins ----------
CREATE TABLE admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT 'Admin',
  totp_secret    TEXT,
  totp_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins  INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- users (store visitors / reviewers) ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL,
  email         TEXT UNIQUE,
  device_id     TEXT UNIQUE,
  is_banned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- categories ----------
CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  name_en    TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📦',
  sort_order INT NOT NULL DEFAULT 0
);

-- ---------- apps ----------
CREATE TABLE apps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  short_desc     TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',        -- sanitized HTML from rich editor
  category_id    INT REFERENCES categories(id) ON DELETE SET NULL,
  platforms      app_platform[] NOT NULL DEFAULT '{android}',
  current_version TEXT NOT NULL DEFAULT '1.0.0',
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  icon_url       TEXT,
  video_url      TEXT,
  status         app_status NOT NULL DEFAULT 'draft',
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  publish_at     TIMESTAMPTZ,
  download_count BIGINT NOT NULL DEFAULT 0,
  rating_avg     NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count   INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX idx_apps_status_pub   ON apps (status, published_at DESC);
CREATE INDEX idx_apps_category     ON apps (category_id);
CREATE INDEX idx_apps_downloads    ON apps (download_count DESC);
CREATE INDEX idx_apps_rating       ON apps (rating_avg DESC);
CREATE INDEX idx_apps_featured     ON apps (is_featured) WHERE is_featured;
CREATE INDEX idx_apps_name_trgm    ON apps USING gin (name gin_trgm_ops);
CREATE INDEX idx_apps_scheduled    ON apps (publish_at) WHERE status = 'scheduled';

-- ---------- app_versions ----------
CREATE TABLE app_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  platform    app_platform NOT NULL,
  file_url    TEXT NOT NULL,
  file_id     TEXT,                    -- id inside upload-service
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  changelog   TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (app_id, version, platform)
);
CREATE INDEX idx_versions_app ON app_versions (app_id, created_at DESC);

-- ---------- media ----------
CREATE TABLE media (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id     UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  kind       media_kind NOT NULL,
  url        TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_app ON media (app_id, kind, sort_order);

-- ---------- reviews ----------
CREATE TABLE reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT 'زائر',
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT NOT NULL DEFAULT '',
  status      review_status NOT NULL DEFAULT 'pending',
  admin_reply TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_app_status ON reviews (app_id, status, created_at DESC);

-- ---------- downloads ----------
CREATE TABLE downloads (
  id          BIGSERIAL PRIMARY KEY,
  app_id      UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_id  UUID REFERENCES app_versions(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  device_id   TEXT,
  platform    TEXT,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_downloads_app_time ON downloads (app_id, created_at DESC);
CREATE INDEX idx_downloads_device   ON downloads (device_id, created_at DESC);
CREATE INDEX idx_downloads_time     ON downloads (created_at DESC);

-- ---------- visits (for dashboard stats) ----------
CREATE TABLE visits (
  id         BIGSERIAL PRIMARY KEY,
  path       TEXT NOT NULL,
  device_id  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_visits_time ON visits (created_at DESC);

-- ---------- activity_logs ----------
CREATE TABLE activity_logs (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   UUID REFERENCES admins(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    JSONB NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_time ON activity_logs (created_at DESC);

-- ---------- site settings (developer profile etc.) ----------
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- ---------- seed data ----------
INSERT INTO categories (slug, name_ar, name_en, icon, sort_order) VALUES
 ('games',        'ألعاب',   'Games',        '🎮', 1),
 ('tools',        'أدوات',   'Tools',        '🛠️', 2),
 ('productivity', 'إنتاجية', 'Productivity', '⚡', 3),
 ('social',       'تواصل',   'Social',       '💬', 4),
 ('education',    'تعليم',   'Education',    '📚', 5),
 ('entertainment','ترفيه',   'Entertainment','🎬', 6);

INSERT INTO settings (key, value) VALUES
 ('developer', '{"name":"Abdo","bio":"مطوّر برمجيات شغوف ببناء تطبيقات أنيقة وسريعة.","email":"abdoelalim045@gmail.com","links":{}}');
