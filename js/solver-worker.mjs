import { createAnalyzer } from './studio.mjs?v=studio-c49dfe94a109';
import { buildLabReport } from './bnb-lab.js?v=studio-c49dfe94a109';

const analyze = createAnalyzer();
self.addEventListener('message', ({ data }) => {
  try {
    const result = data && data.type === 'lab-report'
      ? buildLabReport(data.tour, data.options ?? {})
      : analyze(data.tour);
    self.postMessage({ id: data.id, result });
  }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
});
