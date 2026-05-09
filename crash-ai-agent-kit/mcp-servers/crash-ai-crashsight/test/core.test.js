import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildAuthParams,
  buildIssueLink,
  compareIssueVersions,
  extractRedmineRefs,
  getSingleCrashAnalysisContext,
  normalizeIssue,
  normalizePlatform,
  readConfig,
  scanDailyCrashes,
} from '../src/core.js';

test('buildAuthParams signs CrashSight OpenAPI requests', () => {
  const params = buildAuthParams('local-user', 'openapi-key', 1710000000);
  const hex = crypto.createHmac('sha256', 'openapi-key').update('local-user_1710000000').digest('hex');
  assert.equal(params.userSecret, Buffer.from(hex).toString('base64'));
  assert.equal(params.localUserId, 'local-user');
  assert.equal(params.t, 1710000000);
});

test('extractRedmineRefs accepts tag, title, and message references', () => {
  const refs = extractRedmineRefs({
    tags: ['redmine:116320', '#111237', { name: 'RM-123456' }],
    title: 'fix issue 116320 and redmine 765432',
    message: 'not a ticket 123',
  });
  assert.deepEqual(refs, [116320, 111237, 123456, 765432]);
});

test('extractRedmineRefs accepts Redmine issue URLs and CrashSight tag object fields', () => {
  const refs = extractRedmineRefs({
    tags: [
      'http://soc-redmine.wd.com/issues/101769',
      { tagName: 'https://soc-redmine.wd.com/issues/105768' },
      { displayName: 'Redmine单：108047' },
      { url: 'http://soc-redmine.wd.com/issues/101769' },
    ],
  });
  assert.deepEqual(refs, [101769, 105768, 108047]);
});

test('normalizeIssue keeps application version, device counts, tags, and link', () => {
  const issue = normalizeIssue({
    issueId: 'ISSUE-1',
    issueHash: 'hash-1',
    todayCrashNum: 2,
    crashNum: 7,
    todayUserCount: 1,
    userCount: 3,
    deviceCount: 5,
    firstUploadTime: '2026-05-01 10:00:00',
    latestUploadTime: '2026-05-09 12:00:00',
    firstCrashVersion: 'pc-trunk-1',
    issueVersion: 'pc-trunk-2',
    appVersion: 'Soc_PC_1.2.3',
    tagInfoList: [{ name: 'http://soc-redmine.wd.com/issues/116320' }],
    keyStack: 'A\nB',
  }, {
    platform: normalizePlatform('pc'),
    appId: 'pc-app',
    versionFilter: '*trunk*',
    baseUrl: 'https://crashsight.qq.com',
  });

  assert.equal(issue.issueId, 'ISSUE-1');
  assert.equal(issue.periodCrashNum, 2);
  assert.equal(issue.totalCrashNum, 7);
  assert.equal(issue.crashNum, 2);
  assert.equal(issue.periodAffectedUsersOrDevices, 1);
  assert.equal(issue.totalAffectedUsersOrDevices, 5);
  assert.equal(issue.affectedUsersOrDevices, 1);
  assert.equal(issue.firstSeenTime, '2026-05-01 10:00:00');
  assert.equal(issue.applicationVersion, 'Soc_PC_1.2.3');
  assert.equal(issue.currentVersion, 'Soc_PC_1.2.3');
  assert.equal(issue.firstSeenVersion, 'pc-trunk-1');
  assert.deepEqual(issue.redmineRefs, [116320]);
  assert.deepEqual(issue.redmineLinks, [{ id: 116320, url: 'http://soc-redmine.wd.com/issues/116320' }]);
  assert.equal(issue.crashSightLink, 'https://crashsight.qq.com/crash-reporting/crashes/pc-app/ISSUE-1?pid=10');
});

test('buildIssueLink uses current CrashSight crash-reporting route', () => {
  assert.equal(
    buildIssueLink('https://crashsight.qq.com', '6d453ed847', 1, '937175B5C5894BFA9FD87B4E864CC582'),
    'https://crashsight.qq.com/crash-reporting/crashes/6d453ed847/937175B5C5894BFA9FD87B4E864CC582?pid=1',
  );
  assert.equal(
    buildIssueLink('https://crashsight.qq.com', '6c249f150a', 10, '8d62cbc71eb4ec46e5a88d7bb99fc581'),
    'https://crashsight.qq.com/crash-reporting/crashes/6c249f150a/8d62cbc71eb4ec46e5a88d7bb99fc581?pid=10',
  );
});

test('scanDailyCrashes scans each platform and version filter', async () => {
  const calls = [];
  const client = {
    async post(apiPath, body) {
      calls.push({ apiPath, body });
      assert.equal(apiPath, '/uniform/openapi/queryIssueList');
      return {
        issueList: [{
          issueId: `ISSUE-${body.platformId}-${body.version}`,
          todayCrashNum: 2,
          crashNum: 2,
          todayUserCount: 1,
          userCount: 1,
          issueVersion: body.version,
          latestUploadTime: '2026-05-09 08:00:00',
          tag: ['redmine:116320'],
        }],
      };
    },
  };
  const config = readConfig({
    CRASHSIGHT_APP_ID_PC: 'pc-app',
    CRASHSIGHT_APP_ID_ANDROID: 'android-app',
    CRASHSIGHT_BRANCH_FILTERS: '{"trunk":"*trunk*"}',
  });

  const result = await scanDailyCrashes({
    date: '20260509',
    platforms: ['pc', 'android'],
    versionFilters: ['*trunk*', '*weekly*'],
    rows: 10,
  }, config, client);

  assert.equal(calls.length, 4);
  assert.equal(result.date, '20260509');
  assert.equal(result.items.length, 4);
  assert.equal(result.summary.periodCrashCount, 8);
  assert.equal(result.summary.totalCrashCount, 8);
  assert.equal(result.summary.periodAffectedUsersOrDevices, 4);
  assert.equal(result.summary.totalAffectedUsersOrDevices, 4);
  assert.deepEqual(result.items[0].redmineRefs, [116320]);
});

test('scanDailyCrashes reports period and total counts separately when CrashSight provides both', async () => {
  const client = {
    async post() {
      return {
        issueList: [{
          issueId: 'ISSUE-COUNT-SPLIT',
          todayCrashNum: 12,
          crashNum: 661,
          todayUserCount: 5,
          userCount: 28,
          latestUploadTime: '2026-05-09 09:00:00',
        }],
      };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await scanDailyCrashes({
    date: '20260509',
    platforms: ['pc'],
    versionFilters: ['*trunk*'],
  }, config, client);

  assert.equal(result.items[0].periodCrashNum, 12);
  assert.equal(result.items[0].totalCrashNum, 661);
  assert.equal(result.items[0].periodAffectedUsersOrDevices, 5);
  assert.equal(result.items[0].totalAffectedUsersOrDevices, 28);
  assert.equal(result.summary.periodCrashCount, 12);
  assert.equal(result.summary.totalCrashCount, 661);
  assert.equal(result.summary.periodAffectedUsersOrDevices, 5);
  assert.equal(result.summary.totalAffectedUsersOrDevices, 28);
});

test('normalizeIssue does not invent period metrics from total-only fields', () => {
  const issue = normalizeIssue({
    issueId: 'ISSUE-TOTAL-ONLY',
    crashNum: 144,
    userCount: 2,
    latestUploadTime: '2026-05-09 09:00:00',
  }, {
    platform: normalizePlatform('pc'),
    appId: 'pc-app',
    versionFilter: '*trunk*',
  });

  assert.equal(issue.periodCrashNum, null);
  assert.equal(issue.periodAffectedUsersOrDevices, null);
  assert.equal(issue.periodMetricsVerified, false);
  assert.equal(issue.totalCrashNum, 144);
  assert.equal(issue.totalAffectedUsersOrDevices, 2);
});

test('scanDailyCrashes filters returned issues by upload date range', async () => {
  const client = {
    async post() {
      return {
        issueList: [
          {
            issueId: 'TODAY',
            crashNum: 2,
            userCount: 1,
            latestUploadTime: '2026-05-09 12:34:56',
          },
          {
            issueId: 'YESTERDAY',
            crashNum: 99,
            userCount: 88,
            latestUploadTime: '2026-05-08 23:59:59',
          },
        ],
      };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await scanDailyCrashes({
    startDate: '20260509',
    endDate: '20260509',
    platforms: ['pc'],
    versionFilters: ['*trunk*'],
  }, config, client);

  assert.equal(result.startDate, '20260509');
  assert.equal(result.endDate, '20260509');
  assert.deepEqual(result.items.map((item) => item.issueId), ['TODAY']);
  assert.equal(result.summary.totalCrashCount, 2);
});

test('scanDailyCrashes accepts multi-day date ranges', async () => {
  const client = {
    async post() {
      return {
        issueList: [
          { issueId: 'IN-1', latestUploadTime: '2026-05-08 00:00:00' },
          { issueId: 'IN-2', latestUploadTime: '2026-05-09 23:59:59' },
          { issueId: 'OUT', latestUploadTime: '2026-05-10 00:00:00' },
        ],
      };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await scanDailyCrashes({
    startDate: '2026-05-08',
    endDate: '2026-05-09',
    platforms: ['pc'],
    versionFilters: ['*trunk*'],
  }, config, client);

  assert.deepEqual(result.items.map((item) => item.issueId), ['IN-1', 'IN-2']);
});

test('scanDailyCrashes sends exact time range, paginates, and keeps version-filter duplicates', async () => {
  const calls = [];
  const client = {
    async post(apiPath, body) {
      calls.push({ apiPath, body });
      assert.equal(apiPath, '/uniform/openapi/queryIssueList');
      assert.equal(body.startDate, '20260508');
      assert.equal(body.endDate, '20260509');
      assert.equal(body.startTime, '2026-05-08 12:00:00');
      assert.equal(body.endTime, '2026-05-09 16:30:00');
      assert.equal(body.rows, 2);

      if (body.version === '*trunk*' && body.page === 1) {
        return {
          issueList: [
            {
              issueId: 'DUPLICATE',
              todayCrashNum: 2,
              crashNum: 20,
              todayUserCount: 1,
              userCount: 8,
              latestUploadTime: '2026-05-08 12:30:00',
              tag: ['redmine:116320'],
            },
            {
              issueId: 'BEFORE-RANGE',
              todayCrashNum: 1,
              crashNum: 9,
              latestUploadTime: '2026-05-08 11:59:59',
            },
          ],
        };
      }
      if (body.version === '*trunk*' && body.page === 2) {
        return {
          issueList: [{
            issueId: 'PAGE-2',
            todayCrashNum: 3,
            crashNum: 30,
            latestUploadTime: '2026-05-09 16:00:00',
          }],
        };
      }
      if (body.version === '*weekly*' && body.page === 1) {
        return {
          issueList: [{
            issueId: 'DUPLICATE',
            todayCrashNum: 2,
            crashNum: 20,
            todayUserCount: 1,
            userCount: 8,
            latestUploadTime: '2026-05-08 12:35:00',
            tag: ['http://soc-redmine.wd.com/issues/116320'],
          }],
        };
      }
      return { issueList: [] };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await scanDailyCrashes({
    startTime: '2026-05-08 12:00:00',
    endTime: '2026-05-09 16:30:00',
    platforms: ['pc'],
    versionFilters: ['*trunk*', '*weekly*'],
    pageSize: 2,
  }, config, client);

  assert.deepEqual(result.items.map((item) => item.issueId), ['DUPLICATE', 'PAGE-2', 'DUPLICATE']);
  assert.deepEqual(result.items[0].matchedVersionFilters, ['*trunk*']);
  assert.deepEqual(result.items[2].matchedVersionFilters, ['*weekly*']);
  assert.deepEqual(result.items[0].redmineRefs, [116320]);
  assert.equal(result.summary.rawIssueCount, 3);
  assert.equal(result.summary.duplicateIssueCount, 0);
  assert.equal(result.summary.potentialDuplicateIssueCount, 1);
  assert.equal(result.summary.crossVersionDuplicateIssueCount, 1);
  assert.equal(result.summary.dedupeApplied, false);
  assert.equal(result.summary.totalIssues, 3);
  assert.equal(result.summary.filteredOutByDate, 1);
  assert.equal(result.summary.pagesScanned, 3);
  assert.equal(result.pageSize, 2);
  assert.equal(result.rows, undefined);
});

test('compareIssueVersions reports continued and unresolved version history', async () => {
  const client = {
    async post(apiPath, body) {
      assert.equal(apiPath, '/uniform/openapi/queryIssueList');
      const version = body.version;
      return {
        issueList: version === '*old*'
          ? []
          : [{ issueId: 'ISSUE-9', issueVersion: version, firstUploadTime: '2026-05-01' }],
      };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await compareIssueVersions({
    platform: 'pc',
    issueId: 'ISSUE-9',
    versionFilters: ['*old*', '*current*'],
  }, config, client);

  assert.equal(result.issueId, 'ISSUE-9');
  assert.equal(result.continuedVersionCount, 1);
  assert.equal(result.judgement, '仍在发生');
  assert.equal(result.firstSeenVersion, '*current*');
});

test('getSingleCrashAnalysisContext returns stacks without dump payloads', async () => {
  const calls = [];
  const client = {
    async post(apiPath) {
      calls.push(apiPath);
      if (apiPath === '/uniform/openapi/issueInfo') {
        return { issueId: 'ISSUE-1', exceptionName: 'AccessViolation' };
      }
      if (apiPath === '/uniform/openapi/lastCrashInfo') {
        return { crashHash: 'hash-1' };
      }
      if (apiPath === '/uniform/openapi/crashDoc') {
        return {
          crashMap: {
            callStack: 'Thread A\nFrame 0\nFrame 1',
            threadStack: 'Thread B\nFrame 0',
            userId: 'u1',
            model: 'RTX',
          },
        };
      }
      return { crashMap: { rawStack: 'Detail stack' } };
    },
  };
  const config = readConfig({ CRASHSIGHT_APP_ID_PC: 'pc-app' });

  const result = await getSingleCrashAnalysisContext({
    platform: 'pc',
    issueId: 'ISSUE-1',
  }, config, client);

  assert.deepEqual(calls, [
    '/uniform/openapi/issueInfo',
    '/uniform/openapi/lastCrashInfo',
    '/uniform/openapi/crashDoc',
    '/uniform/openapi/appDetailCrash',
  ]);
  assert.equal(result.crashHash, 'hash-1');
  assert.match(result.fullStack, /Thread A/);
  assert.equal(result.dumpIncluded, false);
  assert.equal(Object.hasOwn(result, 'dump'), false);
});
