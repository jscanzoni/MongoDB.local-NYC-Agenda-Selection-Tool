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
        card.addEventListener('click', () => openModal(s));
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
        const scroller=el('div', 'schedule-scroll'); const grid=el('div', 'schedule-grid');
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
        scroller.appendChild(grid); wrap.appendChild(timeRail); wrap.appendChild(scroller); root.appendChild(wrap); syncRail(scroller, railInner); adjustHead(head, grid);
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
    function adjustHead(head, grid) { requestAnimationFrame(() => { const h=grid.querySelector('.loc-head')?.getBoundingClientRect().height||40; head.style.height=`${h}px`; }); }

    // ---------- Filters ----------
    function buildFilters() { if (!categoriesData||!filtersContainer) return; filtersContainer.innerHTML=''; const title=el('h3', 'filters-title', 'Filters'); filtersContainer.appendChild(title); const wrap=el('div', 'filters-content'); filtersContainer.appendChild(wrap); const known=new Set(); Object.values(categoriesData).forEach(arr => arr.forEach(t => known.add(t))); const used=new Set(); allSessions.forEach(s => (s.tags||[]).forEach(t => used.add(t))); const misc=[ ...used ].filter(t => !known.has(t)); const cats=[ ...Object.entries(categoriesData).map(([ n, t ]) => ({ name: n, tags: t })), ...(misc.length? [ { name: 'Misc', tags: misc } ]:[]) ]; cats.forEach(cat => { const sec=el('section', 'filter-category'); sec.appendChild(el('h4', 'filter-cat-title', cat.name)); const list=el('div', 'filter-tags'); cat.tags.forEach(tag => { const row=el('label', 'filter-tag'); const cb=document.createElement('input'); cb.type='checkbox'; cb.value=tag; cb.checked=selectedTags.has(tag); cb.addEventListener('change', () => { if (cb.checked) selectedTags.add(tag); else selectedTags.delete(tag); applyFilters(); }); row.appendChild(cb); row.appendChild(el('span', 'tag-label', tag)); list.appendChild(row); }); sec.appendChild(list); wrap.appendChild(sec); }); updateFiltersTitle(); }
    function updateFiltersTitle() { const t=filtersContainer?.querySelector('.filters-title'); if (t) { const c=selectedTags.size; t.textContent=c? `Filters (${c})`:'Filters'; } }
    function applyFilters() { const q=(searchInput?.value||'').toLowerCase().trim(); let list=allSessions; if (selectedTags.size) list=list.filter(s => (s.tags||[]).some(t => selectedTags.has(t))); if (q) { list=list.filter(s => (s.title||'').toLowerCase().includes(q)||(s.description||'').toLowerCase().includes(q)||(s.location||'').toLowerCase().includes(q)||(s.speakers||[]).some(sp => (sp.name||'').toLowerCase().includes(q))); } render(list); updateFiltersTitle(); }

    // ---------- Personal schedule ----------
    function loadSchedule() { try { myScheduleIds=new Set(JSON.parse(localStorage.getItem('myScheduleIds')||'[]')); } catch { } renderMySchedule(); }
    function saveSchedule() { localStorage.setItem('myScheduleIds', JSON.stringify([ ...myScheduleIds ])); }
    function toggleSchedule(id) { if (myScheduleIds.has(id)) myScheduleIds.delete(id); else myScheduleIds.add(id); saveSchedule(); renderMySchedule(); applyFilters(); }
    // Faster in-place toggle avoiding full scroll jump; still re-renders list quietly
    function fastToggleSchedule(id, card, btn)
    {
        const scroller=document.querySelector('.schedule-scroll');
        const scrollLeft=scroller? scroller.scrollLeft:0;
        const scrollTop=scroller? scroller.scrollTop:0;
        if (myScheduleIds.has(id)) myScheduleIds.delete(id); else myScheduleIds.add(id);
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
        renderMySchedule();
        // Re-filter without rebuilding scroll container (skip full render)
        applyFilters();
        // Restore scroll
        if (scroller) { scroller.scrollLeft=scrollLeft; scroller.scrollTop=scrollTop; }
    }
    function renderMySchedule() { const list=document.getElementById('schedule-list'); if (!list) return; list.innerHTML=''; const items=[ ...myScheduleIds ].map(id => allSessions.find(s => s.id===id)).filter(Boolean).sort((a, b) => a.start-b.start); let prev=null; items.forEach(s => { if (prev!=null&&s.start-prev>=30) { const gap=el('div', 'schedule-item free-slot'); gap.appendChild(el('span', 'label', 'Open time:')); gap.appendChild(document.createTextNode(` ${fmtRange(prev, s.start)}`)); list.appendChild(gap); } const row=el('div', 'schedule-item'); const remove=el('button', 'remove', '×'); remove.addEventListener('click', () => { myScheduleIds.delete(s.id); saveSchedule(); renderMySchedule(); applyFilters(); }); row.appendChild(remove); row.appendChild(el('div', 'title', s.title||'')); row.appendChild(el('div', 'time', fmtRange(s.start, s.end))); row.appendChild(el('div', 'loc', normLoc(s.location))); list.appendChild(row); prev=s.end; }); }

    document.addEventListener('click', async e => { const t=e.target; if (!(t instanceof HTMLElement)) return; if (t.id==='btn-copy-clipboard') { try { const items=[ ...myScheduleIds ].map(id => allSessions.find(s => s.id===id)).filter(Boolean).sort((a, b) => a.start-b.start); const text=items.map(s => `${fmtRange(s.start, s.end)} | ${normLoc(s.location)}\n${s.title}`).join('\n\n'); await navigator.clipboard.writeText(text); t.textContent='Copied!'; setTimeout(() => t.textContent='Copy to Clipboard', 1200); } catch (err) { console.error('copy failed', err); } } if (t.id==='btn-clear-schedule') { if (!myScheduleIds.size) return; if (!confirm(`Clear your schedule (${myScheduleIds.size} items)?`)) return; myScheduleIds=new Set(); saveSchedule(); renderMySchedule(); applyFilters(); } });

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

    if (searchInput) searchInput.addEventListener('input', () => applyFilters());
});

