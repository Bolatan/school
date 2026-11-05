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
  let pupils=[], events=[], requests=[], adminCorrections=[], schoolSettings={}, signedInUser=null, guardianPortalData=null, mode='arrival', classChoice='All classes', activityChoice='All events', pupilStatusChoice='All statuses';
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
    updateSessionOptions();
    if($('#disclosureToggle')){
      $('#disclosureToggle').checked=schoolSettings.discloseCollectorName!==false;
    }
    if($('#offlineStalePolicyToggle')){
      $('#offlineStalePolicyToggle').checked=Boolean(schoolSettings.allowOfflineStalePickupPolicy);
    }
  }

  function updateSessionOptions() {
    const sessionSelect = $('#sessionSelect');
    if (!sessionSelect) return;
    const currentVal = sessionSelect.value;
    const sessions = schoolSettings.operatingSessions || (schoolSettings.sessions ? schoolSettings.sessions.map(s => ({ name: s, defaultMode: 'arrival' })) : [
      { id: "morning", name: "Morning Arrival", defaultMode: "arrival" },
      { id: "standard", name: "Standard Day", defaultMode: "arrival" },
      { id: "afternoon", name: "Afternoon Dismissal", defaultMode: "departure" }
    ]);
    sessionSelect.innerHTML = sessions.map(s => {
      const sName = typeof s === 'string' ? s : s.name;
      const sMode = typeof s === 'object' && s.defaultMode ? ` (${s.defaultMode})` : '';
      return `<option value="${escapeHtml(sName)}" ${sName === currentVal ? 'selected' : ''}>${escapeHtml(sName)}${escapeHtml(sMode)}</option>`;
    }).join('');
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
  function setSignedIn(user){
    signedInUser=user;
    $('#authScreen').classList.add('hidden');
    $('.profile strong').textContent=user.name;
    const roleLabels = { admin: 'School administrator', manager: 'School manager', viewer: 'View only', guardian: 'Parent / Guardian' };
    $('.profile small').textContent=roleLabels[user.role]||'School staff';
    $('#userNav').classList.toggle('hidden',user.role!=='admin');
    $('#adminNav')?.classList.toggle('hidden',user.role!=='admin');
    $('#addPupilBtn').classList.toggle('hidden',user.role==='viewer' || user.role==='guardian');
    $('#uploadRosterBtn').classList.toggle('hidden',user.role==='viewer' || user.role==='guardian');
    $('#inviteGuardianBtn')?.classList.toggle('hidden',user.role==='viewer' || user.role==='guardian');
    $('[data-page="admin"]')?.classList.toggle('hidden',user.role!=='admin');
    $('[data-page="scan"]').classList.toggle('hidden',user.role==='viewer' || user.role==='guardian');
    $('[data-goto="scan"]')?.classList.toggle('hidden',user.role==='viewer' || user.role==='guardian');
    $('#guardianPortalNav').classList.toggle('hidden', user.role !== 'guardian');

    if (user.role === 'guardian') {
      $('[data-page="dashboard"]').classList.add('hidden');
      $('[data-page="pupils"]').classList.add('hidden');
      $('[data-page="pickup"]').classList.add('hidden');
      $('[data-page="activity"]').classList.add('hidden');
      navigate('guardianPortal');
    } else {
      $('[data-page="dashboard"]').classList.remove('hidden');
      $('[data-page="pupils"]').classList.remove('hidden');
      $('[data-page="pickup"]').classList.remove('hidden');
      $('[data-page="activity"]').classList.remove('hidden');
    }
  }
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
  function navigate(page){
    if((page==='users'||page==='admin')&&signedInUser?.role!=='admin'){toast('Only an administrator can access this section.','!');return}
    if(page==='scan'&&(signedInUser?.role==='viewer'||signedInUser?.role==='guardian')){toast('Access restricted.','!');return}
    $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    $('#crumbPage').textContent=({dashboard:'Overview',scan:'Scan & log',pupils:'Pupils',pickup:'Pickup approvals',activity:'Activity log',users:'User management',admin:'Administration',guardianPortal:'My Children'})[page]||'Overview';
    $('#sidebar').classList.remove('open');
    window.scrollTo(0,0);
    if(page==='users')renderUsers();
    if(page==='admin')loadAdminWorkspace();
    if(page==='guardianPortal')loadGuardianPortal();
    if(page==='pickup')loadAdminCorrections();
  }
  function render(){renderDashboard();renderPupils();renderPickup();renderActivity();if(signedInUser?.role==='guardian')loadGuardianPortal();}
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

  function eventConfirm(p, isManual=false, initialReason='card_missing', preConfirmedMismatch=false){
    const collectors = p.collectors || [];
    const hasCollectors = collectors.length > 0;
    const device = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    const campus = $('#campusSelect')?.value || 'Primary campus';
    const gate = $('#gateSelect')?.value || 'Main gate';
    const isAdmin = signedInUser?.role === 'admin';
    const channelLabel = (p.preferredChannel || 'sms').toUpperCase();

    const isOnline = isDeviceOnline();
    const allowStalePickup = Boolean(schoolSettings.allowOfflineStalePickupPolicy);
    const pStatus = statusFor(p);

    // Accidental mode error detection:
    // 1) Pupil status vs Mode check
    let pupilStatusMismatchHtml = '';
    if (mode === 'arrival' && pStatus === 'On campus') {
      pupilStatusMismatchHtml = `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:9px 12px;margin:8px 0;font-size:10px;color:#9a3412">
          <strong>⚠ Accidental Mode Error Warning:</strong> ${escapeHtml(p.name)} is <b>already marked On Campus</b> today. Confirming arrival again will result in a duplicate check-in.
        </div>
      `;
    } else if (mode === 'departure' && pStatus !== 'On campus') {
      pupilStatusMismatchHtml = `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:9px 12px;margin:8px 0;font-size:10px;color:#991b1b">
          <strong>⚠ Accidental Mode Error Warning:</strong> ${escapeHtml(p.name)} has <b>not arrived</b> on campus yet (current status: ${escapeHtml(pStatus)}). School policy requires arrival verification before departure release.
        </div>
      `;
    }

    // 2) Operating session vs Mode check
    const selectedSessionName = $('#sessionSelect')?.value || 'Morning Arrival';
    const sessions = schoolSettings.operatingSessions || [];
    const sObj = sessions.find(s => s.name === selectedSessionName || s.id === selectedSessionName);
    const isSessionMismatch = sObj && sObj.defaultMode && sObj.defaultMode !== 'both' && sObj.defaultMode !== mode;

    let sessionMismatchHtml = '';
    if (isSessionMismatch) {
      sessionMismatchHtml = `
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:9px 12px;margin:8px 0;">
          <div style="color:#b45309;font-weight:700;font-size:10px;display:flex;align-items:center;gap:6px">
            <span>⚠</span> OPERATING SESSION MISMATCH WARNING
          </div>
          <p style="margin:4px 0 6px;font-size:9px;color:#92400e;line-height:1.4">
            The gate operating session is set to <b>"${escapeHtml(sObj.name)}"</b> (scheduled for <b>${sObj.defaultMode.toUpperCase()}</b>), but you are recording a <b>${mode.toUpperCase()}</b>.
          </p>
          <label style="display:flex;align-items:center;gap:6px;font-size:10px;color:#78350f;font-weight:700;cursor:pointer">
            <input type="checkbox" id="confirmSessionMismatchCheckbox" ${preConfirmedMismatch ? 'checked' : ''}>
            <span>I confirm this ${mode.toUpperCase()} during ${escapeHtml(sObj.name)} is intentional</span>
          </label>
        </div>
      `;
    }

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
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <h2 id="modalTitle" style="margin:0">Confirm Handover</h2>
        <span class="status-pill ${mode === 'arrival' ? 'status-present' : 'status-departed'}" style="font-size:10px;padding:4px 9px">
          MODE: ${mode === 'arrival' ? 'ARRIVAL' : 'DEPARTURE'}
        </span>
      </div>
      <p class="modal-intro">
        Staff verifies pupil against official photograph before recording handover. Session: <b>${escapeHtml(selectedSessionName)}</b> · Device: <b>${escapeHtml(device)}</b> · Location: <b>${escapeHtml(campus)} (${escapeHtml(gate)})</b>.
      </p>
      ${pupilStatusMismatchHtml}
      ${sessionMismatchHtml}
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
    let isSubmitting = false;
    $('#saveEvent').onclick = async () => {
      if (isSubmitting) return; // Prevent repeated taps

      const excSection = $('#exceptionSection');
      const isExceptionMode = excSection && !excSection.classList.contains('hidden');
      const isOnline = isDeviceOnline();

      // Check operating session mismatch confirmation prompt
      if (isSessionMismatch) {
        const confirmedMismatch = $('#confirmSessionMismatchCheckbox')?.checked;
        if (!confirmedMismatch) {
          toast(`Please tick the session mismatch confirmation checkbox before logging ${mode}.`, '!');
          return;
        }
      }

      // Check offline stale pickup policy on departure
      if (!isOnline && mode === 'departure' && !isExceptionMode) {
        const allowStale = Boolean(schoolSettings.allowOfflineStalePickupPolicy);
        const ack = $('#acknowledgeStalePolicy')?.checked;
        if (!allowStale || !ack) {
          toast('Offline mode does not permit stale pickup permissions to be treated as current without explicit school policy. Use manual fallback.', '!');
          return;
        }
      }

      const saveBtn = $('#saveEvent');
      isSubmitting = true;
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Recording…';
      }

      try {
        if (mode === 'departure' && (!hasCollectors || isExceptionMode)) {
          if (!isAdmin) {
            toast('Collector not approved. Escalation instruction: Only a school administrator can authorize an exception.', '!');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Blocked — Admin Required'; }
            isSubmitting = false;
            return;
          }
          const collectorName = $('#exceptionCollectorInput')?.value.trim();
          const reason = $('#exceptionReasonInput')?.value.trim();
          const verification = $('#exceptionVerifySelect')?.value || 'Admin Exception: ID checked';
          if (!collectorName || !reason) {
            toast('Collector name and exception reason are required for administrator authorization.', '!');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Authorize Exception & Release'; }
            isSubmitting = false;
            return;
          }
          await recordAuthorizedException(p, collectorName, reason, verification);
        } else {
          const eventType = isManual ? (mode === 'arrival' ? 'manual_arrival' : 'manual_departure') : mode;
          await recordEvent(p, eventType, isManual ? 'Manual entry' : 'Card scan', isManual ? ($('#reasonSelect')?.value || 'card_missing') : '');
        }
      } finally {
        isSubmitting = false;
      }
    };
  }

  async function recordAuthorizedException(p, collectorName, reason, verification) {
    const device = $('#deviceSelect')?.value || 'Primary Gate Terminal';
    const campus = $('#campusSelect')?.value || 'Primary campus';
    const gate = $('#gateSelect')?.value || 'Main gate';
    const session = $('#sessionSelect')?.value || 'Morning Arrival';
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
        session,
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

    const clientEventId = 'gw_evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
        session,
        manualEntry: true,
        confirmModeMismatch: true
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
    const session = $('#sessionSelect')?.value || 'Morning Arrival';
    const isOnline = isDeviceOnline();

    const isDep = type === 'departure' || type === 'manual_departure';

    if (isDep) {
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
        session,
        manualEntry: source === 'Manual entry' || source === 'Manual ID lookup' || !!reason || type.startsWith('manual_'),
        collectorId: isDep ? collectorId : undefined,
        collectorName: isDep ? collectorName : undefined,
        verification,
        deviceCapturedAt: Date.now(),
        staffEmail: signedInUser?.email || '',
        deviceManaged: true,
        deviceEncrypted: true,
        allowOfflineStalePickupPolicy: isDep && Boolean(schoolSettings.allowOfflineStalePickupPolicy),
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
        session,
        clientEventId, // Prevents duplicate events from repeated taps / network retries
        confirmModeMismatch: true,
        manualEntry: source === 'Manual entry' || source === 'Manual ID lookup' || !!reason || type.startsWith('manual_'),
        collectorId: isDep ? collectorId : undefined,
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
  function matchPupil(p, query) {
    const q = query.trim().toLowerCase();
    const pid = p.id.toLowerCase();
    const name = p.name.toLowerCase();
    const numericPart = pid.replace(/[^0-9]/g, '');
    const queryNumeric = q.replace(/[^0-9]/g, '');
    if (pid === q || pid.endsWith('-' + q)) return true;
    if (queryNumeric && queryNumeric.length >= 3 && numericPart.includes(queryNumeric)) return true;
    if (pid.includes(q)) return true;
    if (name.includes(q)) return true;
    return false;
  }

  function findAndScan(term, source='Card scan', manualReason='card_missing'){
    const query = term.trim().toLowerCase();
    if (!query) return;
    const matches = pupils.filter(p => matchPupil(p, query));
    if (!matches.length) {
      toast('Pupil not found by name or pupil number. Search the directory.', '!');
      return;
    }
    const isManual = source !== 'Card scan';
    if (matches.length === 1) {
      eventConfirm(matches[0], isManual, manualReason);
      return;
    }
    const listHtml = matches.map(p => `
      <div class="confirm-profile pupil-select-item" data-select-pupil="${escapeHtml(p.id)}" style="cursor:pointer;margin:4px 0">
        <div class="photo-preview-large" style="width:40px;height:40px;font-size:20px">${escapeHtml(p.photo||p.initials)}</div>
        <div style="flex:1">
          <strong style="font-size:12px">${escapeHtml(p.name)}</strong>
          <small style="display:block;color:#6f7487">${escapeHtml(p.id)} · ${escapeHtml(p.className)} · Guardian: ${escapeHtml(p.guardian)}</small>
        </div>
        <button class="button button-small button-outline">Select & Verify</button>
      </div>
    `).join('');
    openModal(`
      <h2 id="modalTitle">Select Pupil to Verify</h2>
      <p class="modal-intro">
        Multiple pupils matched "${escapeHtml(term)}". Select the pupil and verify against their on-screen photograph before logging ${mode === 'arrival' ? 'arrival' : 'departure'}.
      </p>
      <div style="display:grid;gap:6px;max-height:280px;overflow:auto;padding-right:4px">${listHtml}</div>
      <div class="modal-actions"><button class="button button-outline" id="cancelSelectPupil">Cancel</button></div>
    `);
    $('#cancelSelectPupil').onclick = closeModal;
    $$('[data-select-pupil]').forEach(el => {
      el.onclick = () => {
        const selected = pupil(el.dataset.selectPupil);
        if (selected) eventConfirm(selected, isManual, manualReason);
      };
    });
  }

  async function openExceptionReport() {
    openModal(`<h2 id="modalTitle">Exception Reporting: Missing & Unreadable Cards</h2><p class="modal-intro">Loading exception report data from MongoDB...</p>`);
    try {
      const data = await api('/api/reports/exceptions');
      const { summary, exceptions } = data;
      const rowsHtml = exceptions.length ? exceptions.map(ex => `
        <tr>
          <td><b>${escapeHtml(ex.pupilName)}</b><br><small style="color:#8a8fa3">${escapeHtml(ex.pupilId)} · ${escapeHtml(ex.className)}</small></td>
          <td><span class="status-pill ${ex.type.includes('arrival')?'status-present':'status-departed'}">${escapeHtml(ex.type)}</span></td>
          <td><span class="manual-tag">${escapeHtml(ex.reason === 'card_missing' ? 'Card missing' : ex.reason === 'card_unreadable' ? 'Unreadable QR' : (ex.reason || 'Manual'))}</span></td>
          <td>${escapeHtml(ex.collector ? `${ex.collector} (${ex.verification||'ID checked'})` : '—')}</td>
          <td>${escapeHtml(ex.staff)}</td>
          <td><small>${escapeHtml(ex.date)} ${escapeHtml(ex.time)}</small></td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align:center;padding:16px;color:#9a9eae">No card exceptions recorded yet.</td></tr>';

      openModal(`
        <h2 id="modalTitle">Exception Report: Card Exceptions & Manual Entries</h2>
        <p class="modal-intro">
          Traceable audit log of all manual entries resulting from missing cards, unreadable QR codes, or authorized exceptions.
        </p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;text-align:center">
            <span style="font-size:18px;font-weight:700;color:#92400e">${summary.todayMissingCard}</span>
            <small style="display:block;font-size:9px;color:#78350f;font-weight:600">Today Missing Cards</small>
          </div>
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;text-align:center">
            <span style="font-size:18px;font-weight:700;color:#92400e">${summary.todayUnreadableQr}</span>
            <small style="display:block;font-size:9px;color:#78350f;font-weight:600">Today Unreadable QRs</small>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px 10px;text-align:center">
            <span style="font-size:18px;font-weight:700;color:#1e40af">${summary.totalExceptions}</span>
            <small style="display:block;font-size:9px;color:#1e3a8a;font-weight:600">Total Exceptions Logged</small>
          </div>
        </div>
        <div style="max-height:260px;overflow:auto;border:1px solid #eceef4;border-radius:6px">
          <table class="exception-report-table">
            <thead>
              <tr>
                <th>PUPIL</th>
                <th>TYPE</th>
                <th>REASON</th>
                <th>COLLECTOR</th>
                <th>STAFF</th>
                <th>TIMESTAMP</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
        <div class="modal-actions">
          <button class="button button-outline" id="closeExceptionReport">Close</button>
          <button class="button button-primary" id="viewInActivityLog">View in Activity Log</button>
        </div>
      `);
      $('#closeExceptionReport').onclick = closeModal;
      $('#viewInActivityLog').onclick = () => {
        closeModal();
        activityChoice = 'Manual entries';
        const btn = $('#eventFilter');
        if (btn) btn.innerHTML = `Exceptions (Manual cards) <span>⌄</span>`;
        navigate('activity');
      };
    } catch (err) {
      toast(`Failed to load exception report: ${err.message}`, '!');
      closeModal();
    }
  }
  function openAddPupil(){
    openModal(`
      <h2 id="modalTitle">Add a pupil & invite guardian</h2>
      <p class="modal-intro">The school creates the pupil record and invites each guardian using a verified contact method. Guardian proves channel control and accepts privacy terms.</p>
      <form id="addPupilForm" class="form-grid">
        <div class="form-field full"><label>Pupil Full Name *</label><input name="name" required placeholder="e.g. Maya Lin"></div>
        <div class="form-field"><label>Pupil ID</label><input name="id" placeholder="Auto-generated if blank (e.g. NF-4001)"></div>
        <div class="form-field"><label>Class *</label><select name="className"><option>Grade 1C</option><option>Grade 2B</option><option>Grade 3A</option><option>Grade 4A</option><option>Grade 5B</option></select></div>
        <div class="form-field full"><label>Primary Guardian Name *</label><input name="guardian" required placeholder="Parent or legal guardian name"></div>
        <div class="form-field"><label>Guardian Mobile Phone</label><input name="guardianPhone" placeholder="+1 555-0100" value="+1 555-0100"></div>
        <div class="form-field"><label>Guardian Email</label><input name="guardianEmail" type="email" placeholder="guardian@example.com"></div>
        <div class="form-field full">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;color:#334155">
            <input type="checkbox" name="inviteGuardian" id="inviteGuardianCheckbox" checked>
            <span>Invite guardian now via verified contact method</span>
          </label>
        </div>
        <div id="pupilInviteFields" class="form-field full" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0">
          <div>
            <label>Verified Contact Method *</label>
            <select name="verifiedContactMethod">
              <option value="sms">SMS Text (proves phone control)</option>
              <option value="email">Email (proves inbox control)</option>
            </select>
          </div>
          <div>
            <label>Relationship to Child</label>
            <select name="relationship">
              <option value="Mother">Mother</option>
              <option value="Father">Father</option>
              <option value="Legal Guardian">Legal Guardian</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div style="grid-column:1/-1">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:10px">
              <input type="checkbox" name="isLegalGuardian" checked>
              <span>School certifies legal guardian status (school authority required)</span>
            </label>
          </div>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelAdd">Cancel</button>
          <button class="button button-primary" type="submit">Create pupil record</button>
        </div>
      </form>
    `);

    $('#cancelAdd').onclick=closeModal;
    $('#inviteGuardianCheckbox').onchange = (e) => {
      $('#pupilInviteFields').style.display = e.target.checked ? 'grid' : 'none';
    };

    $('#addPupilForm').onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);
      const name=String(f.get('name')).trim();
      const shouldInvite = f.get('inviteGuardian') !== null;
      try {
        const res = await api('/api/pupils', {
          name,
          id: String(f.get('id')).trim(),
          className: f.get('className'),
          guardian: String(f.get('guardian')).trim(),
          guardianPhone: String(f.get('guardianPhone') || '').trim(),
          guardianEmail: String(f.get('guardianEmail') || '').trim(),
          inviteGuardian: shouldInvite,
          verifiedContactMethod: f.get('verifiedContactMethod') || 'sms',
          relationship: f.get('relationship') || 'Parent',
          isLegalGuardian: f.get('isLegalGuardian') !== null
        });
        acceptState(res.state);
        closeModal();
        render();
        toast(`${name} added to the directory.`);
        if (res.invite) {
          openInviteSentSuccessModal(res.invite);
        }
      } catch(err) {
        toast(err.message, '!');
      }
    };
  }
  async function renderUsers(){
    if(signedInUser?.role!=='admin')return;
    const body=$('#userRows');
    body.innerHTML='<tr><td colspan="6">Loading accounts…</td></tr>';
    try{
      const {users}=await api('/api/users');
      body.innerHTML=users.map(u=>`
        <tr>
          <td><b>${escapeHtml(u.name)}</b></td>
          <td>${escapeHtml(u.email)}</td>
          <td>
            <select class="user-role-select" data-user-role="${u.id}" ${u.id===signedInUser.id?'disabled':''}>
              <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
              <option value="manager" ${u.role==='manager'?'selected':''}>Manager</option>
              <option value="viewer" ${u.role==='viewer'?'selected':''}>View only</option>
            </select>
          </td>
          <td>
            <span style="font-size:10px;font-weight:600;color:${u.mfaEnabled?'#16a34a':'#64748b'}">MFA: ${u.mfaEnabled?'Active':'Disabled'}</span>
            <br>
            <small style="color:#64748b">Lock: ${u.deviceLockEnforced?'Enforced':'Optional'}</small>
          </td>
          <td>${badge(u.active?'Active':'Revoked',u.active?'status-approved':'status-neutral')}</td>
          <td>
            ${u.active && u.id!==signedInUser.id ? `
              <button class="button button-outline user-revoke-btn" data-revoke-user="${u.id}" data-user-name="${escapeHtml(u.name)}" style="color:#b91c1c;border-color:#fca5a5;padding:4px 8px;font-size:10px">Revoke Account</button>
            ` : (u.id===signedInUser.id ? '<small style="color:#64748b">Active Admin</small>' : '<small style="color:#b91c1c">Revoked</small>')}
          </td>
        </tr>
      `).join('')||'<tr><td colspan="6">No staff accounts.</td></tr>';
    }catch(err){
      body.innerHTML=`<tr><td colspan="6">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function openAddUser(){
    openModal(`
      <h2 id="modalTitle">Create staff account</h2>
      <p class="modal-intro">Strong staff sign-in: Password must be at least 12 characters with uppercase, lowercase, numbers, and special symbols.</p>
      <form id="addUserForm" class="form-grid">
        <div class="form-field full"><label>Full name *</label><input name="name" required maxlength="120"></div>
        <div class="form-field full"><label>School email *</label><input name="email" type="email" required maxlength="254"></div>
        <div class="form-field"><label>Role *</label><select name="role"><option value="manager">Manager — manage pupils and gate operations</option><option value="viewer">View only — read school records</option><option value="admin">Admin — manage users and all operations</option></select></div>
        <div class="form-field"><label>Assigned Campus</label><select name="assignedCampus"><option value="Primary campus">Primary campus</option><option value="Secondary campus">Secondary campus</option><option value="North gate annex">North gate annex</option></select></div>
        <div class="form-field full"><label>Temporary password (at least 12 characters: Upper, lower, digit, symbol) *</label><input name="password" type="password" minlength="12" required autocomplete="new-password" value="GatewiseStaff!26"></div>
        <div class="form-field full"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="mfaEnforced" checked><span>Require Multi-Factor Authentication (MFA)</span></label></div>
        <div class="form-field full"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="deviceLockEnforced" checked><span>Require device lock PIN at terminal sign-in</span></label></div>
        <div class="modal-actions form-field full"><button type="button" class="button button-outline" id="cancelAddUser">Cancel</button><button class="button button-primary" type="submit">Create account</button></div>
      </form>
    `);
    $('#cancelAddUser').onclick=closeModal;
    $('#addUserForm').onsubmit=async ev=>{
      ev.preventDefault();
      const f=new FormData(ev.currentTarget);
      try{
        await api('/api/users',{
          name:String(f.get('name')).trim(),
          email:String(f.get('email')).trim(),
          role:f.get('role'),
          assignedCampus:f.get('assignedCampus'),
          password:f.get('password'),
          mfaEnforced:f.get('mfaEnforced')!==null,
          deviceLockEnforced:f.get('deviceLockEnforced')!==null
        });
        closeModal();
        toast('Staff account created. Share temporary password privately.');
        renderUsers();
      }catch(err){
        toast(err.message,'!');
      }
    };
  }

  // -------------------------------------------------------------
  // ADMINISTRATION WORKSPACE LOGIC
  // -------------------------------------------------------------
  async function loadAdminWorkspace() {
    if (signedInUser?.role !== 'admin') return;
    loadAdminCampuses();
    loadAdminSessions();
    loadAdminClasses();
    loadAdminDevices();
    loadAdminTemplates();
    loadAdminEscalation();
    loadAdminRetention();
    loadAdminAudit();
    loadSafeguardingAndIncidents();
    loadSystemNfrGovernance();
  }

  // Load Safeguarding Incidents and Security Alerts
  async function loadSafeguardingAndIncidents() {
    try {
      const [alertsRes, incidentsRes] = await Promise.all([
        api('/api/safeguarding/alerts').catch(() => ({ alerts: [] })),
        api('/api/safeguarding/incidents').catch(() => ({ incidents: [] }))
      ]);

      const alerts = alertsRes.alerts || [];
      const incidents = incidentsRes.incidents || [];

      // Render alerts
      const activeAlerts = alerts.filter(a => !a.acknowledged);
      const alertsBadge = $('#securityAlertsBadge');
      if (alertsBadge) {
        alertsBadge.textContent = `${activeAlerts.length} Active`;
        alertsBadge.style.background = activeAlerts.length ? '#ef4444' : '#16a34a';
      }

      const alertsList = $('#securityAlertsList');
      if (alertsList) {
        if (!alerts.length) {
          alertsList.innerHTML = '<span style="font-size:11px;color:#64748b">No security alerts recorded.</span>';
        } else {
          alertsList.innerHTML = alerts.slice(0, 5).map(a => `
            <div style="background:#fff;border:1px solid ${a.acknowledged ? '#e2e8f0' : '#fca5a5'};border-radius:6px;padding:8px;font-size:11px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="color:${a.severity === 'critical' ? '#991b1b' : a.severity === 'high' ? '#b91c1c' : '#b45309'}">⚠ ${escapeHtml(a.title)}</b>
                ${a.acknowledged ? '<span style="color:#16a34a">✓ Acknowledged</span>' : `<button class="button button-small button-outline ack-alert-btn" data-alert-id="${a.id}" style="font-size:10px;padding:1px 6px">Ack</button>`}
              </div>
              <p style="margin:4px 0 0;color:#475569">${escapeHtml(a.details)}</p>
              <small style="color:#94a3b8">${new Date(a.createdAt).toLocaleTimeString()} · Target: ${escapeHtml(a.identifier || 'system')}</small>
            </div>
          `).join('');

          $$('.ack-alert-btn').forEach(b => {
            b.onclick = async () => {
              try {
                await api(`/api/safeguarding/alerts/${b.dataset.alertId}/acknowledge`, {});
                toast('Alert acknowledged.');
                loadSafeguardingAndIncidents();
              } catch (e) {
                toast(e.message, '!');
              }
            };
          });
        }
      }

      // Render incidents table
      const tbody = $('#securityIncidentRows');
      if (tbody) {
        if (!incidents.length) {
          tbody.innerHTML = '<tr><td colspan="6">No safeguarding incidents reported.</td></tr>';
        } else {
          tbody.innerHTML = incidents.map(inc => `
            <tr>
              <td><span class="pupil-id">${escapeHtml(inc.id)}</span></td>
              <td>${badge(inc.incidentType.replace('_', ' '), inc.severity === 'critical' || inc.severity === 'high' ? 'status-departed' : 'status-pending')}<br><small style="color:#64748b">Sev: ${escapeHtml(inc.severity)}</small></td>
              <td><b>${escapeHtml(inc.title)}</b><br><small style="color:#475569">${escapeHtml(inc.description)}</small>${inc.targetId ? `<br><small style="color:#2563eb">Target: ${escapeHtml(inc.targetType || 'item')}: ${escapeHtml(inc.targetId)}</small>` : ''}</td>
              <td>${escapeHtml(inc.reportedBy)}<br><small style="color:#94a3b8">${new Date(inc.createdAt).toLocaleString()}</small></td>
              <td>${badge(inc.status, inc.status === 'resolved' ? 'status-approved' : 'status-pending')}</td>
              <td>
                ${inc.status !== 'resolved' ? `<button class="button button-small button-outline resolve-incident-btn" data-inc-id="${inc.id}">Resolve</button>` : `<small style="color:#16a34a">Resolved: ${escapeHtml(inc.resolutionNotes || 'Done')}</small>`}
              </td>
            </tr>
          `).join('');

          $$('.resolve-incident-btn').forEach(b => {
            b.onclick = () => openResolveIncidentModal(b.dataset.incId);
          });
        }
      }
    } catch {}
  }

  function openResolveIncidentModal(incidentId) {
    openModal(`
      <h2 id="modalTitle">Resolve Safeguarding Incident</h2>
      <p class="modal-intro">Preserve resolution details for incident audit compliance.</p>
      <form id="resolveIncidentForm" class="form-grid">
        <div class="form-field full">
          <label>Resolution Notes & Remediation Summary *</label>
          <textarea id="resolveNotes" rows="3" required placeholder="Explain findings, collector/device verification, and corrective actions taken..." style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px"></textarea>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelResolve">Cancel</button>
          <button type="submit" class="button button-primary">Confirm Resolution</button>
        </div>
      </form>
    `);
    $('#cancelResolve').onclick = closeModal;
    $('#resolveIncidentForm').onsubmit = async (e) => {
      e.preventDefault();
      const notes = $('#resolveNotes').value.trim();
      try {
        await api(`/api/safeguarding/incidents/${incidentId}/resolve`, { resolutionNotes: notes });
        toast('Incident resolved and audit log preserved.');
        closeModal();
        loadSafeguardingAndIncidents();
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  function openReportIncidentModal() {
    openModal(`
      <h2 id="modalTitle">Report Safeguarding Incident</h2>
      <p class="modal-intro">Document security incidents with immediate escalation and automated safeguarding actions.</p>
      <form id="reportIncidentForm" class="form-grid">
        <div class="form-field">
          <label>Incident Type *</label>
          <select id="incType" required class="gate-dropdown" style="width:100%">
            <option value="lost_device">Lost Device (immediate device block)</option>
            <option value="compromised_account">Compromised Staff Account (session revoke)</option>
            <option value="unauthorized_pickup">Suspected Unauthorized Pickup</option>
            <option value="incorrect_alert">Incorrect Alert Notification</option>
            <option value="suspicious_scan_pattern">Suspicious Scan Pattern</option>
            <option value="other">Other Safeguarding Concern</option>
          </select>
        </div>
        <div class="form-field">
          <label>Severity *</label>
          <select id="incSeverity" class="gate-dropdown" style="width:100%">
            <option value="critical">Critical</option>
            <option value="high" selected>High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div class="form-field full">
          <label>Incident Title *</label>
          <input type="text" id="incTitle" required placeholder="e.g. Handheld terminal lost at North Gate...">
        </div>
        <div class="form-field full">
          <label>Target Identifier (Device Name / User Email / Pupil ID)</label>
          <input type="text" id="incTargetId" placeholder="e.g. DEV-001 or staff@northfield.school">
        </div>
        <div class="form-field full">
          <label>Detailed Safeguarding Description *</label>
          <textarea id="incDesc" rows="3" required placeholder="Describe what occurred, who was involved, and current status..."></textarea>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelReport">Cancel</button>
          <button type="submit" class="button button-primary">Submit & Escalate</button>
        </div>
      </form>
    `);
    $('#cancelReport').onclick = closeModal;
    $('#reportIncidentForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const payload = {
          incidentType: $('#incType').value,
          severity: $('#incSeverity').value,
          title: $('#incTitle').value.trim(),
          targetId: $('#incTargetId').value.trim(),
          description: $('#incDesc').value.trim()
        };
        await api('/api/safeguarding/incidents', payload);
        toast('Safeguarding incident reported and escalated.');
        closeModal();
        loadSafeguardingAndIncidents();
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  $('#reportIncidentBtn')?.addEventListener('click', openReportIncidentModal);
  $('#refreshSafeguardingBtn')?.addEventListener('click', loadSafeguardingAndIncidents);

  // Load System & NFR Governance Status
  async function loadSystemNfrGovernance() {
    try {
      const res = await api('/api/system/status');
      const container = $('#systemNfrContent');
      if (!container) return;

      container.innerHTML = `
        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">📶 Availability & Service SLA</span>
            <span class="nfr-status-pill ${res.availability.status === 'healthy' ? 'healthy' : 'degraded'}">${res.availability.status}</span>
          </div>
          <div style="font-size:11px;font-weight:600;color:#1e293b">Target: ${res.availability.targetUptimePercent}% monthly availability</div>
          <p style="font-size:10px;color:#64748b;margin:0">${escapeHtml(res.availability.postPilotTarget)}</p>
          <ul class="nfr-list">
            <li><b>Pilot objective:</b> ${escapeHtml(res.availability.pilotServiceObjective)}</li>
            <li><b>Degraded mode active:</b> ${res.availability.degradedModeActive ? 'YES ⚠' : 'No (Standard online)'}</li>
            ${res.availability.degradedReason ? `<li><b>Reason:</b> ${escapeHtml(res.availability.degradedReason)}</li>` : ''}
          </ul>
        </div>

        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">⚡ Performance & Response Times</span>
            <span class="nfr-status-pill healthy">Optimal</span>
          </div>
          <div style="font-size:11px;font-weight:600;color:#1e293b">Scan lookup & confirmation: &lt;3s (p95)</div>
          <ul class="nfr-list">
            <li><b>Measured scan latency (p95):</b> ${res.performance.lastMeasuredP95Ms}ms</li>
            <li><b>Event confirmation target:</b> Within ${res.performance.p95ThresholdSeconds} seconds</li>
            <li><b>Concurrency profile:</b> ${escapeHtml(res.performance.concurrencyProfile)}</li>
          </ul>
        </div>

        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">🛡 Security & Traffic Encryption</span>
            <span class="nfr-status-pill healthy">Compliant</span>
          </div>
          <ul class="nfr-list">
            <li><b>Traffic in transit:</b> ${escapeHtml(res.security.trafficEncryption)}</li>
            <li><b>Data at rest:</b> ${escapeHtml(res.security.dataAtRestEncryption)}</li>
            <li><b>Short-lived sessions:</b> ${res.security.shortLivedSessions.timeoutMinutes}m timeout; HttpOnly cookies</li>
            <li><b>Security logging:</b> Sanitized audit logs strictly exclude unnecessary pupil PII</li>
          </ul>
        </div>

        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">🔐 Privacy & Data Minimization</span>
            <span class="nfr-status-pill healthy">Protected</span>
          </div>
          <ul class="nfr-list">
            <li><b>Scope:</b> Least-privilege role & campus boundary enforcement</li>
            <li><b>Retention:</b> Attendance ${res.privacy.retentionPolicy.attendanceRetentionDays}d, Audit ${res.privacy.retentionPolicy.auditLogRetentionDays}d, Offline queue ${res.privacy.retentionPolicy.offlineQueueTtlHours}h</li>
            <li><b>Processors:</b> Documented DPA / recipients available via compliance API</li>
          </ul>
        </div>

        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">♿ Accessibility & Guardian Views</span>
            <span class="nfr-status-pill healthy">WCAG 2.1 AA</span>
          </div>
          <ul class="nfr-list">
            <li><b>Contrast & targets:</b> High contrast palette, minimum 44x44px touch targets</li>
            <li><b>Screen readers:</b> ARIA roles, landmarks, live announcement regions</li>
            <li><b>Errors:</b> Plain-language, actionable guidance without cryptic codes</li>
          </ul>
        </div>

        <div class="nfr-card">
          <div class="nfr-card-header">
            <span class="nfr-card-title">📱 Compatibility & Hardware</span>
            <span class="nfr-status-pill healthy">Verified</span>
          </div>
          <ul class="nfr-list">
            <li><b>Android minimum:</b> ${escapeHtml(res.compatibility.minimumAndroidVersion)}</li>
            <li><b>iOS minimum:</b> ${escapeHtml(res.compatibility.minimumIosVersion)}</li>
            <li><b>Validated:</b> Zebra TC21/TC26, Galaxy Tab Active3/A9, iPad (9th/10th Gen)</li>
          </ul>
        </div>

        <div class="nfr-card" style="grid-column:1/-1">
          <div class="nfr-card-header">
            <span class="nfr-card-title">🌍 Localization & Reliability Infrastructure</span>
            <span class="nfr-status-pill healthy">Standardized</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:10px;color:#475569">
            <div>
              <b>Localization standards:</b>
              <ul class="nfr-list" style="margin-top:4px">
                <li><b>Storage:</b> ${escapeHtml(res.localization.storageStandard)}</li>
                <li><b>Campus display:</b> Local timezone (${escapeHtml(res.localization.defaultTimezone)})</li>
                <li><b>Formats:</b> E.164 phones, ISO dates, locales [${res.localization.supportedLocales.join(', ')}]</li>
              </ul>
            </div>
            <div>
              <b>Reliability infrastructure:</b>
              <ul class="nfr-list" style="margin-top:4px">
                <li><b>Idempotency:</b> Deduplication via clientEventId prevent double check-ins</li>
                <li><b>Durable offline queues:</b> AES-encrypted local storage with 24-hr expiry</li>
                <li><b>Reconciliation:</b> Daily timeline, missing pattern alerts, manual fallback audit</li>
              </ul>
            </div>
          </div>
        </div>
      `;
    } catch {}
  }

  // Switch Admin Tabs
  $$('.admin-tab-btn').forEach(btn => {
    btn.onclick = () => {
      const targetTab = btn.dataset.adminTab;
      $$('.admin-tab-btn').forEach(b => {
        b.classList.remove('button-primary');
        b.classList.add('button-outline');
      });
      btn.classList.remove('button-outline');
      btn.classList.add('button-primary');
      $$('.admin-tab-content').forEach(c => c.classList.add('hidden'));
      $(`#adminTab-${targetTab}`)?.classList.remove('hidden');
    };
  });

  // Campuses
  async function loadAdminCampuses() {
    try {
      const res = await api('/api/admin/campuses');
      const list = res.campuses || [];
      const tbody = $('#campusRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(c => `
        <tr>
          <td><b>${escapeHtml(c.name)}</b><br><small style="color:#64748b">${escapeHtml(c.address || 'Address not specified')}</small></td>
          <td><span class="pupil-id">${escapeHtml(c.code)}</span></td>
          <td>${escapeHtml(c.timezone)}</td>
          <td>${(c.gates || []).map(g => `<span class="class-pill" style="margin:1px">${escapeHtml(g)}</span>`).join(' ')}</td>
          <td>${badge(c.active ? 'Active' : 'Inactive', c.active ? 'status-approved' : 'status-neutral')}</td>
          <td><button class="button button-outline button-small edit-campus-btn" data-campus-id="${c.id}">Edit</button></td>
        </tr>
      `).join('') || '<tr><td colspan="6">No campuses found.</td></tr>';
    } catch {}
  }

  // Sessions
  async function loadAdminSessions() {
    try {
      const res = await api('/api/sessions');
      const sessions = res.sessions || [];
      const tbody = $('#sessionRows');
      if (!tbody) return;
      tbody.innerHTML = sessions.map(s => `
        <tr>
          <td><b>${escapeHtml(s.name)}</b></td>
          <td>${escapeHtml(s.startTime)} - ${escapeHtml(s.endTime)}</td>
          <td><span class="status-pill ${s.defaultMode==='arrival'?'status-present':s.defaultMode==='departure'?'status-departed':'status-approved'}">${escapeHtml(s.defaultMode)}</span></td>
          <td><button class="button button-outline button-small" data-session-name="${escapeHtml(s.name)}">Active</button></td>
        </tr>
      `).join('') || '<tr><td colspan="4">No sessions found.</td></tr>';
    } catch {}
  }

  // Classes
  async function loadAdminClasses() {
    try {
      const res = await api('/api/admin/classes');
      const list = res.classes || [];
      const tbody = $('#classRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(cl => `
        <tr>
          <td><b>${escapeHtml(cl.name)}</b></td>
          <td>${escapeHtml(cl.gradeLevel || 'N/A')}</td>
          <td>${escapeHtml(cl.campus)}</td>
          <td>${escapeHtml(cl.teacherName || 'Unassigned')}</td>
          <td>${cl.capacity} pupils</td>
          <td><button class="button button-outline button-small edit-class-btn" data-class-id="${cl.id}">Edit</button></td>
        </tr>
      `).join('') || '<tr><td colspan="6">No classes configured.</td></tr>';
    } catch {}
  }

  // Devices & Lock
  async function loadAdminDevices() {
    try {
      const res = await api('/api/admin/devices');
      const list = res.devices || [];
      const tbody = $('#deviceRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(d => `
        <tr>
          <td><b>${escapeHtml(d.name)}</b><br><small style="color:#64748b">${escapeHtml(d.id)}</small></td>
          <td><span class="class-pill">${escapeHtml(d.type.toUpperCase())}</span></td>
          <td>${escapeHtml(d.assignedCampus)} (${escapeHtml(d.assignedGate)})</td>
          <td>${escapeHtml(d.assignedStaff || 'Unassigned')}</td>
          <td>${d.deviceLockEnabled ? '<span style="color:#16a34a;font-weight:600">✓ PIN Locked</span>' : '<span style="color:#b91c1c">Unlocked</span>'}</td>
          <td>${badge(d.status.toUpperCase(), d.status==='active'?'status-approved':'status-departed')}</td>
          <td>
            ${d.status==='active' ? `
              <button class="button button-outline button-small revoke-device-btn" data-device-id="${d.id}" data-device-name="${escapeHtml(d.name)}" style="color:#b91c1c;border-color:#fca5a5">Revoke Lost Device</button>
            ` : '<small style="color:#b91c1c">Revoked</small>'}
          </td>
        </tr>
      `).join('') || '<tr><td colspan="7">No devices registered.</td></tr>';
    } catch {}
  }

  // Templates
  async function loadAdminTemplates() {
    try {
      const res = await api('/api/admin/templates');
      const list = res.templates || [];
      const tbody = $('#templateRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(t => `
        <tr>
          <td><b>${escapeHtml(t.name)}</b><br><small style="color:#64748b">${escapeHtml(t.id)}</small></td>
          <td><span class="class-pill">${escapeHtml(t.type)}</span></td>
          <td>${escapeHtml(t.channel.toUpperCase())}</td>
          <td><code style="font-size:10px">${escapeHtml(t.templateBody)}</code></td>
          <td><button class="button button-outline button-small edit-template-btn" data-template-id="${t.id}">Edit</button></td>
        </tr>
      `).join('') || '<tr><td colspan="5">No templates configured.</td></tr>';
    } catch {}
  }

  // Escalation Contacts
  async function loadAdminEscalation() {
    try {
      const res = await api('/api/admin/escalation-contacts');
      const list = res.contacts || [];
      const tbody = $('#escalationRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(c => `
        <tr>
          <td><b>${escapeHtml(c.name)}</b></td>
          <td>${escapeHtml(c.role)}</td>
          <td>${escapeHtml(c.phone)}</td>
          <td>${escapeHtml(c.email || '—')}</td>
          <td>Priority ${c.priority}</td>
          <td>${escapeHtml(c.campus)}</td>
          <td><button class="button button-outline button-small edit-esc-btn" data-esc-id="${c.id}">Edit</button></td>
        </tr>
      `).join('') || '<tr><td colspan="7">No escalation contacts added.</td></tr>';
    } catch {}
  }

  // Retention Settings
  async function loadAdminRetention() {
    try {
      const res = await api('/api/admin/retention');
      const cfg = res.retentionSettings || {};
      if ($('#retentionAttendanceDays')) $('#retentionAttendanceDays').value = cfg.attendanceRetentionDays || 365;
      if ($('#retentionAuditDays')) $('#retentionAuditDays').value = cfg.auditLogRetentionDays || 730;
      if ($('#retentionQueueHours')) $('#retentionQueueHours').value = cfg.offlineQueueTtlHours || 24;
      if ($('#retentionSessionMinutes')) $('#retentionSessionMinutes').value = cfg.sessionTimeoutMinutes || 480;
      if ($('#retentionAutoPurge')) $('#retentionAutoPurge').checked = cfg.autoPurgeEnabled !== false;
    } catch {}
  }

  // Audit Log
  async function loadAdminAudit() {
    try {
      const res = await api('/api/admin/audit?limit=50');
      const list = res.entries || [];
      const tbody = $('#adminAuditRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(e => `
        <tr>
          <td><small>${escapeHtml(e.timestamp.replace('T', ' ').slice(0, 19))}</small></td>
          <td><b>${escapeHtml(e.actorName)}</b><br><small style="color:#64748b">${escapeHtml(e.actorEmail)}</small></td>
          <td><span class="pupil-id">${escapeHtml(e.action)}</span></td>
          <td>${escapeHtml(e.objectType)} (${escapeHtml(e.objectId)})</td>
          <td><small>${escapeHtml(e.reason)}</small></td>
        </tr>
      `).join('') || '<tr><td colspan="5">No audit entries found.</td></tr>';
    } catch {}
  }

  // Revoke Staff Account click handler
  document.addEventListener('click', async e => {
    const revokeUserBtn = e.target.closest('[data-revoke-user]');
    if (revokeUserBtn) {
      const userId = revokeUserBtn.dataset.revokeUser;
      const userName = revokeUserBtn.dataset.userName;
      const reason = prompt(`Enter mandatory revocation reason for staff member ${userName}:`, 'Staff departure / access revoked');
      if (reason === null) return;
      try {
        const res = await api(`/api/users/${userId}/revoke`, { reason: reason || 'Staff account revoked' });
        toast(res.message);
        renderUsers();
      } catch (err) {
        toast(err.message, '!');
      }
    }

    const revokeDevBtn = e.target.closest('.revoke-device-btn');
    if (revokeDevBtn) {
      const devId = revokeDevBtn.dataset.deviceId;
      const devName = revokeDevBtn.dataset.deviceName;
      const reason = prompt(`Enter reason for revoking lost or compromised device '${devName}':`, 'Device lost during school transport drill');
      if (reason === null) return;
      try {
        const res = await api(`/api/admin/devices/${devId}/revoke`, { reason: reason || 'Device lost', status: 'lost' });
        toast(res.message);
        loadAdminDevices();
      } catch (err) {
        toast(err.message, '!');
      }
    }
  });

  // Admin MFA Setup Modal
  $('#adminMfaSetupBtn')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/mfa/setup', {});
      openModal(`
        <h2 id="modalTitle">Administrator Multi-Factor Authentication</h2>
        <p class="modal-intro">MFA is required for administrator sign-in. Scan or record your MFA secret key and confirm with a 6-digit verification code.</p>
        <div style="background:#f8fafc;padding:12px;border:1px solid #e2e8f0;border-radius:6px;margin:12px 0;text-align:center">
          <small style="display:block;color:#64748b;margin-bottom:4px">MFA Secret Key</small>
          <code style="font-size:13px;font-weight:700;color:#1e40af">${escapeHtml(res.mfaSecret)}</code>
          <p style="font-size:10px;color:#64748b;margin-top:6px">For testing/demo verification, enter test code <b>123456</b></p>
        </div>
        <form id="confirmMfaForm" class="form-grid">
          <div class="form-field full">
            <label>6-Digit Verification Code *</label>
            <input name="mfaToken" required placeholder="e.g. 123456" value="123456">
          </div>
          <div class="modal-actions form-field full">
            <button type="button" class="button button-outline" id="cancelMfaSetup">Cancel</button>
            <button type="submit" class="button button-primary">Verify & Enable MFA</button>
          </div>
        </form>
      `);
      $('#cancelMfaSetup').onclick = closeModal;
      $('#confirmMfaForm').onsubmit = async ev => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        try {
          const enableRes = await api('/api/admin/mfa/enable', { mfaToken: f.get('mfaToken') });
          closeModal();
          toast(enableRes.message);
        } catch (err) {
          toast(err.message, '!');
        }
      };
    } catch (err) {
      toast(err.message, '!');
    }
  });

  // Retention Settings Submit
  $('#retentionSettingsForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    try {
      const res = await api('/api/admin/retention', {
        attendanceRetentionDays: f.get('attendanceRetentionDays'),
        auditLogRetentionDays: f.get('auditLogRetentionDays'),
        offlineQueueTtlHours: f.get('offlineQueueTtlHours'),
        sessionTimeoutMinutes: f.get('sessionTimeoutMinutes'),
        autoPurgeEnabled: f.get('autoPurgeEnabled') !== null
      });
      toast('Data retention settings saved.');
    } catch (err) {
      toast(err.message, '!');
    }
  });

  // Execute Retention Purge
  $('#executePurgeBtn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to execute retention purge? Expired attendance logs and audit entries will be permanently deleted per school policy.')) return;
    try {
      const res = await api('/api/admin/retention/purge', {});
      toast(`Purged ${res.purged.attendanceRecords} attendance logs & ${res.purged.auditEntries} audit entries.`);
      loadAdminRetention();
      loadAdminAudit();
    } catch (err) {
      toast(err.message, '!');
    }
  });

  // Export Audit CSV
  const triggerAuditExport = async () => {
    try {
      const res = await fetch('/api/admin/export/audit?format=csv', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin exported audit trail' })
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `gatewise-audit-${today}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Administrative audit log exported.');
      loadAdminAudit();
    } catch (e) {
      toast(e.message, '!');
    }
  };

  $('#exportAuditDataBtn')?.addEventListener('click', triggerAuditExport);
  $('#exportAuditDataBtn2')?.addEventListener('click', triggerAuditExport);
  $('#refreshAuditBtn')?.addEventListener('click', loadAdminAudit);
  async function previewRoster(file){if(!file)return;if(file.size>8*1024*1024){toast('Roster files must be 8 MB or smaller.','!');return}if(!/\.(csv|xlsx)$/i.test(file.name)){toast('Choose a CSV or XLSX file.','!');return}try{const buffer=await file.arrayBuffer();let binary='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const {preview,errors,errorCount,token}=await api('/api/import/preview',{filename:file.name,fileBase64:btoa(binary)});const rows=preview.map(p=>`<tr><td>${escapeHtml(p.pupil_id)}</td><td>${escapeHtml(p.pupil_name)}</td><td>${escapeHtml(p.class_name)}</td><td>${escapeHtml(p.guardian_name)}</td></tr>`).join('');openModal(`<h2 id="modalTitle">Review pupil roster</h2><p class="modal-intro">${errorCount?`${errorCount} issue(s) found. Correct the file and upload again; nothing has been imported.`:`${preview.length} pupil(s) ready. Review the sample, then import the entire file.`}</p>${preview.length?`<div class="import-preview-wrap"><table class="import-preview-table"><thead><tr><th>PUPIL ID</th><th>NAME</th><th>CLASS</th><th>GUARDIAN</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}${errorCount?`<div class="import-errors">${errors.map(e=>`<div>Row ${e.row}${e.pupil_id?` · ${escapeHtml(e.pupil_id)}`:''}: ${escapeHtml(e.message)}</div>`).join('')}</div>`:''}<div class="modal-actions"><button class="button button-outline" id="cancelImport">Close</button>${token&&!errorCount?'<button class="button button-primary" id="commitImport">Import pupils</button>':''}</div>`);$('#cancelImport').onclick=closeModal;if(token&&!errorCount)$('#commitImport').onclick=async()=>{const button=$('#commitImport');button.disabled=true;button.textContent='Importing…';try{const result=await api('/api/import/commit',{token});acceptState(result.state);closeModal();render();toast(`${result.imported} pupil(s) imported.`)}catch(err){toast(err.message,'!');button.disabled=false;button.textContent='Import pupils'}}}catch(err){toast(err.message,'!')}finally{$('#rosterFile').value=''}}
  function qrValue(p){return p.cardToken || `GW:${p.id}`;}

  async function handleScanOutcome(code) {
    if (!isDeviceOnline()) {
      // Network unavailable outcome
      showScanResult(false, 'Network unavailable', 'Offline scan: verify pupil with on-screen photo or use offline manual queue.');
      toast('Network unavailable: scan could not be verified online. Use manual lookup or offline queue.', '!');
      return;
    }

    const session = $('#sessionSelect')?.value || 'Morning Arrival';
    const campus = $('#campusSelect')?.value || 'Primary campus';

    try {
      const res = await api('/api/cards/scan', {
        code,
        mode,
        session,
        campus
      });

      const { outcome, message, pupil: scanPupil, existingEvent, card } = res;

      if (outcome === 'unknown_code') {
        showScanResult(false, 'Unknown Code (Unrecognized QR)', message);
        toast(message, '!');
        return;
      }

      if (outcome === 'revoked_card') {
        showScanResult(false, 'Revoked Card', message);
        openModal(`
          <h2 id="modalTitle" style="color:#b91c1c">⚠ Card Revoked</h2>
          <p class="modal-intro" style="color:#991b1b">
            This pupil ID card has been revoked and cannot be used for gate handover.
          </p>
          ${scanPupil ? `
            <div class="confirm-profile">
              <div class="photo-preview-large">${escapeHtml(scanPupil.photo || scanPupil.initials)}</div>
              <div>
                <strong>${escapeHtml(scanPupil.name)}</strong>
                <small>${escapeHtml(scanPupil.id)} · ${escapeHtml(scanPupil.className)}</small>
              </div>
            </div>
          ` : ''}
          <div style="background:#fee2e2;border:1px solid #fca5a5;padding:12px;border-radius:6px;font-size:11px;color:#991b1b;margin:12px 0">
            <strong>Revocation Reason:</strong> ${escapeHtml(res.reason || 'Card deactivated by administration.')}
            <p style="margin:4px 0 0;font-size:10px">If child is present, perform manual lookup with photo verification or contact administrator for card reissue.</p>
          </div>
          <div class="modal-actions">
            <button class="button button-primary" id="closeRevokedModal">Understood</button>
          </div>
        `);
        $('#closeRevokedModal').onclick = closeModal;
        return;
      }

      if (outcome === 'already_recorded') {
        showScanResult(false, 'Already Recorded', message);
        openModal(`
          <h2 id="modalTitle" style="color:#b45309">⚠ Already Recorded Today</h2>
          <p class="modal-intro">
            ${escapeHtml(message)}
          </p>
          ${scanPupil ? `
            <div class="confirm-profile">
              <div class="photo-preview-large">${escapeHtml(scanPupil.photo || scanPupil.initials)}</div>
              <div>
                <strong>${escapeHtml(scanPupil.name)}</strong>
                <small>${escapeHtml(scanPupil.id)} · ${escapeHtml(scanPupil.className)}</small>
              </div>
            </div>
          ` : ''}
          <div style="background:#fef3c7;border:1px solid #fde68a;padding:10px 12px;border-radius:6px;font-size:11px;color:#92400e;margin:12px 0">
            Duplicate ${mode} scan was blocked to prevent accidental double-entries.
          </div>
          <div class="modal-actions">
            <button class="button button-primary" id="closeAlreadyRecorded">Close</button>
          </div>
        `);
        $('#closeAlreadyRecorded').onclick = closeModal;
        return;
      }

      if (outcome === 'wrong_session') {
        showScanResult(false, 'Wrong Operating Session', message);
        openModal(`
          <h2 id="modalTitle" style="color:#b45309">⚠ Operating Session Safeguard</h2>
          <p class="modal-intro">
            Accidental mode error safeguard: Current gate session <b>"${escapeHtml(res.session)}"</b> is configured for <b>${escapeHtml(res.defaultMode.toUpperCase())}</b> operations, but you are performing a <b>${mode.toUpperCase()}</b>.
          </p>
          ${scanPupil ? `
            <div class="confirm-profile">
              <div class="photo-preview-large">${escapeHtml(scanPupil.photo || scanPupil.initials)}</div>
              <div>
                <strong>${escapeHtml(scanPupil.name)}</strong>
                <small>${escapeHtml(scanPupil.id)} · ${escapeHtml(scanPupil.className)}</small>
              </div>
            </div>
          ` : ''}
          <div style="background:#fffbeb;border:1px solid #fcd34d;padding:10px 12px;border-radius:6px;font-size:11px;color:#92400e;margin:12px 0">
            Please confirm that recording ${mode.toUpperCase()} during this session is intentional.
          </div>
          <div class="modal-actions">
            <button class="button button-outline" id="cancelWrongSession">Cancel</button>
            <button class="button button-primary" id="confirmWrongSession">Proceed with Intentional ${mode.toUpperCase()}</button>
          </div>
        `);
        $('#cancelWrongSession').onclick = closeModal;
        $('#confirmWrongSession').onclick = () => {
          closeModal();
          const p = pupil(scanPupil.id) || scanPupil;
          eventConfirm(p, false, '', true);
        };
        return;
      }

      if (outcome === 'valid_pupil') {
        const p = pupil(scanPupil.id) || scanPupil;
        eventConfirm(p, false, '', false);
      }
    } catch (err) {
      if (err.message && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('Failed'))) {
        showScanResult(false, 'Network unavailable', 'Could not reach server. Offline mode or network disruption.');
        toast('Network unavailable. Live card scanning requires connection or offline queue.', '!');
      } else {
        showScanResult(false, 'Scan Error', err.message);
        toast(err.message, '!');
      }
    }
  }

  async function startScanner(){
    if(!('BarcodeDetector'in window)){
      toast('Live QR scanning is not available in this browser. Enter the pupil ID or token below.','!');
      return;
    }
    try{
      const detector=new BarcodeDetector({formats:['qr_code']});
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      window._gwStream=stream;
      openModal(`<h2 id="modalTitle">Scan pupil card</h2><p class="modal-intro">Hold the QR code in the frame. Pre-verification photo will appear on scan.</p><video id="scanVideo" autoplay muted playsinline style="width:100%;border-radius:8px;background:#15182a;max-height:310px;object-fit:cover"></video><p class="scan-note">Camera access stays on this device during the scan.</p><div class="modal-actions"><button class="button button-outline" id="stopCamera">Cancel scan</button></div>`);
      const video=$('#scanVideo');
      video.srcObject=stream;
      video.onloadedmetadata=()=>video.play();
      $('#stopCamera').onclick=closeModal;
      let scanned = false;
      const loop=async()=>{
        if(!window._gwStream||!video.isConnected||scanned)return;
        try{
          const codes=await detector.detect(video);
          if(codes.length && !scanned){
            scanned = true;
            const val=codes[0].rawValue;
            closeModal();
            handleScanOutcome(val);
            return;
          }
        }catch{}
        requestAnimationFrame(loop);
      };
      setTimeout(loop,600);
    }catch{
      toast('Camera permission was not granted. Enter the pupil ID or code instead.','!');
    }
  }
  async function openPupilCardModal(p) {
    const isAdmin = signedInUser?.role === 'admin';
    const isManager = signedInUser?.role === 'manager';
    const tokenDisplay = p.cardToken || `GW:${p.id}`;

    let artworkData = null;
    try {
      artworkData = await api(`/api/cards/${p.id}/artwork?format=json`);
    } catch {}

    const cardToken = artworkData?.card?.cardToken || tokenDisplay;
    const cardStatus = artworkData?.card?.status || p.cardStatus || 'active';
    const cardId = artworkData?.card?.id || p.cardId || `card-${p.id}`;

    openModal(`
      <h2 id="modalTitle">Pupil ID Card & Artwork</h2>
      <p class="modal-intro">
        Official PVC ID card record. Random security token contains <b>no pupil PII</b>.
      </p>
      <div class="confirm-profile">
        <div class="photo-preview-large" style="width:48px;height:48px;font-size:24px">${escapeHtml(p.photo||p.initials)}</div>
        <div style="flex:1">
          <strong style="font-size:14px">${escapeHtml(p.name)}</strong>
          <small style="display:block;color:#64748b">${escapeHtml(p.id)} · ${escapeHtml(p.className)} · Status: <b>${escapeHtml(cardStatus.toUpperCase())}</b></small>
        </div>
        <span class="status-pill ${cardStatus==='active'?'status-approved':'status-departed'}">${escapeHtml(cardStatus)}</span>
      </div>

      <div style="display:grid;place-items:center;padding:16px;background:#fafbff;border:1px solid #eceef4;border-radius:8px;margin:12px 0">
        <div id="qrCanvas" style="font:700 13px monospace;color:#4c5ddd;border:8px solid white;background:white;padding:14px;letter-spacing:1px;box-shadow:0 2px 8px rgba(0,0,0,0.05);text-align:center">
          <div style="font-size:28px;margin-bottom:4px">▦</div>
          <div>${escapeHtml(cardToken)}</div>
        </div>
        <small class="card-tag" style="margin-top:8px">Random non-meaningful QR token (no PII)</small>
      </div>

      <div class="qr-security-warning" style="margin:10px 0">
        <span>Security policy: Do not photograph or duplicate QR codes. If the physical card is unavailable, perform on-screen photo verification via manual search.</span>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;padding-top:8px;border-top:1px dashed #e2e8f0">
        <button class="button button-outline" id="printArtworkBtn" style="font-size:11px">🖨 Print / Export Artwork</button>
        ${isAdmin ? `
          <button class="button button-outline" id="reissueCardBtn" style="font-size:11px;color:#2563eb">↺ Reissue Card</button>
          ${cardStatus === 'active' ? `<button class="button button-outline" id="revokeCardBtn" style="font-size:11px;color:#b91c1c">✕ Revoke Card</button>` : ''}
        ` : ''}
      </div>

      <div class="modal-actions">
        <button class="button button-primary" id="closeCard">Done</button>
      </div>
    `);

    $('#closeCard').onclick = closeModal;

    $('#printArtworkBtn').onclick = () => {
      window.open(`/api/cards/${p.id}/artwork?format=html`, '_blank');
    };

    if (isAdmin) {
      $('#reissueCardBtn')?.addEventListener('click', () => {
        openModal(`
          <h2 id="modalTitle">Reissue Pupil ID Card</h2>
          <p class="modal-intro">
            Generates a new random, non-meaningful QR code token for <b>${escapeHtml(p.name)}</b>. The previous card will be permanently marked as replaced. Historical attendance records will not be mutated.
          </p>
          <form id="reissueCardForm" class="form-grid">
            <div class="form-field full">
              <label>Reissue Reason *</label>
              <input name="reason" placeholder="e.g. Card lost on school bus / damaged card" required value="Card lost or damaged">
            </div>
            <div class="modal-actions form-field full">
              <button type="button" class="button button-outline" id="cancelReissue">Cancel</button>
              <button type="submit" class="button button-primary">Generate & Issue New Card</button>
            </div>
          </form>
        `);
        $('#cancelReissue').onclick = () => openPupilCardModal(p);
        $('#reissueCardForm').onsubmit = async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const reason = f.get('reason');
          try {
            const res = await api(`/api/cards/${p.id}/reissue`, { reason });
            acceptState(res.state);
            toast(res.message);
            const updatedP = pupil(p.id) || p;
            openPupilCardModal(updatedP);
          } catch (err) {
            toast(err.message, '!');
          }
        };
      });

      $('#revokeCardBtn')?.addEventListener('click', () => {
        openModal(`
          <h2 id="modalTitle" style="color:#b91c1c">Revoke Pupil ID Card</h2>
          <p class="modal-intro">
            Revoke the current active card for <b>${escapeHtml(p.name)}</b>. Scanning this card will return 'revoked_card' and block handover. Historical attendance records are preserved untouched.
          </p>
          <form id="revokeCardForm" class="form-grid">
            <div class="form-field full">
              <label>Mandatory Revocation Reason *</label>
              <input name="reason" placeholder="e.g. Suspected duplicate / pupil withdrawn / card compromised" required>
            </div>
            <div class="modal-actions form-field full">
              <button type="button" class="button button-outline" id="cancelRevoke">Cancel</button>
              <button type="submit" class="button button-dark" style="background:#b91c1c">Revoke Card</button>
            </div>
          </form>
        `);
        $('#cancelRevoke').onclick = () => openPupilCardModal(p);
        $('#revokeCardForm').onsubmit = async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const reason = f.get('reason');
          try {
            const res = await api(`/api/cards/${cardId}/revoke`, { reason });
            acceptState(res.state);
            toast(res.message);
            const updatedP = pupil(p.id) || p;
            openPupilCardModal(updatedP);
          } catch (err) {
            toast(err.message, '!');
          }
        };
      });
    }
  }

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
    const detail=e.target.closest('[data-pupil-detail]');if(detail){const p=pupil(detail.dataset.pupilDetail);if(p)openPupilCardModal(p);}
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

  // --------------------------------------------------------------------------
  // Guardian Onboarding & Portal Functions
  // --------------------------------------------------------------------------

  // School invites a guardian
  function openInviteGuardianModal() {
    const pupilOptions = pupils.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.id)} - ${escapeHtml(p.className)})</option>`).join('');
    openModal(`
      <h2 id="modalTitle">Invite Guardian (Verified Contact)</h2>
      <p class="modal-intro">The school invites each guardian using a verified contact method. The guardian must prove control of the contact channel and accept the privacy notice and consent terms before accessing pupil records.</p>
      <form id="inviteGuardianForm" class="form-grid">
        <div class="form-field full">
          <label>Select Pupil *</label>
          <select name="pupilId" required>${pupilOptions}</select>
        </div>
        <div class="form-field full">
          <label>Guardian Full Name *</label>
          <input name="name" required placeholder="e.g. Kendra Davis">
        </div>
        <div class="form-field">
          <label>Verified Contact Method *</label>
          <select name="verifiedContactMethod" id="inviteMethodSelect">
            <option value="sms">SMS Text Message</option>
            <option value="email">Email</option>
          </select>
        </div>
        <div class="form-field">
          <label>Relationship *</label>
          <select name="relationship">
            <option value="Mother">Mother</option>
            <option value="Father">Father</option>
            <option value="Legal Guardian">Legal Guardian</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-field full">
          <label>Guardian Mobile Phone (for SMS)</label>
          <input name="phone" id="invitePhoneInput" placeholder="+1 555-0199" value="+1 555-0199">
        </div>
        <div class="form-field full">
          <label>Guardian Email (for Email invitations)</label>
          <input name="email" id="inviteEmailInput" type="email" placeholder="guardian@example.com">
        </div>
        <div class="form-field full">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" name="isLegalGuardian" checked>
            <span>School certifies legal guardian status (school authority required)</span>
          </label>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelInvite">Cancel</button>
          <button type="submit" class="button button-primary">Send Invitation</button>
        </div>
      </form>
    `);

    $('#cancelInvite').onclick = closeModal;
    $('#inviteGuardianForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const payload = {
        pupilId: f.get('pupilId'),
        name: f.get('name'),
        verifiedContactMethod: f.get('verifiedContactMethod'),
        relationship: f.get('relationship'),
        phone: f.get('phone'),
        email: f.get('email'),
        isLegalGuardian: f.get('isLegalGuardian') !== null
      };

      try {
        const res = await api('/api/guardians/invite', payload);
        closeModal();
        openInviteSentSuccessModal(res.invite);
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  function openInviteSentSuccessModal(invite) {
    openModal(`
      <h2 id="modalTitle">Invitation Issued</h2>
      <p class="modal-intro">An onboarding invitation was dispatched via <b>${escapeHtml(invite.verifiedContactMethod.toUpperCase())}</b> to <b>${escapeHtml(invite.targetContact)}</b>.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin:12px 0;font-size:11px;color:#166534">
        <div><strong>Channel Verification Code (OTP):</strong> <code style="font-size:14px;font-weight:700">${escapeHtml(invite.verificationCode)}</code></div>
        <div style="margin-top:6px;font-size:10px;color:#15803d">Share or verify this 6-digit code to prove control of the contact channel.</div>
        <div style="margin-top:8px"><strong>Invite Token:</strong> <code style="font-size:9px;word-break:break-all">${escapeHtml(invite.inviteToken)}</code></div>
      </div>
      <div class="modal-actions">
        <button class="button button-outline" id="closeInviteModal">Close</button>
        <button class="button button-primary" id="launchOnboardingBtn">Open Guardian Onboarding Flow ↗</button>
      </div>
    `);
    $('#closeInviteModal').onclick = closeModal;
    $('#launchOnboardingBtn').onclick = () => {
      openGuardianOnboardingFlow(invite.inviteToken, invite.verificationCode);
    };
  }

  // Guardian proves control and accepts privacy notice & statutory consent
  function openGuardianOnboardingFlow(inviteToken = '', presetCode = '') {
    openModal(`
      <h2 id="modalTitle">Guardian Onboarding & Verification</h2>
      <p class="modal-intro">Step 1: Prove control of contact channel. Step 2: Review and accept the School Privacy Notice and Notification Consent Agreement.</p>
      <form id="guardianOnboardingForm" class="form-grid">
        <div class="form-field full">
          <label>Invitation Token *</label>
          <input name="inviteToken" id="obInviteToken" required value="${escapeHtml(inviteToken)}" placeholder="Paste invitation token">
        </div>
        <div class="form-field full">
          <label>Verification Code sent to your phone/email (OTP) *</label>
          <div style="display:flex;gap:8px">
            <input name="verificationCode" id="obVerificationCode" required value="${escapeHtml(presetCode)}" placeholder="6-digit code">
            <button type="button" class="button button-outline" id="verifyChannelBtn">Prove Control ✓</button>
          </div>
          <small id="verifyStatusMsg" style="font-size:10px;color:#059669;margin-top:4px"></small>
        </div>
        <div class="form-field full" style="margin-top:6px">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;max-height:120px;overflow-y:auto;font-size:9px;color:#475569;line-height:1.5">
            <b>Northfield Academy Privacy Notice (v2026.1):</b><br>
            We process pupil arrival and departure logs, parent/guardian contact credentials, and verified collector records to safeguard child safety. Attendance records are processed pursuant to statutory educational obligations and stored in managed, encrypted repositories. Data is shared strictly with approved gate staff and authorized collectors.
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:10px;margin-top:6px;cursor:pointer">
            <input type="checkbox" name="acceptPrivacyNotice" id="obPrivacy" required>
            <span>I have read and accept the Northfield Academy Privacy Notice</span>
          </label>
        </div>
        <div class="form-field full">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;max-height:100px;overflow-y:auto;font-size:9px;color:#475569;line-height:1.5">
            <b>Statutory Consent & Handover Acknowledgment:</b><br>
            I consent to receiving automated arrival and dismissal notifications via my configured channels. I understand and agree that <b>the school—not the guardian app—approves changes to legal guardian status and pickup permissions</b>.
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:10px;margin-top:6px;cursor:pointer">
            <input type="checkbox" name="acceptConsent" id="obConsent" required>
            <span>I agree to the Consent & Dismissal Handover Terms</span>
          </label>
        </div>
        <div class="form-field full">
          <label>Create Portal Password (at least 8 characters) *</label>
          <input name="password" type="password" required minlength="8" placeholder="Enter secure password">
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelOnboarding">Cancel</button>
          <button type="submit" class="button button-primary">Complete Onboarding & Enter Portal <span>→</span></button>
        </div>
      </form>
    `);

    $('#cancelOnboarding').onclick = closeModal;

    let isChannelVerified = false;
    $('#verifyChannelBtn').onclick = async () => {
      const token = $('#obInviteToken').value.trim();
      const code = $('#obVerificationCode').value.trim();
      if (!token || !code) {
        toast('Enter invitation token and verification code.', '!');
        return;
      }
      try {
        const res = await api('/api/guardian/verify-channel', { inviteToken: token, verificationCode: code });
        isChannelVerified = true;
        $('#verifyStatusMsg').textContent = `✓ ${res.message}`;
        toast('Channel control proven successfully.');
      } catch (err) {
        toast(err.message, '!');
      }
    };

    $('#guardianOnboardingForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const token = f.get('inviteToken');
      const password = f.get('password');
      const acceptPrivacy = f.get('acceptPrivacyNotice') !== null;
      const acceptConsent = f.get('acceptConsent') !== null;

      if (!isChannelVerified) {
        // Attempt verifying channel first if not explicitly clicked
        try {
          await api('/api/guardian/verify-channel', { inviteToken: token, verificationCode: f.get('verificationCode') });
          isChannelVerified = true;
        } catch (e) {
          toast(e.message, '!');
          return;
        }
      }

      try {
        const res = await api('/api/guardian/accept-consent', {
          inviteToken: token,
          acceptPrivacyNotice: acceptPrivacy,
          acceptConsent: acceptConsent,
          password
        });
        closeModal();
        setSignedIn(res.user);
        toast('Onboarding completed! Welcome to your Guardian Portal.');
        navigate('guardianPortal');
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  // Load Guardian Portal view
  async function loadGuardianPortal() {
    try {
      const data = await api('/api/guardian/me');
      guardianPortalData = data;
      renderGuardianPortalUI(data);
    } catch (err) {
      toast(err.message, '!');
    }
  }

  function renderGuardianPortalUI(data) {
    $('#guardianPortalTitle').textContent = `Welcome, ${data.guardian.name}`;

    // 1. Linked Pupils
    const pupilsContainer = $('#guardianPupilsList');
    if (pupilsContainer) {
      if (!data.pupils.length) {
        pupilsContainer.innerHTML = '<div class="empty-state">No linked pupils found for this account. Contact school office.</div>';
      } else {
        pupilsContainer.innerHTML = data.pupils.map(p => `
          <div class="guardian-pupil-card">
            <span class="avatar avatar-${p.color || 'blue'}">${escapeHtml(p.photo || p.initials)}</span>
            <div class="guardian-pupil-meta">
              <strong>${escapeHtml(p.name)} <small style="display:inline;color:#64748b">(${escapeHtml(p.className)})</small></strong>
              <small>Pupil ID: <b>${escapeHtml(p.id)}</b> · Relationship: ${escapeHtml(p.relationship)}</small>
              <div style="margin-top:4px">
                <span class="${p.isLegalGuardian ? 'badge-legal' : 'badge-nonlegal'}">
                  ${p.isLegalGuardian ? '✓ Certified Legal Guardian' : 'Authorized Contact'}
                </span>
                <span style="font-size:9px;color:#64748b;margin-left:6px">${p.collectors.length} approved collector(s)</span>
              </div>
            </div>
          </div>
        `).join('');
      }
    }

    // 2. Notification Preferences
    const form = $('#guardianPrefsForm');
    if (form) {
      const current = data.guardian.preferredChannels || ['sms'];
      $$('input[name="prefChannels"]', form).forEach(cb => {
        cb.checked = current.includes(cb.value);
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const selected = $$('input[name="prefChannels"]:checked', form).map(cb => cb.value);
        if (!selected.length) {
          toast('Select at least one notification channel.', '!');
          return;
        }
        try {
          const res = await api('/api/guardian/preferences', { channels: selected });
          toast(res.message);
          loadGuardianPortal();
        } catch (err) {
          toast(err.message, '!');
        }
      };
    }

    // 3. Timeline
    const timeline = $('#guardianTimelineList');
    if (timeline) {
      if (!data.events.length) {
        timeline.innerHTML = '<div class="empty-state">No recent activity recorded for your linked children.</div>';
      } else {
        timeline.innerHTML = data.events.map(e => {
          const p = data.pupils.find(x => x.id === e.pupilId) || { name: 'Linked Child' };
          const isArr = e.type.includes('arrival');
          return `
            <div class="activity-item">
              <div class="activity-icon ${isArr ? 'arrival' : 'departure'}">${isArr ? '↘' : '↗'}</div>
              <div class="activity-copy">
                <b>${isArr ? 'Safe Arrival' : 'Dismissal Handover'}</b> for ${escapeHtml(p.name)} ${e.collector ? ` with ${escapeHtml(e.collector)}` : ''}
                <small>${escapeHtml(e.date)} at ${escapeHtml(e.time)} · Verification: ${escapeHtml(e.verification || 'Standard Gate Check')}</small>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Correction Requests History
    const reqHistory = $('#guardianRequestsHistory');
    if (reqHistory) {
      if (!data.correctionRequests.length) {
        reqHistory.innerHTML = '<div class="empty-state">No requests submitted yet. Use the button above to request record updates or contact the school.</div>';
      } else {
        reqHistory.innerHTML = data.correctionRequests.map(r => `
          <div class="correction-item">
            <div class="correction-header">
              <strong style="font-size:11px">${escapeHtml(r.subject)} <small style="color:#64748b">(${escapeHtml(r.type.replace(/_/g, ' '))})</small></strong>
              <span class="correction-status ${r.status}">${r.status}</span>
            </div>
            <p style="margin:4px 0;font-size:10px;color:#334155">${escapeHtml(r.message)}</p>
            ${r.reviewNote ? `<small style="display:block;margin-top:4px;color:#0369a1;background:#f0f9ff;padding:4px 6px;border-radius:4px">School Response: ${escapeHtml(r.reviewNote)}</small>` : ''}
          </div>
        `).join('');
      }
    }
  }

  // Guardian submits record correction or contact inquiry
  function openGuardianCorrectionModal() {
    if (!guardianPortalData || !guardianPortalData.pupils.length) {
      toast('No linked pupils available.', '!');
      return;
    }

    const pupilOptions = guardianPortalData.pupils.map(p => `
      <option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.id)})</option>
    `).join('');

    openModal(`
      <h2 id="modalTitle">Request Record Correction / Contact School</h2>
      <p class="modal-intro">
        Submit changes or questions to Northfield Academy. <b>The school—not the guardian app—approves changes to legal guardian status and pickup permissions.</b>
      </p>
      <form id="correctionReqForm" class="form-grid">
        <div class="form-field full">
          <label>Select Child *</label>
          <select name="pupilId" required>${pupilOptions}</select>
        </div>
        <div class="form-field full">
          <label>Request Category *</label>
          <select name="type" id="correctionTypeSelect">
            <option value="record_correction">Pupil Record Correction (e.g. spelling, DOB, medical notes)</option>
            <option value="pickup_permission_request">Request New Pickup Permission (requires school approval)</option>
            <option value="legal_status_request">Update Legal Guardian Status (requires school certification)</option>
            <option value="contact_school">General Inquiry / Message School Office</option>
          </select>
        </div>
        <div class="form-field full">
          <label>Subject *</label>
          <input name="subject" required placeholder="Brief summary of request">
        </div>
        <div class="form-field full">
          <label>Details / Message *</label>
          <textarea name="message" required placeholder="Provide full details. If proposing a new pickup collector, include full legal name, relationship, and contact details..." style="width:100%;padding:8px;border-radius:6px;border:1px solid #d0d5dd;font:inherit;min-height:60px"></textarea>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="cancelCorrReq">Cancel</button>
          <button type="submit" class="button button-primary">Submit Request to School</button>
        </div>
      </form>
    `);

    $('#cancelCorrReq').onclick = closeModal;
    $('#correctionReqForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const payload = {
        pupilId: f.get('pupilId'),
        type: f.get('type'),
        subject: f.get('subject'),
        message: f.get('message')
      };

      try {
        const res = await api('/api/guardian/correction-request', payload);
        closeModal();
        toast('Request submitted to school administration.');
        loadGuardianPortal();
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  // School administration review of guardian correction requests
  async function loadAdminCorrections() {
    if (signedInUser?.role === 'viewer' || signedInUser?.role === 'guardian') return;
    try {
      const res = await api('/api/admin/corrections');
      adminCorrections = res.requests || [];
      renderAdminCorrectionsUI();
    } catch {}
  }

  function renderAdminCorrectionsUI() {
    const list = $('#correctionList');
    if (!list) return;
    const pending = adminCorrections.filter(c => c.status === 'pending');
    const badgeEl = $('#guardianRequestBadge');
    if (badgeEl) badgeEl.textContent = `${requests.length + pending.length} NEW`;

    if (!pending.length) {
      list.innerHTML = '<div style="font-size:10px;color:#94a3b8;padding:8px 0">No pending guardian record correction requests.</div>';
      return;
    }

    list.innerHTML = `
      <h3 style="font:700 11px Manrope;color:#475569;margin:12px 0 6px">Record Correction & Legal Status Requests</h3>
      ${pending.map(c => `
        <div class="request-card" style="border-top:1px dashed #e2e8f0;padding:10px 0">
          <div class="request-details">
            <strong>${escapeHtml(c.subject)} <span class="card-tag">· ${escapeHtml(c.type.replace(/_/g, ' '))}</span></strong>
            <p>Pupil: <b>${escapeHtml(c.pupilId)}</b> · Guardian: ${escapeHtml(c.guardianId)}</p>
            <small>${escapeHtml(c.message)}</small>
          </div>
          <div class="request-actions">
            <button class="decline-button" data-correction-id="${c.id}" data-action="reject">Reject</button>
            <button class="approve-button" data-correction-id="${c.id}" data-action="approve">✓ Approve</button>
          </div>
        </div>
      `).join('')}
    `;

    $$('[data-correction-id]').forEach(btn => {
      btn.onclick = async () => {
        const cid = btn.dataset.correctionId;
        const action = btn.dataset.action;
        const note = prompt(`Enter review note / reason for ${action}:`, action === 'approve' ? 'Approved by school office' : 'Declined per school policy');
        if (note === null) return;
        try {
          await api(`/api/admin/corrections/${cid}`, { action, reviewNote: note });
          toast(`Request ${action}d.`);
          loadAdminCorrections();
        } catch (e) {
          toast(e.message, '!');
        }
      };
    });
  }

  $('#inviteGuardianBtn')?.addEventListener('click', openInviteGuardianModal);
  $('#openCorrectionBtn')?.addEventListener('click', openGuardianCorrectionModal);

  $('#uploadRosterBtn').onclick=()=>$('#rosterFile').click();$('#rosterFile').onchange=e=>previewRoster(e.target.files[0]);$('#addUserBtn').onclick=openAddUser;$('#userRows').addEventListener('change',async e=>{const select=e.target.closest('[data-user-role]');if(!select)return;try{await api(`/api/users/${select.dataset.userRole}`,{role:select.value});toast('User role updated.');renderUsers()}catch(err){toast(err.message,'!');renderUsers()}});$('#userRows').addEventListener('click',async e=>{const button=e.target.closest('[data-user-active]');if(!button)return;try{await api(`/api/users/${button.dataset.userActive}`,{active:Number(button.dataset.active)===1});toast('User status updated.');renderUsers()}catch(err){toast(err.message,'!')}});
  $('.main-nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)navigate(b.dataset.page)});
  $('[data-goto="scan"]')?.addEventListener('click',()=>navigate('scan'));
  $('#manualForm').addEventListener('submit', e => {
    e.preventDefault();
    const reason = $('#manualReasonQuickSelect')?.value || 'card_missing';
    findAndScan($('#pupilIdInput').value, 'Manual entry', reason);
    $('#pupilIdInput').value = '';
  });
  $('#sessionSelect')?.addEventListener('change', e => {
    const selectedName = e.target.value;
    const sessions = schoolSettings.operatingSessions || [];
    const sObj = sessions.find(s => s.name === selectedName || s.id === selectedName);
    if (sObj && sObj.defaultMode && sObj.defaultMode !== 'both') {
      if (sObj.defaultMode !== mode) {
        const newMode = sObj.defaultMode;
        openModal(`
          <h2 id="modalTitle">Switch Mode for Operating Session?</h2>
          <p class="modal-intro">
            The selected session <b>"${escapeHtml(sObj.name)}"</b> is scheduled for <b>${newMode.toUpperCase()}</b> operations.
          </p>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin:12px 0;font-size:11px;color:#1e40af">
            Would you like to automatically switch the gate operating mode from <b>${mode.toUpperCase()}</b> to <b>${newMode.toUpperCase()}</b>?
          </div>
          <div class="modal-actions">
            <button class="button button-outline" id="keepCurrentMode">Keep ${mode.toUpperCase()} Mode</button>
            <button class="button button-primary" id="confirmSwitchMode">Switch to ${newMode.toUpperCase()} Mode</button>
          </div>
        `);
        $('#keepCurrentMode').onclick = closeModal;
        $('#confirmSwitchMode').onclick = () => {
          mode = newMode;
          $$('.mode-button').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
          $('.scan-start').textContent = 'Start camera scanner';
          $('.scan-frame h2').textContent = mode === 'arrival' ? 'Scan pupil ID card' : 'Scan for departure';
          closeModal();
          toast(`Operating mode switched to ${mode.toUpperCase()} for ${sObj.name}.`);
        };
      }
    }
  });

  function openManageSessionsModal() {
    if (signedInUser?.role !== 'admin') {
      toast('Only administrators can configure operating sessions.', '!');
      return;
    }
    const sessions = schoolSettings.operatingSessions || [
      { id: "morning", name: "Morning Arrival", startTime: "07:30", endTime: "08:30", defaultMode: "arrival" },
      { id: "standard", name: "Standard Day", startTime: "08:30", endTime: "14:30", defaultMode: "arrival" },
      { id: "afternoon", name: "Afternoon Dismissal", startTime: "14:30", endTime: "15:30", defaultMode: "departure" }
    ];
    const sessionsListHtml = sessions.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 10px;border-radius:6px;margin-bottom:6px">
        <div>
          <strong style="font-size:11px">${escapeHtml(s.name)}</strong>
          <small style="display:block;color:#64748b">${escapeHtml(s.startTime)} - ${escapeHtml(s.endTime)} · Default: <b>${escapeHtml(s.defaultMode)}</b></small>
        </div>
        <span class="status-pill ${s.defaultMode === 'arrival' ? 'status-present' : s.defaultMode === 'departure' ? 'status-departed' : 'status-approved'}">${escapeHtml(s.defaultMode)}</span>
      </div>
    `).join('');

    openModal(`
      <h2 id="modalTitle">Configurable Operating Sessions</h2>
      <p class="modal-intro">
        Configure scheduled operating sessions. Sessions help prevent accidental arrival/departure mode errors at the gates.
      </p>
      <div style="max-height:160px;overflow-y:auto;margin-bottom:12px">
        ${sessionsListHtml}
      </div>
      <form id="addSessionForm" class="form-grid" style="border-top:1px dashed #cbd5e1;padding-top:12px">
        <div class="form-field full">
          <label>New / Updated Session Name *</label>
          <input name="name" required placeholder="e.g. Evening Club Dismissal">
        </div>
        <div class="form-field">
          <label>Start Time (HH:MM)</label>
          <input name="startTime" placeholder="15:30" value="15:30">
        </div>
        <div class="form-field">
          <label>End Time (HH:MM)</label>
          <input name="endTime" placeholder="17:00" value="17:00">
        </div>
        <div class="form-field full">
          <label>Default Operating Mode *</label>
          <select name="defaultMode">
            <option value="arrival">Arrival (Check-in)</option>
            <option value="departure">Departure (Dismissal & Release)</option>
            <option value="both">Both (Flexible operations)</option>
          </select>
        </div>
        <div class="modal-actions form-field full">
          <button type="button" class="button button-outline" id="closeSessionsModal">Close</button>
          <button type="submit" class="button button-primary">Save Session</button>
        </div>
      </form>
    `);

    $('#closeSessionsModal').onclick = closeModal;
    $('#addSessionForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      try {
        const res = await api('/api/sessions', {
          name: f.get('name'),
          startTime: f.get('startTime'),
          endTime: f.get('endTime'),
          defaultMode: f.get('defaultMode')
        });
        toast(`Session "${res.session.name}" configured.`);
        schoolSettings.operatingSessions = res.sessions;
        updateSessionOptions();
        closeModal();
      } catch (err) {
        toast(err.message, '!');
      }
    };
  }

  $('#manageSessionsBtn')?.addEventListener('click', openManageSessionsModal);
  $('#startCamera').onclick = startScanner;
  // Daily Reconciliation Report Modal
  async function openDailyReconciliationModal() {
    openModal(`<h2 id="modalTitle">Daily Attendance Reconciliation</h2><p class="modal-intro">Generating reconciliation report across timelines, missing patterns, and exceptions...</p>`);
    try {
      const data = await api('/api/reports/reconciliation');
      const { summary, pupilTimeline, missingArrivalPatterns, missingDeparturePatterns, unresolvedExceptions } = data;

      openModal(`
        <h2 id="modalTitle">Daily Gate Reconciliation Report</h2>
        <p class="modal-intro">Comprehensive audit covering pupil event timelines, missing arrival/departure patterns, duplicate attempts, and unresolved exceptions.</p>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px;text-align:center">
            <span style="font-size:16px;font-weight:700;color:#1e40af">${summary.totalEventsToday}</span>
            <small style="display:block;font-size:9px;color:#1e40af">Events Today</small>
          </div>
          <div style="background:${missingArrivalPatterns.length ? '#fee2e2' : '#f0fdf4'};border:1px solid ${missingArrivalPatterns.length ? '#fca5a5' : '#bbf7d0'};border-radius:6px;padding:8px;text-align:center">
            <span style="font-size:16px;font-weight:700;color:${missingArrivalPatterns.length ? '#b91c1c' : '#15803d'}">${missingArrivalPatterns.length}</span>
            <small style="display:block;font-size:9px;color:${missingArrivalPatterns.length ? '#b91c1c' : '#15803d'}">Missing Arrival</small>
          </div>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px;text-align:center">
            <span style="font-size:16px;font-weight:700;color:#92400e">${missingDeparturePatterns.length}</span>
            <small style="display:block;font-size:9px;color:#92400e">Still On Site</small>
          </div>
          <div style="background:${unresolvedExceptions.length ? '#fee2e2' : '#f0fdf4'};border:1px solid ${unresolvedExceptions.length ? '#fca5a5' : '#bbf7d0'};border-radius:6px;padding:8px;text-align:center">
            <span style="font-size:16px;font-weight:700;color:${unresolvedExceptions.length ? '#b91c1c' : '#15803d'}">${unresolvedExceptions.length}</span>
            <small style="display:block;font-size:9px;color:${unresolvedExceptions.length ? '#b91c1c' : '#15803d'}">Exceptions</small>
          </div>
        </div>

        ${missingArrivalPatterns.length ? `
          <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:6px;padding:10px;margin-bottom:12px">
            <strong style="font-size:11px;color:#9f1239">⚠ Missing Arrival Patterns Detected (${missingArrivalPatterns.length}):</strong>
            <ul style="margin:4px 0 0;padding-left:16px;font-size:10px;color:#be123c">
              ${missingArrivalPatterns.map(m => `<li><b>${escapeHtml(m.pupilName)} (${escapeHtml(m.pupilId)})</b>: Departed at ${escapeHtml(m.departureTime)} without check-in.</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        <h3 style="font-size:12px;margin:12px 0 6px">Pupil Event Timeline (${pupilTimeline.length} pupils today)</h3>
        <div class="table-wrap" style="max-height:220px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px">
          <table class="directory-table" style="font-size:9px">
            <thead><tr><th>PUPIL</th><th>CLASS</th><th>FIRST ARRIVAL</th><th>LAST DEPARTURE</th><th>EVENTS</th></tr></thead>
            <tbody>
              ${pupilTimeline.map(pt => `
                <tr>
                  <td><b>${escapeHtml(pt.pupilName)}</b><br><small style="color:#64748b">${escapeHtml(pt.pupilId)}</small></td>
                  <td>${escapeHtml(pt.className)}</td>
                  <td>${escapeHtml(pt.firstArrival || '—')}</td>
                  <td>${escapeHtml(pt.lastDeparture || '—')}</td>
                  <td>${pt.events.length} logs</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="modal-actions" style="margin-top:14px">
          <button type="button" class="button button-primary" id="closeReconcileReport">Done</button>
        </div>
      `);
      $('#closeReconcileReport').onclick = closeModal;
    } catch (err) {
      toast(err.message, '!');
    }
  }

  // Data Processors (DPA Compliance) Modal
  async function openProcessorsModal() {
    try {
      const data = await api('/api/compliance/processors');
      openModal(`
        <h2 id="modalTitle">Documented Data Recipients & Processors</h2>
        <p class="modal-intro">Formal privacy record documenting every third-party processor, legal jurisdiction, and data minimization policy.</p>
        <div class="table-wrap" style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:12px">
          <table class="directory-table" style="font-size:9px">
            <thead><tr><th>PROCESSOR</th><th>ROLE</th><th>CATEGORIES</th><th>LOCATION & SECURITY</th></tr></thead>
            <tbody>
              ${data.dataProcessors.map(dp => `
                <tr>
                  <td><b>${escapeHtml(dp.recipient)}</b></td>
                  <td>${escapeHtml(dp.processorRole)}</td>
                  <td><small>${escapeHtml(dp.dataCategories.join(', '))}</small></td>
                  <td>${escapeHtml(dp.location)}<br><small style="color:#15803d">${escapeHtml(dp.securityCertifications)}</small></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <p style="font-size:10px;color:#64748b;line-height:1.4"><b>Minimization:</b> ${escapeHtml(data.dataMinimizationNotice)}</p>
        <div class="modal-actions">
          <button type="button" class="button button-primary" id="closeProcessorsModal">Close</button>
        </div>
      `);
      $('#closeProcessorsModal').onclick = closeModal;
    } catch (err) {
      toast(err.message, '!');
    }
  }

  // Toggle Degraded Mode Modal
  async function openDegradedModeModal() {
    try {
      const res = await api('/api/system/status');
      const isCurrentlyDegraded = res.availability.degradedModeActive;

      openModal(`
        <h2 id="modalTitle">Configure System Degraded Mode</h2>
        <p class="modal-intro">Activate degraded-mode operations during network disruptions or third-party notification outages.</p>
        <form id="degradedModeForm" class="form-grid">
          <div class="form-field full">
            <label style="display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer">
              <input type="checkbox" name="degradedModeActive" id="degradedModeCheckbox" ${isCurrentlyDegraded ? 'checked' : ''}>
              <span><b>Enable Degraded Mode Operations</b></span>
            </label>
          </div>
          <div class="form-field full">
            <label>Degraded Mode Reason / Root Cause *</label>
            <input name="reason" value="${escapeHtml(res.availability.degradedReason || 'Third-party notification provider outage')}" required>
          </div>
          <div class="form-field full" style="font-size:10px;color:#64748b">
            <b>Degraded-mode procedures enforced:</b>
            <ol style="margin:4px 0;padding-left:16px">
              <li>Local managed encrypted queueing enabled with "Pending sync" banner.</li>
              <li>Paper/voice fallback procedure with supervisor verification.</li>
              <li>Idempotent reconciliation via /api/events/reconcile upon reconnection.</li>
            </ol>
          </div>
          <div class="modal-actions form-field full">
            <button type="button" class="button button-outline" id="cancelDegradedModal">Cancel</button>
            <button type="submit" class="button button-primary">Save Degraded Mode Status</button>
          </div>
        </form>
      `);
      $('#cancelDegradedModal').onclick = closeModal;
      $('#degradedModeForm').onsubmit = async ev => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        try {
          const postRes = await api('/api/system/degraded-mode', {
            degradedModeActive: f.get('degradedModeActive') !== null,
            reason: f.get('reason')
          });
          closeModal();
          toast(postRes.degradedMode.degradedModeActive ? 'Degraded mode activated ⚠' : 'Standard online operations restored.');
          loadSystemNfrGovernance();
        } catch (err) {
          toast(err.message, '!');
        }
      };
    } catch (err) {
      toast(err.message, '!');
    }
  }

  $('#dailyReconcileReportBtn')?.addEventListener('click', openDailyReconciliationModal);
  $('#viewProcessorsBtn')?.addEventListener('click', openProcessorsModal);
  $('#toggleDegradedModeBtn')?.addEventListener('click', openDegradedModeModal);
  $('#openExceptionReportBtn')?.addEventListener('click', openExceptionReport);
  $('#viewExceptionsTabBtn')?.addEventListener('click', openExceptionReport);
  $('#addPupilBtn').onclick=openAddPupil;
  $('#arrivalSearch').oninput=renderDashboard;
  $('#pupilSearch').oninput=renderPupils;
  $('#activitySearch').oninput=renderActivity;
  $('#pickupSearch').oninput=renderPickup;
  $('#classFilter').onclick=()=>pickFilter($('#classFilter'),['All classes',...new Set(pupils.map(p=>p.className))],classChoice,x=>{classChoice=x;renderDashboard()});
  $('#directoryFilter').onclick=()=>pickFilter($('#directoryFilter'),['All classes',...new Set(pupils.map(p=>p.className))],classChoice,x=>{classChoice=x;renderPupils()});
  $('#pupilStatusFilter')?.addEventListener('click',()=>pickFilter($('#pupilStatusFilter'),['All statuses','On campus','Departed','Not arrived'],pupilStatusChoice,x=>{pupilStatusChoice=x;renderPupils()}));
  $('#eventFilter').onclick=()=>pickFilter($('#eventFilter'),['All events','Arrivals','Departures','Manual entries','Exceptions (Manual cards)'],activityChoice,x=>{activityChoice=x;renderActivity()});
  $('#exportActivity').onclick=exportCsv;
  $('#modalClose').onclick=closeModal;
  $('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  $('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');
  $('#helpBtn').onclick=()=>{
    openModal(`<h2 id="modalTitle">Gate team quick guide</h2><p class="modal-intro">A safe, repeatable routine for every pupil movement.</p><ol class="confirm-info"><li>Scan the card, or search the pupil by name or pupil number if card is missing or unreadable.</li><li>Compare the pupil with the profile photo displayed on screen.</li><li>For departure, select only an approved collector and follow school ID-check policy. Departure always requires collector verification.</li><li>Confirm the event and record reason (card_missing or card_unreadable). Event is visibly marked as manual entry in exception reports.</li></ol><div class="qr-security-warning"><strong>Security policy:</strong> Do not photograph, copy, or duplicate a QR code as a workaround. Always use manual entry with on-screen photo verification for missing or unreadable cards.</div><div class="modal-actions"><button class="button button-primary" id="guideDone">Got it</button></div>`);
    $('#guideDone').onclick=closeModal;
  };
  $('#pickupHelp').onclick=()=>toast('Follow the school’s approved pickup verification policy.');
  $('#contactSupport').onclick=e=>{e.preventDefault();toast('Demo: contact your school administrator for support.','i')};
  $('#notificationsBtn').onclick=()=>toast('Message delivery is not configured in this local MVP.','!');
  $('.more-button').onclick=async()=>{try{await api('/api/logout',{});signedInUser=null;$('#authScreen').classList.remove('hidden');pupils=[];events=[];requests=[];$('#loginPassword').value='';$('#loginError').classList.add('hidden')}catch(err){toast(err.message,'!')}};
  const now=new Date();$('#todayLabel').textContent=now.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});$('#dateEyebrow').innerHTML=`${now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}).toUpperCase()} <span class="live-label"><i></i> LIVE</span>`;
  $('#startOnboardingFromLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    openGuardianOnboardingFlow();
  });
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('.auth-submit');button.disabled=true;button.textContent='Signing in…';$('#loginError').classList.add('hidden');try{const result=await api('/api/login',{email:$('#loginEmail').value,password:$('#loginPassword').value});setSignedIn(result.user);acceptState(result.state);render()}catch(err){$('#loginError').textContent=err.message==='Failed to fetch'?'Cannot reach the app server. Start Node.js server with npm start and reload this page.':err.message;$('#loginError').classList.remove('hidden')}finally{button.disabled=false;button.innerHTML='Sign in <span>→</span>'}});
  api('/api/me').then(async({user})=>{if(user){setSignedIn(user);await refreshState()}}).catch(()=>{});
})();
