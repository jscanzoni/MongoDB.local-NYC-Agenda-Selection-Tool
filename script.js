// CLEAN REBUILD (simplified, unified card layout, continuous 15-min timeline)
document.addEventListener('DOMContentLoaded', () =>
{
    const root=document.getElementById('sessions-root');
    const filtersContainer=document.getElementById('filters-static');
    const searchInput=document.querySelector('.search input');
    const MISSING_LOC='Undefined';
    const EVENT_DATE='September 17, 2025';
    const EVENT_TZ='ET';
    const STEP=15; // minutes per slot
    let allSessions=[]; // normalized
    let categoriesData=null;
    const selectedTags=new Set();
    let myScheduleIds=new Set();
    // --- Analytics helper (safe no-op if GA not present) ---
    const track=(name, params={}) => { if (typeof window!=='undefined'&&typeof window.gtag==='function') { try { window.gtag('event', name, params); } catch { } } };

    // ---------- Utility ----------
    const el=(t, c, txt) => { const n=document.createElement(t); if (c) n.className=c; if (txt!=null) n.textContent=txt; return n; };
    const normLoc=loc => { const v=(loc==null? '':String(loc)).trim(); return v||MISSING_LOC; };
    const parseTime=s => { if (!s) return null; const m=String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i); if (!m) return null; let h=+m[ 1 ]; const min=+(m[ 2 ]||0); const ap=m[ 3 ].toUpperCase(); if (ap==='AM') { if (h===12) h=0; } else if (h!==12) h+=12; return h*60+min; };
    const parseRange=r => { if (!r) return null; const [ a, b ]=r.split('-').map(s => s.trim()); const start=parseTime(a); const end=parseTime(b); return (start!=null&&end!=null)? { start, end }:null; };
    const fmtRange=(a, b) => { const f=t => { const h24=Math.floor(t/60), m=t%60; let h=h24%12; if (h===0) h=12; return `${h}:${m.toString().padStart(2, '0')}`; }; return `${f(a)}–${f(b)}`; };
    const fmtTimeLabel=t => { const m=t%60; if (m!==0&&m!==30) return ''; const h24=Math.floor(t/60), m2=t%60, ap=h24>=12? 'PM':'AM'; let h=h24%12; if (h===0) h=12; return `${h}:${m2.toString().padStart(2, '0')} ${ap}`; };

    function normalizeSessions(raw)
    {
        return raw.map((s, i) => { const rng=parseRange(s.time); return Object.assign({ id: i, tags: Array.isArray(s.tags)? s.tags:[] }, s, rng||{}); })
            .filter(s => s.start!=null&&s.end!=null)
            .sort((a, b) => a.start-b.start||a.end-b.end);
    }

    function assignLanes(sessions)
    {
        const lanes=[]; const sorted=[ ...sessions ].sort((a, b) => a.start-b.start||a.end-b.end);
        for (const item of sorted) { let placed=false; for (const lane of lanes) { const last=lane[ lane.length-1 ]; if (item.start>=last.end) { lane.push(item); placed=true; break; } } if (!placed) lanes.push([ item ]); }
        lanes.forEach((lane, idx) => lane.forEach(s => { s.__lane=idx; s.__laneCount=lanes.length; }));
        return lanes.length; // lane count
    }

    function buildTimeline(list)
    {
        if (!list.length) return { slots: [], map: new Map(), totalRows: 1 };
        const min=Math.min(...list.map(s => s.start));
        const max=Math.max(...list.map(s => s.end));
        // Expand outward to the nearest half-hour boundaries plus an extra half-hour
        // before and after for breathing room + visible labels.
        const halfHour=30;
        const baseStart=Math.floor(min/halfHour)*halfHour;
        const baseEnd=Math.ceil(max/halfHour)*halfHour;
        const start=Math.max(0, baseStart-halfHour); // one extra slot above
        const end=baseEnd+halfHour; // one extra slot below (exclusive)
        const slots=[]; const map=new Map();
        let row=2; // row 1 = headers
        for (let t=start; t<end; t+=STEP) { slots.push(t); map.set(t, row++); }
        return { slots, map, totalRows: row-1, start, end };
    }

    function renderSessionCard(s)
    {
        const card=el('div', 'sched-session session-card');
        const cleanTitle=(s.title||'').replace(/\s+/g, ' ').trim();
        const title=el('h3', 'session-title', cleanTitle);
        title.title=cleanTitle;
        card.appendChild(title);
        // Time range (for hover & accessibility)
        if (s.start!=null&&s.end!=null) {
            const rangeTxt=fmtRange(s.start, s.end)+` ${EVENT_TZ}`;
            card.setAttribute('data-time-range', rangeTxt);
            // Enrich accessibility label later after selection state known
            card.setAttribute('aria-label', `${cleanTitle}. ${rangeTxt}.`);
        }
        const inSched=myScheduleIds.has(s.id);
        if (inSched) card.classList.add('selected');
        const btn=el('button', 'card-add-btn'+(inSched? ' saved':''), inSched? '✓':'+');
        btn.setAttribute('aria-label', (inSched? 'Remove from':'Add to')+` My Schedule: ${cleanTitle}`);
        // Removed red hover remove state; keep stable icon
        btn.addEventListener('click', e => { e.stopPropagation(); fastToggleSchedule(s.id, card, btn); });
        card.appendChild(btn);
        card.tabIndex=0; card.role='button';
        card.addEventListener('click', () => { track('session_view', { session_id: s.id, title: cleanTitle, start: s.start, end: s.end, location: normLoc(s.location) }); openModal(s); });
        card.addEventListener('keydown', ev => { if (ev.key==='Enter'||ev.key===' ') { ev.preventDefault(); openModal(s); } });
        return card;
    }

    // ---------- Modal ----------
    function ensureModal() { let shell=document.getElementById('session-modal'); if (shell) return shell; shell=el('div', 'modal-backdrop'); shell.id='session-modal'; document.body.appendChild(shell); return shell; }
    function closeModal() { const sh=document.getElementById('session-modal'); if (sh) { sh.classList.remove('open'); sh.setAttribute('aria-hidden', 'true'); sh.innerHTML=''; } }
    function openModal(s)
    {
        const shell=ensureModal(); shell.classList.add('open'); shell.setAttribute('aria-hidden', 'false'); shell.innerHTML='';
        const dialog=el('div', 'Dialog__dragContainer___tcUgB');
        const header=el('div', 'DialogHeader__dialogHeader___66ff');
        const hWrap=el('div', 'SessionDetailDialog__title___47b2');
        const titleEl=el('h3', 'AgendaV2Styles__sessionModalName___72ac', s.title||''); titleEl.id='session-modal-title';
        const closeBtn=el('button', 'SessionDetailDialog__closeDialog___47b2'); closeBtn.setAttribute('aria-label', 'Close'); closeBtn.innerHTML='×'; closeBtn.addEventListener('click', closeModal); hWrap.appendChild(titleEl); hWrap.appendChild(closeBtn); header.appendChild(hWrap);
        const content=el('div', 'Dialog__content___IGTri'); const focus=el('div', 'SessionDetailDialog__dialogDefaultFocus___47b2');
        const dateLoc=el('div', 'AgendaV2Styles__sessionModalDateTimeContainer___72ac'); dateLoc.innerHTML=`<div><div>${EVENT_DATE}</div></div><div><div></div><div>${s.time||fmtRange(s.start, s.end)} <span>${EVENT_TZ}</span></div></div>`;
        const level=el('div', 'AgendaV2Styles__sessionModalCategoryContainer___72ac'); if (s.level) level.appendChild(el('span', 'level-pill', s.level));
        const loc=el('div', 'AgendaV2Styles__sessionModalLocationAndCodeContainer___72ac', normLoc(s.location));
        const actions=el('div', 'session-modal-actions'); const btn=el('button', 'sched-add-btn modal'+(myScheduleIds.has(s.id)? ' saved':''), myScheduleIds.has(s.id)? 'Saved':'Add to My Schedule'); btn.addEventListener('click', () => toggleSchedule(s.id)); actions.appendChild(btn);
        const desc=el('div', 'AgendaV2Styles__sessionModalDescription___72ac', s.description||'');
        const tagWrap=el('div', 'tags-wrap'); (s.tags||[]).forEach(t => tagWrap.appendChild(el('span', 'tag-chip', t)));
        if ((s.tags||[]).length) focus.appendChild(tagWrap);
        if (s.takeaway) { const tw=el('div', 'takeaway-callout'); tw.appendChild(el('span', 'label', 'AI-generated takeaway:')); tw.appendChild(document.createTextNode(' '+s.takeaway)); focus.appendChild(tw); }
        const speakers=el('div', 'AgendaV2Styles__sessionModalSpeakersWrapper___72ac speakers-grid'); (s.speakers||[]).forEach(sp => speakers.appendChild(buildSpeaker(sp)));
        [ dateLoc, level, loc, actions, desc, speakers ].forEach(n => focus.appendChild(n));
        content.appendChild(focus); dialog.appendChild(header); dialog.appendChild(content); shell.appendChild(dialog);
        function onEsc(e) { if (e.key==='Escape') closeModal(); }
        document.addEventListener('keydown', onEsc, { once: true });
        shell.addEventListener('click', e => { if (e.target===shell) closeModal(); }, { once: true });
    }
    function buildSpeaker(sp) { const r=el('div', 'speaker'); const av=el('div', 'speaker-avatar'); if (sp&&sp.photoUrl) { const img=new Image(); img.loading='lazy'; img.src=sp.photoUrl; img.alt=sp.name||''; av.appendChild(img); } else { const ini=(sp?.name||'?').split(/\s+/).map(p => p[ 0 ]).slice(0, 2).join('').toUpperCase(); av.textContent=ini; } const info=el('div', 'speaker-info'); info.appendChild(el('div', 'name', sp?.name||'')); if (sp?.title) info.appendChild(el('div', 'title', sp.title)); if (sp?.company) info.appendChild(el('div', 'company', sp.company)); r.appendChild(av); r.appendChild(info); return r; }

    // ---------- Rendering main schedule ----------
    function render(list)
    {
        root.innerHTML=''; if (!list.length) { root.textContent='No sessions match the current filters.'; return; }
        const locations=[ ...new Set(list.map(s => normLoc(s.location))) ]; if (locations.includes(MISSING_LOC)) { locations.splice(locations.indexOf(MISSING_LOC), 1); locations.push(MISSING_LOC); }
        const perLoc=new Map(); locations.forEach(l => perLoc.set(l, list.filter(s => normLoc(s.location)===l)));
        const locMeta=locations.map(loc => { const sessions=perLoc.get(loc)||[]; const laneCount=assignLanes(sessions); return { loc, laneCount }; });
        // Build timeline then insert a uniform gap row before every slot after the first (Option A)
        const timeline=buildTimeline(list); // reuse existing slot calc
        const slots=timeline.slots;
        const map=new Map();
        const rowDescriptors=[]; // after header row
        // Height of the synthetic uniform gap row inserted before each time slot (except the first)
        const GAP_ROW_H=14; // px
        let nextRow=2; // row 1 = headers
        slots.forEach((t, idx) =>
        {
            if (idx>0) { // uniform gap before every subsequent slot
                rowDescriptors.push({ type: 'gap' });
                nextRow++;
            }
            rowDescriptors.push({ type: 'slot', time: t });
            map.set(t, nextRow);
            nextRow++;
        });
        const totalRows=nextRow-1;
        const wrap=el('div', 'schedule-wrap');
        const timeRail=el('div', 'time-rail'); const head=el('div', 'time-rail-head sched-head'); timeRail.appendChild(head); const railInner=el('div', 'time-rail-inner'); timeRail.appendChild(railInner);
        const scroller=el('div', 'schedule-scroll');
        // Cover element sits above sessions (prevents peeking during upward scroll) but below sticky location headers
        const cover=el('div', 'schedule-cover');
        scroller.appendChild(cover);
        const grid=el('div', 'schedule-grid');
        grid.style.gridTemplateColumns=locMeta.map(m => `repeat(${m.laneCount}, minmax(280px,1fr))`).join(' ');
        let col=1; const locStart=new Map(); locMeta.forEach(m => { locStart.set(m.loc, col); grid.appendChild(place(el('div', 'sched-head loc-head', m.loc), col, 1, m.laneCount)); col+=m.laneCount; });
        // Build time rail rows aligned with grid (gap rows render as empty shrink rows)
        const railFrag=document.createDocumentFragment();
        const firstSlot=slots[ 0 ];
        rowDescriptors.forEach(desc =>
        {
            if (desc.type==='gap') {
                railFrag.appendChild(el('div', 'time-gap-cell', ''));
            } else {
                if (desc.time===firstSlot) {
                    // Skip top-most label (leave empty cell so alignment stays correct)
                    railFrag.appendChild(el('div', 'sched-time minor', ''));
                } else {
                    const lbl=fmtTimeLabel(desc.time);
                    railFrag.appendChild(el('div', lbl? 'sched-time':'sched-time minor', lbl));
                }
            }
        });
        railInner.appendChild(railFrag);
        for (let c=1; c<col; c++) { grid.appendChild(place(el('div', 'col-sep'), c, 2, 1, totalRows-1)); }
        // Place sessions; gap rows already inserted before their start row if needed
        list.forEach(s =>
        {
            const base=locStart.get(normLoc(s.location));
            const laneIdx=s.__lane||0;
            const startRow=map.get(Math.floor(s.start/STEP)*STEP);
            // Number of STEP-sized slots this session covers
            const slotCount=Math.max(1, Math.ceil((s.end-s.start)/STEP));
            // With uniform gap rows inserted before every slot after the first,
            // a session spanning N slots must also span the (N-1) gap rows between them.
            // Row span formula: 1 slot => 1 row; N>1 => 2N-1 rows.
            const rowSpan=slotCount===1? 1:slotCount*2-1;
            if (!startRow) return;
            const card=renderSessionCard(s);
            if (slotCount===1) card.classList.add('span-one');
            grid.appendChild(place(card, base+laneIdx, startRow, 1, rowSpan));
        });
        scroller.appendChild(grid); wrap.appendChild(timeRail); wrap.appendChild(scroller); root.appendChild(wrap); syncRail(scroller, railInner); adjustHead(head, grid, scroller);
        // Enable mouse wheel scrolling when pointer is over the (non-scrollable) time rail
        timeRail.addEventListener('wheel', e =>
        {
            if (!e.deltaY) return; // vertical intent only
            scroller.scrollTop+=e.deltaY;
            e.preventDefault();
        }, { passive: false });
        // Apply explicit row sizing: header auto + dynamic gaps + slots
        const rowSizes=[ 'auto' ];
        rowDescriptors.forEach(desc => { rowSizes.push(desc.type==='gap'? GAP_ROW_H+'px':'var(--slot-h)'); });
        grid.style.gridTemplateRows=rowSizes.join(' ');
        railInner.style.gridTemplateRows=rowSizes.slice(1).join(' '); // rail has only post-header rows
    }
    const place=(node, col, row, colSpan=1, rowSpan=1) => { node.style.gridColumn=`${col} / ${col+colSpan}`; node.style.gridRow=`${row} / ${row+rowSpan}`; return node; };
    function syncRail(scroller, rail) { const f=() => rail.style.transform=`translateY(-${scroller.scrollTop}px)`; scroller.addEventListener('scroll', f, { passive: true }); f(); }
    function adjustHead(head, grid, scroller) { requestAnimationFrame(() => { const h=grid.querySelector('.loc-head')?.getBoundingClientRect().height||40; head.style.height=`${h}px`; if (scroller) scroller.style.setProperty('--loc-head-h', h+'px'); }); }

    // ---------- Filters ----------
    function buildFilters() { if (!categoriesData||!filtersContainer) return; filtersContainer.innerHTML=''; const title=el('h3', 'filters-title', 'Filters'); filtersContainer.appendChild(title); const wrap=el('div', 'filters-content'); filtersContainer.appendChild(wrap); const known=new Set(); Object.values(categoriesData).forEach(arr => arr.forEach(t => known.add(t))); const used=new Set(); allSessions.forEach(s => (s.tags||[]).forEach(t => used.add(t))); const misc=[ ...used ].filter(t => !known.has(t)); const cats=[ ...Object.entries(categoriesData).map(([ n, t ]) => ({ name: n, tags: t })), ...(misc.length? [ { name: 'Misc', tags: misc } ]:[]) ]; cats.forEach(cat => { const sec=el('section', 'filter-category'); sec.appendChild(el('h4', 'filter-cat-title', cat.name)); const list=el('div', 'filter-tags'); cat.tags.forEach(tag => { const row=el('label', 'filter-tag'); const cb=document.createElement('input'); cb.type='checkbox'; cb.value=tag; cb.checked=selectedTags.has(tag); cb.addEventListener('change', () => { if (cb.checked) selectedTags.add(tag); else selectedTags.delete(tag); applyFilters(); }); row.appendChild(cb); row.appendChild(el('span', 'tag-label', tag)); list.appendChild(row); }); sec.appendChild(list); wrap.appendChild(sec); }); updateFiltersTitle(); }
    function updateFiltersTitle() { const t=filtersContainer?.querySelector('.filters-title'); if (t) { const c=selectedTags.size; t.textContent=c? `Filters (${c})`:'Filters'; track('filters_change', { selected_count: c, filters: [ ...selectedTags ].join('|') }); } }
    function applyFilters(preserveScroll=false)
    {
        const q=(searchInput?.value||'').toLowerCase().trim();
        let list=allSessions;
        if (selectedTags.size) list=list.filter(s => (s.tags||[]).some(t => selectedTags.has(t)));
        if (q) {
            list=list.filter(s => (s.title||'').toLowerCase().includes(q)||(s.description||'').toLowerCase().includes(q)||(s.location||'').toLowerCase().includes(q)||(s.speakers||[]).some(sp => (sp.name||'').toLowerCase().includes(q)));
        }
        let sx=0, sy=0;
        if (preserveScroll) {
            const sc=document.querySelector('.schedule-scroll');
            if (sc) { sx=sc.scrollLeft; sy=sc.scrollTop; }
        }
        render(list);
        if (preserveScroll) {
            requestAnimationFrame(() =>
            {
                const sc2=document.querySelector('.schedule-scroll');
                if (sc2) { sc2.scrollLeft=sx; sc2.scrollTop=sy; }
            });
        }
        updateFiltersTitle();
    }

    // ---------- Personal schedule ----------
    function loadSchedule() { try { myScheduleIds=new Set(JSON.parse(localStorage.getItem('myScheduleIds')||'[]')); } catch { } renderMySchedule(); }
    function saveSchedule() { localStorage.setItem('myScheduleIds', JSON.stringify([ ...myScheduleIds ])); }
    function toggleSchedule(id) { const adding=!myScheduleIds.has(id); if (adding) myScheduleIds.add(id); else myScheduleIds.delete(id); track(adding? 'schedule_add':'schedule_remove', { session_id: id }); saveSchedule(); renderMySchedule(); applyFilters(true); }
    // Faster in-place toggle avoiding full scroll jump; still re-renders list quietly
    function fastToggleSchedule(id, card, btn)
    {
        // Preserve scroll via applyFilters(true) instead of manually restoring old node
        const adding=!myScheduleIds.has(id);
        if (adding) myScheduleIds.add(id); else myScheduleIds.delete(id);
        saveSchedule();
        // Update visual state inline
        const selected=myScheduleIds.has(id);
        card.classList.toggle('selected', selected);
        btn.classList.toggle('saved', selected);
        // Maintain hover remove state if active
        if (btn.classList.contains('hover-remove')) {
            btn.dataset.prevIcon=selected? '✓':'+';
            btn.textContent='×';
        } else {
            btn.textContent=selected? '✓':'+';
        }
        btn.setAttribute('aria-label', (selected? 'Remove from':'Add to')+` My Schedule: ${(card.querySelector('.session-title')||{}).textContent||''}`);
        renderMySchedule(); track(adding? 'schedule_add':'schedule_remove', { session_id: id });
        applyFilters(true);
    }
    function renderMySchedule() { const list=document.getElementById('schedule-list'); if (!list) return; list.innerHTML=''; const items=[ ...myScheduleIds ].map(id => allSessions.find(s => s.id===id)).filter(Boolean).sort((a, b) => a.start-b.start); let prev=null; items.forEach(s => { if (prev!=null&&s.start-prev>=30) { const gap=el('div', 'schedule-item free-slot'); gap.appendChild(el('span', 'label', 'Open time:')); gap.appendChild(document.createTextNode(` ${fmtRange(prev, s.start)}`)); list.appendChild(gap); } const row=el('div', 'schedule-item'); const remove=el('button', 'remove', '×'); remove.addEventListener('click', () => { myScheduleIds.delete(s.id); saveSchedule(); renderMySchedule(); applyFilters(true); }); row.appendChild(remove); row.appendChild(el('div', 'title', s.title||'')); row.appendChild(el('div', 'time', fmtRange(s.start, s.end))); row.appendChild(el('div', 'loc', normLoc(s.location))); if (s.takeaway) { const tw=el('div', 'takeaway', s.takeaway); row.appendChild(tw); } list.appendChild(row); prev=s.end; }); }

    document.addEventListener('click', async e =>
    {
        const t=e.target; if (!(t instanceof HTMLElement)) return;
        if (t.id==='btn-copy-clipboard') {
            openExportModal();
        }
        if (t.id==='btn-clear-schedule') {
            if (!myScheduleIds.size) return;
            if (!confirm(`Clear your schedule (${myScheduleIds.size} items)?`)) return;
            const prevCount=myScheduleIds.size; myScheduleIds=new Set(); saveSchedule(); renderMySchedule(); applyFilters(true); track('schedule_clear', { previous_count: prevCount });
        }
        if (t.matches('[data-copy-export]')) {
            const type=t.getAttribute('data-copy-export');
            try {
                const { text, count }=buildExport(type);
                await navigator.clipboard.writeText(text);
                const prev=t.textContent; t.textContent='Copied!';
                track('schedule_copy', { variant: type, count });
                setTimeout(() => { t.textContent=prev||'Copy'; }, 1200);
            } catch (err) { console.error('copy failed', err); }
        }
        if (t.id==='export-close') closeExportModal();
        if (t.classList.contains('modal-backdrop')&&t.id==='export-modal') closeExportModal();
    });

    function scheduleItemsSorted()
    {
        return [ ...myScheduleIds ].map(id => allSessions.find(s => s.id===id)).filter(Boolean).sort((a, b) => a.start-b.start);
    }
    function buildExport(type)
    {
        const items=scheduleItemsSorted();
        const nowStr=new Date().toLocaleString();
        if (!items.length) return { text: 'No sessions selected.', count: 0 };
        const rows=items.map(s => ({
            start: s.start,
            end: s.end,
            range: fmtRange(s.start, s.end),
            dur: (s.end-s.start)+'m',
            room: normLoc(s.location),
            title: (s.title||'').replace(/\s+/g, ' ').trim(),
            takeaway: s.takeaway||''
        }));
        if (type==='table') {
            const w={
                range: Math.max('Time'.length, ...rows.map(r => r.range.length)),
                dur: Math.max('Dur'.length, ...rows.map(r => r.dur.length)),
                room: Math.max('Room'.length, ...rows.map(r => r.room.length))
            };
            const pad=(s, l) => s+' '.repeat(Math.max(0, l-s.length));
            const out=[ `My MongoDB.local NYC Schedule — generated ${nowStr}`, '', pad('Time', w.range)+'  '+pad('Dur', w.dur)+'  '+pad('Room', w.room)+'  Title', '-'.repeat(w.range)+'  '+'-'.repeat(w.dur)+'  '+'-'.repeat(w.room)+'  '+'-----' ];
            rows.forEach(r =>
            {
                out.push(pad(r.range, w.range)+'  '+pad(r.dur, w.dur)+'  '+pad(r.room, w.room)+'  '+r.title);
                if (r.takeaway) out.push(' '.repeat(w.range+w.dur+w.room+6)+'Takeaway: '+r.takeaway);
            });
            return { text: out.join('\n'), count: rows.length };
        }
        if (type==='bullets') {
            const out=[ `My MongoDB.local NYC Schedule — generated ${nowStr}`, '' ];
            rows.forEach(r =>
            {
                out.push(`• ${r.title} [${r.range}]`);
                out.push(`  • Time: ${r.range} (${r.dur})`);
                out.push(`  • Room: ${r.room}`);
                if (r.takeaway) out.push(`  • Takeaway: ${r.takeaway}`);
            });
            return { text: out.join('\n'), count: rows.length };
        }
        if (type==='opens') {
            // Determine open slots between 8:00 (480) and 18:00 (1080)
            const DAY_START=8*60, DAY_END=18*60;
            const occupied=rows.map(r => ({ start: r.start, end: r.end }));
            // Merge just in case
            occupied.sort((a, b) => a.start-b.start);
            const merged=[]; for (const o of occupied) { const last=merged[ merged.length-1 ]; if (!last||o.start>last.end) merged.push({ ...o }); else if (o.end>last.end) last.end=o.end; }
            const gaps=[]; let cur=DAY_START; merged.forEach(m => { if (m.start>cur) gaps.push({ start: cur, end: m.start }); cur=Math.max(cur, m.end); }); if (cur<DAY_END) gaps.push({ start: cur, end: DAY_END });
            const out=[ `Open times to meet (between 8:00 AM and 6:00 PM) — generated ${nowStr}`, '' ];
            if (!gaps.length) out.push('No free time blocks.'); else gaps.forEach(g => out.push(`• ${fmtRange(g.start, g.end)} (${g.end-g.start}m)`));
            return { text: out.join('\n'), count: gaps.length };
        }
        return { text: 'Unknown export type', count: 0 };
    }
    function ensureExportModal() { return document.getElementById('export-modal'); }
    function openExportModal()
    {
        const modal=ensureExportModal(); if (!modal) return; modal.innerHTML=''; modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false');
        const wrap=el('div', 'export-dialog');
        wrap.innerHTML=`<div class="export-header"><h3 id="export-modal-title">Share / Export Schedule</h3><button id="export-close" aria-label="Close export" class="close-btn">×</button></div>`;
        const formats=[ { key: 'table', label: 'Tabular agenda (Time / Dur / Room / Title + Takeaway)' }, { key: 'bullets', label: 'Bullet list (email friendly)' }, { key: 'opens', label: 'Open times to meet' } ];
        formats.forEach(f =>
        {
            const sec=el('section', 'export-section');
            const { text, count }=buildExport(f.key);
            const pre=el('pre', 'export-pre'); pre.textContent=text; pre.setAttribute('data-export-type', f.key);
            const h=el('h4', 'export-format-title', f.label+(f.key==='opens'? '':'')+(f.key!=='opens'? ` (${count} items)`:''));
            sec.appendChild(h); sec.appendChild(pre);
            const btn=el('button', 'export-copy-btn', 'Copy'); btn.type='button'; btn.setAttribute('data-copy-export', f.key); sec.appendChild(btn);
            wrap.appendChild(sec);
        });
        modal.appendChild(wrap);
        document.addEventListener('keydown', escCloseExport, { once: true });
    }
    function escCloseExport(e) { if (e.key==='Escape') closeExportModal(); }
    function closeExportModal() { const m=ensureExportModal(); if (!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); m.innerHTML=''; }

    // Speaker image preload (lazy)
    function preloadImages() { try { const set=new Set(); allSessions.forEach(s => (s.speakers||[]).forEach(sp => sp?.photoUrl&&set.add(sp.photoUrl))); set.forEach(src => { const img=new Image(); img.decoding='async'; img.loading='eager'; img.src=src; }); } catch { } }

    // ---------- Init ----------
    Promise.all([
        fetch('./sessions.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch('./categories.json', { cache: 'no-store' }).then(r => r.ok? r.json():{}).catch(() => ({}))
    ]).then(([ sessions, cats ]) =>
    {
        allSessions=normalizeSessions(sessions);
        categoriesData=cats;
        buildFilters();
        loadSchedule();
        applyFilters();
        if ('requestIdleCallback' in window) requestIdleCallback(preloadImages); else setTimeout(preloadImages, 0);
    }).catch(err => { console.error('Load failed', err); if (root) root.textContent='Failed to load schedule.'; });

    if (searchInput) searchInput.addEventListener('input', () => { applyFilters(); track('search', { query: (searchInput.value||'').trim() }); });
    // ---------- Author idle attention ----------
    (function setupAuthorAttention()
    {
        const author=document.getElementById('author-name');
        if (!author) return;
        // One-time split into per-letter spans for flicker wave effect
        if (!author.dataset.split) {
            const text=author.textContent||'';
            author.textContent='';
            // NOTE: Wrapping literal spaces in inline-block spans causes browsers to collapse them visually.
            // To preserve normal word spacing, we leave spaces as raw text nodes and only wrap non-space
            // characters (which participate in the flicker animation). Delays are computed over animated
            // letters only so the wave ignores spaces naturally.
            let letterIdx=0;
            for (const ch of text) {
                if (ch===' ') { // preserve real space
                    author.appendChild(document.createTextNode(' '));
                    continue;
                }
                const span=document.createElement('span');
                span.className='letter';
                span.textContent=ch;
                const delay=letterIdx*40+Math.random()*25; // ms
                span.style.setProperty('--d', delay+'ms');
                author.appendChild(span);
                letterIdx++;
            }
            author.dataset.split='1';
        }
        let inactivityTimer=null; // fires after 30s
        let cycleTimeout=null; // manages rest between two flicker waves
        let playing=false;
        let cyclesRun=0; // run at most 2 flicker waves per inactivity period

        function clearCycle() { if (cycleTimeout) { clearTimeout(cycleTimeout); cycleTimeout=null; } }
        function stopEffect() { author.classList.remove('author-attn', 'cycle2'); playing=false; }
        function runFlicker(pass)
        {
            playing=true;
            const cls=pass===2? 'cycle2':'';
            if (pass===1) { author.classList.add('author-attn'); }
            else { author.classList.add('cycle2'); }
            // Each letter animation is < ~500ms; remove classes shortly after all finish
            const maxDelay=[ ...author.querySelectorAll('.letter') ].reduce((m, el) =>
            {
                const d=parseFloat(el.style.getPropertyValue('--d'))||0; return Math.max(m, d);
            }, 0);
            const duration=pass===1? 420:360;
            setTimeout(() =>
            {
                if (pass===1) { author.classList.remove('author-attn'); }
                else { author.classList.remove('cycle2'); playing=false; }
            }, maxDelay+duration+60); // buffer
        }
        function startEffectWindow() { runFlicker(1); }
        function scheduleNextCycle()
        {
            if (cyclesRun>=2) return; // only two cycles
            startEffectWindow();
            cyclesRun++;
            if (cyclesRun<2) {
                // queue second flicker after short rest (e.g., 6s) so it feels random
                cycleTimeout=setTimeout(() => { runFlicker(2); }, 6000);
            }
        }
        function onInactivity() { cyclesRun=0; scheduleNextCycle(); }

        function resetInactivity()
        {
            stopEffect(); clearCycle(); if (inactivityTimer) clearTimeout(inactivityTimer);
            inactivityTimer=setTimeout(onInactivity, 30000); // 30s idle
        }

        [ 'mousemove', 'keydown', 'scroll', 'click', 'touchstart', 'wheel' ].forEach(evt =>
        {
            window.addEventListener(evt, resetInactivity, { passive: true });
        });
        resetInactivity(); // initialize
        // Observe class changes to infer flicker start/end for analytics
        const mo=new MutationObserver(muts => { for (const m of muts) { if (m.attributeName==='class') { const cls=author.className; if (cls.includes('author-attn')) { track('author_flicker', { phase: cls.includes('cycle2')? 'second_pass_start':'start' }); } else { track('author_flicker', { phase: 'end' }); } } } });
        mo.observe(author, { attributes: true });
    })();
    // Scroll depth tracking (25/50/75/100%)
    (function trackScrollDepth() { const el=() => document.querySelector('.schedule-scroll'); const marks=new Set(); function handler() { const c=el(); if (!c) return; const ratio=c.scrollTop/(c.scrollHeight-c.clientHeight||1); const pct=Math.round(ratio*100);[ 25, 50, 75, 100 ].forEach(m => { if (pct>=m&&!marks.has(m)) { marks.add(m); track('scroll_depth', { percent: m }); } }); } const sc=el(); if (sc) { sc.addEventListener('scroll', handler, { passive: true }); handler(); } })();
    // Fire a page_ready event after content likely loaded
    setTimeout(() => { track('page_ready', { sessions: allSessions.length }); }, 3000);
});

