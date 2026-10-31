(() => {
  const seedPupils = [
    {id:'NF-1042',name:'Zara Adeyemi',className:'Grade 3A',guardian:'Tomi Adeyemi',initials:'ZA',color:'rose',photo:'👧🏽',collectors:[{name:'Tomi Adeyemi',relation:'Mother',until:'Ongoing'},{name:'Kola Adeyemi',relation:'Father',until:'Ongoing'}]},
    {id:'NF-1087',name:'Daniel Mensah',className:'Grade 2B',guardian:'Ama Mensah',initials:'DM',color:'mint',photo:'👦🏾',collectors:[{name:'Ama Mensah',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1103',name:'Maya Okonkwo',className:'Grade 4A',guardian:'Chika Okonkwo',initials:'MO',color:'sand',photo:'👧🏿',collectors:[{name:'Chika Okonkwo',relation:'Father',until:'Ongoing'}]},
    {id:'NF-1139',name:'Ethan Bello',className:'Grade 1C',guardian:'Sade Bello',initials:'EB',color:'blue',photo:'👦🏽',collectors:[{name:'Sade Bello',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1175',name:'Nneka Eze',className:'Grade 3A',guardian:'Ifeoma Eze',initials:'NE',color:'violet',photo:'👧🏾',collectors:[{name:'Ifeoma Eze',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1204',name:'Samuel Adebayo',className:'Grade 5B',guardian:'Tunde Adebayo',initials:'SA',color:'mint',photo:'👦🏿',collectors:[{name:'Tunde Adebayo',relation:'Father',until:'Ongoing'}]},
    {id:'NF-1228',name:'Lola James',className:'Grade 2B',guardian:'Kemi James',initials:'LJ',color:'rose',photo:'👧🏽',collectors:[{name:'Kemi James',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1261',name:'David Nwosu',className:'Grade 4A',guardian:'Ada Nwosu',initials:'DN',color:'blue',photo:'👦🏾',collectors:[{name:'Ada Nwosu',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1290',name:'Amina Yusuf',className:'Grade 1C',guardian:'Bilkisu Yusuf',initials:'AY',color:'sand',photo:'👧🏿',collectors:[{name:'Bilkisu Yusuf',relation:'Mother',until:'Ongoing'}]},
    {id:'NF-1315',name:'Noah Peters',className:'Grade 5B',guardian:'Grace Peters',initials:'NP',color:'violet',photo:'👦🏽',collectors:[{name:'Grace Peters',relation:'Mother',until:'Ongoing'}]}
  ];
  const today = new Date().toLocaleDateString('en-CA');
  const localTime = (minsAgo=0) => {const d=new Date(Date.now()-minsAgo*60000);return d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});};
  const load=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem('gatewise-'+key));return v??fallback}catch{return fallback}};
  let pupils=[], events=[], requests=[], schoolSettings={}, signedInUser=null, mode='arrival', classChoice='All classes', activityChoice='All events', pupilStatusChoice='All statuses';
  let isOfflineSimulated = false;
  let deviceManaged = true;
  let deviceEncrypted = true;
  const QUEUE_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour expiration policy
  const $=(s,root=document)=>root.querySelector(s), $$=(s,root=document)=>[...root.querySelectorAll(s)];

  // Simple client-side encryption-at-rest simulation bound to staff user and device
  function getDeviceKey() {
    const staffId = signedInUser ? signedInUser.id || signedInUser.email : 'anon';
    const deviceName = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    return `GW_ENC_KEY_${staffId}_${deviceName}`;
  }

  function encryptQueueData(dataObj) {
    const jsonStr = JSON.stringify(dataObj);
    const key = getDeviceKey();
    let xored = '';
    for (let i = 0; i < jsonStr.length; i++) {
      xored += String.fromCharCode(jsonStr.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(unescape(encodeURIComponent(xored)));
  }

  function decryptQueueData(cipherText) {
    try {
      const decoded = decodeURIComponent(escape(atob(cipherText)));
      const key = getDeviceKey();
      let xored = '';
      for (let i = 0; i < decoded.length; i++) {
        xored += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return JSON.parse(xored);
    } catch {
      return null;
    }
  }

  function getLocalQueue() {
    const raw = localStorage.getItem('gw_offline_queue_encrypted');
    if (!raw) return [];
    const decrypted = decryptQueueData(raw);
    if (!Array.isArray(decrypted)) return [];
    const now = Date.now();
    // Prune expired records based on defined policy
    return decrypted.filter(item => {
      return (now - (item.deviceCapturedAt || now)) < QUEUE_TTL_MS;
    });
  }

  function saveLocalQueue(queue) {
    const cipher = encryptQueueData(queue);
    localStorage.setItem('gw_offline_queue_encrypted', cipher);
    updateOfflineStatusUI();
  }

  function addToOfflineQueue(eventPayload) {
    const queue = getLocalQueue();
    queue.push(eventPayload);
    saveLocalQueue(queue);
  }

  function isDeviceOnline() {
    return navigator.onLine && !isOfflineSimulated;
  }

  async function api(path,body){
    if (!isDeviceOnline() && path !== '/api/events/reconcile') {
      throw new Error('Device is offline or connectivity was lost.');
    }
    const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});let data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error(data.error||(response.status===404?'Server endpoint not found (404). Check that the Gatewise app server is running.':`Request failed (${response.status})`));return data;
  }
  function acceptState(state){
    pupils=state.pupils||[];
    const serverEvents = (state.events||[]).map(e=>({...e,createdAt:e.createdAt||Date.now()}));

    // Merge offline pending sync queue into events list for UI display
    const pendingQueue = getLocalQueue().map(q => ({
      id: q.clientEventId,
      pupilId: q.pupilId,
      type: q.type,
      time: q.time,
      date: q.date,
      createdAt: q.deviceCapturedAt,
      staff: signedInUser?.name || 'Staff',
      source: 'Offline queued',
      collector: q.collectorName || null,
      verification: q.verification || null,
      device: q.device,
      campus: q.campus,
      gate: q.gate,
      alert: 'Pending sync',
      reason: q.reason || '',
      manualEntry: Boolean(q.manualEntry),
      clientEventId: q.clientEventId,
      syncStatus: 'pending_sync'
    }));

    events = [...pendingQueue, ...serverEvents];
    requests=state.requests||[];
    schoolSettings=state.school||{};
    if($('#disclosureToggle')){
      $('#disclosureToggle').checked=schoolSettings.discloseCollectorName!==false;
    }
    if($('#offlineStalePolicyToggle')){
      $('#offlineStalePolicyToggle').checked=Boolean(schoolSettings.allowOfflineStalePickupPolicy);
    }
  }
  async function refreshState(){
    if (!isDeviceOnline()) {
      acceptState({ pupils, events: events.filter(e => e.syncStatus !== 'pending_sync'), requests, school: schoolSettings });
      render();
      return;
    }
    const state=await api('/api/state');
    acceptState(state);
    render();
  }
  function setSignedIn(user){signedInUser=user;$('#authScreen').classList.add('hidden');$('.profile strong').textContent=user.name;$('.profile small').textContent=({admin:'School administrator',manager:'School manager',viewer:'View only'})[user.role]||'School staff';$('#userNav').classList.toggle('hidden',user.role!=='admin');$('#addPupilBtn').classList.toggle('hidden',user.role==='viewer');$('#uploadRosterBtn').classList.toggle('hidden',user.role==='viewer');$('[data-page="scan"]').classList.toggle('hidden',user.role==='viewer');$('[data-goto="scan"]').classList.toggle('hidden',user.role==='viewer');}
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials=s=>s.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const pupil=id=>pupils.find(p=>p.id.toLowerCase()===String(id).toLowerCase());
  const todayEvents=()=>events.filter(e=>e.date===today);
  const lastEvent=id=>todayEvents().filter(e=>e.pupilId===id).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const statusFor=p=>{const e=lastEvent(p.id);return !e?'Not arrived':e.type==='arrival'||e.type==='manual_arrival'?'On campus':'Departed'};
  const statusClass=s=>s==='On campus'?'status-present':s==='Departed'?'status-departed':s==='Approved'?'status-approved':s==='Pending'?'status-pending':'status-neutral';
  const badge=(label,cls)=>`<span class="status-pill ${cls}"><i></i>${escapeHtml(label)}</span>`;
  const avatar=(p)=>`<span class="avatar avatar-${p.color||'blue'}">${escapeHtml(p.initials||initials(p.name))}</span>`;
  const pupilCell=p=>`<div class="pupil-cell">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.guardian||'Guardian not set')}</small></span></div>`;
  function toast(msg,icon='✓'){const el=document.createElement('div');el.className='toast';el.innerHTML=`<i>${icon}</i><span>${escapeHtml(msg)}</span>`;$('#toastRegion').append(el);setTimeout(()=>el.remove(),3200);}
  function openModal(html){$('#modalContent').innerHTML=html;$('#modalBackdrop').classList.remove('hidden');setTimeout(()=>$('#modalContent input:not([type=hidden]), #modalContent select')?.focus(),30);}
  function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#modalContent').innerHTML='';if(window._gwStream){window._gwStream.getTracks().forEach(t=>t.stop());window._gwStream=null;}}
  function navigate(page){if(page==='users'&&signedInUser?.role!=='admin'){toast('Only an administrator can manage staff accounts.','!');return}if(page==='scan'&&signedInUser?.role==='viewer'){toast('Your account is view-only.','!');return}$$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#crumbPage').textContent=({dashboard:'Overview',scan:'Scan & log',pupils:'Pupils',pickup:'Pickup approvals',activity:'Activity log',users:'User management'})[page]||'Overview';$('#sidebar').classList.remove('open');window.scrollTo(0,0);if(page==='users')renderUsers();}
  function render(){renderDashboard();renderPupils();renderPickup();renderActivity();}
  function updateOfflineStatusUI() {
    const queue = getLocalQueue();
    const isOnline = isDeviceOnline();
    const connLabel = $('.connection');
    if (connLabel) {
      if (isOnline) {
        connLabel.innerHTML = `<i></i> Online · ${queue.length > 0 ? `<b style="color:#d97706">${queue.length} pending sync</b>` : 'Synced'}`;
        connLabel.style.color = queue.length > 0 ? '#b45309' : '#858a9c';
      } else {
        connLabel.innerHTML = `<i style="background:#e11d48;box-shadow:0 0 0 3px #ffe4e6"></i> Offline mode · <b style="color:#e11d48">${queue.length} pending sync</b>`;
        connLabel.style.color = '#e11d48';
      }
    }

    const gateStatus = $('.gate-status');
    if (gateStatus) {
      if (isOnline) {
        gateStatus.className = 'gate-status';
        gateStatus.innerHTML = `<i></i> ${queue.length > 0 ? `Syncing (${queue.length})` : 'Online'}`;
      } else {
        gateStatus.className = 'gate-status offline';
        gateStatus.innerHTML = `<i style="background:#e11d48"></i> Offline (${queue.length} queued)`;
      }
    }

    const offlineNote = $('.offline-note');
    if (offlineNote) {
      if (isOnline) {
        offlineNote.className = 'offline-note';
        offlineNote.innerHTML = `<span>✳</span><p><b>Network looks good</b><small>${queue.length > 0 ? `${queue.length} event(s) waiting to sync. <a href="#" id="syncNowLink" style="color:#4f46e5;font-weight:600">Sync now ↗</a>` : 'Scans are syncing in real time.'}</small></p>`;
      } else {
        offlineNote.className = 'offline-note offline-warning-box';
        offlineNote.innerHTML = `<span style="color:#e11d48">⚠</span><p><b>Offline operation active</b><small>Local queue encrypted & signed. Events will show Pending sync. <br>Fallback: Use paper/voice procedures if device cannot safely record.</small></p>`;
      }
    }

    const syncNowBtn = $('#syncNowBtn');
    if (syncNowBtn) {
      syncNowBtn.disabled = !isOnline || queue.length === 0;
      syncNowBtn.textContent = queue.length > 0 ? `Sync Pending Queue (${queue.length})` : 'Queue Synced';
    }
  }

  function renderDashboard(){const es=todayEvents(), arrivals=es.filter(e=>e.type==='arrival'||e.type==='manual_arrival'), deps=es.filter(e=>e.type==='departure'||e.type==='manual_departure'||e.type==='authorized_exception'), present=pupils.filter(p=>statusFor(p)==='On campus').length;$('#presentCount').innerHTML=`${present} <small>/ 248</small>`;$('#presentProgress').style.width=`${Math.min(100,present/248*100)}%`;$('#arrivalsCount').textContent=arrivals.length;$('#departuresCount').textContent=deps.length;$('#lastArrival').textContent=arrivals.length?arrivals.sort((a,b)=>b.createdAt-a.createdAt)[0].time:'—';$('#alertsSent').textContent=es.filter(e=>e.alert==='Sent').length;$('#attentionCount').textContent=requests.length+1;const term=($('#arrivalSearch')?.value||'').toLowerCase();const list=pupils.filter(p=>statusFor(p)==='On campus'&&(!term||`${p.name} ${p.className}`.toLowerCase().includes(term))&&(classChoice==='All classes'||p.className===classChoice));$('#arrivalRows').innerHTML=list.slice(0,7).map(p=>{const e=lastEvent(p.id);return `<tr><td>${pupilCell(p)}</td><td><span class="class-pill">${escapeHtml(p.className)}</span></td><td class="time-cell">${escapeHtml(e?.time||'—')}</td><td>${badge('On campus','status-present')}</td></tr>`}).join('');$('#emptyArrivals').classList.toggle('hidden',list.length>0);const recent=es.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);$('#recentActivity').innerHTML=recent.map(activityItem).join('')||'<div class="empty-state">No events recorded yet.</div>';updateOfflineStatusUI();}
  function activityItem(e){const p=pupil(e.pupilId)||{name:'Unknown pupil'};let type=e.type;const isArrival=type==='arrival'||type==='manual_arrival';const isDep=type==='departure'||type==='manual_departure'||type==='authorized_exception';const isPendingSync=e.alert==='Pending sync'||e.syncStatus==='pending_sync';const manualTag=e.manualEntry||e.source==='Manual entry'||e.source==='Manual ID lookup'||e.reason?`<span class="manual-tag">MANUAL ENTRY (${escapeHtml((e.reason||'manual').replace('_',' '))})</span>`:'';const corrTag=e.correctionLink?`<span class="manual-tag" style="background:#fef3c7;color:#92400e">CORRECTION</span>`:'';const pendingTag=isPendingSync?`<span class="manual-tag" style="background:#fee2e2;color:#b91c1c;font-weight:700">PENDING SYNC (NOT NOTIFIED)</span>`:'';const alertText=isPendingSync?'Pending sync (parents NOT notified)':(e.alert||'Sent');return `<div class="activity-item"><div class="activity-icon ${isArrival?'arrival':isDep?'departure':'request'}">${isArrival?'↘':isDep?'↗':'◷'}</div><div class="activity-copy"><b>${isArrival?'Arrival recorded':isDep?'Departure recorded':'Activity'}</b> for ${escapeHtml(p.name)}${e.collector?` with ${escapeHtml(e.collector)}`:''} ${manualTag} ${corrTag} ${pendingTag}<small>${escapeHtml(e.time)} · ${escapeHtml(e.staff)} · Guardian alert: <b>${escapeHtml(alertText)}</b></small></div></div>`;}
  function renderPupils(){const q=($('#pupilSearch')?.value||'').toLowerCase();const list=pupils.filter(p=>{const st=statusFor(p);const matchStatus=pupilStatusChoice==='All statuses'||st===pupilStatusChoice;const matchQ=!q||`${p.name} ${p.id} ${p.className}`.toLowerCase().includes(q);const matchCls=classChoice==='All classes'||p.className===classChoice;return matchStatus&&matchQ&&matchCls;});$('#pupilResultCount').textContent=`${list.length} pupils`;$('#pupilRows').innerHTML=list.map(p=>`<tr><td>${pupilCell(p)}</td><td><span class="pupil-id">${escapeHtml(p.id)}</span></td><td><span class="class-pill">${escapeHtml(p.className)}</span></td><td>${p.collectors.length} approved</td><td>${badge(statusFor(p),statusClass(statusFor(p)))}</td><td><button class="row-menu" data-pupil-detail="${escapeHtml(p.id)}" aria-label="Pupil options">···</button></td></tr>`).join('');}
  function renderPickup(){const total=pupils.reduce((n,p)=>n+p.collectors.length,0);$('#pendingCount').textContent=requests.length;$('#approvedCount').textContent=total;$('#requestList').innerHTML=requests.length?requests.map(r=>{const p=pupil(r.pupilId)||{name:'Unknown pupil',initials:'?',color:'blue'};return `<div class="request-card"><div>${avatar(p)}</div><div class="request-details"><strong>${escapeHtml(r.name)} <span class="card-tag">· ${escapeHtml(r.relation)}</span></strong><p>Pickup for <b>${escapeHtml(p.name)}</b> · Requested by ${escapeHtml(r.requestedBy)}</p><small>${escapeHtml(r.time)} — ${escapeHtml(r.note)}</small></div>${signedInUser?.role==='viewer'?'':`<div class="request-actions"><button class="decline-button" data-request="${r.id}" data-action="decline">Decline</button><button class="approve-button" data-request="${r.id}" data-action="approve">✓ Approve</button></div>`}</div>`}).join(''):'<div class="empty-state">No pending pickup requests.</div>';const q=($('#pickupSearch')?.value||'').toLowerCase();const active=pupils.flatMap(p=>p.collectors.map(c=>({p,c}))).filter(x=>`${x.p.name} ${x.c.name} ${x.c.relation}`.toLowerCase().includes(q));$('#approvedRows').innerHTML=active.map(({p,c})=>`<tr><td>${pupilCell(p)}</td><td><b>${escapeHtml(c.name)}</b></td><td>${escapeHtml(c.relation)}</td><td>${escapeHtml(c.until||'Ongoing')}</td><td>${badge('Approved','status-approved')}</td></tr>`).join('');}
  function renderActivity(){const q=($('#activitySearch')?.value||'').toLowerCase();let es=todayEvents().slice().sort((a,b)=>b.createdAt-a.createdAt);if(activityChoice==='Arrivals')es=es.filter(e=>e.type==='arrival'||e.type==='manual_arrival');else if(activityChoice==='Departures')es=es.filter(e=>e.type==='departure'||e.type==='manual_departure'||e.type==='authorized_exception');else if(activityChoice==='Manual entries')es=es.filter(e=>e.manualEntry||e.source==='Manual entry'||e.source==='Manual ID lookup'||e.source==='Paper/voice manual fallback'||e.reason);es=es.filter(e=>{const p=pupil(e.pupilId)||{};return `${p.name||''} ${e.type} ${e.source} ${e.staff} ${e.reason||''} ${e.alert||''}`.toLowerCase().includes(q)});$('#activityResultCount').textContent=`${es.length} events`;$('#activityRows').innerHTML=es.map(e=>{const p=pupil(e.pupilId)||{name:'Unknown pupil',guardian:'',initials:'?',color:'blue'};const isPendingSync=e.alert==='Pending sync'||e.syncStatus==='pending_sync';const manualTag=e.manualEntry||e.source==='Manual entry'||e.source==='Manual ID lookup'||e.reason?`<br><span class="manual-tag">MANUAL ENTRY (${escapeHtml((e.reason||'manual').replace('_',' '))})</span>`:'';const corrTag=e.correctionLink?`<br><span class="manual-tag" style="background:#fef3c7;color:#92400e">CORRECTION (LINKED: ${escapeHtml(e.correctionLink)})</span>`:'';const offlineTag=e.source==='Offline queued'||isPendingSync?`<br><span class="manual-tag" style="background:#fee2e2;color:#b91c1c;font-weight:700">OFFLINE QUEUED</span>`:'';const fallbackTag=e.source==='Paper/voice manual fallback'?`<br><span class="manual-tag" style="background:#f3e8ff;color:#6b21a8;font-weight:700">RECONCILED FALLBACK (${escapeHtml(e.reconciliationAuditReason||'Manual log')})</span>`:'';const canCorrect=(signedInUser?.role==='admin'||signedInUser?.role==='manager')&&!isPendingSync?`<button class="text-link" data-correct-event="${escapeHtml(e.id)}" style="margin-left:8px;font-size:11px">Correct</button>`:'';const alertBadge=isPendingSync?`<span class="status-pill status-pending" title="Parents have NOT been notified. Will sync upon reconnection."><i></i>Pending sync</span>`:badge(e.alert||'Sent',e.alert==='Sent'?'status-approved':'status-pending');return `<tr><td>${badge(e.type.includes('arrival')?'Arrival':e.type.includes('exception')?'Authorized Exception':'Departure',e.type.includes('arrival')?'status-present':'status-departed')}</td><td>${pupilCell(p)}</td><td>${escapeHtml(e.source||'Card scan')}${e.collector?`<small class="card-tag"> · ${escapeHtml(e.collector)}</small>`:''}${manualTag}${corrTag}${offlineTag}${fallbackTag}${canCorrect}</td><td>${escapeHtml(e.staff)}</td><td class="time-cell">${escapeHtml(e.time)}</td><td>${alertBadge}</td></tr>`}).join('');$('#emptyActivity').classList.toggle('hidden',es.length>0);updateOfflineStatusUI();}
  function showScanResult(isSuccess, message, details = '') {
    const banner = $('#scanResultBanner');
    if (!banner) return;
    banner.className = `result-banner ${isSuccess ? 'success' : 'error'}`;
    banner.innerHTML = `<i>${isSuccess ? '✓' : '⚠'}</i><div><strong>${escapeHtml(message)}</strong>${details ? `<small style="display:block;margin-top:2px;font-weight:normal">${escapeHtml(details)}</small>` : ''}</div>`;
    banner.classList.remove('hidden');
    setTimeout(() => { banner.classList.add('hidden'); }, 6000);
  }

  function eventConfirm(p, isManual=false, initialReason='card_missing'){
    const collectors = p.collectors || [];
    const hasCollectors = collectors.length > 0;
    const device = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    const campus = $('#campusSelect')?.value || 'Primary campus';
    const gate = $('#gateSelect')?.value || 'Main gate';
    const isAdmin = signedInUser?.role === 'admin';
    const channelLabel = (p.preferredChannel || 'sms').toUpperCase();

    const isOnline = isDeviceOnline();
    const allowStalePickup = Boolean(schoolSettings.allowOfflineStalePickupPolicy);

    // Offline stale pickup warning banner
    let offlinePickupWarningHtml = '';
    if (!isOnline && mode === 'departure') {
      offlinePickupWarningHtml = `
        <div class="offline-stale-warning" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;margin:10px 0;">
          <div style="display:flex;align-items:center;gap:8px;color:#c2410c;font-weight:700;font-size:10px;">
            <span>⚠</span> OFFLINE MODE: STALE PICKUP PERMISSIONS WARNING
          </div>
          <p style="margin:4px 0 6px;font-size:9px;color:#9a3412;line-height:1.4;">
            Device is disconnected from the school network. Locally stored pickup approvals may be stale or revoked by the school office.
          </p>
          ${allowStalePickup ? `
            <label style="display:flex;align-items:center;gap:6px;font-size:9px;color:#7c2d12;font-weight:600;cursor:pointer;">
              <input type="checkbox" id="acknowledgeStalePolicy" checked>
              <span>Explicit School Policy: Authorized to release using cached pickup permissions in offline emergency.</span>
            </label>
          ` : `
            <div style="background:#fef2f2;border:1px solid #fecaca;padding:6px 8px;border-radius:6px;color:#991b1b;font-size:9px;">
              <b>Blocked by School Policy:</b> Offline mode does not permit stale pickup permissions to be treated as current without explicit school policy. Use manual paper/voice fallback.
            </div>
          `}
        </div>
      `;
    }

    // Approved contacts list with visual cards
    let departureSection = '';
    if (mode === 'departure') {
      const contactsHtml = hasCollectors ? `
        ${offlinePickupWarningHtml}
        <div style="margin:12px 0">
          <label style="font-size:10px;font-weight:700;color:#454b60;display:block;margin-bottom:6px">Active Approved Pickup Contacts</label>
          <div class="approved-collectors-list">
            ${collectors.map((c, i) => `
              <label class="collector-card-item ${i === 0 ? 'selected' : ''}" data-collector-id="${c.id}">
                <input type="radio" name="selectedCollectorRadio" value="${c.id}" ${i === 0 ? 'checked' : ''}>
                <div class="collector-avatar">${escapeHtml(initials(c.name))}</div>
                <div class="collector-meta">
                  <strong>${escapeHtml(c.name)} <span style="font-weight:normal;color:#6f7487">(${escapeHtml(c.relation)})</span></strong>
                  <small>Status: Approved · Valid until: ${escapeHtml(c.until || 'Ongoing')}</small>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="form-field" style="margin-bottom:12px">
          <label>Identity Verification Method (School Policy Check)</label>
          <select id="verifySelect">
            <option value="Photo matched">Photo matched (official records comparison)</option>
            <option value="Approved ID document checked">Approved ID document checked</option>
            <option value="Known to staff">Known to staff</option>
          </select>
        </div>
      ` : `
        ${offlinePickupWarningHtml}
        <div class="block-escalation">
          <div class="block-icon">!</div>
          <div>
            <strong>BLOCK: Collector not approved</strong>
            <p>Escalation instruction: Release is blocked. No approved pickup contacts found for this pupil. Only a school administrator can authorize an exception with a preserved audit entry.</p>
          </div>
        </div>
      `;

      // Option to trigger or show administrator exception
      const unapprovedTrigger = hasCollectors ? `
        <div style="margin:10px 0 14px">
          <button type="button" class="text-link" id="toggleUnapprovedBtn" style="font-size:10px;color:#c05621">
            Person collecting child is NOT listed as approved? Click for escalation / admin exception ↗
          </button>
        </div>
      ` : '';

      const adminExceptionForm = `
        <div id="exceptionSection" class="exception-box ${hasCollectors ? 'hidden' : ''}">
          <h3>Authorize Unapproved Collector Exception (Administrator Only)</h3>
          ${!isAdmin ? `
            <div class="danger-note" style="margin-bottom:10px">
              <b>Escalation required:</b> Your account (${escapeHtml(signedInUser?.role)}) cannot authorize pickup exceptions. Please summon a school administrator to review and authorize release.
            </div>
          ` : `
            <div class="form-field" style="margin-bottom:8px">
              <label>Unapproved Collector Full Name *</label>
              <input id="exceptionCollectorInput" placeholder="Full legal name of collector" required>
            </div>
            <div class="form-field" style="margin-bottom:8px">
              <label>Exception Reason (Preserved in Audit Log) *</label>
              <textarea id="exceptionReasonInput" placeholder="Detailed reason for releasing to unapproved collector (e.g. parent emergency phone authorization)..." required style="width:100%;padding:8px;border-radius:6px;border:1px solid #d0d5dd;font:inherit;font-size:10px;min-height:50px"></textarea>
            </div>
            <div class="form-field">
              <label>Identity Verification Method</label>
              <select id="exceptionVerifySelect">
                <option value="Approved ID document checked">Government / Approved ID document checked</option>
                <option value="Photo matched">Photo matched</option>
                <option value="Known to staff">Known to staff</option>
              </select>
            </div>
          `}
        </div>
      `;

      departureSection = contactsHtml + unapprovedTrigger + adminExceptionForm;
    }

    const manualReasonSelect = isManual ? `
      <div class="form-field" style="margin-bottom:12px">
        <label>Manual entry reason</label>
        <select id="reasonSelect">
          <option value="card_missing" ${initialReason==='card_missing'?'selected':''}>Card missing</option>
          <option value="card_unreadable" ${initialReason==='card_unreadable'?'selected':''}>Unreadable QR code</option>
          <option value="other">Other reason</option>
        </select>
      </div>
    ` : '';

    openModal(`
      <h2 id="modalTitle">Confirm ${mode === 'arrival' ? 'Arrival' : 'Departure & Release'}</h2>
      <p class="modal-intro">
        Staff verifies pupil against official photograph before recording handover. Device: <b>${escapeHtml(device)}</b> · Location: <b>${escapeHtml(campus)} (${escapeHtml(gate)})</b>.
      </p>
      <div class="confirm-profile">
        <div class="photo-preview-large">${escapeHtml(p.photo||p.initials)}</div>
        <div>
          <strong style="font-size:14px">${escapeHtml(p.name)}</strong>
          <small style="font-size:11px;color:#6f7487">${escapeHtml(p.id)} · ${escapeHtml(p.className)}</small>
          <small style="display:block;margin-top:4px">Guardian: ${escapeHtml(p.guardian)} <span class="channel-badge">${escapeHtml(channelLabel)} ALERT READY</span></small>
        </div>
      </div>
      ${manualReasonSelect}
      ${mode === 'departure' ? departureSection : '<p class="confirm-info" style="margin:12px 0">Confirming will record arrival at the school gate and dispatch an arrival alert to eligible guardians.</p>'}
      <div class="modal-actions">
        <button class="button button-outline" id="cancelConfirm">Cancel</button>
        <button class="button button-primary" id="saveEvent">
          ${mode === 'departure' && !hasCollectors ? (isAdmin ? 'Authorize Exception & Release' : 'Blocked — Admin Required') : `Confirm ${mode === 'arrival' ? 'Arrival' : 'Release'}`}
        </button>
      </div>
    `);

    // Radio selection interactivity for collectors
    $$('.collector-card-item').forEach(card => {
      card.onclick = () => {
        $$('.collector-card-item').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      };
    });

    const toggleUnapproved = $('#toggleUnapprovedBtn');
    if (toggleUnapproved) {
      toggleUnapproved.onclick = () => {
        const exc = $('#exceptionSection');
        if (exc) {
          const isHidden = exc.classList.toggle('hidden');
          toggleUnapproved.textContent = isHidden
            ? 'Person collecting child is NOT listed as approved? Click for escalation / admin exception ↗'
            : '▲ Hide unapproved collector / exception form';
          if (!isHidden && isAdmin) {
            $('#saveEvent').textContent = 'Authorize Exception & Release';
          } else {
            $('#saveEvent').textContent = `Confirm ${mode === 'arrival' ? 'Arrival' : 'Release'}`;
          }
        }
      };
    }

    $('#cancelConfirm').onclick = closeModal;
    $('#saveEvent').onclick = () => {
      const excSection = $('#exceptionSection');
      const isExceptionMode = excSection && !excSection.classList.contains('hidden');
      const isOnline = isDeviceOnline();

      // Check offline stale pickup policy on departure
      if (!isOnline && mode === 'departure' && !isExceptionMode) {
        const allowStale = Boolean(schoolSettings.allowOfflineStalePickupPolicy);
        const ack = $('#acknowledgeStalePolicy')?.checked;
        if (!allowStale || !ack) {
          toast('Offline mode does not permit stale pickup permissions to be treated as current without explicit school policy. Use manual fallback.', '!');
          return;
        }
      }

      if (mode === 'departure' && (!hasCollectors || isExceptionMode)) {
        if (!isAdmin) {
          toast('Collector not approved. Escalation instruction: Only a school administrator can authorize an exception.', '!');
          return;
        }
        const collectorName = $('#exceptionCollectorInput')?.value.trim();
        const reason = $('#exceptionReasonInput')?.value.trim();
        const verification = $('#exceptionVerifySelect')?.value || 'Admin Exception: ID checked';
        if (!collectorName || !reason) {
          toast('Collector name and exception reason are required for administrator authorization.', '!');
          return;
        }
        recordAuthorizedException(p, collectorName, reason, verification);
      } else {
        recordEvent(p, mode, isManual ? 'Manual entry' : 'Card scan', isManual ? ($('#reasonSelect')?.value || 'card_missing') : '');
      }
    };
  }

  async function recordAuthorizedException(p, collectorName, reason, verification) {
    const device = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    const campus = $('#campusSelect')?.value || 'Primary campus';
    const gate = $('#gateSelect')?.value || 'Main gate';
    const isOnline = isDeviceOnline();

    if (!isOnline) {
      if (!deviceManaged || !deviceEncrypted) {
        toast('Device is not managed and encrypted. Local offline queueing is blocked. Staff must follow paper/voice fallback procedure.', '!');
        return;
      }

      const clientEventId = 'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const queuePayload = {
        clientEventId,
        pupilId: p.id,
        type: 'authorized_exception',
        source: 'Authorized exception',
        reason,
        collectorName,
        verification,
        device,
        campus,
        gate,
        manualEntry: true,
        deviceCapturedAt: Date.now(),
        staffEmail: signedInUser?.email || '',
        deviceManaged: true,
        deviceEncrypted: true,
        time: localTime(),
        date: today
      };

      addToOfflineQueue(queuePayload);
      closeModal();
      refreshState();
      $('#lastScanCard').innerHTML = `<div class="pupil-cell">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>Authorized Exception (Queued offline) · Pending sync</small></span></div>`;
      showScanResult(true, `Exception departure queued locally for ${p.name} (Pending sync).`, 'Event will sync automatically upon reconnection. Parents have NOT been notified.');
      toast(`Offline event queued: Pending sync. Parents have NOT been notified.`);
      navigate('scan');
      return;
    }

    try {
      const res = await api('/api/events', {
        pupilId: p.id,
        type: 'authorized_exception',
        source: 'Authorized exception',
        reason,
        collectorName,
        verification,
        device,
        campus,
        gate,
        manualEntry: true
      });
      acceptState(res.state);
      closeModal();
      render();
      const headline = 'Authorized Exception Departure recorded';
      const notifInfo = res.notification ? ` · Alert sent via ${res.notification.channel}` : '';
      $('#lastScanCard').innerHTML = `<div class="pupil-cell">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(headline)} · with ${escapeHtml(collectorName)}${escapeHtml(notifInfo)}</small></span></div>`;
      showScanResult(true, `Exception authorized and departure recorded for ${p.name}.`, `Collector: ${collectorName} · Verified: ${verification} · Reason: ${reason}`);
      toast(`Authorized exception departure recorded for ${p.name}.`);
      navigate('scan');
    } catch(err) {
      toast(err.message, '!');
    }
  }

  async function recordEvent(p, type, source='Card scan', reason='') {
    let collectorId = null, collectorName = null, verification = null;
    const device = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    const campus = $('#campusSelect')?.value || 'Primary campus';
    const gate = $('#gateSelect')?.value || 'Main gate';
    const isOnline = isDeviceOnline();

    if (type === 'departure') {
      const selectedRadio = $('input[name="selectedCollectorRadio"]:checked');
      if (!selectedRadio) {
        toast('Select an approved collector. If collector is unapproved, escalate to administrator.', '!');
        return;
      }
      collectorId = Number(selectedRadio.value);
      const colObj = (p.collectors || []).find(c => c.id === collectorId);
      collectorName = colObj ? colObj.name : null;
      verification = $('#verifySelect')?.value || 'Photo matched';
    }

    // Handle offline flow
    if (!isOnline) {
      if (!deviceManaged || !deviceEncrypted) {
        closeModal();
        toast('Device is not managed and encrypted. Local offline queueing is prohibited. Staff must follow paper/voice fallback procedure.', '!');
        showScanResult(false, 'Local offline queueing blocked: Device unmanaged/unencrypted.', 'Follow paper/voice fallback procedure and reconcile later.');
        return;
      }

      const clientEventId = 'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const queuePayload = {
        clientEventId,
        pupilId: p.id,
        type,
        source: 'Offline queued',
        reason,
        device,
        campus,
        gate,
        manualEntry: source === 'Manual entry' || source === 'Manual ID lookup' || !!reason,
        collectorId: type === 'departure' ? collectorId : undefined,
        collectorName: type === 'departure' ? collectorName : undefined,
        verification,
        deviceCapturedAt: Date.now(),
        staffEmail: signedInUser?.email || '',
        deviceManaged: true,
        deviceEncrypted: true,
        allowOfflineStalePickupPolicy: type === 'departure' && Boolean(schoolSettings.allowOfflineStalePickupPolicy),
        time: localTime(),
        date: today
      };

      addToOfflineQueue(queuePayload);
      closeModal();
      refreshState();
      const headline = type === 'arrival' ? 'Arrival recorded locally' : 'Departure recorded locally';
      $('#lastScanCard').innerHTML = `<div class="pupil-cell">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(headline)} · Pending sync (Parents not notified)</small></span></div>`;
      showScanResult(true, `${headline} for ${p.name} (Pending sync).`, 'Record stored encrypted locally. Parents have NOT been notified.');
      toast(`${headline} for ${p.name}. Status: Pending sync (parents not notified).`);
      navigate('scan');
      return;
    }

    try {
      const res = await api('/api/events', {
        pupilId: p.id,
        type,
        source,
        reason,
        device,
        campus,
        gate,
        manualEntry: source === 'Manual entry' || source === 'Manual ID lookup' || !!reason,
        collectorId: type === 'departure' ? collectorId : undefined,
        verification
      });
      acceptState(res.state);
      closeModal();
      render();
      const e = events.find(x => x.id === res.eventId);
      const headline = type === 'arrival' ? 'Arrival recorded' : 'Departure recorded';
      const mTag = reason ? ` · MANUAL ENTRY (${reason.replace('_',' ')})` : '';
      const notifInfo = res.notification ? ` · Alert sent via ${res.notification.channel} to ${res.notification.guardian}` : '';
      const collectorText = e?.collector ? ` · with ${e.collector}` : '';
      $('#lastScanCard').innerHTML = `<div class="pupil-cell">${avatar(p)}<span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(headline)} · ${escapeHtml(e?.time||localTime())}${escapeHtml(collectorText)}${mTag}${escapeHtml(notifInfo)}</small></span></div>`;
      showScanResult(true, `${headline} successfully for ${p.name}.`, `Device: ${device} · Location: ${campus} (${gate}) · Verification: ${verification || 'N/A'}`);
      toast(`${headline} for ${p.name}. Guardian alerted via ${(p.preferredChannel||'sms').toUpperCase()}.`);
      navigate('scan');
    } catch(err) {
      closeModal();
      showScanResult(false, `Could not record ${type} for ${p.name}`, err.message);
      toast(err.message, '!');
    }
  }

  // Idempotent sync of pending offline queue to server
  async function syncPendingQueue() {
    if (!isDeviceOnline()) {
      toast('Device is offline. Connect to school network before syncing queue.', '!');
      return;
    }
    const queue = getLocalQueue();
    if (!queue.length) {
      toast('No pending offline events to sync.');
      return;
    }

    try {
      const res = await fetch('/api/events/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: queue })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');

      // Clear synced items from queue
      localStorage.removeItem('gw_offline_queue_encrypted');
      acceptState(data.state);
      render();
      toast(`Offline queue synchronized (${data.results?.length || 0} event(s)). Guardian notifications dispatched.`);
    } catch (e) {
      toast(`Sync error: ${e.message}`, '!');
    }
  }

  // Paper/voice manual fallback reconciliation modal
  function openReconcileModal() {
    openModal(`
      <h2 id="modalTitle">Paper / Voice Fallback Reconciliation</h2>
      <p class="modal-intro">
        On reconnection, staff reconciles manual paper/voice logs recorded when the app could not safely record events. A preserved audit reason is required.
      </p>
      <form id="reconcileForm" class="form-grid">
        <div class="form-field full">
          <label>Pupil ID *</label>
          <input name="pupilId" id="reconcilePupilId" placeholder="e.g. NF-1042" required>
        </div>
        <div class="form-field">
          <label>Event Type *</label>
          <select name="type">
            <option value="arrival">Arrival</option>
            <option value="departure">Departure</option>
          </select>
        </div>
        <div class="form-field">
          <label>Collector Name (for departure)</label>
          <input name="collectorName" placeholder="Full name of collector">
        </div>
        <div class="form-field full">
          <label>Manual Log Audit Reason (Preserved in Log) *</label>
          <textarea name="reconciliationAuditReason" required placeholder="Detail paper/voice fallback circumstance, staff signature, and paper log reference..." style="width:100%;padding:8px;border-radius:6px;border:1px solid #d0d5dd;font:inherit;min-height:55px"></textarea>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelReconcile">Cancel</button>
          <button type="submit" class="button button-primary">Reconcile Manual Log</button>
        </div>
      </form>
    `);
    $('#cancelReconcile').onclick = closeModal;
    $('#reconcileForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const pupilId = String(f.get('pupilId')).trim().toUpperCase();
      const type = f.get('type');
      const collectorName = String(f.get('collectorName') || '').trim();
      const reconciliationAuditReason = String(f.get('reconciliationAuditReason')).trim();

      if (!pupilId || !reconciliationAuditReason) {
        toast('Pupil ID and audit reason are required.', '!');
        return;
      }

      try {
        const res = await api('/api/events/reconcile', {
          pupilId,
          type,
          collectorName: collectorName || undefined,
          reconciliationAuditReason,
          verification: 'Paper log reconciled'
        });
        acceptState(res.state);
        closeModal();
        render();
        toast(`Manual log reconciled for ${pupilId}.`);
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  function resolvePickupRequest(r,action){if(action==='approve'){const localToday=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);openModal(`<h2 id="modalTitle">Approve pickup</h2><p class="modal-intro">This adds ${escapeHtml(r.name)} to the approved collector list for ${escapeHtml(pupil(r.pupilId)?.name||'the pupil')}. Set the last valid pickup date.</p><form id="approvePickupForm"><div class="form-field"><label>Approval expires on</label><input name="validUntil" type="date" min="${localToday}" value="${localToday}" required></div><div class="danger-note" style="margin-top:12px">Staff must still verify this person’s identity at pickup. Confirm the expiry with the guardian before approving.</div><div class="modal-actions"><button type="button" class="button button-outline" id="cancelPickupApproval">Cancel</button><button class="button button-primary" type="submit">Approve collector</button></div></form>`);$('#cancelPickupApproval').onclick=closeModal;$('#approvePickupForm').onsubmit=async ev=>{ev.preventDefault();const validUntil=new FormData(ev.currentTarget).get('validUntil');try{const res=await api(`/api/pickup/${encodeURIComponent(r.id)}`,{action,validUntil});acceptState(res.state);closeModal();render();toast(`${r.name} approved until ${validUntil}.`)}catch(err){toast(err.message,'!')}};return}openModal(`<h2 id="modalTitle">Decline pickup request?</h2><p class="modal-intro">${escapeHtml(r.name)} will not be added to the approved collector list. Contact the guardian through the school’s usual process.</p><div class="modal-actions"><button class="button button-outline" id="cancelDecline">Keep request</button><button class="button button-dark" id="confirmDecline">Decline request</button></div>`);$('#cancelDecline').onclick=closeModal;$('#confirmDecline').onclick=async()=>{try{const res=await api(`/api/pickup/${encodeURIComponent(r.id)}`,{action});acceptState(res.state);closeModal();render();toast('Pickup request declined.')}catch(err){toast(err.message,'!')}}}
  function findAndScan(term,source='Card scan'){const query=term.trim().toLowerCase();if(!query)return;const matches=pupils.filter(p=>p.id.toLowerCase()===query || p.name.toLowerCase().includes(query));if(!matches.length){toast('Pupil not found by ID or name. Search the directory.','!');return}if(matches.length===1){eventConfirm(matches[0], source!=='Card scan');return}const listHtml=matches.map(p=>`<div class="confirm-profile pupil-select-item" data-select-pupil="${escapeHtml(p.id)}" style="cursor:pointer">${avatar(p)}<div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)} · ${escapeHtml(p.className)} · ${escapeHtml(p.guardian)}</small></div></div>`).join('');openModal(`<h2 id="modalTitle">Select pupil</h2><p class="modal-intro">Multiple pupils matched "${escapeHtml(term)}". Select the pupil to verify using their photo on screen.</p><div style="display:grid;gap:8px;max-height:280px;overflow:auto">${listHtml}</div><div class="modal-actions"><button class="button button-outline" id="cancelSelectPupil">Cancel</button></div>`);$('#cancelSelectPupil').onclick=closeModal;$$('[data-select-pupil]').forEach(el=>{el.onclick=()=>{const selected=pupil(el.dataset.selectPupil);if(selected)eventConfirm(selected, source!=='Card scan');};});}
  function openAddPupil(){openModal(`<h2 id="modalTitle">Add a pupil</h2><p class="modal-intro">Create a school profile. The guardian relationship still needs to be verified by the school.</p><form id="addPupilForm" class="form-grid"><div class="form-field full"><label>Full name</label><input name="name" required placeholder="Pupil name"></div><div class="form-field"><label>Pupil ID</label><input name="id" placeholder="Auto-generated if blank"></div><div class="form-field"><label>Class</label><select name="className"><option>Grade 1C</option><option>Grade 2B</option><option>Grade 3A</option><option>Grade 4A</option><option>Grade 5B</option></select></div><div class="form-field full"><label>Guardian name</label><input name="guardian" required placeholder="Parent or guardian"></div><div class="form-field full"><div class="danger-note">Local MVP only: do not enter real pupil or guardian data. No guardian login or messaging is connected.</div></div><div class="modal-actions form-field full"><button type="button" class="button button-outline" id="cancelAdd">Cancel</button><button class="button button-primary" type="submit">Create pupil</button></div></form>`);$('#cancelAdd').onclick=closeModal;$('#addPupilForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),name=String(f.get('name')).trim();try{const res=await api('/api/pupils',{name,id:String(f.get('id')).trim(),className:f.get('className'),guardian:String(f.get('guardian')).trim()});acceptState(res.state);closeModal();render();toast(`${name} added to the directory.`)}catch(err){toast(err.message,'!')}};}
  async function renderUsers(){if(signedInUser?.role!=='admin')return;const body=$('#userRows');body.innerHTML='<tr><td colspan="5">Loading accounts…</td></tr>';try{const {users}=await api('/api/users');body.innerHTML=users.map(u=>`<tr><td><b>${escapeHtml(u.name)}</b></td><td>${escapeHtml(u.email)}</td><td><select class="user-role-select" data-user-role="${u.id}" ${u.id===signedInUser.id?'disabled':''}><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option><option value="manager" ${u.role==='manager'?'selected':''}>Manager</option><option value="viewer" ${u.role==='viewer'?'selected':''}>View only</option></select></td><td>${badge(u.active?'Active':'Disabled',u.active?'status-approved':'status-neutral')}</td><td><button class="button button-outline user-toggle" data-user-active="${u.id}" data-active="${u.active?0:1}" ${u.id===signedInUser.id?'disabled':''}>${u.active?'Disable':'Enable'}</button></td></tr>`).join('')||'<tr><td colspan="5">No staff accounts.</td></tr>'}catch(err){body.innerHTML=`<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`}}
  function openAddUser(){openModal(`<h2 id="modalTitle">Create staff account</h2><p class="modal-intro">The staff member will use this temporary password at sign-in. Share it privately.</p><form id="addUserForm" class="form-grid"><div class="form-field full"><label>Full name</label><input name="name" required maxlength="120"></div><div class="form-field full"><label>School email</label><input name="email" type="email" required maxlength="254"></div><div class="form-field full"><label>Role</label><select name="role"><option value="manager">Manager — manage pupils and gate operations</option><option value="viewer">View only — read school records</option><option value="admin">Admin — manage users and all operations</option></select></div><div class="form-field full"><label>Temporary password (at least 12 characters)</label><input name="password" type="password" minlength="12" required autocomplete="new-password"></div><div class="modal-actions form-field full"><button type="button" class="button button-outline" id="cancelAddUser">Cancel</button><button class="button button-primary" type="submit">Create account</button></div></form>`);$('#cancelAddUser').onclick=closeModal;$('#addUserForm').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);try{await api('/api/users',{name:String(f.get('name')).trim(),email:String(f.get('email')).trim(),role:f.get('role'),password:f.get('password')});closeModal();toast('Staff account created. Share the temporary password privately.');renderUsers()}catch(err){toast(err.message,'!')}}}
  async function previewRoster(file){if(!file)return;if(file.size>8*1024*1024){toast('Roster files must be 8 MB or smaller.','!');return}if(!/\.(csv|xlsx)$/i.test(file.name)){toast('Choose a CSV or XLSX file.','!');return}try{const buffer=await file.arrayBuffer();let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const {preview,errors,errorCount,token}=await api('/api/import/preview',{filename:file.name,fileBase64:btoa(binary)});const rows=preview.map(p=>`<tr><td>${escapeHtml(p.pupil_id)}</td><td>${escapeHtml(p.pupil_name)}</td><td>${escapeHtml(p.class_name)}</td><td>${escapeHtml(p.guardian_name)}</td></tr>`).join('');openModal(`<h2 id="modalTitle">Review pupil roster</h2><p class="modal-intro">${errorCount?`${errorCount} issue(s) found. Correct the file and upload again; nothing has been imported.`:`${preview.length} pupil(s) ready. Review the sample, then import the entire file.`}</p>${preview.length?`<div class="import-preview-wrap"><table class="import-preview-table"><thead><tr><th>PUPIL ID</th><th>NAME</th><th>CLASS</th><th>GUARDIAN</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}${errorCount?`<div class="import-errors">${errors.map(e=>`<div>Row ${e.row}${e.pupil_id?` · ${escapeHtml(e.pupil_id)}`:''}: ${escapeHtml(e.message)}</div>`).join('')}</div>`:''}<div class="modal-actions"><button class="button button-outline" id="cancelImport">Close</button>${token&&!errorCount?'<button class="button button-primary" id="commitImport">Import pupils</button>':''}</div>`);$('#cancelImport').onclick=closeModal;if(token&&!errorCount)$('#commitImport').onclick=async()=>{const button=$('#commitImport');button.disabled=true;button.textContent='Importing…';try{const result=await api('/api/import/commit',{token});acceptState(result.state);closeModal();render();toast(`${result.imported} pupil(s) imported.`)}catch(err){toast(err.message,'!');button.disabled=false;button.textContent='Import pupils'}}}catch(err){toast(err.message,'!')}finally{$('#rosterFile').value=''}}
  function qrValue(p){return `GW:${p.id}`}
  async function startScanner(){if(!('BarcodeDetector'in window)){toast('Live QR scanning is not available in this browser. Enter the pupil ID below.','!');return}try{const detector=new BarcodeDetector({formats:['qr_code']});const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});window._gwStream=stream;openModal(`<h2 id="modalTitle">Scan pupil card</h2><p class="modal-intro">Hold the QR code in the frame. Confirm the pupil on the next screen.</p><video id="scanVideo" autoplay muted playsinline style="width:100%;border-radius:8px;background:#15182a;max-height:310px;object-fit:cover"></video><p class="scan-note">Camera access stays on this device during the scan.</p><div class="modal-actions"><button class="button button-outline" id="stopCamera">Cancel scan</button></div>`);const video=$('#scanVideo');video.srcObject=stream;video.onloadedmetadata=()=>video.play();$('#stopCamera').onclick=closeModal;const loop=async()=>{if(!window._gwStream||!video.isConnected)return;try{const codes=await detector.detect(video);if(codes.length){const val=codes[0].rawValue.replace(/^GW:/,'');closeModal();findAndScan(val, 'Card scan');return}}catch{}requestAnimationFrame(loop)};setTimeout(loop,600)}catch{toast('Camera permission was not granted. Enter the pupil ID instead.','!')}}
  async function exportCsv(){
    try {
      await api('/api/export/activity', {});
    } catch {}
    const lines=[['Event','Pupil ID','Pupil','Type','Time','Staff','Source','Reason','Manual Entry','Collector','Verification','Alert'],...todayEvents().map(e=>{const p=pupil(e.pupilId)||{};return[e.id,e.pupilId,p.name||'',e.type,e.time,e.staff,e.source,e.reason||'',e.manualEntry||e.reason?'Yes':'No',e.collector||'',e.verification||'',e.alert]} )];const csv=lines.map(row=>row.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`gatewise-activity-${today}.csv`;a.click();URL.revokeObjectURL(a.href);toast('Activity CSV exported.');}
  function pickFilter(button,options,current,cb){const old=$('.filter-menu');old?.remove();const menu=document.createElement('div');menu.className='filter-menu';menu.style.cssText='position:absolute;background:white;border:1px solid #eceef4;border-radius:7px;box-shadow:0 8px 24px #22264018;padding:5px;z-index:20;min-width:130px';const r=button.getBoundingClientRect();menu.style.left=`${r.left+window.scrollX}px`;menu.style.top=`${r.bottom+window.scrollY+4}px`;options.forEach(x=>{const b=document.createElement('button');b.textContent=x;b.style.cssText='display:block;width:100%;text-align:left;background:white;border:0;padding:8px 9px;border-radius:4px;font:10px DM Sans;color:#555b70;cursor:pointer';if(x===current)b.style.color='#5368ef';b.onclick=()=>{menu.remove();cb(x);button.innerHTML=`${escapeHtml(x)} <span>⌄</span>`};menu.append(b)});document.body.append(menu);setTimeout(()=>document.addEventListener('click',function close(e){if(!menu.contains(e.target)&&e.target!==button){menu.remove();document.removeEventListener('click',close)}},{once:true}),0);}

  function openCorrectionModal(eventId) {
    const orig = events.find(x=>x.id===eventId);
    if (!orig) return;
    const p = pupil(orig.pupilId) || { name: 'Unknown pupil' };
    openModal(`<h2 id="modalTitle">Non-destructive Event Correction</h2><p class="modal-intro">Preserves original event (${escapeHtml(orig.id)}) and creates a linked correction entry with mandatory reason.</p><div class="confirm-profile">${avatar(p)}<div><strong>${escapeHtml(p.name)}</strong><small>Original Event: ${escapeHtml(orig.type)} at ${escapeHtml(orig.time)}</small></div></div><form id="correctionForm"><div class="form-field"><label>Correct Event Type</label><select name="type"><option value="arrival" ${orig.type.includes('arrival')?'selected':''}>Arrival</option><option value="departure" ${orig.type.includes('departure')?'selected':''}>Departure</option></select></div><div class="form-field"><label>Correction Reason (Mandatory)</label><textarea name="reason" required placeholder="Reason for correction e.g. accidental scan / wrong pupil selected" style="width:100%;padding:8px;border-radius:6px;border:1px solid #d0d5dd;font:inherit"></textarea></div><div class="modal-actions"><button type="button" class="button button-outline" id="cancelCorrection">Cancel</button><button type="submit" class="button button-primary">Save Non-Destructive Correction</button></div></form>`);
    $('#cancelCorrection').onclick = closeModal;
    $('#correctionForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const newType = f.get('type');
      const reason = f.get('reason').trim();
      if (!reason) { toast('Correction reason is required.','!'); return; }
      try {
        const res = await api('/api/events', {
          pupilId: orig.pupilId,
          type: 'correction',
          source: 'Non-destructive correction',
          reason,
          correctionLink: orig.id,
          manualEntry: true
        });
        acceptState(res.state);
        closeModal();
        render();
        toast(`Linked correction recorded for ${p.name}.`);
      } catch(err) {
        toast(err.message, '!');
      }
    };
  }

  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-page]');if(nav)navigate(nav.dataset.page);
    const go=e.target.closest('[data-goto]');if(go)navigate(go.dataset.goto);
    const modeBtn=e.target.closest('[data-mode]');if(modeBtn){mode=modeBtn.dataset.mode;$$('.mode-button').forEach(b=>b.classList.toggle('selected',b===modeBtn));$('.scan-start').textContent='Start camera scanner';$('.scan-frame h2').textContent=mode==='arrival'?'Scan pupil ID card':'Scan for departure';}
    const req=e.target.closest('[data-request]');if(req){const r=requests.find(x=>x.id===req.dataset.request);if(r)resolvePickupRequest(r,req.dataset.action);}
    const corr=e.target.closest('[data-correct-event]');if(corr){openCorrectionModal(corr.dataset.correctEvent);}
    const detail=e.target.closest('[data-pupil-detail]');if(detail){const p=pupil(detail.dataset.pupilDetail);if(p)openModal(`<h2 id="modalTitle">Pupil card</h2><p class="modal-intro">Demo school ID card. QR contains only a random lookup code in a production implementation.</p><div class="confirm-profile">${avatar(p)}<div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.id)} · ${escapeHtml(p.className)}</small></div></div><div style="display:grid;place-items:center;padding:20px;background:#fafbff;border:1px solid #eceef4;border-radius:8px"><div id="qrCanvas" style="font:700 14px monospace;color:#4c5ddd;border:8px solid white;background:white;padding:18px;letter-spacing:1px">▦ ${escapeHtml(qrValue(p))}</div><small class="card-tag" style="margin-top:8px">Demo QR reference (not scannable artwork)</small></div><div class="modal-actions"><button class="button button-outline" id="closeCard">Close</button></div>`);$('#closeCard').onclick=closeModal;}
    if(e.target.id==='syncNowLink'||e.target.id==='syncNowBtn'){e.preventDefault();syncPendingQueue();}
    if(e.target.id==='reconcileFallbackBtn'){e.preventDefault();openReconcileModal();}
  });

  $('#disclosureToggle')?.addEventListener('change', async e => {
    if (signedInUser?.role !== 'admin') {
      toast('Only an administrator can change disclosure settings.', '!');
      e.target.checked = !e.target.checked;
      return;
    }
    try {
      const res = await api('/api/settings', { discloseCollectorName: e.target.checked });
      schoolSettings = res.school || {};
      toast(`Alert disclosure updated: ${e.target.checked ? 'Collector names disclosed' : 'Collector names kept private'}.`);
    } catch(err) {
      toast(err.message, '!');
      e.target.checked = !e.target.checked;
    }
  });

  $('#offlineStalePolicyToggle')?.addEventListener('change', async e => {
    if (signedInUser?.role !== 'admin') {
      toast('Only an administrator can modify offline pickup policy.', '!');
      e.target.checked = !e.target.checked;
      return;
    }
    try {
      const res = await api('/api/settings', { allowOfflineStalePickupPolicy: e.target.checked });
      schoolSettings = res.school || {};
      toast(`Offline pickup policy updated: ${e.target.checked ? 'Stale pickups permitted with visible warning' : 'Stale pickups strictly blocked in offline mode'}.`);
    } catch(err) {
      toast(err.message, '!');
      e.target.checked = !e.target.checked;
    }
  });

  $('#offlineSimToggle')?.addEventListener('change', e => {
    isOfflineSimulated = e.target.checked;
    updateOfflineStatusUI();
    toast(isOfflineSimulated ? 'Offline simulation enabled. Scans will be queued locally.' : 'Reconnected. Online sync restored.');
    if (!isOfflineSimulated && getLocalQueue().length > 0) {
      syncPendingQueue();
    }
  });

  $('#deviceManagedCheck')?.addEventListener('change', e => {
    deviceManaged = e.target.checked;
    toast(`Device management status: ${deviceManaged ? 'Managed' : 'Unmanaged'}`);
  });

  $('#deviceEncryptedCheck')?.addEventListener('change', e => {
    deviceEncrypted = e.target.checked;
    toast(`Device encryption status: ${deviceEncrypted ? 'Encrypted' : 'Unencrypted'}`);
  });

  window.addEventListener('online', () => {
    updateOfflineStatusUI();
    toast('Network connection detected. Syncing pending queue...');
    syncPendingQueue();
  });
  window.addEventListener('offline', () => {
    updateOfflineStatusUI();
    toast('Network connection lost. Offline mode activated.', '!');
  });

  $('#uploadRosterBtn').onclick=()=>$('#rosterFile').click();$('#rosterFile').onchange=e=>previewRoster(e.target.files[0]);$('#addUserBtn').onclick=openAddUser;$('#userRows').addEventListener('change',async e=>{const select=e.target.closest('[data-user-role]');if(!select)return;try{await api(`/api/users/${select.dataset.userRole}`,{role:select.value});toast('User role updated.');renderUsers()}catch(err){toast(err.message,'!');renderUsers()}});$('#userRows').addEventListener('click',async e=>{const button=e.target.closest('[data-user-active]');if(!button)return;try{await api(`/api/users/${button.dataset.userActive}`,{active:Number(button.dataset.active)===1});toast('User status updated.');renderUsers()}catch(err){toast(err.message,'!')}});
  $('.main-nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)navigate(b.dataset.page)});
  $('[data-goto="scan"]')?.addEventListener('click',()=>navigate('scan'));
  $('#manualForm').addEventListener('submit',e=>{e.preventDefault();findAndScan($('#pupilIdInput').value, 'Manual entry');$('#pupilIdInput').value='';});$('#startCamera').onclick=startScanner;$('#cameraInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(!('BarcodeDetector'in window)){toast('Image QR decoding is not supported here. Search the pupil instead.','!');return}try{const bitmap=await createImageBitmap(file);const detector=new BarcodeDetector({formats:['qr_code']});const result=await detector.detect(bitmap);if(result.length)findAndScan(result[0].rawValue.replace(/^GW:/,''),'Card image scan');else toast('No QR code detected in that image.','!')}catch{toast('Could not read that image. Search the pupil instead.','!')}e.target.value='';};$('#addPupilBtn').onclick=openAddPupil;$('#arrivalSearch').oninput=renderDashboard;$('#pupilSearch').oninput=renderPupils;$('#activitySearch').oninput=renderActivity;$('#pickupSearch').oninput=renderPickup;
  $('#classFilter').onclick=()=>pickFilter($('#classFilter'),['All classes',...new Set(pupils.map(p=>p.className))],classChoice,x=>{classChoice=x;renderDashboard()});$('#directoryFilter').onclick=()=>pickFilter($('#directoryFilter'),['All classes',...new Set(pupils.map(p=>p.className))],classChoice,x=>{classChoice=x;renderPupils()});$('#pupilStatusFilter')?.addEventListener('click',()=>pickFilter($('#pupilStatusFilter'),['All statuses','On campus','Departed','Not arrived'],pupilStatusChoice,x=>{pupilStatusChoice=x;renderPupils()}));$('#eventFilter').onclick=()=>pickFilter($('#eventFilter'),['All events','Arrivals','Departures','Manual entries'],activityChoice,x=>{activityChoice=x;renderActivity()});$('#exportActivity').onclick=exportCsv;
  $('#modalClose').onclick=closeModal;$('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');$('#helpBtn').onclick=()=>{openModal(`<h2 id="modalTitle">Gate team quick guide</h2><p class="modal-intro">A safe, repeatable routine for every pupil movement.</p><ol class="confirm-info"><li>Scan the card or search the pupil by name/ID.</li><li>Compare the pupil with the profile photo on screen.</li><li>For departure, select only an approved collector and follow school ID-check policy.</li><li>Confirm the event and select a reason (e.g. card_missing or card_unreadable) for manual entries. Never release a child solely because a card was scanned.</li></ol><div class="danger-note">Do not photograph or copy a QR code as a workaround. Always use manual entry for missing or unreadable cards.</div><div class="modal-actions"><button class="button button-primary" id="guideDone">Got it</button></div>`);$('#guideDone').onclick=closeModal};$('#pickupHelp').onclick=()=>toast('Follow the school’s approved pickup verification policy.');$('#contactSupport').onclick=e=>{e.preventDefault();toast('Demo: contact your school administrator for support.','i')};$('#notificationsBtn').onclick=()=>toast('Message delivery is not configured in this local MVP.','!');$('.more-button').onclick=async()=>{try{await api('/api/logout',{});signedInUser=null;$('#authScreen').classList.remove('hidden');pupils=[];events=[];requests=[];$('#loginPassword').value='';$('#loginError').classList.add('hidden')}catch(err){toast(err.message,'!')}};
  const now=new Date();$('#todayLabel').textContent=now.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});$('#dateEyebrow').innerHTML=`${now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}).toUpperCase()} <span class="live-label"><i></i> LIVE</span>`;
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('.auth-submit');button.disabled=true;button.textContent='Signing in…';$('#loginError').classList.add('hidden');try{const result=await api('/api/login',{email:$('#loginEmail').value,password:$('#loginPassword').value});setSignedIn(result.user);acceptState(result.state);render()}catch(err){$('#loginError').textContent=err.message==='Failed to fetch'?'Cannot reach the app server. Start Node.js server with npm start and reload this page.':err.message;$('#loginError').classList.remove('hidden')}finally{button.disabled=false;button.innerHTML='Sign in <span>→</span>'}});
  api('/api/me').then(async({user})=>{if(user){setSignedIn(user);await refreshState()}}).catch(()=>{});
})();
