#!/usr/bin/env node

const fs = require('fs');

const BIFROST_BASE = 'https://bifrost-premium-https-v4.gw.postman.com/ws/proxy';
const POSTMAN_API_BASE = 'https://api.getpostman.com';
const SLUG_MAP = {
  production: 'prod',
  staging: 'stage',
  stage: 'stage',
  development: 'dev',
  qa: 'qa',
  test: 'qa'
};

function fail(message) {
  throw new Error(message);
}

function parseJson(name, rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    fail(`Invalid JSON in ${name}: ${error.message}`);
  }
}

function normalizeStringMap(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawValue)
      .filter(([key, value]) => key && value !== undefined && value !== null && String(value).trim() !== '')
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, value]) => [String(key).trim(), String(value).trim()])
  );
}

function normalizeEnvironmentList(rawValue) {
  if (!Array.isArray(rawValue)) {
    return ['prod'];
  }

  const normalized = Array.from(
    new Set(
      rawValue
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );

  return normalized.length > 0 ? normalized : ['prod'];
}

function readBooleanEnv(name, fallback) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return fallback;
}

function deriveSlug(name) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return (
    SLUG_MAP[normalized] ||
    normalized.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  );
}

function dedupeBySlug(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || !entry.slug || seen.has(entry.slug)) {
      continue;
    }
    seen.set(entry.slug, entry);
  }
  return Array.from(seen.values());
}

function sortStringMap(rawValue) {
  return Object.fromEntries(
    Object.entries(rawValue || {})
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  );
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
  }

  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed) : text;
    const requestError = new Error(`Request failed (${response.status}) for ${url}: ${detail}`);
    requestError.status = response.status;
    requestError.responseText = text;
    throw requestError;
  }

  return parsed;
}

async function resolveTeamId(apiKey) {
  const payload = await requestJson(`${POSTMAN_API_BASE}/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey
    }
  });

  const teamId =
    payload &&
    payload.user &&
    typeof payload.user === 'object' &&
    payload.user.teamId
      ? String(payload.user.teamId).trim()
      : '';

  return teamId;
}

async function requestBifrostSystemEnvironments(teamId, accessToken, body) {
  const response = await fetch(BIFROST_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-access-token': accessToken,
      ...(teamId ? { 'x-entity-team-id': teamId } : {})
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
  }

  if (!response.ok) {
    const error = new Error(`Bifrost system-envs request failed (${response.status})`);
    error.responseText = text;
    throw error;
  }

  return parsed;
}

async function fetchSystemEnvironments(teamId, accessToken) {
  let payload;
  try {
    payload = await requestBifrostSystemEnvironments(teamId, accessToken, {
      service: 'api-catalog',
      method: 'GET',
      path: '/api/system-envs',
      query: { teamId },
      body: {}
    });
  } catch (error) {
    const responseText = String(error && error.responseText ? error.responseText : '');
    const shouldFallback =
      responseText.includes('invalidPathError') ||
      responseText.includes('not allowed');

    if (!shouldFallback) {
      throw error;
    }

    payload = await requestBifrostSystemEnvironments(teamId, accessToken, {
      service: 'publishing',
      method: 'get',
      path: `/api/system-envs?teamId=${encodeURIComponent(teamId)}`
    });
  }

  const rawEntries = payload && Array.isArray(payload.data) ? payload.data : [];
  if (rawEntries.length === 0) {
    fail(`Bifrost returned no system environments for team ${teamId}`);
  }

  return dedupeBySlug(
    rawEntries.map((entry) => ({
      id: String(entry.id || '').trim(),
      name: String(entry.name || '').trim(),
      slug: String(entry.slug || '').trim() || deriveSlug(entry.name)
    }))
  ).filter((entry) => entry.id && entry.slug);
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `${name}<<EOF\n${String(value)}\nEOF\n`, 'utf8');
    return;
  }

  process.stdout.write(`${name}=${String(value)}\n`);
}

async function main() {
  const explicitMap = normalizeStringMap(
    parseJson('INPUT_SYSTEM_ENV_MAP_JSON', process.env.INPUT_SYSTEM_ENV_MAP_JSON, {})
  );
  const requestedEnvironments = normalizeEnvironmentList(
    parseJson('INPUT_ENVIRONMENTS_JSON', process.env.INPUT_ENVIRONMENTS_JSON, ['prod'])
  );
  const requireAssociation = readBooleanEnv('INPUT_REQUIRE_SYSTEM_ENV_ASSOCIATION', true);
  const apiKey = String(process.env.POSTMAN_API_KEY || '').trim();
  const accessToken = String(process.env.POSTMAN_ACCESS_TOKEN || '').trim();

  let teamId = String(process.env.INPUT_POSTMAN_TEAM_ID || '').trim();
  if (!teamId && apiKey) {
    teamId = await resolveTeamId(apiKey);
  }

  let discoveredMap = {};
  let discoverySource = Object.keys(explicitMap).length > 0 ? 'explicit' : 'none';

  if (accessToken && teamId) {
    try {
      const discovered = await fetchSystemEnvironments(teamId, accessToken);
      discoveredMap = Object.fromEntries(
        discovered.map((entry) => [entry.slug, entry.id])
      );
      discoverySource =
        Object.keys(explicitMap).length > 0 ? 'bifrost+explicit' : 'bifrost';
      console.error(
        `Resolved ${Object.keys(discoveredMap).length} system environment(s) from Bifrost for team ${teamId}.`
      );
    } catch (error) {
      console.error(
        `Bifrost system environment discovery failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (Object.keys(explicitMap).length === 0 && requireAssociation) {
        throw error;
      }
    }
  } else if (Object.keys(explicitMap).length === 0) {
    const missing = [];
    if (!accessToken) missing.push('POSTMAN_ACCESS_TOKEN');
    if (!teamId) missing.push('Postman team id');
    if (missing.length > 0) {
      const message =
        `Unable to auto-discover system environments because ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing.`;
      if (requireAssociation) {
        fail(message);
      }
      console.error(message);
    }
  }

  const mergedMap = {
    ...discoveredMap,
    ...explicitMap
  };
  const stableMergedMap = sortStringMap(mergedMap);
  const missingEnvironments = requestedEnvironments.filter(
    (slug) => !stableMergedMap[String(slug || '').trim()]
  );

  if (missingEnvironments.length > 0 && requireAssociation) {
    fail(
      `Missing system environment ids for requested environment(s): ${missingEnvironments.join(', ')}. ` +
      'Add POSTMAN_SYSTEM_ENV_MAP_JSON or ensure Bifrost returns matching system environments for this team.'
    );
  }

  setOutput('team_id', teamId);
  setOutput('system_env_map_json', JSON.stringify(stableMergedMap));
  setOutput('system_env_source', discoverySource);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
