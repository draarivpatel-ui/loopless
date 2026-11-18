import { createAnalyzer } from './studio.mjs?v=studio-c49dfe94a109';

const analyze = createAnalyzer();
self.addEventListener('message', ({ data }) => {
  try { self.postMessage({ id: data.id, result: analyze(data.tour) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
});
