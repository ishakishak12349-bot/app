'use strict';
/* Abdo-Sit Store — SPA بدون اعتماديات */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ar-EG');
const fmtNum = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : nf.format(n); };
const fmtSize = (b) => { b = Number(b) || 0; if (!b) return '—'; return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
const fmtDate = (d) => new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') || (u || '').startsWith('/') ? u : '');

const PLAT = { android: { n: 'Android', e: '🤖' }, ios: { n: 'iOS', e: '' }, windows: { n: 'Windows', e: '🪟' }, mac: { n: 'macOS', e: '' }, linux: { n: 'Linux', e: '🐧' }, web: { n: 'Web', e: '🌐' } };
const BADGE = { new: 'جديد', featured: 'مميز', updated: 'محدّث', top: 'الأكثر تحميلاً' };

// ---------- state helpers ----------
let deviceId = '';
try { deviceId = localStorage.getItem('abdosit_dev') || ''; if (!deviceId) { deviceId = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('abdosit_dev', deviceId); } } catch { deviceId = 'anon-' + Math.random().toString(36).slice(2); }

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

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'خطأ في الاتصال'), { status: r.status, data: j });
  return j;
}
function toast(msg) { $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3200); }

// ---------- components ----------
const icon = (a, size) => a.icon_url
  ? `<img class="ico" src="${esc(safeUrl(a.icon_url))}" alt="" loading="lazy" ${size ? `width="${size}" height="${size}"` : ''}>`
  : `<div class="ico ph" style="${size ? `width:${size}px;height:${size}px;` : ''}font-size:${(size || 72) / 2.2}px">${esc((a.name || '?')[0].toUpperCase())}</div>`;
const badges = (a) => (a.badges?.length ? `<div class="badges">${a.badges.map((b) => `<span class="badge ${b}">${BADGE[b]}</span>`).join('')}</div>` : '');
const stars = (v) => `<span class="star">★</span> <span class="en">${Number(v).toFixed(1)}</span>`;
function card(a) {
  return `<a class="acard glass" href="#/app/${encodeURIComponent(a.slug)}">${icon(a)}<div class="info">
    <h4>${esc(a.name)}</h4><p>${esc(a.short_desc)}</p>
    <div class="meta">${a.rating_count ? stars(a.rating_avg) + '<span>·</span>' : ''}<span>⬇ ${fmtNum(a.download_count)}</span><span>·</span><span class="en">${fmtSize(a.size_bytes)}</span></div>${badges(a)}</div></a>`;
}
const skeleton = (n = 6) => `<div class="grid">${'<div class="skel"></div>'.repeat(n)}</div>`;
const empty = (m, e = '🛸') => `<div class="empty"><div class="e">${e}</div><p>${m}</p></div>`;
const setTitle = (t) => { document.title = t ? `${t} — Abdo-Sit` : 'Abdo-Sit — متجر التطبيقات'; };
function setMeta(name, content, prop = false) { let m = $(`meta[${prop ? 'property' : 'name'}="${name}"]`); if (!m) { m = document.createElement('meta'); m.setAttribute(prop ? 'property' : 'name', name); document.head.append(m); } m.content = content; }

// ---------- pages ----------
const view = $('#app');
let heroTimer;

async function pageHome() {
  setTitle('');
  view.innerHTML = `<div class="page">${skeleton(3)}</div>`;
  const h = await api('/home');
  const slides = (h.featured.length ? h.featured : h.popular.slice(0, 5));
  view.innerHTML = `<div class="page">
  <section class="hero"><div class="orb a"></div><div class="orb b"></div>
    <div class="hero-grid">
      <div><span class="pill"><i></i> متجر مستقل · تحديثات مستمرة</span>
        <h1>تطبيقات <em>أنيقة</em> بنقرة واحدة</h1>
        <p>كل تطبيقاتي في مكان واحد — تحميل مباشر وآمن لجهازك، مع تحديثات وإصدارات موثّقة.</p>
        <div class="cta"><a class="btn pri" href="#/search">استكشف التطبيقات</a><a class="btn sec2" href="#/categories">التصنيفات</a></div>
        <div class="stats"><div><b class="en">${nf.format(h.totals.apps)}</b><small>تطبيق</small></div><div><b class="en">${fmtNum(h.totals.downloads)}</b><small>تحميل</small></div><div><b class="en">${nf.format(h.categories.length)}</b><small>تصنيف</small></div></div>
      </div>
      <div class="stage" id="stage">${slides.length ? slides.map((a, i) => `<a class="slide ${i ? '' : 'on'}" href="#/app/${encodeURIComponent(a.slug)}"><div class="card3d">${icon(a, 112)}<h3>${esc(a.name)}</h3><small>${esc(a.short_desc)}</small><div class="meta" style="justify-content:center;margin-top:10px">${a.rating_count ? stars(a.rating_avg) : ''}<span>⬇ ${fmtNum(a.download_count)}</span></div></div></a>`).join('') + `<div class="dots">${slides.map((_, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="شريحة ${i + 1}"></button>`).join('')}</div>` : `<div class="slide on"><div class="card3d"><svg width="112" height="112"><use href="#logo"/></svg><h3>قريباً</h3><small>سيتم إضافة التطبيقات هنا</small></div></div>`}</div>
    </div></section>
  ${h.featured.length ? `<section class="sec"><div class="sec-h"><h2>⭐ التطبيقات المميزة</h2></div><div class="row">${h.featured.map(card).join('')}</div></section>` : ''}
  <section class="sec"><div class="sec-h"><h2>🔥 الأكثر تحميلاً</h2><a href="#/search?sort=downloads">عرض الكل ←</a></div>${h.popular.length ? `<div class="row">${h.popular.map(card).join('')}</div>` : empty('لا توجد تطبيقات بعد')}</section>
  <section class="sec"><div class="sec-h"><h2>🆕 جديدنا</h2><a href="#/search?sort=new">عرض الكل ←</a></div>${h.fresh.length ? `<div class="row">${h.fresh.map(card).join('')}</div>` : ''}</section>
  <section class="sec"><div class="sec-h"><h2>🗂️ التصنيفات</h2><a href="#/categories">الكل ←</a></div><div class="cats">${h.categories.map(catCard).join('')}</div></section></div>`;
  // carousel
  const slidesEl = $$('.slide', view), dots = $$('.dots button', view);
  if (slidesEl.length > 1) {
    let i = 0;
    const go = (n) => { i = (n + slidesEl.length) % slidesEl.length; slidesEl.forEach((s, k) => s.classList.toggle('on', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
    dots.forEach((d) => d.addEventListener('click', (e) => { e.preventDefault(); go(+d.dataset.i); }));
    heroTimer = setInterval(() => go(i + 1), 4500);
  }
}
const catCard = (c) => `<a class="cat glass" href="#/search?category=${esc(c.slug)}"><div class="e">${esc(c.icon)}</div><b>${esc(c.name_ar)}</b><small>${nf.format(c.apps)} تطبيق</small></a>`;

async function pageCategories() {
  setTitle('التصنيفات');
  const cats = await api('/categories');
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>🗂️ التصنيفات</h2></div><div class="cats">${cats.map(catCard).join('')}</div></div>`;
}

let cats = [];
async function pageSearch(params) {
  setTitle('بحث متقدم');
  if (!cats.length) cats = await api('/categories');
  const p = Object.fromEntries(params);
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>🔎 البحث المتقدم</h2></div>
  <form class="filters glass" id="ff">
    <div style="grid-column:1/-1"><label>كلمة البحث</label><input name="q" value="${esc(p.q || '')}" placeholder="اسم التطبيق أو وصفه"></div>
    <div><label>الفئة</label><select name="category"><option value="">الكل</option>${cats.map((c) => `<option value="${esc(c.slug)}" ${p.category === c.slug ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name_ar)}</option>`).join('')}</select></div>
    <div><label>نظام التشغيل</label><select name="platform"><option value="">الكل</option>${Object.entries(PLAT).map(([k, v]) => `<option value="${k}" ${p.platform === k ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div>
    <div><label>التقييم الأدنى</label><select name="minRating"><option value="">أي</option>${[4.5, 4, 3, 2].map((n) => `<option value="${n}" ${p.minRating == n ? 'selected' : ''}>${n}+ ★</option>`).join('')}</select></div>
    <div><label>الحجم الأقصى</label><select name="maxSize"><option value="">أي</option>${[10, 50, 100, 500, 1024].map((n) => `<option value="${n}" ${p.maxSize == n ? 'selected' : ''}>${n >= 1024 ? '1 GB' : n + ' MB'}</option>`).join('')}</select></div>
    <div><label>تاريخ الإضافة</label><select name="since"><option value="">أي وقت</option>${[[7, 'آخر أسبوع'], [30, 'آخر شهر'], [365, 'آخر سنة']].map(([d, l]) => { const v = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10); return `<option value="${v}" ${p.since && p.since.slice(0, 10) >= v && d === sinceDays(p.since) ? 'selected' : ''}>${l}</option>`; }).join('')}</select></div>
    <div><label>الترتيب</label><select name="sort">${[['new', 'الأحدث'], ['downloads', 'الأكثر تحميلاً'], ['rating', 'الأعلى تقييماً'], ['name', 'الاسم'], ['size', 'الأصغر حجماً']].map(([k, l]) => `<option value="${k}" ${(p.sort || 'new') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  </form><div id="res">${skeleton()}</div></div>`;
  const form = $('#ff');
  const run = async () => {
    const fd = new URLSearchParams(); new FormData(form).forEach((v, k) => v && fd.set(k, v));
    history.replaceState(null, '', '#/search' + (fd.toString() ? '?' + fd : ''));
    $('#res').innerHTML = skeleton();
    try {
      const r = await api('/apps?' + fd);
      $('#res').innerHTML = r.items.length ? `<p style="color:var(--m);margin:0 4px 12px">${nf.format(r.total)} نتيجة</p><div class="grid">${r.items.map(card).join('')}</div>` : empty('لا توجد نتائج مطابقة', '🔭');
    } catch (e) { $('#res').innerHTML = empty(esc(e.message), '⚠️'); }
  };
  let t; form.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 300); });
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
}
function sinceDays(s) { const d = Math.round((Date.now() - new Date(s)) / 864e5); return d <= 8 ? 7 : d <= 31 ? 30 : 365; }

async function pageApp(slug) {
  view.innerHTML = `<div class="page">${skeleton(2)}</div>`;
  let a;
  try { a = await api('/apps/' + encodeURIComponent(slug)); } catch { view.innerHTML = empty('التطبيق غير موجود', '🔍'); return; }
  setTitle(a.name); setMeta('description', a.short_desc);
  setMeta('og:title', a.name, true); setMeta('og:description', a.short_desc, true); if (a.icon_url) setMeta('og:image', a.icon_url, true);
  const have = a.platforms || [];
  const mine = have.includes(MY);
  const shareUrl = `${location.origin}/share/${encodeURIComponent(a.slug)}`;
  const total = a.distribution.reduce((s, d) => s + d.count, 0) || 1;
  const vid = a.video_url ? videoEmbed(a.video_url) : '';
  view.innerHTML = `<div class="page">
  <section class="dhead glass">${icon(a, 150)}<div><h1>${esc(a.name)}</h1><div style="color:var(--c3);font-weight:600">${esc(a.category_icon || '')} ${esc(a.category_name || '')}</div>${badges(a)}
      <div class="facts"><div><b>${a.rating_count ? stars(a.rating_avg) : '—'}</b><small>${nf.format(a.rating_count)} تقييم</small></div><div><b class="en">${fmtNum(a.download_count)}</b><small>تحميل</small></div><div><b class="en">${fmtSize(a.size_bytes)}</b><small>الحجم</small></div><div><b class="en">${esc(a.current_version)}</b><small>الإصدار</small></div></div></div>
    <div class="install">
      ${mine ? `<button class="btn pri" id="dl" data-p="${MY}">⬇ تثبيت على ${PLAT[MY].n}</button>` : `<button class="btn pri" disabled>غير متوفر لجهازك (${PLAT[MY].n})</button>`}
      ${have.filter((p) => p !== MY).map((p) => `<button class="btn sec2 dl2" data-p="${p}">${PLAT[p].e} ${PLAT[p].n}</button>`).join('')}
      <small>${have.map((p) => PLAT[p].n).join(' · ')}</small></div></section>
  ${a.screenshots.length ? `<section class="sec"><div class="sec-h"><h2>📸 لقطات الشاشة</h2></div><div class="shots">${a.screenshots.map((s) => `<img src="${esc(safeUrl(s))}" alt="" loading="lazy">`).join('')}</div></section>` : ''}
  ${vid ? `<section class="sec"><div class="sec-h"><h2>🎬 معاينة</h2></div>${vid}</section>` : ''}
  <div class="cols"><div>
    <section class="glass desc"><h2 style="margin-top:0">عن التطبيق</h2>${a.description || '<p style="color:var(--m)">لا يوجد وصف بعد.</p>'}</section>
    <section class="sec"><div class="sec-h"><h2>💬 التقييمات</h2></div>
      ${a.reviews.length ? a.reviews.map((r) => `<div class="review glass"><div class="rh"><b>${esc(r.author_name)}</b><span class="star">${'★'.repeat(r.rating)}<span style="color:var(--m)">${'★'.repeat(5 - r.rating)}</span></span></div>${r.comment ? `<p style="margin-top:6px">${esc(r.comment)}</p>` : ''}${r.admin_reply ? `<div class="reply"><b>ردّ المطوّر:</b> ${esc(r.admin_reply)}</div>` : ''}<small style="color:var(--m)">${fmtDate(r.created_at)}</small></div>`).join('') : '<p style="color:var(--m)">كن أول من يقيّم التطبيق.</p>'}
    </section></div>
  <aside style="display:grid;gap:18px;align-content:start">
    <section class="glass" style="padding:20px"><div style="display:flex;gap:16px;align-items:center"><div style="font-size:46px;font-weight:800" class="en">${Number(a.rating_avg).toFixed(1)}</div><div class="hist" style="flex:1">${a.distribution.map((d) => `<div><span class="en">${d.stars}</span><i><b style="width:${(d.count / total * 100).toFixed(0)}%"></b></i><span class="en">${d.count}</span></div>`).join('')}</div></div></section>
    <form class="form glass" id="rf"><b>أضف تقييمك</b><div class="stars" id="st">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n}">★</button>`).join('')}</div>
      <input name="name" maxlength="40" placeholder="اسمك (اختياري)"><textarea name="comment" rows="3" maxlength="1000" placeholder="رأيك في التطبيق (يظهر بعد موافقة المطوّر)"></textarea><button class="btn pri" type="submit">إرسال</button></form>
    <section class="glass qrbox"><b>شارك التطبيق</b><br><small style="color:var(--m)">امسح الرمز لفتح الصفحة على هاتفك</small><img alt="QR" src="/upload/api/qr?url=${encodeURIComponent(shareUrl)}" onerror="this.remove()"><div style="margin-top:12px"><button class="btn sec2" id="cp">نسخ الرابط</button></div></section>
    ${a.versions.length ? `<section class="glass" style="padding:20px"><b>سجل الإصدارات</b>${a.versions.map((v) => `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)"><span class="en" style="font-weight:700">v${esc(v.version)}</span> <small style="color:var(--m)">· ${PLAT[v.platform]?.n || ''} · ${fmtDate(v.created_at)}</small>${v.changelog ? `<p style="font-size:13px;color:var(--m)">${esc(v.changelog)}</p>` : ''}</div>`).join('')}</section>` : ''}
  </aside></div>
  ${a.related.length ? `<section class="sec"><div class="sec-h"><h2>تطبيقات مشابهة</h2></div><div class="row">${a.related.map(card).join('')}</div></section>` : ''}</div>`;

  const doDownload = async (p) => {
    try {
      const r = await api(`/apps/${encodeURIComponent(a.slug)}/download`, { method: 'POST', body: { platform: p, deviceId } });
      toast('بدأ التحميل ⬇'); const l = document.createElement('a'); l.href = r.url; l.rel = 'noopener'; l.download = ''; document.body.append(l); l.click(); l.remove();
      try { const h = JSON.parse(localStorage.getItem('abdosit_dl') || '[]'); h.unshift({ slug: a.slug }); localStorage.setItem('abdosit_dl', JSON.stringify(h.slice(0, 50))); } catch {}
    } catch (e) { toast(e.status === 409 ? 'لا يوجد ملف لهذا النظام بعد' : e.message); }
  };
  $('#dl')?.addEventListener('click', () => doDownload(MY));
  $$('.dl2').forEach((b) => b.addEventListener('click', () => doDownload(b.dataset.p)));
  $$('.shots img').forEach((im) => im.addEventListener('click', () => { const lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = `<img src="${esc(im.src)}" alt="">`; lb.onclick = () => lb.remove(); document.body.append(lb); }));
  $('#cp').addEventListener('click', () => navigator.clipboard?.writeText(shareUrl).then(() => toast('تم نسخ الرابط ✓')));
  let rating = 0;
  $$('#st button').forEach((b) => b.addEventListener('click', () => { rating = +b.dataset.n; $$('#st button').forEach((x) => x.classList.toggle('on', +x.dataset.n <= rating)); }));
  $('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!rating) return toast('اختر عدد النجوم أولاً');
    const fd = new FormData(e.target);
    try { const r = await api(`/apps/${encodeURIComponent(a.slug)}/reviews`, { method: 'POST', body: { rating, name: fd.get('name'), comment: fd.get('comment') } }); toast(r.status === 'pending' ? 'شكراً! سيظهر تعليقك بعد المراجعة' : 'شكراً لتقييمك ⭐'); e.target.reset(); rating = 0; $$('#st button').forEach((x) => x.classList.remove('on')); if (r.status === 'approved') pageApp(a.slug); }
    catch (er) { toast(er.message); }
  });
}
function videoEmbed(u) {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(u);
  if (yt) return `<iframe class="video" src="https://www.youtube-nocookie.com/embed/${yt[1]}" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>`;
  if (/^https?:\/\//i.test(u)) return `<video class="video" src="${esc(u)}" controls preload="metadata" playsinline></video>`;
  return '';
}

async function pageDownloads() {
  setTitle('تحميلاتي');
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>⬇ سجل التحميلات</h2></div>${skeleton(3)}</div>`;
  const rows = await api('/downloads/history?deviceId=' + encodeURIComponent(deviceId));
  view.innerHTML = `<div class="page"><div class="sec-h"><h2>⬇ سجل التحميلات</h2></div>${rows.length ? `<div class="grid">${rows.map((r) => `<a class="acard glass" href="#/app/${encodeURIComponent(r.slug)}">${icon(r)}<div class="info"><h4>${esc(r.name)}</h4><div class="meta"><span class="en">v${esc(r.version || '')}</span><span>·</span><span>${PLAT[r.platform]?.n || ''}</span></div><div class="meta">${fmtDate(r.created_at)}</div></div></a>`).join('')}</div>` : empty('لم تقم بتحميل أي تطبيق بعد', '📥')}</div>`;
}

async function pageAbout() {
  setTitle('عن المطور');
  const d = await api('/developer').catch(() => ({}));
  const links = Object.entries(d.links || {});
  view.innerHTML = `<div class="page"><section class="about glass"><div class="avatar en">${esc((d.name || 'A')[0].toUpperCase())}</div><div><span class="pill">👋 صاحب المتجر</span><h1 style="font-size:34px;margin:10px 0">${esc(d.name || 'Abdo')}</h1><p style="color:var(--m);max-width:640px;white-space:pre-line">${esc(d.bio || '')}</p>
    <div class="cta" style="margin-top:18px">${d.email ? `<a class="btn pri" href="mailto:${esc(d.email)}">✉ تواصل معي</a>` : ''}${links.map(([k, v]) => `<a class="btn sec2" target="_blank" rel="noopener noreferrer" href="${esc(v)}">${esc(k)}</a>`).join('')}</div></div></section></div>`;
}

// ---------- router ----------
const routes = [
  [/^\/?$/, 'home', pageHome], [/^\/categories$/, 'categories', pageCategories], [/^\/search$/, 'search', pageSearch],
  [/^\/app\/(.+)$/, 'app', pageApp], [/^\/downloads$/, 'downloads', pageDownloads], [/^\/about$/, 'about', pageAbout],
];
let lastPath = '';
async function route() {
  clearInterval(heroTimer);
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  for (const [re, name, fn] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
    if (path !== lastPath) { window.scrollTo({ top: 0 }); lastPath = path; api('/visit', { method: 'POST', body: { path, deviceId } }).catch(() => {}); }
    try { await fn(name === 'app' ? decodeURIComponent(m[1]) : params, params); }
    catch (e) { view.innerHTML = empty(e.status === 503 ? 'أنت غير متصل بالإنترنت' : esc(e.message), '⚠️'); }
    return;
  }
  view.innerHTML = empty('الصفحة غير موجودة', '🧭');
}
let skipRoute = false;
addEventListener('hashchange', () => { if (location.hash.startsWith('#/search') && lastPath === '/search' && skipRoute) return; route(); });

$('#sform').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#sq').value.trim(); location.hash = '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''); });
$('#yr').textContent = new Date().getFullYear();

// theme
const root = document.documentElement;
try { const t = localStorage.getItem('abdosit_theme'); if (t) root.dataset.theme = t; } catch {}
const themeBtn = $('#theme'); const syncTheme = () => { themeBtn.textContent = root.dataset.theme === 'dark' ? '🌙' : '☀️'; $('meta[name=theme-color]').content = root.dataset.theme === 'dark' ? '#060914' : '#f4f6ff'; };
themeBtn.onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('abdosit_theme', root.dataset.theme); } catch {} syncTheme(); };
syncTheme();

// glow follows pointer on cards
document.addEventListener('pointermove', (e) => { const c = e.target.closest?.('.acard'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); } });

// PWA
let deferred;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!localStorage.getItem('abdosit_pwa_x')) $('#pwa').style.display = 'flex'; });
$('#pwaBtn').onclick = async () => { $('#pwa').style.display = 'none'; deferred?.prompt(); deferred = null; };
$('#pwaX').onclick = () => { $('#pwa').style.display = 'none'; try { localStorage.setItem('abdosit_pwa_x', '1'); } catch {} };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

route();
