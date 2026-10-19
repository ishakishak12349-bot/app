'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ar-EG');
const fmtSize = (b) => { b = +b || 0; return !b ? '—' : b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
const fmtDT = (d) => d ? new Date(d).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const PLAT = { android: 'Android', ios: 'iOS', windows: 'Windows', mac: 'macOS', linux: 'Linux', web: 'Web' };
const STATUS_AR = { published: 'منشور', draft: 'مسودة', hidden: 'مخفي', scheduled: 'مجدول', pending: 'بانتظار', approved: 'مقبول', rejected: 'مرفوض' };
const view = $('#view');

// ---------- session / api ----------
let token = sessionStorage.getItem('abdosit_tok') || '';
function toast(msg, kind = '') { $('.toast')?.remove(); const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3500); }
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token && !path.startsWith('/auth/login')) { logout(); throw new Error('انتهت الجلسة'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'خطأ'), { data: j });
  return j;
}
function logout() { token = ''; sessionStorage.removeItem('abdosit_tok'); $('#shell').hidden = true; $('#login').hidden = false; }
$('#logout').onclick = logout;

$('#lform').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = new FormData(e.target); $('#lerr').textContent = '';
  try {
    const r = await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password'), code: f.get('code') || undefined } });
    if (r.need2fa) { $('#code').hidden = false; $('#code').focus(); $('#lerr').textContent = 'أدخل رمز التحقق من تطبيق المصادقة'; return; }
    token = r.token; sessionStorage.setItem('abdosit_tok', token); e.target.reset(); $('#code').hidden = true; boot();
  } catch (er) { $('#lerr').textContent = er.message; if (er.data?.need2fa) $('#code').hidden = false; }
});

// ---------- upload (chunked + resume) ----------
const CHUNK = 8 * 1024 * 1024;
function upKey() { return sessionStorage.getItem('abdosit_upkey') || ''; }
async function uploadFile(file, onProgress) {
  const key = upKey();
  if (!key) throw new Error('أدخل مفتاح الرفع أولاً من الإعدادات');
  const H = { 'x-api-key': key };
  const init = await fetch('/upload/api/upload/init', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size }) });
  const ij = await init.json(); if (!init.ok) throw new Error(ij.error || 'فشل بدء الرفع');
  let off = ij.received;
  while (off < file.size) {
    const end = Math.min(off + CHUNK, file.size); let tries = 0;
    for (;;) {
      try {
        const r = await fetch(`/upload/api/upload/${ij.uploadId}?offset=${off}`, { method: 'PUT', headers: H, body: file.slice(off, end) });
        const j = await r.json();
        if (r.status === 409 && typeof j.received === 'number') { off = j.received; break; }
        if (!r.ok) throw new Error(j.error || 'فشل');
        off = j.received; break;
      } catch (e) { if (++tries > 8) throw e; await new Promise((s) => setTimeout(s, 1500 * tries)); }
    }
    onProgress?.(off / file.size);
  }
  const c = await fetch(`/upload/api/upload/${ij.uploadId}/complete`, { method: 'POST', headers: H });
  const cj = await c.json(); if (!c.ok) throw new Error(cj.error || 'فشل الإنهاء');
  return cj; // {id,url,size,name}
}

// ---------- small charts (SVG) ----------
function lineChart(data, color = '#4f8cff', h = 180) {
  const w = 600, pad = 26, max = Math.max(1, ...data.map((d) => d.n));
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, data.length - 1), y = (v) => h - pad - (v / max) * (h - pad * 2);
  const pts = data.map((d, i) => `${x(i)},${y(d.n)}`).join(' ');
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg class="chart" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".4"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
  ${[0, .5, 1].map((p) => `<line x1="${pad}" x2="${w - pad}" y1="${y(max * p)}" y2="${y(max * p)}" stroke="rgba(255,255,255,.07)"/><text x="4" y="${y(max * p) + 4}">${Math.round(max * p)}</text>`).join('')}
  <polygon points="${pad},${h - pad} ${pts} ${w - pad},${h - pad}" fill="url(#${id})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>
  ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.n)}" r="3.5" fill="${color}"><title>${d.day}: ${d.n}</title></circle>${i % 3 === 0 ? `<text x="${x(i) - 14}" y="${h - 6}">${d.day}</text>` : ''}`).join('')}</svg>`;
}
function barChart(rows, label, val) {
  const max = Math.max(1, ...rows.map((r) => +r[val]));
  return rows.length ? rows.map((r) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(r[label])}</span><b class="en">${nf.format(r[val])}</b></div><div class="prog"><i style="width:${(r[val] / max * 100).toFixed(0)}%"></i></div></div>`).join('') : '<p style="color:var(--m)">لا بيانات بعد</p>';
}

// ---------- pages ----------
async function pageDash() {
  const s = await api('/admin/stats'), t = s.totals;
  const k = (l, v, e) => `<div class="kpi glass"><small>${e} ${l}</small><b class="en">${v}</b></div>`;
  view.innerHTML = `<h2 class="t">📊 لوحة الإحصائيات</h2>
  <div class="kpis">${k('إجمالي التحميلات', nf.format(t.downloads), '⬇')}${k('الزيارات', nf.format(t.visits), '👁')}${k('التطبيقات المنشورة', `${t.published}/${t.apps}`, '📦')}${k('متوسط التقييم', Number(t.avg_rating).toFixed(2), '⭐')}${k('تعليقات بانتظار الموافقة', t.pending_reviews, '⏳')}</div>
  <div class="two"><div class="card glass"><h3>التحميلات — آخر 14 يوماً</h3>${lineChart(s.downloadsByDay)}</div><div class="card glass"><h3>الأكثر تحميلاً</h3>${barChart(s.topApps, 'name', 'download_count')}</div></div>
  <div class="two"><div class="card glass"><h3>الزيارات — آخر 14 يوماً</h3>${lineChart(s.visitsByDay, '#9b5cff')}</div><div class="card glass"><h3>آخر النشاطات</h3>${s.recent.length ? s.recent.map((r) => `<div style="padding:7px 0;border-bottom:1px solid var(--bd);font-size:13.5px"><b>${esc(r.action)}</b> <span style="color:var(--m)">${esc(r.details?.name || r.entity || '')}</span><br><small style="color:var(--m)">${fmtDT(r.created_at)}</small></div>`).join('') : '<p style="color:var(--m)">—</p>'}</div></div>`;
}

async function pageApps() {
  const rows = await api('/admin/apps');
  view.innerHTML = `<h2 class="t">📦 التطبيقات <a class="btn pri" href="#/new">➕ تطبيق جديد</a></h2><div class="card glass tw"><table class="tbl"><thead><tr><th>التطبيق</th><th>الحالة</th><th>الإصدار</th><th>التحميلات</th><th>التقييم</th><th>الحجم</th><th></th></tr></thead><tbody>
  ${rows.map((a) => `<tr><td><div class="cell">${a.icon_url ? `<img class="ico" src="${esc(a.icon_url)}" alt="">` : '<div class="ico"></div>'}<div><b>${esc(a.name)}</b>${a.is_featured ? ' ⭐' : ''}<br><small style="color:var(--m)">${esc(a.category_name || '—')}</small></div></div></td>
  <td><span class="tag ${a.status}">${STATUS_AR[a.status]}</span>${a.status === 'scheduled' ? `<br><small style="color:var(--m)">${fmtDT(a.publish_at)}</small>` : ''}</td><td class="en">${esc(a.current_version)}</td><td class="en">${nf.format(a.download_count)}</td><td class="en">${a.rating_count ? Number(a.rating_avg).toFixed(1) + ' (' + a.rating_count + ')' : '—'}</td><td class="en">${fmtSize(a.size_bytes)}</td>
  <td><div class="acts"><a class="btn sec2 sm" href="#/edit/${a.id}">تعديل</a><button class="btn sec2 sm" data-f="${a.id}" data-v="${!a.is_featured}">${a.is_featured ? 'إلغاء التمييز' : 'تمييز'}</button><button class="btn sec2 sm" data-s="${a.id}" data-v="${a.status === 'hidden' ? 'published' : 'hidden'}">${a.status === 'hidden' ? 'إظهار' : 'إخفاء'}</button><button class="btn bad sm" data-d="${a.id}" data-n="${esc(a.name)}">حذف</button></div></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--m);padding:40px">لا توجد تطبيقات بعد</td></tr>'}</tbody></table></div>`;
  view.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.f) await api(`/admin/apps/${b.dataset.f}/flags`, { method: 'PATCH', body: { is_featured: b.dataset.v === 'true' } });
      else if (b.dataset.s) await api(`/admin/apps/${b.dataset.s}/flags`, { method: 'PATCH', body: { status: b.dataset.v } });
      else if (b.dataset.d) { if (!confirm(`حذف "${b.dataset.n}" نهائياً مع كل إصداراته وتقييماته؟`)) return; await api('/admin/apps/' + b.dataset.d, { method: 'DELETE' }); }
      else return;
      toast('تم ✓', 'ok'); pageApps();
    } catch (er) { toast(er.message, 'bad'); }
  };
}

// ---- app form (new / edit) ----
async function pageForm(id) {
  const cats = await api('/admin/categories');
  const a = id ? await api('/admin/apps/' + id) : { platforms: ['android'], status: 'published', current_version: '1.0.0', media: [], versions: [] };
  const state = { icon: a.icon_url || '', shots: a.media.filter((m) => m.kind === 'screenshot').map((m) => m.url), video: a.video_url || '', files: {} };
  const dtLocal = a.publish_at ? new Date(new Date(a.publish_at) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  view.innerHTML = `<h2 class="t">${id ? '✏️ تعديل: ' + esc(a.name) : '➕ رفع تطبيق جديد'}</h2>
  <form id="af" class="glass card" style="display:grid;gap:18px">
    <div class="fgrid"><div><label class="l">اسم التطبيق *</label><input name="name" required maxlength="80" value="${esc(a.name || '')}"></div>
      <div><label class="l">الفئة</label><select name="category_id"><option value="">— بدون —</option>${cats.map((c) => `<option value="${c.id}" ${a.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name_ar)}</option>`).join('')}</select></div>
      <div><label class="l">الإصدار</label><input name="current_version" class="en" value="${esc(a.current_version)}" maxlength="20"></div>
      <div><label class="l">الحجم (MB) — يُحسب تلقائياً عند رفع الملف</label><input name="size_mb" type="number" step="0.1" min="0" value="${a.size_bytes ? (a.size_bytes / 1048576).toFixed(1) : ''}"></div>
      <div class="full"><label class="l">وصف قصير (160 حرفاً)</label><input name="short_desc" maxlength="160" value="${esc(a.short_desc || '')}"></div></div>
    <div><label class="l">الوصف الكامل</label><div class="rte-bar">${[['bold', '<b>B</b>'], ['italic', '<i>I</i>'], ['underline', '<u>U</u>'], ['h2', 'H'], ['insertUnorderedList', '•'], ['insertOrderedList', '1.'], ['link', '🔗'], ['removeFormat', '✕']].map(([c, l]) => `<button type="button" data-c="${c}">${l}</button>`).join('')}</div><div class="rte" id="rte" contenteditable="true">${a.description || ''}</div></div>
    <div><label class="l">أنظمة التشغيل — ارفع الملف لكل نظام</label><div class="pf" id="plats">${Object.entries(PLAT).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${a.platforms.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div><div id="files"></div></div>
    <div class="fgrid"><div><label class="l">أيقونة التطبيق (PNG عالي الدقة)</label><div class="drop" id="dIcon">اسحب الأيقونة أو اضغط</div><div class="thumbs" id="tIcon"></div></div>
      <div><label class="l">لقطات الشاشة (حتى 8)</label><div class="drop" id="dShots">اسحب الصور أو اضغط</div><div class="thumbs" id="tShots"></div></div>
      <div class="full"><label class="l">فيديو معاينة (اختياري): رفع ملف MP4/WebM أو رابط YouTube</label><div class="fgrid"><div class="drop" id="dVid">رفع فيديو</div><input name="video_url" placeholder="https://youtube.com/watch?v=…" value="${esc(a.video_url || '')}"></div><div class="prog" id="pVid" hidden><i></i></div></div></div>
    <div class="fgrid"><div><label class="l">ملاحظات الإصدار (تُضاف مع الملفات الجديدة)</label><textarea name="changelog" rows="2" maxlength="2000"></textarea></div>
      <div><label class="l">النشر</label><div style="display:grid;gap:8px"><label><input type="radio" name="status" value="published" ${a.status === 'published' || !id && !a.status ? 'checked' : ''}> نشر فوري</label><label><input type="radio" name="status" value="scheduled" ${a.status === 'scheduled' ? 'checked' : ''}> نشر مجدول <input type="datetime-local" name="publish_at" value="${dtLocal}" style="margin-top:6px"></label><label><input type="radio" name="status" value="draft" ${a.status === 'draft' ? 'checked' : ''}> مسودة</label><label><input type="radio" name="status" value="hidden" ${a.status === 'hidden' ? 'checked' : ''}> مخفي</label><label><input type="checkbox" name="is_featured" ${a.is_featured ? 'checked' : ''}> ⭐ تطبيق مميز</label></div></div></div>
    ${a.versions.length ? `<div><label class="l">الإصدارات السابقة</label>${a.versions.map((v) => `<div class="fileline"><b class="en">v${esc(v.version)}</b><span>${PLAT[v.platform]}</span><span class="en">${fmtSize(v.size_bytes)}</span><a class="n en" href="${esc(v.file_url)}" target="_blank" rel="noopener">${esc(v.file_url)}</a></div>`).join('')}</div>` : ''}
    <p class="err" id="ferr"></p>
    <div class="sticky glass"><a class="btn sec2" href="#/apps">إلغاء</a><button class="btn pri" id="save" type="submit">${id ? 'حفظ التعديلات' : 'نشر التطبيق'}</button></div></form>`;

  // rich text
  $$('.rte-bar button').forEach((b) => b.addEventListener('mousedown', (e) => {
    e.preventDefault(); const c = b.dataset.c;
    if (c === 'h2') document.execCommand('formatBlock', false, 'h2');
    else if (c === 'link') { const u = prompt('الرابط (https://…)'); if (u && /^https?:\/\//i.test(u)) document.execCommand('createLink', false, u); }
    else document.execCommand(c, false);
  }));

  const renderThumbs = () => {
    $('#tIcon').innerHTML = state.icon ? `<div class="thumb"><img src="${esc(state.icon)}" alt=""><button type="button" data-x="icon">✕</button></div>` : '';
    $('#tShots').innerHTML = state.shots.map((u, i) => `<div class="thumb"><img src="${esc(u)}" alt=""><button type="button" data-x="shot" data-i="${i}">✕</button></div>`).join('');
  };
  renderThumbs();
  view.querySelector('#af').addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'icon') state.icon = ''; else state.shots.splice(+b.dataset.i, 1); renderThumbs(); });

  const picker = (el, accept, multiple, handler) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept, multiple, hidden: true });
    el.after(inp); el.onclick = () => inp.click(); inp.onchange = () => handler([...inp.files]).finally(() => (inp.value = ''));
    ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('over'); }));
    el.addEventListener('drop', (e) => handler([...e.dataTransfer.files]));
  };
  const withProgress = async (el, file) => { const old = el.textContent; try { const r = await uploadFile(file, (p) => (el.textContent = `⏳ ${Math.round(p * 100)}%`)); return r; } finally { el.textContent = old; } };
  picker($('#dIcon'), 'image/png,image/jpeg,image/webp', false, async ([f]) => { if (!f) return; try { state.icon = (await withProgress($('#dIcon'), f)).url; renderThumbs(); } catch (e) { toast(e.message, 'bad'); } });
  picker($('#dShots'), 'image/png,image/jpeg,image/webp', true, async (fs) => { for (const f of fs) { if (state.shots.length >= 8) { toast('الحد الأقصى 8 صور', 'bad'); break; } try { state.shots.push((await withProgress($('#dShots'), f)).url); renderThumbs(); } catch (e) { toast(e.message, 'bad'); } } });
  picker($('#dVid'), 'video/mp4,video/webm', false, async ([f]) => { if (!f) return; try { const r = await withProgress($('#dVid'), f); state.video = r.url; view.querySelector('[name=video_url]').value = r.url; toast('تم رفع الفيديو ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); } });

  // per-platform app files
  const exts = { android: '.apk', ios: '.ipa', windows: '.exe,.msi,.zip', mac: '.dmg,.zip', linux: '.deb,.appimage,.zip', web: '.zip' };
  const renderFiles = () => {
    const sel = $$('#plats input:checked').map((i) => i.value);
    Object.keys(state.files).forEach((k) => { if (!sel.includes(k)) delete state.files[k]; });
    $('#files').innerHTML = sel.map((p) => `<div class="fileline" data-p="${p}"><b>${PLAT[p]}</b><span class="n en">${state.files[p] ? esc(state.files[p].name) + ' · ' + fmtSize(state.files[p].size_bytes) : 'لم يُرفع ملف جديد'}</span><div class="prog" style="width:100%" hidden><i></i></div><button type="button" class="btn sec2 sm">${state.files[p] ? 'استبدال' : 'رفع ' + exts[p]}</button></div>`).join('');
    $$('#files .fileline').forEach((line) => {
      const p = line.dataset.p, btn = line.querySelector('button'), pg = line.querySelector('.prog');
      const inp = Object.assign(document.createElement('input'), { type: 'file', accept: exts[p], hidden: true }); line.append(inp);
      btn.onclick = () => inp.click();
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return; pg.hidden = false; btn.disabled = true;
        try { const r = await uploadFile(f, (x) => (pg.firstChild.style.width = x * 100 + '%')); state.files[p] = { platform: p, file_url: r.url, file_id: r.id, size_bytes: r.size, name: f.name }; recalcSize(); toast('تم رفع الملف ✓', 'ok'); }
        catch (e) { toast(e.message, 'bad'); }
        renderFiles();
      };
    });
  };
  const recalcSize = () => { const v = Object.values(state.files); if (v.length) view.querySelector('[name=size_mb]').value = (Math.max(...v.map((x) => x.size_bytes)) / 1048576).toFixed(1); };
  $('#plats').addEventListener('change', renderFiles); renderFiles();

  $('#af').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#ferr').textContent = '';
    const f = new FormData(e.target), plats = $$('#plats input:checked').map((i) => i.value);
    if (!plats.length) { $('#ferr').textContent = 'اختر نظام تشغيل واحداً على الأقل'; return; }
    if (!id && !Object.keys(state.files).length && !confirm('لم تُرفع أي ملفات للتطبيق. المتابعة (لن يستطيع الزوار تحميله)؟')) return;
    const ver = f.get('current_version') || '1.0.0';
    const body = { name: f.get('name'), short_desc: f.get('short_desc'), description: $('#rte').innerHTML, category_id: f.get('category_id') ? +f.get('category_id') : null,
      platforms: plats, current_version: ver, size_bytes: Math.round((+f.get('size_mb') || 0) * 1048576), icon_url: state.icon || null,
      video_url: f.get('video_url') || null, screenshots: state.shots, status: f.get('status'), publish_at: f.get('publish_at') ? new Date(f.get('publish_at')).toISOString() : null,
      is_featured: !!f.get('is_featured'), files: Object.values(state.files).map((x) => ({ ...x, version: ver, changelog: f.get('changelog') || '' })) };
    $('#save').disabled = true;
    try { await api(id ? '/admin/apps/' + id : '/admin/apps', { method: id ? 'PUT' : 'POST', body }); toast('تم الحفظ ✓', 'ok'); location.hash = '#/apps'; }
    catch (er) { $('#ferr').textContent = er.message; $('#save').disabled = false; }
  });
}

async function pageReviews() {
  const rows = await api('/admin/reviews');
  view.innerHTML = `<h2 class="t">💬 التقييمات والتعليقات</h2><div class="card glass tw"><table class="tbl"><thead><tr><th>التطبيق</th><th>المراجع</th><th>التقييم</th><th>التعليق</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.app_name)}</td><td>${esc(r.author_name)}<br><small style="color:var(--m)">${fmtDT(r.created_at)}</small></td><td style="color:var(--warn)">${'★'.repeat(r.rating)}</td><td style="max-width:320px">${esc(r.comment) || '—'}${r.admin_reply ? `<div style="color:var(--c3);font-size:13px;margin-top:4px">↳ ${esc(r.admin_reply)}</div>` : ''}</td><td><span class="tag ${r.status}">${STATUS_AR[r.status]}</span></td>
  <td><div class="acts">${r.status !== 'approved' ? `<button class="btn sec2 sm" data-id="${r.id}" data-a="approved">قبول</button>` : ''}${r.status !== 'rejected' ? `<button class="btn sec2 sm" data-id="${r.id}" data-a="rejected">رفض</button>` : ''}<button class="btn sec2 sm" data-id="${r.id}" data-a="reply">ردّ</button><button class="btn bad sm" data-id="${r.id}" data-a="del">حذف</button></div></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--m);padding:40px">لا توجد تقييمات</td></tr>'}</tbody></table></div>`;
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const id = b.dataset.id;
    try {
      if (b.dataset.a === 'del') { if (!confirm('حذف هذا التقييم؟')) return; await api('/admin/reviews/' + id, { method: 'DELETE' }); }
      else if (b.dataset.a === 'reply') { const t = prompt('نص الرد (اتركه فارغاً لحذف الرد):'); if (t === null) return; await api('/admin/reviews/' + id, { method: 'PATCH', body: { admin_reply: t } }); }
      else await api('/admin/reviews/' + id, { method: 'PATCH', body: { status: b.dataset.a } });
      toast('تم ✓', 'ok'); pageReviews(); refreshPending();
    } catch (er) { toast(er.message, 'bad'); }
  };
}

async function pageCategories() {
  const rows = await api('/admin/categories');
  view.innerHTML = `<h2 class="t">🗂️ التصنيفات</h2><div class="two"><div class="card glass tw"><table class="tbl"><thead><tr><th></th><th>العربية</th><th>English</th><th>الترتيب</th><th>التطبيقات</th><th></th></tr></thead><tbody>
  ${rows.map((c) => `<tr><td style="font-size:22px">${esc(c.icon)}</td><td>${esc(c.name_ar)}</td><td class="en">${esc(c.name_en)}</td><td class="en">${c.sort_order}</td><td class="en">${c.apps}</td><td><div class="acts"><button class="btn sec2 sm" data-e="${c.id}" data-n="${esc(c.name_ar)}">تعديل</button><button class="btn bad sm" data-d="${c.id}" data-n="${esc(c.name_ar)}">حذف</button></div></td></tr>`).join('')}</tbody></table></div>
  <form class="card glass" id="cf" style="display:grid;gap:10px;align-content:start"><h3>تصنيف جديد</h3><input name="name_ar" placeholder="الاسم بالعربية" required maxlength="40"><input name="name_en" class="en" placeholder="Name in English" required maxlength="40"><input name="icon" placeholder="أيقونة (إيموجي)" maxlength="8" value="📦"><input name="sort_order" type="number" placeholder="الترتيب" value="${rows.length + 1}"><button class="btn pri">إضافة</button></form></div>`;
  $('#cf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/admin/categories', { method: 'POST', body: f }); toast('تمت الإضافة ✓', 'ok'); pageCategories(); } catch (er) { toast(er.message, 'bad'); } };
  view.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.d) { if (!confirm(`حذف تصنيف "${b.dataset.n}"؟ ستصبح تطبيقاته بدون فئة.`)) return; await api('/admin/categories/' + b.dataset.d, { method: 'DELETE' }); }
      else if (b.dataset.e) { const n = prompt('الاسم الجديد بالعربية:', b.dataset.n); if (!n) return; await api('/admin/categories/' + b.dataset.e, { method: 'PUT', body: { name_ar: n } }); }
      else return; toast('تم ✓', 'ok'); pageCategories();
    } catch (er) { toast(er.message, 'bad'); }
  };
}

async function pageUsers() {
  const rows = await api('/admin/users');
  view.innerHTML = `<h2 class="t">👥 المستخدمون</h2><div class="card glass tw"><table class="tbl"><thead><tr><th>الاسم</th><th>البريد</th><th>تقييمات</th><th>تحميلات</th><th>التسجيل</th><th></th></tr></thead><tbody>
  ${rows.map((u) => `<tr><td>${esc(u.display_name)} ${u.is_banned ? '<span class="tag hidden">محظور</span>' : ''}</td><td class="en">${esc(u.email || '—')}</td><td class="en">${u.reviews}</td><td class="en">${u.downloads}</td><td>${fmtDT(u.created_at)}</td><td><button class="btn ${u.is_banned ? 'sec2' : 'bad'} sm" data-id="${u.id}" data-b="${!u.is_banned}">${u.is_banned ? 'إلغاء الحظر' : 'حظر'}</button></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--m);padding:40px">لا يوجد مستخدمون مسجّلون — الزوار يتصفحون بدون حساب</td></tr>'}</tbody></table></div>`;
  view.onclick = async (e) => { const b = e.target.closest('button[data-id]'); if (!b) return; try { await api('/admin/users/' + b.dataset.id, { method: 'PATCH', body: { is_banned: b.dataset.b === 'true' } }); pageUsers(); } catch (er) { toast(er.message, 'bad'); } };
}

async function pageActivity() {
  const rows = await api('/admin/activity');
  view.innerHTML = `<h2 class="t">🧾 سجل النشاطات</h2><div class="card glass tw"><table class="tbl"><thead><tr><th>الوقت</th><th>الإجراء</th><th>العنصر</th><th>التفاصيل</th><th>IP</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${fmtDT(r.created_at)}</td><td><b>${esc(r.action)}</b></td><td>${esc(r.entity || '')}</td><td style="color:var(--m)">${esc(r.details?.name || '')}</td><td class="en" style="color:var(--m)">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pageSettings() {
  const [me, dev] = await Promise.all([api('/auth/me'), fetch('/api/developer').then((r) => r.json())]);
  view.innerHTML = `<h2 class="t">⚙️ الإعدادات</h2><div class="two">
  <div style="display:grid;gap:14px;align-content:start">
    <form class="card glass" id="kf" style="display:grid;gap:10px"><h3>🔑 مفتاح الرفع (UPLOAD_API_KEY)</h3><p style="color:var(--m);font-size:13px">يُحفظ في هذه الجلسة فقط ولا يُرسل إلا لخدمة الرفع.</p><input type="password" name="k" class="en" placeholder="UPLOAD_API_KEY" value="${esc(upKey())}" autocomplete="off"><button class="btn pri">حفظ للجلسة</button></form>
    <form class="card glass" id="df" style="display:grid;gap:10px"><h3>👤 صفحة «عن المطور»</h3><input name="name" placeholder="الاسم" value="${esc(dev.name || '')}"><textarea name="bio" rows="4" placeholder="نبذة عنك">${esc(dev.bio || '')}</textarea><input name="email" type="email" placeholder="البريد" value="${esc(dev.email || '')}">
      ${['GitHub', 'Twitter', 'Website', 'Telegram'].map((k) => `<input name="l_${k}" class="en" placeholder="${k} URL" value="${esc((dev.links || {})[k] || '')}">`).join('')}<button class="btn pri">حفظ</button></form></div>
  <div style="display:grid;gap:14px;align-content:start">
    <div class="card glass" id="tf"><h3>🛡️ المصادقة الثنائية (2FA)</h3>${me.totp ? '<p style="color:var(--ok)">✔ مفعّلة</p>' : '<p style="color:var(--m);margin-bottom:10px">استخدم Google Authenticator أو أي تطبيق TOTP.</p><button class="btn pri" id="t2">تفعيل 2FA</button>'}<div id="t2box"></div></div>
    <form class="card glass" id="pf" style="display:grid;gap:10px"><h3>🔒 تغيير كلمة المرور</h3><input type="password" name="current" placeholder="الحالية" required autocomplete="current-password"><input type="password" name="next" placeholder="الجديدة (10 أحرف على الأقل)" required minlength="10" autocomplete="new-password"><button class="btn pri">تغيير</button></form></div></div>`;
  $('#kf').onsubmit = (e) => { e.preventDefault(); sessionStorage.setItem('abdosit_upkey', new FormData(e.target).get('k').trim()); toast('تم حفظ المفتاح للجلسة ✓', 'ok'); };
  $('#df').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const links = {}; for (const k of ['GitHub', 'Twitter', 'Website', 'Telegram']) if (f['l_' + k]) links[k] = f['l_' + k]; try { await api('/admin/developer', { method: 'PUT', body: { name: f.name, bio: f.bio, email: f.email, links } }); toast('تم الحفظ ✓', 'ok'); } catch (er) { toast(er.message, 'bad'); } };
  $('#pf').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/auth/password', { method: 'POST', body: f }); toast('تم تغيير كلمة المرور ✓', 'ok'); e.target.reset(); } catch (er) { toast(er.message, 'bad'); } };
  $('#t2')?.addEventListener('click', async () => {
    try {
      const s = await api('/auth/2fa/setup', { method: 'POST' });
      $('#t2box').innerHTML = `<img class="qr" src="${s.qr}" alt="QR"><p class="en" style="font-size:12px;word-break:break-all;margin:8px 0">${esc(s.secret)}</p><input id="tc" class="en" inputmode="numeric" maxlength="6" placeholder="000000"><button class="btn pri" id="te" style="margin-top:8px">تأكيد وتفعيل</button>`;
      $('#te').onclick = async () => { try { await api('/auth/2fa/enable', { method: 'POST', body: { code: $('#tc').value } }); toast('تم تفعيل 2FA ✓', 'ok'); pageSettings(); } catch (er) { toast(er.message, 'bad'); } };
    } catch (er) { toast(er.message, 'bad'); }
  });
}

// ---------- router ----------
const routes = [[/^\/?$/, 'dash', pageDash], [/^\/apps$/, 'apps', pageApps], [/^\/new$/, 'new', () => pageForm()], [/^\/edit\/([\w-]+)$/, 'apps', (m) => pageForm(m[1])],
  [/^\/reviews$/, 'reviews', pageReviews], [/^\/categories$/, 'categories', pageCategories], [/^\/users$/, 'users', pageUsers], [/^\/activity$/, 'activity', pageActivity], [/^\/settings$/, 'settings', pageSettings]];
async function route() {
  if (!token) return;
  const path = location.hash.slice(1) || '/'; view.onclick = null;
  for (const [re, name, fn] of routes) {
    const m = re.exec(path); if (!m) continue;
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === name));
    view.innerHTML = '<p style="color:var(--m);padding:30px">جاري التحميل…</p>';
    try { await fn(m); } catch (e) { view.innerHTML = `<div class="card glass"><p class="err">${esc(e.message)}</p></div>`; }
    return;
  }
  view.innerHTML = '<p style="padding:30px">الصفحة غير موجودة</p>';
}
async function refreshPending() { try { const r = await api('/admin/reviews?status=pending'); const n = r.length; $('#pend').hidden = !n; $('#pend').textContent = n; } catch {} }
function boot() { if (!token) { $('#login').hidden = false; return; } $('#login').hidden = true; $('#shell').hidden = false; route(); refreshPending(); }
addEventListener('hashchange', route);
boot();
