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
    // Global persistence helper for bullet export field preferences
    function persistBulletPrefs() { try { if (window.__bulletFieldsSelected) localStorage.setItem('bulletFieldPrefs', JSON.stringify(window.__bulletFieldsSelected)); } catch { } }
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
        // Tag card with session id for quick lookup from My Schedule list
        card.dataset.sid=s.id;
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
    function buildSpeaker(sp)
    {
        const r=el('div', 'speaker');
        const av=el('div', 'speaker-avatar');
        if (sp&&sp.photoUrl) { const img=new Image(); img.loading='lazy'; img.src=sp.photoUrl; img.alt=sp.name||''; av.appendChild(img); }
        else { const ini=(sp?.name||'?').split(/\s+/).map(p => p[ 0 ]).slice(0, 2).join('').toUpperCase(); av.textContent=ini; }
        const info=el('div', 'speaker-info');
        info.appendChild(el('div', 'name', sp?.name||''));
        if (sp?.title) info.appendChild(el('div', 'title', sp.title));
        if (sp?.company) info.appendChild(el('div', 'company', sp.company));
        r.appendChild(av); r.appendChild(info); return r;
    }
    // ---------- Main agenda render ----------
    function render(list)
    {
        root.innerHTML=''; if (!list.length) { root.textContent='No sessions match the current filters.'; return; }
        const locations=[ ...new Set(list.map(s => normLoc(s.location))) ]; if (locations.includes(MISSING_LOC)) { locations.splice(locations.indexOf(MISSING_LOC), 1); locations.push(MISSING_LOC); }
        const perLoc=new Map(); locations.forEach(l => perLoc.set(l, list.filter(s => normLoc(s.location)===l)));
        const locMeta=locations.map(loc => { const sessions=perLoc.get(loc)||[]; const laneCount=assignLanes(sessions); return { loc, laneCount }; });
        // Include scheduled sessions (even if filtered out) so occupancy column & background bands remain stable
        const scheduledAll=[ ...myScheduleIds ].map(id => allSessions.find(s => s.id===id)).filter(Boolean);
        const timelineBaseMap=new Map();
        const timelineList=[];
        [ ...list, ...scheduledAll ].forEach(s => { if (!timelineBaseMap.has(s.id)) { timelineBaseMap.set(s.id, 1); timelineList.push(s); } });
        const timeline=buildTimeline(timelineList);
        const slots=timeline.slots;
        const map=new Map();
        const rowDescriptors=[]; let nextRow=2; const GAP_ROW_H=14;
        slots.forEach((t, idx) => { if (idx>0) { rowDescriptors.push({ type: 'gap' }); nextRow++; } rowDescriptors.push({ type: 'slot', time: t }); map.set(t, nextRow); nextRow++; });
        const totalRows=nextRow-1;
        const wrap=el('div', 'schedule-wrap');
        const timeRail=el('div', 'time-rail'); const head=el('div', 'time-rail-head sched-head'); timeRail.appendChild(head); const railInner=el('div', 'time-rail-inner'); timeRail.appendChild(railInner);
        const scroller=el('div', 'schedule-scroll');
        const railFrag=document.createDocumentFragment(); const firstSlot=slots[ 0 ];
        rowDescriptors.forEach(desc => { if (desc.type==='gap') railFrag.appendChild(el('div', 'time-gap-cell', '')); else { if (desc.time===firstSlot) railFrag.appendChild(el('div', 'sched-time minor', '')); else { const lbl=fmtTimeLabel(desc.time); railFrag.appendChild(el('div', lbl? 'sched-time':'sched-time minor', lbl)); } } });
        railInner.appendChild(railFrag);
        const grid=el('div', 'schedule-grid');
        const locStart=new Map(); grid.appendChild(place(el('div', 'occ-head', ''), 1, 1, 1, 1));
        let curCol=2; locMeta.forEach(meta => { locStart.set(meta.loc, curCol); const headCell=el('div', 'loc-head', meta.loc); grid.appendChild(place(headCell, curCol, 1, meta.laneCount, 1)); curCol+=meta.laneCount; });
        const totalCols=curCol-1; grid.style.gridTemplateColumns=`var(--occ-col-w,12px) repeat(${totalCols-1}, minmax(var(--lane-w, 300px), 1fr))`;
        for (let c=3; c<=totalCols; c++) grid.appendChild(place(el('div', 'col-sep'), c, 2, 1, totalRows-1));
        // Background bands for scheduled sessions
        (function addScheduledBackgrounds() { const ranges=[]; scheduledAll.forEach(s => { const startRow=map.get(Math.floor(s.start/STEP)*STEP); if (!startRow) return; const slotCount=Math.max(1, Math.ceil((s.end-s.start)/STEP)); const rowSpan=slotCount===1? 1:slotCount*2-1; ranges.push({ start: startRow, end: startRow+rowSpan }); }); ranges.sort((a, b) => a.start-b.start); const merged=[]; for (const r of ranges) { const last=merged[ merged.length-1 ]; if (!last||r.start>last.end) merged.push({ ...r }); else if (r.end>last.end) last.end=r.end; } merged.forEach(r => { const bg=el('div', 'saved-bg'); place(bg, 1, r.start, totalCols, r.end-r.start); grid.appendChild(bg); }); })();
        // Place visible sessions
        list.forEach(s => { const base=locStart.get(normLoc(s.location)); const laneIdx=s.__lane||0; const startRow=map.get(Math.floor(s.start/STEP)*STEP); if (!startRow) return; const slotCount=Math.max(1, Math.ceil((s.end-s.start)/STEP)); const rowSpan=slotCount===1? 1:slotCount*2-1; const card=renderSessionCard(s); if (slotCount===1) card.classList.add('span-one'); grid.appendChild(place(card, base+laneIdx, startRow, 1, rowSpan)); });
        scroller.appendChild(grid); wrap.appendChild(timeRail); wrap.appendChild(scroller); root.appendChild(wrap); syncRail(scroller, railInner); adjustHead(head, grid, scroller);
        timeRail.addEventListener('wheel', e => { if (!e.deltaY) return; scroller.scrollTop+=e.deltaY; e.preventDefault(); }, { passive: false });
        const rowSizes=[ 'auto' ]; rowDescriptors.forEach(desc => rowSizes.push(desc.type==='gap'? GAP_ROW_H+'px':'var(--slot-h)')); grid.style.gridTemplateRows=rowSizes.join(' '); railInner.style.gridTemplateRows=rowSizes.slice(1).join(' ');
        scheduledAll.forEach(s => { const startRow=map.get(Math.floor(s.start/STEP)*STEP); if (!startRow) return; const slotCount=Math.max(1, Math.ceil((s.end-s.start)/STEP)); const rowSpan=slotCount===1? 1:slotCount*2-1; const block=el('div', 'occ-block'); block.title=(s.title||'')+' '+fmtRange(s.start, s.end); grid.appendChild(place(block, 1, startRow, 1, rowSpan)); });
    }
    function place(node, col, row, colSpan=1, rowSpan=1) { node.style.gridColumn=`${col} / ${col+colSpan}`; node.style.gridRow=`${row} / ${row+rowSpan}`; return node; }
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
        // Preserve scroll via applyFilters(true)
        const adding=!myScheduleIds.has(id);
        if (adding) myScheduleIds.add(id); else myScheduleIds.delete(id);
        saveSchedule();
        track(adding? 'schedule_add':'schedule_remove', { session_id: id });
        const selected=myScheduleIds.has(id);
        card.classList.toggle('selected', selected);
        btn.classList.toggle('saved', selected);
        btn.textContent=selected? '✓':'+';
        btn.setAttribute('aria-label', (selected? 'Remove from':'Add to')+` My Schedule: ${(card.querySelector('.session-title')||{}).textContent||''}`);
        // Update side list & re-render filtered schedule (for occupancy rail) with scroll preservation
        renderMySchedule();
        applyFilters(true);
    }

    // Render the "My Schedule" side list
    function renderMySchedule()
    {
        const listEl=document.getElementById('schedule-list');
        const freeEl=document.getElementById('free-slots');
        if (!listEl) return;
        const items=scheduleItemsSorted();
        listEl.innerHTML='';
        if (!items.length) {
            listEl.textContent='No sessions saved yet.';
            if (freeEl) freeEl.innerHTML='';
            return;
        }
        // Build gaps inline and merge with sessions chronologically
        const DAY_START=8*60, DAY_END=18*60;
        const occ=items.map(s => ({ start: s.start, end: s.end, s })).sort((a, b) => a.start-b.start);
        // Merge overlapping (shouldn't usually overlap but safeguard)
        const merged=[]; for (const o of occ) { const last=merged[ merged.length-1 ]; if (!last||o.start>last.end) merged.push({ start: o.start, end: o.end }); else if (o.end>last.end) last.end=o.end; }
        const gaps=[]; let cur=DAY_START; merged.forEach(m => { if (m.start>cur) gaps.push({ start: cur, end: m.start }); cur=Math.max(cur, m.end); }); if (cur<DAY_END) gaps.push({ start: cur, end: DAY_END });
        const combined=[ ...items.map(s => ({ type: 'session', start: s.start, end: s.end, s })), ...gaps.map(g => ({ type: 'gap', start: g.start, end: g.end })) ].sort((a, b) => a.start-b.start);
        combined.forEach(entry =>
        {
            if (entry.type==='session') {
                const s=entry.s;
                const row=el('div', 'schedule-item');
                row.setAttribute('data-sid', s.id);
                row.appendChild(el('div', 'time', fmtRange(s.start, s.end)));
                row.appendChild(el('div', 'loc', normLoc(s.location)));
                row.appendChild(el('div', 'title', (s.title||'').replace(/\s+/g, ' ').trim()));
                if (s.takeaway) row.appendChild(el('div', 'takeaway', 'Takeaway: '+s.takeaway));
                row.tabIndex=0;
                row.addEventListener('click', () =>
                {
                    const target=document.querySelector(`.sched-session[data-sid="${s.id}"]`);
                    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('pulse'); setTimeout(() => target.classList.remove('pulse'), 1200); }
                });
                listEl.appendChild(row);
            } else {
                const g=entry; const fs=el('div', 'free-slot'); fs.innerHTML=`<span class="label">Open</span> ${fmtRange(g.start, g.end)} (${g.end-g.start}m)`; listEl.appendChild(fs);
            }
        });
        if (freeEl) freeEl.innerHTML=''; // legacy container cleared
    }
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
        if (t.id==='export-close') closeExportModal('button');
        if (t.classList.contains('modal-backdrop')&&t.id==='export-modal') closeExportModal('backdrop');
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
        // Dynamically derive available keys from first session for bullet export field selection
        function scanKeys(obj, prefix='', acc=new Set(), depth=0)
        {
            if (!obj||typeof obj!=='object'||Array.isArray(obj)) return acc; if (depth>3) return acc; // limit depth
            Object.keys(obj).forEach(k =>
            {
                if (k.startsWith('__')) return; // internal
                const val=obj[ k ];
                const full=prefix? prefix+'.'+k:k;
                if (val&&typeof val==='object'&&!Array.isArray(val)) {
                    scanKeys(val, full, acc, depth+1);
                } else {
                    acc.add(full);
                }
            });
            return acc;
        }
        if (!window.__dynamicBulletKeyList) {
            const first=items[ 0 ];
            window.__dynamicBulletKeyList=[ ...scanKeys(first) ].sort();
        }
        const rows=items.map(s => ({
            start: s.start,
            end: s.end,
            range: fmtRange(s.start, s.end),
            dur: (s.end-s.start)+'m',
            room: normLoc(s.location),
            title: (s.title||'').replace(/\s+/g, ' ').trim(),
            takeaway: s.takeaway||''
        }));
        // Bullet field selection persistence (localStorage)
        if (!window.__bulletFieldsSelected) {
            try { const stored=JSON.parse(localStorage.getItem('bulletFieldPrefs')||'null'); if (stored&&typeof stored==='object') window.__bulletFieldsSelected=stored; } catch { }
        }
        if (!window.__bulletFieldsSelected) {
            window.__bulletFieldsSelected={ time: true, duration: true, room: true, takeaway: true, description: false, level: false, speakers: false, tags: false };
            persistBulletPrefs();
        }
        const bulletFields=window.__bulletFieldsSelected;
        if (type==='table') {
            const w={
                range: Math.max('Time'.length, ...rows.map(r => r.range.length)),
                dur: Math.max('Dur'.length, ...rows.map(r => r.dur.length)),
                room: Math.max('Room'.length, ...rows.map(r => r.room.length))
            };
            const pad=(s, l) => s+' '.repeat(Math.max(0, l-s.length));
            const headerTitle=`Personalized MongoDB.local NYC Schedule - September 17,  2025`;
            const out=[ headerTitle, '', pad('Time', w.range)+'  '+pad('Dur', w.dur)+'  '+pad('Room', w.room)+'  Title', '-'.repeat(w.range)+'  '+'-'.repeat(w.dur)+'  '+'-'.repeat(w.room)+'  '+'-----' ];
            rows.forEach(r =>
            {
                out.push(pad(r.range, w.range)+'  '+pad(r.dur, w.dur)+'  '+pad(r.room, w.room)+'  '+r.title);
                if (r.takeaway) out.push(' '.repeat(w.range+w.dur+w.room+6)+'Takeaway: '+r.takeaway);
            });
            return { text: out.join('\n'), count: rows.length };
        }
        if (type==='bullets') {
            const headerTitle=`Personalized MongoDB.local NYC Schedule - September 17,  2025`;
            const out=[ headerTitle, '' ];
            const titleCase=k => k.split(/[^A-Za-z0-9]+/).filter(Boolean).map(p => p.charAt(0).toUpperCase()+p.slice(1)).join(' ');
            items.forEach(s =>
            {
                const cleanTitle=(s.title||'').replace(/\s+/g, ' ').trim();
                const range=fmtRange(s.start, s.end);
                const dur=(s.end-s.start)+"m";
                const room=normLoc(s.location);
                out.push(`• ${cleanTitle}`);
                if (bulletFields.time) out.push(`  • Time: ${range}`);
                if (bulletFields.duration) out.push(`  • Duration: ${dur}`);
                if (bulletFields.room) out.push(`  • Room: ${room}`);
                if (bulletFields.level&&s.level) out.push(`  • Level: ${s.level}`);
                if (bulletFields.takeaway&&s.takeaway) out.push(`  • Takeaway: ${s.takeaway}`);
                if (bulletFields.description&&s.description) {
                    const desc=(s.description||'').replace(/\s+/g, ' ').trim(); if (desc) out.push(`  • Description: ${desc}`);
                }
                // dynamic primitive fields
                Object.keys(s||{}).forEach(k =>
                {
                    if ([ 'id', 'start', 'end', 'title', 'time', 'location', 'tags', 'takeaway', 'speakers', 'description', 'level' ].includes(k)) return;
                    if ([ 'id', 'start', 'end', 'title', 'time', 'location', 'tags', 'takeaway', 'speakers' ].includes(k)) return;
                    if (!bulletFields[ k ]) return;
                    const v=s[ k ];
                    if ([ 'string', 'number', 'boolean' ].includes(typeof v)) out.push(`  • ${titleCase(k)}: ${v}`);
                });
                // Tags single bullet alphabetical (conditional)
                if (bulletFields.tags&&Array.isArray(s.tags)&&s.tags.length) {
                    const tags=[ ...s.tags ].map(t => t.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
                    if (tags.length) out.push(`  • Tags: ${tags.join(', ')}`);
                }
                // Speakers sub bullets (conditional)
                if (bulletFields.speakers&&Array.isArray(s.speakers)&&s.speakers.length) {
                    out.push('  • Speakers:');
                    s.speakers.forEach(sp =>
                    {
                        if (!sp) return; const name=sp.name||''; const roleParts=[]; if (sp.title) roleParts.push(sp.title); if (sp.company) roleParts.push(sp.company); const role=roleParts.join(', ');
                        out.push(`    • ${name}${role? ' – '+role:''}`);
                    });
                }
            });
            return { text: out.join('\n'), count: items.length };
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
            if (f.key==='bullets') {
                const actions=el('div', 'export-actions');
                const toggle=el('button', 'export-fields-btn', 'Select Fields'); toggle.type='button'; actions.appendChild(toggle);
                const btn=el('button', 'export-copy-btn', 'Copy'); btn.type='button'; btn.setAttribute('data-copy-export', f.key); actions.appendChild(btn);
                sec.appendChild(actions);
                const panel=el('div', 'export-field-options');
                // Fixed list of selectable fields requested
                const fieldDefs=[
                    { k: 'time', label: 'Time' },
                    { k: 'duration', label: 'Duration' },
                    { k: 'room', label: 'Room' },
                    { k: 'takeaway', label: 'Takeaway' },
                    { k: 'description', label: 'Description' },
                    { k: 'level', label: 'Level' },
                    { k: 'speakers', label: 'Speakers' },
                    { k: 'tags', label: 'Tags' }
                ];
                const bf=window.__bulletFieldsSelected;
                fieldDefs.forEach(fd =>
                {
                    const lab=el('label');
                    lab.innerHTML=`<input type="checkbox" data-bullet-field="${fd.k}" ${bf[ fd.k ]? 'checked':''}> <span>${fd.label}</span>`;
                    panel.appendChild(lab);
                });
                toggle.addEventListener('click', () => { panel.classList.toggle('open'); });
                panel.addEventListener('change', e =>
                {
                    const inp=e.target; if (!(inp instanceof HTMLInputElement)) return; const key=inp.getAttribute('data-bullet-field'); if (!key) return; window.__bulletFieldsSelected[ key ]=inp.checked; persistBulletPrefs();
                    try { const rebuilt=buildExport('bullets'); pre.textContent=rebuilt.text; } catch (err) { console.warn('preview rebuild failed', err); }
                    track('schedule_export_fields_change', { field: key, enabled: inp.checked? 1:0 });
                });
                sec.appendChild(panel);
            } else {
                const actions=el('div', 'export-actions');
                const btn=el('button', 'export-copy-btn', 'Copy'); btn.type='button'; btn.setAttribute('data-copy-export', f.key); actions.appendChild(btn);
                sec.appendChild(actions);
            }
            wrap.appendChild(sec);
        });
        modal.appendChild(wrap);
        document.addEventListener('keydown', escCloseExport, { once: true });
        // Analytics: export modal opened
        try { track('schedule_export_open', { items: scheduleItemsSorted().length }); } catch { }
    }
    function escCloseExport(e) { if (e.key==='Escape') closeExportModal(); }
    function closeExportModal(method='unknown') { const m=ensureExportModal(); if (!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); m.innerHTML=''; try { track('schedule_export_close', { method }); } catch { } }

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

