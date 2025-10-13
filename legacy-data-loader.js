export async function loadLegacyData({ version = '', cacheBust = '' } = {}) {
  const params = new URLSearchParams();
  if (version) params.set('v', version);
  if (cacheBust) params.set('cb', cacheBust);
  const specifier = `./data.js${params.toString() ? `?${params}` : ''}`;
  const module = await import(specifier);
  const raw = module?.DATA ?? module?.default ?? null;
  const transformed = transformData(raw);
  const meta = (raw && typeof raw === 'object') ? raw.meta || {} : {};
  const versionToken = deriveVersionToken(meta, version);
  return {
    data: transformed,
    raw,
    versionToken
  };
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

  const characters = (source && typeof source === 'object' && source.characters && typeof source.characters === 'object')
    ? source.characters
    : {};

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
  const trades = Array.isArray(log.tradesParsed) ? log.tradesParsed : [];

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
      entry.itemTraded = sanitizeText(firstTrade.itemGiven || firstTrade.itemTraded);
      entry.itemReceived = sanitizeText(firstTrade.itemReceived);
      entry.player = sanitizeText(firstTrade.withPlayer || firstTrade.player);
      entry.character = sanitizeText(firstTrade.withCharacter || firstTrade.character);
      if (!entry.notes) {
        entry.notes = sanitizeText(firstTrade.notes);
      }
    }
  }

  if (!hasMeaningfulContent(entry)) {
    return null;
  }

  return entry;
}

function determineEntryKind(log, context) {
  const candidates = [log.entryKind, log.entryType, log.kind, log.category, log.type];
  for (const candidate of candidates) {
    const normalized = sanitizeText(candidate).toLowerCase();
    if (!normalized) continue;
    if (normalized.includes('activity') || normalized.includes('downtime') || normalized.includes('trade') || normalized.includes('reward')) {
      return 'Downtime Activity';
    }
  }

  if (context.trades.length) {
    return 'Downtime Activity';
  }

  const hasAdventureData = Boolean(sanitizeText(log.adventureCode) || sanitizeText(log.adventureName));
  if (!hasAdventureData) {
    const hasDowntimeValues = context.supernatural.length || context.storyRewards.length || context.permItems.length || context.consumables.length;
    if (hasDowntimeValues || toNumber(log.downtimePlus) || toNumber(log.downtimeMinus) || !toNumber(log.levelPlus)) {
      return 'Downtime Activity';
    }
  }

  return 'adventure';
}

function hasMeaningfulContent(entry) {
  if (!entry) return false;
  return Boolean(
    sanitizeText(entry.title) ||
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
