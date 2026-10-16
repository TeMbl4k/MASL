import { INTERESTS } from '@masl/shared';
import { createDb } from '../client.js';
import { seedInterests } from '../seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
try {
  await seedInterests(db);
  console.log(`Интересы: ${INTERESTS.length} записей`);
} finally {
  await close();
}
