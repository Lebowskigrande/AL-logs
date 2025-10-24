(function(globalFactory){
  const globalScope = typeof globalThis !== 'undefined'
    ? globalThis
    : (typeof window !== 'undefined' ? window : this);

  const api = globalFactory(globalScope);

  if (typeof module === 'object' && module && typeof module.exports === 'object') {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.AL_LEGACY_LOADER = globalScope.AL_LEGACY_LOADER || {};
    globalScope.AL_LEGACY_LOADER.loadLegacyData = api.loadLegacyData;
  }
})(function(){
  const DATA_SCRIPT_PATH='/api/data-proxy';
  const DATA_SCRIPT_FALLBACK_PATH='data/data.js';

  function isLikelyGitObjectId(value){
    return /^[0-9a-f]{40}$/i.test(String(value||'').trim());
  }

  async function loadLegacyData({ version = '', cacheBust = '' } = {}) {
    const specifier = buildDataScriptUrl({ version, cacheBust });
    let raw = getWindowPayload();

    if (!raw) {
      raw = await ensureDataScriptLoaded(specifier, { version, cacheBust });
    }

    if (!raw && typeof window !== 'undefined') {
      if (window.DATA && typeof window.DATA === 'object') {
        raw = window.DATA;
      }
    }

    if (!raw || typeof raw !== 'object') {
      throw new Error('DATA missing after loading data/data.js');
    }

    const transformed = transformData(raw);
    const meta = (raw && typeof raw === 'object') ? raw.meta || {} : {};
    const versionToken = deriveVersionToken(meta, version);
    return {
      data: transformed,
      raw,
      versionToken
    };
  }

  function buildDataScriptUrl({
    version = '',
    cacheBust = '',
    basePath = DATA_SCRIPT_PATH,
    includeVersionParam = true,
    includeCacheBust = true
  } = {}) {
    const normalizedPath = String(basePath || '').trim() || DATA_SCRIPT_PATH;
    const params = new URLSearchParams();
    const normalizedVersion = String(version || '').trim();
    if (includeVersionParam && normalizedVersion && isLikelyGitObjectId(normalizedVersion)) {
      params.set('ref', normalizedVersion);
    }
    if (includeCacheBust && cacheBust) params.set('cb', cacheBust);
    const query = params.toString();
    return query ? `${normalizedPath}?${query}` : normalizedPath;
  }

  function getWindowPayload() {
    if (typeof window === 'undefined') {
      return null;
    }
    const candidates = [window.RAW_DATA, window.DATA];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        return candidate;
      }
    }
    return null;
  }

  async function ensureDataScriptLoaded(src, { version = '', cacheBust = '' } = {}) {
    const attempts = [];

    const tryLoad = async (candidateSrc, isFallback) => {
      await appendDataScript(candidateSrc, { version, cacheBust, isFallback });
      const payload = getWindowPayload();
      if (payload && typeof payload === 'object') {
        return payload;
      }
      pushBootstrapDiagStep('legacy-load-missing-data', {
        src: candidateSrc,
        cacheBust,
        version,
        fallback: isFallback
      });
      throw new Error(`DATA payload missing after loading ${candidateSrc}`);
    };

    try {
      const payload = await tryLoad(src, false);
      if (payload) {
        return payload;
      }
    } catch (primaryError) {
      attempts.push({ src, error: primaryError });
    }

    const fallbackSrc = buildDataScriptUrl({
      version,
      cacheBust,
      basePath: DATA_SCRIPT_FALLBACK_PATH,
      includeVersionParam: false,
      includeCacheBust: false
    });
    if (fallbackSrc !== src) {
      try {
        const payload = await tryLoad(fallbackSrc, true);
        if (payload) {
          return payload;
        }
      } catch (fallbackError) {
        attempts.push({ src: fallbackSrc, error: fallbackError });
      }
    }

    const message = attempts.length > 1
      ? `Failed to load data/data.js from ${attempts.map(({ src: attemptSrc }) => attemptSrc).join(' and ')}`
      : (attempts[0]?.error?.message || `Failed to load ${src}`);

    const error = new Error(message);
    error.attempts = attempts;
    throw error;
  }

  function appendDataScript(src, { version = '', cacheBust = '', isFallback = false } = {}) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw new Error('DOM APIs are required to load data/data.js');
    }

    const parent = document.head || document.body || document.documentElement;
    if (!parent) {
      throw new Error('Unable to append data/data.js script tag');
    }

    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-loader="legacy-data"]');
      if (existing) {
        existing.remove();
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.loader = 'legacy-data';
      script.dataset.source = isFallback ? 'fallback' : 'primary';
      if (version) {
        script.setAttribute('data-version', version);
      }
      if (version && isLikelyGitObjectId(version)) {
        script.setAttribute('data-ref', version);
      } else {
        script.removeAttribute('data-ref');
      }
      if (cacheBust) {
        script.setAttribute('data-cache-bust', cacheBust);
      }

      pushBootstrapDiagStep('legacy-load-attempt', {
        src,
        cacheBust,
        version,
        fallback: isFallback
      });

      const cleanup = () => {
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
      };

      const onLoad = () => {
        cleanup();
        pushBootstrapDiagStep('legacy-load-success', {
          src,
          cacheBust,
          version,
          fallback: isFallback
        });
        resolve();
      };

      const onError = () => {
        cleanup();
        script.remove();
        pushBootstrapDiagStep('legacy-load-error', {
          src,
          cacheBust,
          version,
          fallback: isFallback
        });
        reject(new Error(`Failed to load ${src}`));
      };

      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);

      parent.appendChild(script);
    });
  }

  function pushBootstrapDiagStep(event, detail) {
    if (typeof window === 'undefined') {
      return;
    }
    const diag = window.__AL_DATA_BOOTSTRAP_DIAG__;
    if (!diag || !Array.isArray(diag.steps)) {
      return;
    }
    try {
      diag.steps.push({
        event: String(event || 'unknown'),
        detail: detail ? { ...detail } : null,
        ts: Date.now()
      });
    } catch (error) {
      /* no-op */
    }
  }

  function deriveVersionToken(meta = {}, fallback = '') {
    const candidates = [
      meta.version,
      meta.generatedAt,
      meta.generated,
      fallback
    ];
    for (const candidate of candidates) {
      if (candidate && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
    try {
      return new Date().toISOString();
    } catch (error) {
      return String(Date.now());
    }
  }

  function transformData(source) {
    if (!source || typeof source !== 'object') {
      return {
        characters: {},
        stats: {},
        years: {},
        meta: {
          source_file: '',
          generated: safeIsoString(),
          problems: ['Invalid data/data.js payload']
        }
      };
    }

    const characters = (source && typeof source === 'object' && source.characters && typeof source.characters === 'object')
      ? source.characters
      : {};

    const hasModernStructure = Object.values(characters).some((value) => Array.isArray(value?.adventures));

    if (hasModernStructure) {
      const extras = { ...source };
      delete extras.characters;
      delete extras.stats;
      delete extras.years;
      delete extras.meta;

      const output = {
        characters: {},
        stats: (source.stats && typeof source.stats === 'object') ? { ...source.stats } : {},
        years: (source.years && typeof source.years === 'object') ? { ...source.years } : {},
        meta: {
          source_file: sanitizeText(source.meta?.source_file || source.meta?.sourceFile || ''),
          generated: sanitizeText(source.meta?.generated || source.meta?.generatedAt || safeIsoString()),
          problems: Array.isArray(source.meta?.problems) ? [...source.meta.problems] : []
        }
      };

      for (const [key, value] of Object.entries(characters)) {
        if (!value || typeof value !== 'object') {
          output.characters[key] = { adventures: [] };
          continue;
        }
        const character = { ...value };
        const adventures = Array.isArray(character.adventures)
          ? character.adventures.map((entry) => {
              if (!entry || typeof entry !== 'object') return entry;
              const copy = { ...entry };
              if (!copy.__charKey) {
                copy.__charKey = key;
              }
              return copy;
            })
          : [];
        character.adventures = adventures;
        output.characters[key] = character;
      }

      return { ...extras, ...output };
    }

    const output = {
      characters: {},
      stats: {},
      years: {},
      meta: {
        source_file: sanitizeText(source.meta?.sourceFile || source.meta?.source_file || ''),
        generated: sanitizeText(source.meta?.generatedAt || source.meta?.generated || safeIsoString()),
        problems: Array.isArray(source.meta?.problems) ? [...source.meta.problems] : []
      }
    };

    for (const [key, value] of Object.entries(characters)) {
      output.characters[key] = transformCharacter(key, value);
    }

    return output;
  }

  function transformCharacter(key, value) {
    const logs = Array.isArray(value?.logs) ? value.logs : [];
    const adventures = [];
    for (let index = 0; index < logs.length; index += 1) {
      const entry = transformLog(logs[index], { index, charKey: key });
      if (entry) {
        entry.__charKey = key;
        adventures.push(entry);
      }
    }

    const finalTallies = value?.finalTallies || {};

    const character = {
      sheet: sanitizeText(value?.sheetName || key),
      display_name: sanitizeText(value?.displayName || key),
      adventures
    };

    const magicItems = sanitizeList(finalTallies.magicItems);
    const consumables = sanitizeList(finalTallies.consumablesRemaining);
    const supernatural = sanitizeList(finalTallies.supernaturalGifts);

    if (magicItems.length) {
      character.__final_magic_items = magicItems;
    }
    if (consumables.length) {
      character.__final_consumables = consumables;
    }
    if (supernatural.length) {
      character.supernatural_gifts = supernatural;
    }

    return character;
  }

  function transformLog(log, { index, charKey }) {
    if (!log || typeof log !== 'object') return null;

    const goldPlus = toNumber(log.goldPlus);
    const goldMinus = toNumber(log.goldMinus);
    const downtimePlus = toNumber(log.downtimePlus);
    const downtimeMinus = toNumber(log.downtimeMinus);
    const levelPlus = toNumber(log.levelPlus);
    const permItems = sanitizeList(log.permItems);
    const consumables = sanitizeList(log.consumables);
    const storyRewards = sanitizeList(log.storyRewards);
    const supernatural = sanitizeList(log.supernaturalGiftsFoundHere);
    const losses = sanitizeList(log.lossesParsed);
    const tradesRaw = Array.isArray(log.tradesParsed)
      ? log.tradesParsed
      : Array.isArray(log.trades)
        ? log.trades
        : (log.trades && typeof log.trades === 'object')
          ? [log.trades]
          : [];
    const trades = tradesRaw.filter((entry) => entry && typeof entry === 'object');

    const baseTitle = sanitizeText(log.adventureName) || sanitizeText(log.adventureCode);
    const derivedTitle = trades.length ? 'Trade' : (baseTitle || 'Log Entry');

    const entry = {
      title: baseTitle || derivedTitle,
      date: normalizeDate(log.date),
      code: sanitizeText(log.adventureCode) || null,
      dm: sanitizeText(log.dm) || null,
      gp_plus: Math.max(0, goldPlus),
      gp_minus: Math.max(0, goldMinus),
      gp_net: goldPlus - goldMinus,
      dtd_plus: Math.max(0, downtimePlus),
      dtd_minus: Math.max(0, downtimeMinus),
      dtd_net: downtimePlus - downtimeMinus,
      level_plus: levelPlus,
      perm_items: permItems,
      consumable_items: consumables,
      story_awards: storyRewards,
      supernatural_gifts: supernatural,
      notes: sanitizeText(log.notes),
      kind: determineEntryKind(log, { trades, permItems, consumables, supernatural, storyRewards })
    };

    if (losses.length) {
      entry.lost_perm_item = losses.join('\n');
    }

    if (trades.length) {
      const [firstTrade] = trades;
      if (firstTrade && typeof firstTrade === 'object') {
        const trade = {};
        const given = sanitizeText(
          firstTrade.itemGiven ||
          firstTrade.itemTraded ||
          firstTrade.tradeItemGiven ||
          firstTrade.tradeItem
        );
        const received = sanitizeText(
          firstTrade.itemReceived ||
          firstTrade.tradeItemReceived
        );
        const counterpartyPlayer = sanitizeText(
          firstTrade.withPlayer ||
          firstTrade.player ||
          firstTrade.tradePlayerName
        );
        const counterpartyCharacter = sanitizeText(
          firstTrade.withCharacter ||
          firstTrade.character ||
          firstTrade.tradeCharacterName
        );
        if (given) trade.given = given;
        if (received) trade.received = received;
        if (counterpartyPlayer) trade.counterpartyPlayer = counterpartyPlayer;
        if (counterpartyCharacter) trade.counterpartyCharacter = counterpartyCharacter;
        if (Object.keys(trade).length) {
          entry.trade = trade;
        }
        if (!entry.notes) {
          entry.notes = sanitizeText(firstTrade.notes || firstTrade.tradeNotes);
        }
      }
    }

    const usedFallbackTitle = !baseTitle && !trades.length;
    if (!hasMeaningfulContent(entry, { ignoreTitle: usedFallbackTitle })) {
      return null;
    }

    return entry;
  }

  function determineEntryKind(log, context) {
    const normalizedText = (value) => sanitizeText(value).toLowerCase();
    const explicitKind = normalizedText(log.entryKind || log.entryType || log.kind || log.category || log.type);

    if (explicitKind) {
      if (explicitKind.includes('adventure') || explicitKind.includes('session')) {
        return 'adventure';
      }
      if (explicitKind.includes('activity') || explicitKind.includes('downtime') || explicitKind.includes('trade') || explicitKind.includes('reward')) {
        return 'Downtime Activity';
      }
    }

    if (context.trades.length) {
      return 'Downtime Activity';
    }

    const titleText = normalizedText(log.adventureName) || normalizedText(log.adventureCode);
    if (titleText) {
      if (/(downtime|activity|reward|trade|training)/.test(titleText)) {
        return 'Downtime Activity';
      }
      return 'adventure';
    }

    const noteText = normalizedText(log.notes);
    if (noteText) {
      if (/(downtime|training|crafting|carousing|sow|harvest|lifestyle|purchase|dm reward|reward|trade|traded|sell|sold|buy|bought)/.test(noteText)) {
        return 'Downtime Activity';
      }
      if (/(session|played|adventure|module|scenario)/.test(noteText)) {
        return 'adventure';
      }
    }

    const levelGain = toNumber(log.levelPlus);
    if (levelGain > 0) {
      return 'adventure';
    }

    const gpEarned = toNumber(log.goldPlus);
    const gpSpent = toNumber(log.goldMinus);
    const downtimeEarned = toNumber(log.downtimePlus);
    const downtimeSpent = toNumber(log.downtimeMinus);

    const hasRewards = context.permItems.length || context.storyRewards.length || context.supernatural.length || context.consumables.length;
    if (!hasRewards && levelGain === 0 && gpEarned === 0 && gpSpent === 0 && downtimeEarned === 0 && downtimeSpent > 0) {
      return 'Downtime Activity';
    }

    if (hasRewards || gpEarned > 0 || gpSpent > 0 || downtimeEarned > 0) {
      return 'adventure';
    }

    return 'adventure';
  }

  function hasMeaningfulContent(entry, { ignoreTitle = false } = {}) {
    if (!entry) return false;
    return Boolean(
      (!ignoreTitle && sanitizeText(entry.title)) ||
      sanitizeText(entry.code) ||
      sanitizeText(entry.dm) ||
      sanitizeText(entry.notes) ||
      (Array.isArray(entry.perm_items) && entry.perm_items.length) ||
      (Array.isArray(entry.consumable_items) && entry.consumable_items.length) ||
      (Array.isArray(entry.story_awards) && entry.story_awards.length) ||
      (Array.isArray(entry.supernatural_gifts) && entry.supernatural_gifts.length) ||
      entry.gp_plus || entry.gp_minus || entry.dtd_plus || entry.dtd_minus || entry.level_plus
    );
  }

  function sanitizeText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return String(value || '').trim();
  }

  function sanitizeList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    value.forEach((item) => {
      const text = sanitizeText(item);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  function normalizeDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  function toNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function safeIsoString() {
    try {
      return new Date().toISOString();
    } catch (error) {
      return String(Date.now());
    }
  }

  return {
    loadLegacyData
  };
});
