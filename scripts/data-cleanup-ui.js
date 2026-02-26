(function(){
  'use strict';

  const state = {
    data: null,
    issues: [],
    selectedIssueIndex: -1,
    codeFilter: 'all',
    searchFilter: ''
  };

  const els = {};

  function $(id){
    return document.getElementById(id);
  }

  function clone(value){
    return JSON.parse(JSON.stringify(value));
  }

  function pipeline(){
    return window.AL_DATA_PIPELINE || null;
  }

  function saveService(){
    return window.AL_DATA_SAVE_SERVICE || null;
  }

  function normalizeIntoState(){
    const p = pipeline();
    const source = window.DATA || {};
    if(!p || typeof p.normalizeData !== 'function'){
      state.data = clone(source);
      return;
    }
    const normalized = p.normalizeData(clone(source));
    state.data = normalized && normalized.data ? normalized.data : clone(source);
  }

  function runValidation(){
    const p = pipeline();
    if(!p || typeof p.validateData !== 'function'){
      state.issues = [];
      render();
      return;
    }
    const result = p.validateData(state.data);
    state.issues = (result && Array.isArray(result.issues)) ? result.issues : [];
    render();
  }

  function countsByCode(issues){
    const counts = {};
    (issues || []).forEach((issue)=>{
      const code = issue && issue.code ? issue.code : 'unknown';
      counts[code] = (counts[code] || 0) + 1;
    });
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  }

  function applyFilters(issues){
    return (issues || []).filter((issue)=>{
      if(state.codeFilter !== 'all' && issue.code !== state.codeFilter){
        return false;
      }
      if(!state.searchFilter){
        return true;
      }
      const q = state.searchFilter;
      const hay = [
        issue.code || '',
        issue.message || '',
        issue.charKey || '',
        issue.path || ''
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function targetFromIssue(issue){
    if(!issue || !issue.charKey) return null;
    const char = state.data && state.data.characters && state.data.characters[issue.charKey];
    if(!char || !Array.isArray(char.adventures)) return null;
    let index = Number.isFinite(issue.adventureIndex) ? issue.adventureIndex : null;
    if(index == null && typeof issue.path === 'string'){
      const m = issue.path.match(/adventures\[(\d+)\]/);
      if(m){
        index = Number(m[1]);
      }
    }
    if(!Number.isFinite(index) || index < 0 || index >= char.adventures.length){
      return null;
    }
    return {
      charKey: issue.charKey,
      adventureIndex: index,
      adventure: char.adventures[index]
    };
  }

  function eventIndexFromIssue(issue){
    if(!issue || typeof issue.path !== 'string') return null;
    const m = issue.path.match(/item_events\[(\d+)\]/);
    if(!m) return null;
    const value = Number(m[1]);
    return Number.isFinite(value) ? value : null;
  }

  function isOutgoingType(type){
    return type === 'trade_out' || type === 'consume' || type === 'sell' || type === 'destroy' || type === 'lose' || type === 'gift_out';
  }

  function showStatus(message, isError){
    if(!els.status) return;
    els.status.textContent = message || '';
    els.status.dataset.state = isError ? 'error' : 'ok';
  }

  function updateSummary(){
    const filtered = applyFilters(state.issues);
    const errors = filtered.filter((issue)=>issue && issue.severity === 'error').length;
    const warnings = filtered.filter((issue)=>!issue || issue.severity !== 'error').length;
    els.summary.textContent = `Filtered issues: ${filtered.length} (errors: ${errors}, warnings: ${warnings})`;

    const codeCounts = countsByCode(state.issues);
    els.codeFilter.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = `All codes (${state.issues.length})`;
    els.codeFilter.appendChild(all);
    codeCounts.forEach(([code,count])=>{
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${code} (${count})`;
      if(state.codeFilter === code){
        opt.selected = true;
      }
      els.codeFilter.appendChild(opt);
    });
  }

  function renderIssueList(){
    const filtered = applyFilters(state.issues);
    els.issueList.innerHTML = '';
    if(!filtered.length){
      const li = document.createElement('li');
      li.className = 'issue-item empty';
      li.textContent = 'No issues match current filters.';
      els.issueList.appendChild(li);
      return;
    }
    filtered.forEach((issue,idx)=>{
      const li = document.createElement('li');
      li.className = 'issue-item';
      li.dataset.severity = issue && issue.severity ? issue.severity : 'warning';
      li.dataset.selected = String(idx === state.selectedIssueIndex);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'issue-select';
      const where = issue.charKey ? `${issue.charKey}` : 'global';
      const at = Number.isFinite(issue.adventureIndex) ? ` #${issue.adventureIndex + 1}` : '';
      btn.textContent = `${issue.code} | ${where}${at}`;
      btn.addEventListener('click', ()=>{
        state.selectedIssueIndex = idx;
        render();
      });
      li.appendChild(btn);

      const msg = document.createElement('p');
      msg.className = 'issue-message';
      msg.textContent = issue.message || issue.code || 'Issue';
      li.appendChild(msg);

      els.issueList.appendChild(li);
    });
  }

  function selectedIssue(){
    const filtered = applyFilters(state.issues);
    if(state.selectedIssueIndex < 0 || state.selectedIssueIndex >= filtered.length){
      return null;
    }
    return filtered[state.selectedIssueIndex];
  }

  function renderEditor(){
    const issue = selectedIssue();
    if(!issue){
      els.issueMeta.textContent = 'Select an issue to inspect.';
      els.editor.value = '';
      els.autoFix.disabled = true;
      return;
    }
    const target = targetFromIssue(issue);
    const meta = [
      `Code: ${issue.code || ''}`,
      `Severity: ${issue.severity || 'warning'}`,
      `Character: ${issue.charKey || '-'}`,
      `Adventure: ${Number.isFinite(issue.adventureIndex) ? (issue.adventureIndex + 1) : '-'}`,
      `Path: ${issue.path || '-'}`
    ];
    els.issueMeta.textContent = meta.join('\n');
    if(!target){
      els.editor.value = '';
      els.autoFix.disabled = true;
      return;
    }
    els.editor.value = JSON.stringify(target.adventure, null, 2);
    els.autoFix.disabled = !(issue.code === 'missing_acquisition_path' || issue.code === 'trade_reciprocity_unmatched');
  }

  function render(){
    updateSummary();
    renderIssueList();
    renderEditor();
  }

  function applyEditor(){
    const issue = selectedIssue();
    if(!issue){
      showStatus('Select an issue first.', true);
      return;
    }
    const target = targetFromIssue(issue);
    if(!target){
      showStatus('Issue is not mapped to a single adventure entry.', true);
      return;
    }
    let parsed;
    try{
      parsed = JSON.parse(els.editor.value);
    }catch(err){
      showStatus(`JSON parse error: ${err.message}`, true);
      return;
    }
    state.data.characters[target.charKey].adventures[target.adventureIndex] = parsed;
    showStatus('Adventure entry updated. Revalidating...', false);
    runValidation();
  }

  function ensureItemEvents(adventure){
    if(Array.isArray(adventure.item_events)){
      return adventure.item_events;
    }
    const p = pipeline();
    if(p && typeof p.normalizeItemEventsForAdventure === 'function'){
      adventure.item_events = p.normalizeItemEventsForAdventure(adventure, adventure);
    }else{
      adventure.item_events = [];
    }
    return adventure.item_events;
  }

  function autoFixMissingAcquisition(issue){
    const target = targetFromIssue(issue);
    if(!target) return false;
    const adventure = target.adventure;
    const events = ensureItemEvents(adventure);
    const eventIndex = eventIndexFromIssue(issue);
    if(!Number.isFinite(eventIndex) || eventIndex < 0 || eventIndex >= events.length){
      return false;
    }
    const event = events[eventIndex];
    if(!event || !isOutgoingType(event.type)){
      return false;
    }
    const previous = eventIndex > 0 ? events[eventIndex - 1] : null;
    if(previous && previous.type === 'acquire' && previous.item === event.item && Number(previous.quantity || 1) === Number(event.quantity || 1)){
      return false;
    }
    events.splice(eventIndex, 0, {
      type: 'acquire',
      item: event.item,
      quantity: Number(event.quantity) > 0 ? Number(event.quantity) : 1,
      notes: 'cleanup: inferred prior acquisition'
    });
    return true;
  }

  function findCharacterKeyLoose(value){
    const input = String(value || '').trim().toLowerCase();
    if(!input) return '';
    const keys = Object.keys(state.data.characters || {});
    const exact = keys.find((key)=>key.toLowerCase() === input);
    if(exact) return exact;
    return '';
  }

  function splitItems(text){
    const p = pipeline();
    if(p && typeof p.parseItemList === 'function'){
      return p.parseItemList(text);
    }
    return String(text || '')
      .split(',')
      .map((v)=>v.trim())
      .filter(Boolean);
  }

  function autoFixTradeReciprocity(issue){
    const target = targetFromIssue(issue);
    if(!target) return false;
    const origin = target.adventure;
    const trade = origin && origin.trade;
    if(!trade || typeof trade !== 'object'){
      return false;
    }
    const counterpartyKey = findCharacterKeyLoose(trade.counterpartyCharacter);
    if(!counterpartyKey){
      return false;
    }
    const cp = state.data.characters[counterpartyKey];
    if(!cp || !Array.isArray(cp.adventures)){
      return false;
    }

    const sameDateInverse = cp.adventures.some((adv)=>{
      if(!adv || adv.date !== origin.date || !adv.trade) return false;
      const t = adv.trade;
      return String(t.counterpartyCharacter || '').trim().toLowerCase() === target.charKey.trim().toLowerCase() &&
        String(t.given || '').trim() === String(trade.received || '').trim() &&
        String(t.received || '').trim() === String(trade.given || '').trim();
    });
    if(sameDateInverse){
      return false;
    }

    const outItems = splitItems(trade.received);
    const inItems = splitItems(trade.given);
    const reciprocal = {
      title: `Trade (reciprocal for ${target.charKey})`,
      date: origin.date,
      code: origin.code || '',
      dm: origin.dm || '',
      kind: 'adventure',
      gp_plus: 0,
      gp_minus: 0,
      gp_net: 0,
      dtd_plus: 0,
      dtd_minus: 0,
      dtd_net: 0,
      level_plus: 0,
      totals: {
        gp: { earned: 0, spent: 0, net: 0 },
        downtime: { earned: 0, spent: 0, net: 0 },
        level: { gained: 0 }
      },
      perm_items: [],
      lost_perm_item: [],
      consumable_items: [],
      supernatural_gifts: [],
      story_awards: [],
      notes: 'cleanup: generated reciprocal trade entry',
      trade: {
        counterpartyCharacter: target.charKey,
        given: trade.received || '',
        received: trade.given || ''
      },
      item_events: []
    };
    outItems.forEach((item)=>{
      reciprocal.item_events.push({ type: 'acquire', item, quantity: 1, notes: 'cleanup: inferred pre-trade ownership' });
      reciprocal.item_events.push({ type: 'trade_out', item, quantity: 1 });
    });
    inItems.forEach((item)=>{
      reciprocal.item_events.push({ type: 'trade_in', item, quantity: 1 });
    });
    cp.adventures.push(reciprocal);
    return true;
  }

  function autoFixSelected(){
    const issue = selectedIssue();
    if(!issue){
      showStatus('Select an issue first.', true);
      return;
    }
    let changed = false;
    if(issue.code === 'missing_acquisition_path'){
      changed = autoFixMissingAcquisition(issue);
    }else if(issue.code === 'trade_reciprocity_unmatched'){
      changed = autoFixTradeReciprocity(issue);
    }
    if(!changed){
      showStatus('No automatic fix available for this issue instance.', true);
      return;
    }
    showStatus('Applied automatic fix. Revalidating...', false);
    runValidation();
  }

  function autoFixAllMissingAcquisition(){
    const issues = applyFilters(state.issues).filter((issue)=>issue.code === 'missing_acquisition_path');
    let count = 0;
    issues.forEach((issue)=>{
      if(autoFixMissingAcquisition(issue)){
        count += 1;
      }
    });
    showStatus(`Applied ${count} inferred acquisition fixes. Revalidating...`, false);
    runValidation();
  }

  function buildDataJsPayload(){
    const svc = saveService();
    const p = pipeline();
    if(svc && typeof svc.buildDataJsPayload === 'function'){
      return svc.buildDataJsPayload(state.data, p);
    }
    return `window.DATA = ${JSON.stringify(state.data, null, 2)};`;
  }

  function downloadDataFile(){
    const payload = buildDataJsPayload();
    const blob = new Blob([payload], { type: 'application/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'data.js';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showStatus('Downloaded data.js snapshot.', false);
  }

  async function saveToApi(){
    const endpoint = '/api/save-data';
    const payload = buildDataJsPayload();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataJs: payload })
    });
    const body = await response.json().catch(()=>({}));
    if(!response.ok){
      throw new Error((body && (body.error || body.message)) || `Save failed (${response.status})`);
    }
    showStatus('Saved to data/data.js via /api/save-data.', false);
  }

  function bind(){
    els.summary = $('issue-summary');
    els.status = $('status');
    els.codeFilter = $('code-filter');
    els.search = $('search-filter');
    els.issueList = $('issue-list');
    els.issueMeta = $('issue-meta');
    els.editor = $('adventure-editor');
    els.applyEditor = $('apply-editor');
    els.revalidate = $('revalidate');
    els.autoFix = $('auto-fix');
    els.autoFixAllMissing = $('auto-fix-all-missing');
    els.download = $('download-data');
    els.save = $('save-data');

    els.codeFilter.addEventListener('change', ()=>{
      state.codeFilter = els.codeFilter.value || 'all';
      state.selectedIssueIndex = -1;
      render();
    });
    els.search.addEventListener('input', ()=>{
      state.searchFilter = String(els.search.value || '').trim().toLowerCase();
      state.selectedIssueIndex = -1;
      render();
    });
    els.applyEditor.addEventListener('click', applyEditor);
    els.revalidate.addEventListener('click', runValidation);
    els.autoFix.addEventListener('click', autoFixSelected);
    els.autoFixAllMissing.addEventListener('click', autoFixAllMissingAcquisition);
    els.download.addEventListener('click', downloadDataFile);
    els.save.addEventListener('click', async ()=>{
      try{
        await saveToApi();
      }catch(err){
        showStatus(err && err.message ? err.message : String(err), true);
      }
    });
  }

  function init(){
    bind();
    normalizeIntoState();
    runValidation();
    showStatus('Loaded and validated current data.', false);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
