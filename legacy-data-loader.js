export async function loadLegacyData({ version = '', cacheBust = '' } = {}) {
  const params = new URLSearchParams();
  if (version) params.set('v', version);
  if (cacheBust) params.set('cb', cacheBust);
  const specifier = `./data.js${params.toString() ? `?${params}` : ''}`;
  let raw = null;
  let importError = null;

  try {
    const module = await import(specifier);
    raw = module?.DATA ?? module?.default ?? null;
    if (!raw && typeof window !== 'undefined') {
      raw = window.DATA ?? null;
    }
  } catch (error) {
    importError = error;
  }

  if (!raw || typeof raw !== 'object') {
    const fetched = await loadDataFromText(specifier);
    if (fetched) {
      raw = fetched;
    } else if (importError) {
      throw importError;
    }
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

async function loadDataFromText(specifier) {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(specifier, { cache: 'no-cache' });
    if (!response || !response.ok) {
      return null;
    }
    const text = await response.text();
    return parseDataText(text);
  } catch (error) {
    return null;
  }
}

function parseDataText(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const payload = extractDataPayload(text);
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

function extractDataPayload(text) {
  const patterns = [
    /window\.DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
    /export\s+const\s+DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
    /export\s+default\s*(\{[\s\S]*\})\s*;?\s*$/
  ];
  for (const pattern of patterns) {
    const match = typeof text === 'string' ? text.match(pattern) : null;
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
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
        problems: ['Invalid data.js payload']
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
      entry.itemTraded = sanitizeText(
        firstTrade.itemGiven ||
        firstTrade.itemTraded ||
        firstTrade.tradeItemGiven ||
        firstTrade.tradeItem
      );
      entry.itemReceived = sanitizeText(
        firstTrade.itemReceived ||
        firstTrade.tradeItemReceived
      );
      entry.player = sanitizeText(
        firstTrade.withPlayer ||
        firstTrade.player ||
        firstTrade.tradePlayerName
      );
      entry.character = sanitizeText(
        firstTrade.withCharacter ||
        firstTrade.character ||
        firstTrade.tradeCharacterName
      );
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
