/**
 * Focused regressions for debrid error classification, quarantine, and balance.
 * Run: node test-debrid-reliability.js
 */
'use strict';

const assert = require('assert');
const {
  isFailedClipUrl,
  isAccountErrorText,
  balanceByProvider,
  quarantineProviders,
  providerFamily,
  probeStreamUrl,
  validateTopStreams,
  configuredDebrids,
  debridsForLookup
} = require('./debridRoutes');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '—', e.message);
    process.exitCode = 1;
  }
}

async function okAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '—', e.message);
    process.exitCode = 1;
  }
}

console.log('debrid reliability');

ok('detects failed_access sentinel clips', () => {
  assert.strictEqual(isFailedClipUrl('https://torrentio.strem.fun/videos/failed_access_v2.mp4'), true);
  assert.strictEqual(isFailedClipUrl('https://cdn.example/real.mp4'), false);
});

ok('detects AUTH_BLOCKED / email account errors', () => {
  assert.ok(isAccountErrorText('AUTH_BLOCKED: access to the debrid api is blocked'));
  assert.ok(isAccountErrorText('Please check your debrid email / approve access'));
  assert.ok(isAccountErrorText('not premium'));
  assert.ok(!isAccountErrorText('1080p BluRay REMUX'));
});

ok('providerFamily groups torrentio/rd/ad variants', () => {
  assert.strictEqual(providerFamily('torrentio-realdebrid'), 'realdebrid');
  assert.strictEqual(providerFamily('mediafusion-ad'), 'alldebrid');
  assert.strictEqual(providerFamily('comet'), 'comet');
});

ok('quarantineProviders drops blocked families', () => {
  const streams = [
    { url: 'https://a/1', provider: 'torrentio-realdebrid' },
    { url: 'https://b/2', provider: 'mediafusion-alldebrid' },
    { url: 'https://c/3', provider: 'comet' }
  ];
  const blocked = new Set(['alldebrid']);
  const kept = quarantineProviders(streams, blocked);
  assert.strictEqual(kept.length, 2);
  assert.ok(kept.every(s => providerFamily(s.provider) !== 'alldebrid'));
});

ok('balanceByProvider caps per family and total', () => {
  const streams = [];
  for (let i = 0; i < 20; i++) streams.push({ url: 'https://rd/' + i, provider: 'realdebrid' });
  for (let i = 0; i < 20; i++) streams.push({ url: 'https://ad/' + i, provider: 'alldebrid' });
  for (let i = 0; i < 5; i++) streams.push({ url: 'https://cm/' + i, provider: 'comet' });
  const out = balanceByProvider(streams, { perProvider: 3, max: 8 });
  assert.strictEqual(out.length, 8);
  const counts = {};
  out.forEach(s => {
    const f = providerFamily(s.provider);
    counts[f] = (counts[f] || 0) + 1;
  });
  assert.ok(counts.realdebrid <= 3);
  assert.ok(counts.alldebrid <= 3);
  assert.ok(counts.comet <= 3);
  assert.ok(Object.keys(counts).length >= 2, 'should diversify across providers');
});

ok('configuredDebrids loads numbered slots in order and deduplicates tokens', () => {
  const env = {
    REALDEBRID_API_TOKEN_3: 'rd-three',
    REALDEBRID_API_TOKEN: 'rd-one',
    REALDEBRID_API_TOKEN_2: 'rd-two',
    ALLDEBRID_API_TOKEN: 'ad-one',
    ALLDEBRID_API_TOKEN_2: 'ad-one',
    PREMIUMIZE_API_TOKEN: '  '
  };
  const out = configuredDebrids('', env);
  assert.deepStrictEqual(out.map(d => d.key), [
    'REALDEBRID_API_TOKEN',
    'REALDEBRID_API_TOKEN_2',
    'REALDEBRID_API_TOKEN_3',
    'ALLDEBRID_API_TOKEN'
  ]);
  assert.deepStrictEqual(out.map(d => d.slot), [1, 2, 3, 1]);
});

ok('personal RD token overrides all site RD slots but keeps other providers', () => {
  const env = {
    REALDEBRID_API_TOKEN: 'site-rd',
    REALDEBRID_API_TOKEN_2: 'site-rd-two',
    TORBOX_API_TOKEN: 'tb-one'
  };
  const out = configuredDebrids('personal-rd', env);
  assert.deepStrictEqual(out.map(d => d.key), ['PERSONAL_REALDEBRID_TOKEN', 'TORBOX_API_TOKEN']);
});

ok('debridsForLookup uses one account per provider on first play', () => {
  const env = {
    REALDEBRID_API_TOKEN: 'rd1',
    REALDEBRID_API_TOKEN_2: 'rd2',
    ALLDEBRID_API_TOKEN: 'ad1',
    ALLDEBRID_API_TOKEN_2: 'ad2'
  };
  assert.deepStrictEqual(
    debridsForLookup('', false, env).map(d => d.key),
    ['REALDEBRID_API_TOKEN', 'ALLDEBRID_API_TOKEN']
  );
  assert.deepStrictEqual(
    debridsForLookup('', true, env).map(d => d.key),
    ['REALDEBRID_API_TOKEN', 'REALDEBRID_API_TOKEN_2', 'ALLDEBRID_API_TOKEN', 'ALLDEBRID_API_TOKEN_2']
  );
});

(async () => {
  await okAsync('probeStreamUrl rejects failed_access without network', async () => {
    const r = await probeStreamUrl('https://torrentio.strem.fun/videos/failed_access_v2.mp4');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'account_blocked');
  });

  await okAsync('probeStreamUrl rejects invalid url', async () => {
    const r = await probeStreamUrl('not-a-url');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'invalid');
  });

  ok('isAccountErrorText matches orange-screen copy', () => {
    assert.ok(isAccountErrorText('Access to debrid API is blocked. Check your debrid account or email.'));
  });

  // Regression: unreachable probes must not empty the list (caused "No playable
  // premium streams" while Find more sources played fine).
  await okAsync('validateTopStreams keeps candidates when probes fail', async () => {
    const streams = [
      { url: 'http://127.0.0.1:9/a.mp4', provider: 'torrentio-realdebrid', quality: '1080p', browserOk: true, cached: true },
      { url: 'http://127.0.0.1:9/b.mp4', provider: 'comet', quality: '1080p', browserOk: true, cached: true },
      { url: 'http://127.0.0.1:9/c.mp4', provider: 'mediafusion', quality: '720p', browserOk: true }
    ];
    const out = await validateTopStreams(streams, { want: 12, probeLimit: 3, minValidated: 3 });
    assert.strictEqual(out.length, 3, 'all unverified candidates should survive');
    assert.ok(out.every(s => !s.validated), 'none should be marked validated');
  });

  await okAsync('blocked numbered account does not quarantine healthy sibling account', async () => {
    const streams = [
      {
        url: 'https://torrentio.strem.fun/videos/failed_access_v2.mp4',
        provider: 'torrentio-realdebrid-2',
        quality: '1080p',
        cached: true
      },
      {
        url: 'http://127.0.0.1:9/primary.mp4',
        provider: 'torrentio-realdebrid',
        quality: '1080p',
        cached: true
      }
    ];
    const out = await validateTopStreams(streams, { probeLimit: 2, minValidated: 1 });
    assert.deepStrictEqual(out.map(s => s.provider), ['torrentio-realdebrid']);
  });

  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
})();
