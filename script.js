(function ()
{
    document.addEventListener('DOMContentLoaded', function ()
    {
        const root=document.getElementById('sessions-root');
        const modal=createModalShell();

        function fetchSessions()
        {
            return fetch('./sessions.json', { cache: 'no-store' }).then(r =>
            {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            });
        }

        function el(tag, cls, text)
        {
            const n=document.createElement(tag);
            if (cls) n.className=cls;
            if (text!=null) n.textContent=text;
            return n;
        }

        function parseTimeToMinutes(s)
        {
            if (!s) return null;
            s=String(s).trim();
            const m=s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
            if (!m) return null;
            let h=parseInt(m[ 1 ], 10);
            const min=parseInt(m[ 2 ]||'0', 10);
            const ap=m[ 3 ].toUpperCase();
            if (ap==='AM') { if (h===12) h=0; }
            else { if (h!==12) h+=12; }
            return h*60+min;
        }

        function parseRangeToMinutes(rangeStr)
        {
            if (!rangeStr) return null;
            const [ startStr, endStr ]=rangeStr.split('-').map(s => s.trim());
            const start=parseTimeToMinutes(startStr);
            const end=parseTimeToMinutes(endStr);
            if (start==null||end==null) return null;
            return { start, end };
        }

        function formatMinutesToLabel(total)
        {
            const h24=Math.floor(total/60);
            const m=total%60;
            const ap=h24>=12? 'PM':'AM';
            let h=h24%12; if (h===0) h=12;
            return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
        }

        function normalizeSessions(raw)
        {
            return raw.map((s, i) =>
            {
                const range=parseRangeToMinutes(s.time);
                return Object.assign({ id: i }, s, range||{});
            }).filter(s => s.start!=null&&s.end!=null);
        }

        function groupIntoOverlapBlocks(items)
        {
            const sorted=[ ...items ].sort((a, b) => a.start-b.start||a.end-b.end);
            const blocks=[];
            let current=[];
            let currentEnd=-1;
            for (const it of sorted) {
                if (current.length===0||it.start<currentEnd) {
                    current.push(it);
                    currentEnd=Math.max(currentEnd, it.end);
                } else {
                    blocks.push(current);
                    current=[ it ];
                    currentEnd=it.end;
                }
            }
            if (current.length) blocks.push(current);
            return blocks;
        }

        function assignLanes(block)
        {
            // Greedy lane assignment
            const lanes=[];
            const byStart=[ ...block ].sort((a, b) => a.start-b.start||a.end-b.end);
            for (const item of byStart) {
                let placed=false;
                for (let i=0; i<lanes.length; i++) {
                    const last=lanes[ i ][ lanes[ i ].length-1 ];
                    if (item.start>=last.end) {
                        lanes[ i ].push(item);
                        placed=true;
                        break;
                    }
                }
                if (!placed) lanes.push([ item ]);
            }
            return lanes;
        }

        function renderSessionCard(session)
        {
            const card=el('div', 'session-card');
            card.appendChild(el('h3', 'session-title', session.title||''));
            if (session.time) card.appendChild(el('div', 'session-meta', session.time));
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            function onOpen() { openSessionModal(session); }
            card.addEventListener('click', onOpen);
            card.addEventListener('keydown', ev => { if (ev.key==='Enter'||ev.key===' ') { ev.preventDefault(); onOpen(); } });
            return card;
        }

        function buildSpeakerRow(s)
        {
            const row=el('div', 'speaker');
            const avatar=el('div', 'speaker-avatar');
            const initials=(s?.name||'').split(/\s+/).map(p => p[ 0 ]).slice(0, 2).join('').toUpperCase();
            if (s&&s.photoUrl) {
                const img=new Image();
                img.loading='lazy';
                img.alt=s.name||'';
                img.src=s.photoUrl;
                avatar.appendChild(img);
            } else {
                avatar.textContent=initials||'?';
            }
            const info=el('div', 'speaker-info');
            info.appendChild(el('div', 'name', s?.name||''));
            if (s?.title) info.appendChild(el('div', 'title', s.title));
            if (s?.company) info.appendChild(el('div', 'company', s.company));
            row.appendChild(avatar);
            row.appendChild(info);
            return row;
        }

        function createModalShell()
        {
            let shell=document.getElementById('session-modal');
            if (!shell) {
                shell=el('div', 'modal-backdrop');
                shell.id='session-modal';
                document.body.appendChild(shell);
            }
            shell.innerHTML='';
            const dialog=el('div', 'Dialog__dragContainer___tcUgB');
            const header=el('div', 'DialogHeader__dialogHeader___66ff');
            const hWrap=el('div', 'SessionDetailDialog__title___47b2');
            const titleEl=el('h3', 'AgendaV2Styles__sessionModalName___72ac');
            titleEl.id='session-modal-title';
            const closeBtn=el('button', 'SessionDetailDialog__closeDialog___47b2');
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.textContent='×';
            closeBtn.addEventListener('click', closeSessionModal);
            hWrap.appendChild(titleEl);
            hWrap.appendChild(closeBtn);
            header.appendChild(hWrap);
            const contentWrap=el('div', 'Dialog__content___IGTri');
            const focusWrap=el('div', 'SessionDetailDialog__dialogDefaultFocus___47b2');
            const dateLoc=el('div', 'AgendaV2Styles__sessionModalDateTimeContainer___72ac');
            const level=el('div', 'AgendaV2Styles__sessionModalCategoryContainer___72ac');
            const loc=el('div', 'AgendaV2Styles__sessionModalLocationAndCodeContainer___72ac');
            const desc=el('div', 'AgendaV2Styles__sessionModalDescription___72ac');
            const speakers=el('div', 'AgendaV2Styles__sessionModalSpeakersWrapper___72ac speakers-grid');
            focusWrap.appendChild(dateLoc);
            focusWrap.appendChild(level);
            focusWrap.appendChild(loc);
            focusWrap.appendChild(desc);
            focusWrap.appendChild(speakers);
            contentWrap.appendChild(focusWrap);
            dialog.appendChild(header);
            dialog.appendChild(contentWrap);
            shell.appendChild(dialog);
            return shell;
        }

        function openSessionModal(session)
        {
            const shell=document.getElementById('session-modal')||createModalShell();
            shell.classList.add('open');
            const titleEl=shell.querySelector('#session-modal-title');
            const dateLoc=shell.querySelector('.AgendaV2Styles__sessionModalDateTimeContainer___72ac');
            const level=shell.querySelector('.AgendaV2Styles__sessionModalCategoryContainer___72ac');
            const loc=shell.querySelector('.AgendaV2Styles__sessionModalLocationAndCodeContainer___72ac');
            const desc=shell.querySelector('.AgendaV2Styles__sessionModalDescription___72ac');
            const speakers=shell.querySelector('.AgendaV2Styles__sessionModalSpeakersWrapper___72ac');
            titleEl.textContent=session.title||'';
            dateLoc.textContent=session.time||'';
            level.textContent=session.level||'';
            loc.textContent=session.location||'';
            desc.textContent=session.description||'';
            speakers.innerHTML='';
            (session.speakers||[]).forEach(s => speakers.appendChild(buildSpeakerRow(s)));
            function onEsc(e) { if (e.key==='Escape') closeSessionModal(); }
            document.addEventListener('keydown', onEsc, { once: true });
            shell.addEventListener('click', (e) => { if (e.target===shell) closeSessionModal(); }, { once: true });
        }

        function closeSessionModal()
        {
            const shell=document.getElementById('session-modal');
            if (shell) shell.classList.remove('open');
        }

        function renderTimeBlocks(sessions)
        {
            root.innerHTML='';
            const blocks=groupIntoOverlapBlocks(sessions);
            blocks.forEach(block =>
            {
                const lanes=assignLanes(block);
                const wrap=el('section', 'time-block');
                const title=el('div', 'block-title', `${formatMinutesToLabel(Math.min(...block.map(s => s.start)))} - ${formatMinutesToLabel(Math.max(...block.map(s => s.end)))}`);
                const grid=el('div', 'block-grid');
                grid.style.gridTemplateColumns=`repeat(${lanes.length}, 1fr)`;
                lanes.forEach(col =>
                {
                    const c=el('div', 'block-col');
                    col.forEach(sess => c.appendChild(renderSessionCard(sess)));
                    grid.appendChild(c);
                });
                wrap.appendChild(title);
                wrap.appendChild(grid);
                root.appendChild(wrap);
            });
        }

        fetchSessions()
            .then(raw => normalizeSessions(raw))
            .then(list => renderTimeBlocks(list))
            .catch(err =>
            {
                console.error('Failed to load sessions.json', err);
                if (root) root.textContent='Failed to load schedule.';
            });
    });
})();
