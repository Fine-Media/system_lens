import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SharedDb } from '@system-lens/shared-db';
import { SearchService } from '@system-lens/search';

let db: SharedDb;
let searchService: SearchService;

beforeEach(async () => {
  db = new SharedDb();
  db.upsertFile({
    path: 'notes/test.txt',
    type: 'file',
    updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    sizeBytes: 13,
  });
  searchService = new SearchService(db);
});

afterEach(() => {
  db.close();
});

test('happy path', async () => {
  const query = 'test';
  const results = await searchService.queryHybrid(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'notes/test.txt');
  assert.ok(results[0].score > 0);
});

test('extension filter', async () => {
  const results = await searchService.queryHybrid('test', { extensions: ['.md'] });
  assert.equal(results.length, 0);
});
