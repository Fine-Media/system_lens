import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SharedDb } from '@system-lens/shared-db';
import { SearchService } from '@system-lens/search';

test('shared db smoke test', async () => {
  const db = new SharedDb();
  const updatedAt = new Date('2026-01-01T00:00:00.000Z').toISOString();

  const file = db.upsertFile({
    path: 'notes/test.txt',
    type: 'file',
    updatedAt,
    sizeBytes: 13,
  });
  const query = db.queryFilesByText('test');

  assert.equal(query.length, 1);
  assert.equal(query[0].id, file.id);
  assert.equal(query[0].path, 'notes/test.txt');

  db.close();
});

test('search service smoke test', async () => {
  const db = new SharedDb();
  const updatedAt = new Date('2026-01-01T00:00:00.000Z').toISOString();

  const searchService = new SearchService(db);

  db.upsertFile({
    path: 'notes/greeting.txt',
    type: 'file',
    updatedAt,
    sizeBytes: 13,
  });

  const results = await searchService.queryHybrid('greeting');

  assert.equal(results.length, 1);
  assert.equal(results[0].path, 'notes/greeting.txt');
  assert.ok(results[0].score > 0);

  db.close();
});
