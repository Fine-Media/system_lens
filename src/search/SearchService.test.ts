import { test, expect } from 'node:test';
import { SearchService } from './SearchService';
import { SharedDb } from '../db/SharedDb';

const db = new SharedDb();
await db.init();

const searchService = new SearchService(db);

test('happy path', async () => {
  const query = 'test';
  const results = await searchService.search(query);
  expect(results).not.toBeNull();
  expect(results.length).toBe(1);
  expect(results[0].name).toBe('test.txt');
  expect(results[0].content).toBe('Hello, world!');
});

test('edge case - empty query', async () => {
  const query = '';
  const results = await searchService.search(query);
  expect(results).not.toBeNull();
  expect(results.length).toBe(0);
});

await db.close();
