import { test, expect } from 'node:test';
import { SharedDb } from './SharedDb';
import { SearchService } from '../search/SearchService';

test('shared db smoke test', async () => {
  const db = new SharedDb();
  await db.init();

  const file = await db.insertFile('test.txt', 'Hello, world!');
  const query = await db.query('SELECT * FROM files WHERE name = ?', ['test.txt']);

  expect(query).not.toBeNull();
  expect(query.length).toBe(1);
  expect(query[0].name).toBe('test.txt');
  expect(query[0].content).toBe('Hello, world!');

  await db.close();
});

test('search service smoke test', async () => {
  const db = new SharedDb();
  await db.init();

  const searchService = new SearchService(db);

  await db.insertFile('greeting.txt', 'Hello, world!');
  await db.insertFile('notes.txt', 'This is a test file with no greeting');

  const results = await searchService.search('Hello');

  expect(results.length).toBe(1);
  expect(results[0].name).toBe('greeting.txt');
  expect(results[0].score).toBeGreaterThan(0);

  await db.close();
});