'use strict';
/* Abdo-Sit Store (static) — يقرأ المنتجات من API البوت مباشرة */
const CFG = window.ABDO_CONFIG || {};
const API = (CFG.API_URL || '').replace(/\/$/, '') + (CFG.PRODUCTS_PATH || '/api/products');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ar-EG');
const fmtNum = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : nf.format(n); };
const fmtDate = (d) => { const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }); };
const httpUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

const PLAT = { android: { n: 'Android', e: '🤖' }, ios: { n: 'iOS', e: '' }, windows: { n: 'Windows', e: '🪟' }, mac: { n: 'macOS', e: '' }, linux: { n: 'Linux', e: '🐧' }, web: { n: 'Web', e: '🌐' } };
const BADGE = { new: 'جديد', top: 'الأكثر تحميلاً' };

// ---------- device ----------
function detectPlatform() {
  const ua = navigator.userAgent || '', p = navigator.platform || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (p === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/win/i.test(p) || /windows/i.test(ua)) return 'windows';
  if (/mac/i.test(p)) return 'mac';
  if (/linux|x11/i.test(p + ua)) return 'linux';
  return 'web';
}
const MY = detectPlatform();

// ---------- data layer ----------
const CAT_ALIAS = { desktop: 'pc', computer: 'pc', apps: 'mobile', app: 'mobile', games: 'game' };
function catInfo(raw) {
  const key = String(raw || 'other').toLowerCase().trim();
  const k = CAT_ALIAS[key] || key;
  const c = (CFG.CATEGORIES || {})[k];
  return { slug: (c ? Object.keys(CFG.CATEGORIES).find((x) => CFG.CATEGORIES[x] === c) : k) || 'other', name: c?.ar || (raw ? String(raw) : 'أخرى'), icon: c?.icon || '📦' };
}
function platformOf(p) {
  const f = String(p.fileName || p.fileUrl || '').toLowerCase().split('?')[0];
  const ext = (f.match(/\.([a-z0-9]+)$/) || [])[1];
  if (ext === 'apk' || ext === 'xapk' || ext === 'apks') return 'android';
  if (ext === 'ipa') return 'ios';
  if (['exe', 'msi'].includes(ext)) return 'windows';
  if (['dmg', 'pkg'].includes(ext)) return 'mac';
  if (['deb', 'appimage', 'rpm'].includes(ext)) return 'linux';
  const c = catInfo(p.category).slug;
  return c === 'pc' ? 'windows' : ['mobile', 'game'].includes(c) ? 'android' : 'web';
}
function normalize(list) {
  const items = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.title).map((p) => {
    const cat = catInfo(p.category), desc = String(p.desc || '').trim();
    return { id: String(p.id), name: String(p.title), desc, short: desc.replace(/\s+/g, ' ').slice(0, 95) + (desc.length > 95 ? '…' : ''),
      icon: httpUrl(p.image), file: httpUrl(p.fileUrl), fileName: p.fileName || '', version: p.version || '', date: p.date || '',
      downloads: Number(p.downloads) || 0, cat, platform: platformOf(p), badges: [] };
  });
  const top = [...items].sort((a, b) => b.downloads - a.downloads)[0];
  items.forEach((a) => {
    if (a.date && Date.now() - new Date(a.date) < 14 * 864e5) a.badges.push('new');
    if (top && a.id === top.id && top.downloads > 0) a.badges.push('top');
  });
  return items;
}

let APPS = null, loading = null, lastSig = '';
const sig = (items) => items.map((a) => a.id + a.version + a.downloads + a.name).join('|');
function readCache() { try { const c = JSON.parse(localStorage.getItem('abdosit_cache') || 'null'); return c && Array.isArray(c.items) ? c.items : null; } catch { return null; } }

async function fetchFresh() {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 75000); // Render المجاني قد يحتاج ~1 دقيقة ليستيقظ
  try {
    const r = await fetch(API, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const raw = Array.isArray(j) ? j : j.products;
    if (!Array.isArray(raw)) throw new Error('شكل البيانات غير متوقع');
    try { localStorage.setItem('abdosit_cache', JSON.stringify({ t: Date.now(), items: raw })); } catch {}
    return normalize(raw);
  } finally { clearTimeout(t); }
}

// أول زيارة: ننتظر الشبكة. بعدها: نعرض النسخة المخزّنة فوراً ونحدّث بالخلفية.
async function getApps() {
  if (APPS) return APPS;
  const cached = readCache();
  if (cached) {
    APPS = normalize(cached); lastSig = sig(APPS);
    loading = fetchFresh().then((fresh) => { if (sig(fresh) !== lastSig) { APPS = fresh; lastSig = sig(fresh); route(); } }).catch(() => {});
    return APPS;
  }
  APPS = await fetchFresh(); lastSig = sig(APPS);
  return APPS;
}

// ---------- history (محلي على الجهاز) ----------
const getHist = () => { try { return JSON.parse(localStorage.getItem('abdosit_dl') || '[]'); } catch { return []; } };
const addHist = (a) => { try { const h = getHist().filter((x) => x.id !== a.id); h.unshift({ id: a.id, ts: Date.now() }); localStorage.setItem('abdosit_dl', JSON.stringify(h.slice(0, 60))); } catch {} };

// ---------- UI helpers ----------
function toast(msg) { $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3200); }
const icon = (a, size) => a.icon
  ? `<img class="ico" src="${esc(a.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" ${size ? `width="${size}" height="${size}"` : ''} onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ico ph',textContent:'${esc((a.name || '?')[0]).replace(/'/g, '')}'}))">`
  : `<div class="ico ph" style="${size ? `width:${size}px;height:${size}px;` : ''}font-size:${(size || 72) / 2.2}px">${esc((a.name || '?')[0].toUpperCase())}</div>`;
const badges = (a) => (a.badges.length ? `<div class="badges">${a.badges.map((b) => `<span class="badge ${b}">${BADGE[b]}</span>`).join('')}</div>` : '');
function card(a) {
  return `<a class="acard glass" href="#/app/${encodeURIComponent(a.id)}">${icon(a)}<div class="info"><h4>${esc(a.name)}</h4><p>${esc(a.short)}</p>
    <div class="meta"><span>${esc(a.cat.icon)} ${esc(a.cat.name)}</span>${a.version ? `<span>·</span><span class="en">${esc(a.version)}</span>` : ''}<span>·</span><span>⬇ ${fmtNum(a.downloads)}</span></div>${badges(a)}</div></a>`;
}
const catCard = (c) => `<a class="cat glass" href="#/search?category=${encodeURIComponent(c.slug)}"><div class="e">${esc(c.icon)}</div><b>${esc(c.name)}</b><small>${nf.format(c.count)} تطبيق</small></a>`;
const skeleton = (n = 6) => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty = (m, e = '🛸') => `<div class="empty"><div class="e">${e}</div><p>${m}</p></div>`;
const setTitle = (t) => { document.title = t ? `${t} — Abdo-Sit` : 'Abdo-Sit — متجر التطبيقات'; };
function categoriesOf(apps) { const m = new Map(); apps.forEach((a) => { const c = m.get(a.cat.slug) || { ...a.cat, count: 0 }; c.count++; m.set(a.cat.slug, c); }); return [...m.values()]; }
const byDate = (a, b) => (new Date(b.date) || 0) - (new Date(a.date) || 0);

const view = $('#app');
let heroTimer, slowTimer;

function showLoading() {
  view.innerHTML = `<div class="page">${skeleton(3)}<p id="slow" style="text-align:center;color:var(--m);margin-top:18px"></p></div>`;
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { const s = $('#slow'); if (s) s.textContent = '⏳ السيرفر يستيقظ، قد يستغرق حتى دقيقة في أول زيارة…'; }, 4000);
}
function errorView(e) {
  const cors = e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e.message);
  view.innerHTML = `<div class="page"><div class="empty"><div class="e">⚠️</div><p><b>تعذّر جلب التطبيقات</b></p><p style="margin-top:8px">${cors ? 'السيرفر لا يردّ أو يمنع الطلب من هذا الموقع (CORS). تأكد أن البوت يسمح بـ CORS.' : esc(e.message)}</p><p style="margin-top:14px"><button class="btn pri" onclick="location.reload()">إعادة المحاولة</button></p></div></div>`;
}

// ---------- pages ----------
async function pageHome() {
  setTitle('');
  const apps = await getApps(); clearTimeout(slowTimer);
  const latest = [...apps].sort(byDate), popular = [...apps].sort((a, b) => b.downloads - a.downloads), cats = categoriesOf(apps);
  const slides = latest.slice(0, 5), total = apps.reduce((s, a) => s + a.downloads, 0);
  view.innerHTML = `<div class="page">
  <section class="hero"><div class="orb a"></div><div class="orb b"></div>
    <div class="hero-grid"><div><span class="pill"><i></i> يتحدّث تلقائياً · تطبيقات جديدة باستمرار</span>
      <h1>تطبيقات <em>أنيقة</em> بنقرة واحدة</h1>
      <p>كل ما أنشره في مكان واحد — اختر تطبيقك وحمّله مباشرة لجهازك.</p>
      <div class="cta"><a class="btn pri" href="#/search">استكشف التطبيقات</a><a class="btn sec2" href="#/categories">التصنيفات</a></div>
      <div class="stats"><div><b class="en">${nf.format(apps.length)}</b><small>تطبيق</small></div><div><b class="en">${fmtNum(total)}</b><small>تحميل</small></div><div><b class="en">${nf.format(cats.length)}</b><small>تصنيف</small></div></div></div>
      <div class="stage">${slides.length ? slides.map((a, i) => `<a class="slide ${i ? '' : 'on'}" href="#/app/${encodeURIComponent(a.id)}"><div class="card3d">${icon(a, 112)}<h3>${esc(a.name)}</h3><small>${esc(a.short)}</small><div class="meta" style="justify-content:center;margin-top:10px"><span>${esc(a.cat.icon)} ${esc(a.cat.name)}</span>${a.version ? `<span class="en">${esc(a.version)}</span>` : ''}</div></div></a>`).join('') + `<div class="dots">${slides.map((_, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="شريحة ${i + 1}"></button>`).join('')}</div>` : `<div class="slide on"><div class="card3d"><svg width="112" height="112"><use href="#logo"/></svg><h3>قريباً</h3><small>ستظهر التطبيقات هنا</small></div></div>`}</div></div></section>
  ${apps.length ? `<section class="sec"><div class="sec-h"><h2>🆕 أحدث التطبيقات</h2><a href="#/search?sort=new">عرض الكل ←</a></div><div class="row">${latest.slice(0, 12).map(card).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>🔥 الأكثر تحميلاً</h2><a href="#/search?sort=downloads">عرض الكل ←</a></div><div class="row">${popular.slice(0, 12).map(card).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2>🗂️ التصنيفات</h2><a href="#/categories">الكل ←</a></div><div class="cats">${cats.map(catCard).join('')}</div></section>` : empty('لا توجد تطبيقات بعد — أضف تطبيقاً من البوت وسيظهر هنا تلقائياً', '📭')}</div>`;
  const sl = $$('.slide', view), dots = $$('.dots button', view);
  if (sl.length > 1) {
    let i = 0; const go = (n) => { i = (n + sl.length) % sl.length; sl.forEach((s, k) => s.classList.toggle('on', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
    dots.forEach((d) => d.addEventListener('click', (e) => { e.preventDefault(); go(+d.dataset.i); }));
    heroTimer = setInterval(() => go(i + 1), 4500);
  }
}

async function pageCategories() {
  setTitle('التصنيفات');
  const cats = categoriesOf(await getApps());
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>🗂️ التصنيفات</h2></div>${cats.length ? `<div class="cats">${cats.map(catCard).join('')}</div>` : empty('لا توجد تصنيفات بعد', '🗂️')}</div>`;
}

async function pageSearch(params) {
  setTitle('بحث متقدم');
  const apps = await getApps(), cats = categoriesOf(apps), p = Object.fromEntries(params);
  const plats = [...new Set(apps.map((a) => a.platform))];
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>🔎 البحث المتقدم</h2></div>
  <form class="filters glass" id="ff">
    <div style="grid-column:1/-1"><label>كلمة البحث</label><input name="q" value="${esc(p.q || '')}" placeholder="اسم التطبيق أو وصفه"></div>
    <div><label>الفئة</label><select name="category"><option value="">الكل</option>${cats.map((c) => `<option value="${esc(c.slug)}" ${p.category === c.slug ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></div>
    <div><label>نظام التشغيل</label><select name="platform"><option value="">الكل</option>${plats.map((k) => `<option value="${k}" ${p.platform === k ? 'selected' : ''}>${PLAT[k].n}</option>`).join('')}</select></div>
    <div><label>تاريخ الإضافة</label><select name="since"><option value="">أي وقت</option>${[[7, 'آخر أسبوع'], [30, 'آخر شهر'], [365, 'آخر سنة']].map(([d, l]) => `<option value="${d}" ${p.since == d ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label>الترتيب</label><select name="sort">${[['new', 'الأحدث'], ['downloads', 'الأكثر تحميلاً'], ['name', 'الاسم']].map(([k, l]) => `<option value="${k}" ${(p.sort || 'new') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  </form><div id="res"></div></div>`;
  const form = $('#ff');
  const run = () => {
    const f = Object.fromEntries(new FormData(form)); const qs = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => v && qs.set(k, v));
    history.replaceState(null, '', '#/search' + (qs.toString() ? '?' + qs : ''));
    const q = (f.q || '').trim().toLowerCase();
    let r = apps.filter((a) => (!q || (a.name + ' ' + a.desc).toLowerCase().includes(q)) && (!f.category || a.cat.slug === f.category) && (!f.platform || a.platform === f.platform) && (!f.since || (Date.now() - new Date(a.date)) / 864e5 <= +f.since));
    r.sort(f.sort === 'downloads' ? (a, b) => b.downloads - a.downloads : f.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ar') : byDate);
    $('#res').innerHTML = r.length ? `<p style="color:var(--m);margin:0 4px 12px">${nf.format(r.length)} نتيجة</p><div class="grid">${r.map(card).join('')}</div>` : empty('لا توجد نتائج مطابقة', '🔭');
  };
  form.addEventListener('input', run); form.addEventListener('submit', (e) => { e.preventDefault(); run(); }); run();
}

async function pageApp(id) {
  const apps = await getApps(), a = apps.find((x) => x.id === id);
  if (!a) { setTitle('غير موجود'); view.innerHTML = `<div class="page">${empty('التطبيق غير موجود أو حُذف', '🔍')}</div>`; return; }
  setTitle(a.name);
  const related = apps.filter((x) => x.id !== a.id && x.cat.slug === a.cat.slug).slice(0, 6);
  const mismatch = a.platform !== MY && a.platform !== 'web';
  const isTg = /(^|\.)t\.me$/i.test((() => { try { return new URL(a.file).hostname; } catch { return ''; } })());
  const shareUrl = location.href.split('#')[0] + '#/app/' + encodeURIComponent(a.id);
  view.innerHTML = `<div class="page">
  <section class="dhead glass">${icon(a, 150)}<div><h1>${esc(a.name)}</h1><div style="color:var(--c3);font-weight:600">${esc(a.cat.icon)} ${esc(a.cat.name)}</div>${badges(a)}
    <div class="facts"><div><b class="en">${fmtNum(a.downloads)}</b><small>تحميل</small></div><div><b class="en">${esc(a.version || '—')}</b><small>الإصدار</small></div><div><b>${PLAT[a.platform].n}</b><small>النظام</small></div><div><b>${fmtDate(a.date)}</b><small>تاريخ الإضافة</small></div></div></div>
    <div class="install">${a.file ? `<button class="btn pri" id="dl">${isTg ? '✈️ تحميل عبر تيليجرام' : '⬇ تحميل'} ${esc(a.version)}</button>` : '<button class="btn pri" disabled>الملف غير متوفر</button>'}
      ${mismatch ? `<small style="color:var(--warn)">هذا الملف لنظام ${PLAT[a.platform].n} (جهازك ${PLAT[MY].n})</small>` : `<small>${PLAT[a.platform].e} ${PLAT[a.platform].n}</small>`}${a.fileName ? `<small class="en" style="word-break:break-all;direction:ltr">${esc(a.fileName)}</small>` : ''}</div></section>
  <div class="cols"><div><section class="glass desc"><h2 style="margin-top:0">عن التطبيق</h2><p style="white-space:pre-line">${esc(a.desc) || '<span style="color:var(--m)">لا يوجد وصف.</span>'}</p></section></div>
  <aside style="display:grid;gap:18px;align-content:start"><section class="glass qrbox"><b>شارك التطبيق</b><br><small style="color:var(--m)">امسح الرمز لفتح الصفحة على هاتفك</small><img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=340x340&margin=8&data=${encodeURIComponent(shareUrl)}" onerror="this.remove()"><div style="margin-top:12px"><button class="btn sec2" id="cp">نسخ الرابط</button></div></section></aside></div>
  ${related.length ? `<section class="sec"><div class="sec-h"><h2>تطبيقات مشابهة</h2></div><div class="row">${related.map(card).join('')}</div></section>` : ''}</div>`;
  $('#dl')?.addEventListener('click', () => { addHist(a); toast('بدأ التحميل ⬇'); window.open(a.file, '_blank', 'noopener'); });
  $('#cp')?.addEventListener('click', () => navigator.clipboard?.writeText(shareUrl).then(() => toast('تم نسخ الرابط ✓')));
}

async function pageDownloads() {
  setTitle('تحميلاتي');
  const apps = await getApps(), rows = getHist().map((h) => ({ a: apps.find((x) => x.id === h.id), ts: h.ts })).filter((r) => r.a);
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>⬇ سجل التحميلات</h2></div>${rows.length ? `<div class="grid">${rows.map((r) => `<a class="acard glass" href="#/app/${encodeURIComponent(r.a.id)}">${icon(r.a)}<div class="info"><h4>${esc(r.a.name)}</h4><div class="meta"><span class="en">${esc(r.a.version)}</span><span>·</span><span>${PLAT[r.a.platform].n}</span></div><div class="meta">${fmtDate(r.ts)}</div></div></a>`).join('')}</div>` : empty('لم تقم بتحميل أي تطبيق بعد', '📥')}</div>`;
}

function pageAbout() {
  setTitle('عن المطور');
  const d = CFG.ABOUT || {}, links = Object.entries(d.links || {}).filter(([, v]) => httpUrl(v));
  view.innerHTML = `<div class="page"><section class="about glass"><div class="avatar en">${esc((d.name || 'A')[0].toUpperCase())}</div><div><span class="pill">👋 صاحب المتجر</span><h1 style="font-size:34px;margin:10px 0">${esc(d.name || 'Abdo')}</h1><p style="color:var(--m);max-width:640px;white-space:pre-line">${esc(d.bio || '')}</p>
    <div class="cta" style="margin-top:18px">${d.email ? `<a class="btn pri" href="mailto:${esc(d.email)}">✉ تواصل معي</a>` : ''}${links.map(([k, v]) => `<a class="btn pri" target="_blank" rel="noopener noreferrer" href="${esc(v)}">${esc(k)}</a>`).join('')}</div></div></section></div>`;
}

// ---------- router ----------
const routes = [[/^\/?$/, 'home', pageHome], [/^\/categories$/, 'categories', pageCategories], [/^\/search$/, 'search', pageSearch],
  [/^\/app\/(.+)$/, 'app', pageApp], [/^\/downloads$/, 'downloads', pageDownloads], [/^\/about$/, 'about', pageAbout]];
let lastPath = '', routeToken = 0;
async function route() {
  clearInterval(heroTimer); const my = ++routeToken;
  const [path, qs] = (location.hash.slice(1) || '/').split('?'), params = new URLSearchParams(qs || '');
  for (const [re, name, fn] of routes) {
    const m = re.exec(path); if (!m) continue;
    $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
    if (path !== lastPath) { window.scrollTo({ top: 0 }); lastPath = path; }
    if (!APPS && name !== 'about') showLoading();
    try { await fn(name === 'app' ? decodeURIComponent(m[1]) : params); if (my !== routeToken) return; }
    catch (e) { if (my === routeToken) errorView(e); }
    return;
  }
  view.innerHTML = empty('الصفحة غير موجودة', '🧭');
}
addEventListener('hashchange', route);
$('#sform').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#sq').value.trim(); location.hash = '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''); });
$('#yr').textContent = new Date().getFullYear();

// theme
const root = document.documentElement;
try { const t = localStorage.getItem('abdosit_theme'); if (t) root.dataset.theme = t; } catch {}
const themeBtn = $('#theme'), syncTheme = () => { themeBtn.textContent = root.dataset.theme === 'dark' ? '🌙' : '☀️'; $('meta[name=theme-color]').content = root.dataset.theme === 'dark' ? '#060914' : '#f4f6ff'; };
themeBtn.onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('abdosit_theme', root.dataset.theme); } catch {} syncTheme(); };
syncTheme();
document.addEventListener('pointermove', (e) => { const c = e.target.closest?.('.acard'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); } });

// PWA
let deferred;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; try { if (!localStorage.getItem('abdosit_pwa_x')) $('#pwa').style.display = 'flex'; } catch {} });
$('#pwaBtn').onclick = () => { $('#pwa').style.display = 'none'; deferred?.prompt(); deferred = null; };
$('#pwaX').onclick = () => { $('#pwa').style.display = 'none'; try { localStorage.setItem('abdosit_pwa_x', '1'); } catch {} };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

route();
