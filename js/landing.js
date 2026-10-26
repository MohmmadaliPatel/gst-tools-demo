// Renders the landing page from profile.json (the single editable content file).
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
// Highlight [placeholders] so they're impossible to miss before publishing.
const fmt = (s) => esc(s).replace(/\[[^\]]+\]/g, (m) => `<span class="ph">${m}</span>`);

const p = await fetch('profile.json').then((r) => r.json());
document.querySelectorAll('[data-p]').forEach((el) => { const k = el.dataset.p; if (p[k] !== undefined) el.innerHTML = fmt(p[k]); });
document.getElementById('services-list').innerHTML = p.services.map((s) => `
  <div class="card"><div class="note">Package ${esc(s.id)}</div><h3>${fmt(s.name)}</h3>
  <div class="price">${fmt(s.price)} ${s.price_usd ? `<small>/ ${esc(s.price_usd)}</small>` : ''}</div>
  <div class="note" style="margin-bottom:8px">${fmt(s.timeline)}</div><p style="font-size:14px">${fmt(s.desc)}</p></div>`).join('');
document.getElementById('about-text').innerHTML = p.about.map((t) => `<p>${fmt(t)}</p>`).join('');
document.getElementById('work-types').innerHTML = p.work_types.map((t) => `<li>${fmt(t)}</li>`).join('');
document.getElementById('strengths').innerHTML = p.strengths.map((t) => `<li>${fmt(t)}</li>`).join('');
document.getElementById('stack').innerHTML = Object.entries(p.stack).map(([k, v]) => `<div style="margin-bottom:8px"><div class="note"><b>${esc(k)}</b></div><div class="tags" style="margin-top:4px">${v.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>`).join('');
document.getElementById('work-list').innerHTML = p.selected_work.map((w) => `
  <div class="card"><h3>${fmt(w.title)}</h3><p style="font-size:14px">${fmt(w.desc)}</p>
  <div class="tags">${w.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>`).join('');
document.getElementById('contact-line').innerHTML = `${fmt(p.location)} · ${fmt(p.availability)}`;
const qt = document.getElementById('quick-list');
if (qt && p.quick_tools) qt.innerHTML = p.quick_tools.map((s) => `
  <div class="card"><h3>${fmt(s.name)}</h3>
  <div class="price"><small>from</small> ${fmt(s.from)} <small>/ ${esc(s.usd)}</small></div>
  <div class="note" style="margin-bottom:8px">${fmt(s.timeline)} · fixed price</div><p style="font-size:14px">${fmt(s.desc)}</p>
  <p><a class="btn sm" href="${esc(s.demo)}">See the demo</a></p></div>`).join('');
