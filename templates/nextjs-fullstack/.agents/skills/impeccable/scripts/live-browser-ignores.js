(function (root) {
  'use strict';
  if (!root) return;

  function normalizeIgnoreRule(rule) {
    return String(rule || '').trim().toLowerCase();
  }

  function normalizeIgnoreValue(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function globToRegex(glob) {
    let re = '^';
    let i = 0;
    while (i < glob.length) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          re += '.*';
          i += 2;
          if (glob[i] === '/') i += 1;
        } else {
          re += '[^/]*';
          i += 1;
        }
      } else if (c === '?') {
        re += '[^/]';
        i += 1;
      } else if (c === '{') {
        const end = glob.indexOf('}', i);
        if (end === -1) { re += '\\{'; i += 1; continue; }
        const parts = glob.slice(i + 1, end).split(',').map((p) => p.replace(/[.+^$()|[\]\\]/g, '\\$&'));
        re += `(?:${parts.join('|')})`;
        i = end + 1;
      } else if (/[.+^$()|[\]\\]/.test(c)) {
        re += `\\${c}`;
        i += 1;
      } else {
        re += c;
        i += 1;
      }
    }
    re += '$';
    return new RegExp(re);
  }

  function pageCandidates(pathname, roots, pageFiles) {
    let pagePath = String(pathname || '');
    try {
      pagePath = decodeURIComponent(pagePath);
    } catch {
    }
    pagePath = pagePath.replace(/^\/+/, '');
    if (pagePath === '' || pagePath.endsWith('/')) pagePath += 'index.html';

    const candidates = new Set();
    const addSuffixes = (fullPath) => {
      const parts = fullPath.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        candidates.add(parts.slice(i).join('/'));
      }
    };
    addSuffixes(pagePath);

    const knownPages = [];
    for (const entry of Array.isArray(pageFiles) ? pageFiles : []) {
      if (typeof entry !== 'string' || !entry) continue;
      if (entry === pagePath || entry.endsWith('/' + pagePath)) knownPages.push(entry);
    }
    if (knownPages.length === 1) {
      addSuffixes(knownPages[0]);
      return [...candidates];
    }

    const prefixes = [];
    for (const entry of Array.isArray(roots) ? roots : []) {
      if (typeof entry !== 'string') continue;
      prefixes.push(entry.split('/').filter(Boolean));
    }
    let common = prefixes.length > 0 ? prefixes[0] : [];
    for (const segments of prefixes.slice(1)) {
      let i = 0;
      while (i < common.length && i < segments.length && common[i] === segments[i]) i += 1;
      common = common.slice(0, i);
    }

    if (common.length > 0) addSuffixes(common.join('/') + '/' + pagePath);
    return [...candidates];
  }

  function matchesScope(globs, candidates) {
    return globs.some((glob) => {
      let re;
      try {
        re = globToRegex(String(glob));
      } catch {
        return false;
      }
      return candidates.some((candidate) => re.test(candidate));
    });
  }

  function resolveDetectIgnores({ ignores, pathname } = {}) {
    const config = ignores && typeof ignores === 'object' ? ignores : {};
    const asArray = (value) => (Array.isArray(value) ? value : []);
    const candidates = pageCandidates(pathname, config.roots, config.pageFiles);

    const ignoreFileGlobs = asArray(config.ignoreFiles)
      .filter((glob) => typeof glob === 'string' && glob.trim());
    if (ignoreFileGlobs.length > 0 && matchesScope(ignoreFileGlobs, candidates)) {
      return { disabledRules: [], disabledValues: [], skipScan: true };
    }

    const disabledRules = new Set(
      asArray(config.ignoreRules)
        .filter((rule) => typeof rule === 'string')
        .map(normalizeIgnoreRule)
        .filter(Boolean),
    );
    const disabledValues = [];

    for (const entry of asArray(config.ignoreValues)) {
      if (!entry || typeof entry !== 'object') continue;
      const rule = normalizeIgnoreRule(entry.rule);
      const value = normalizeIgnoreValue(entry.value);
      if (!rule || !value) continue;
      const files = [
        ...(typeof entry.file === 'string' && entry.file.trim() ? [entry.file.trim()] : []),
        ...asArray(entry.files).filter((glob) => typeof glob === 'string' && glob.trim()),
      ];
      if (value === '*') {
        if (files.length > 0 && matchesScope(files, candidates)) disabledRules.add(rule);
        continue;
      }
      if (files.length > 0 && !matchesScope(files, candidates)) continue;
      disabledValues.push({ rule, value });
    }

    return { disabledRules: [...disabledRules], disabledValues, skipScan: false };
  }

  root.__IMPECCABLE_LIVE_IGNORES__ = {
    version: 1,
    resolveDetectIgnores,
  };
})(typeof window !== 'undefined' ? window : globalThis);
