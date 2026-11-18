/** Houston / Sugar Land inspired examples. These are fictional errands on a synthetic mile grid. */
export const STUDIO_PRESETS = [
  {
    id: 'houston-stem', title: 'After-School STEM & Errand Run', mode: 'bike', metric: 'manhattan',
    startTime: '15:30', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Home base', x: 0, y: 0 },
    stops: [
      { id: 'groceries', name: 'Family grocery pickup', x: -2.6, y: 0.2, durationMin: 20, windowStart: '16:30', windowEnd: '18:30', priority: 2, category: 'family', dependsOn: null },
      { id: 'library', name: 'Library book return', x: 2.5, y: 1.4, durationMin: 10, windowStart: '15:30', windowEnd: '16:15', priority: 3, category: 'study', dependsOn: null },
      { id: 'stem-kit', name: 'STEM kit pickup', x: -2.4, y: 0.5, durationMin: 12, windowStart: '15:30', windowEnd: '17:50', priority: 3, category: 'club', dependsOn: null },
      { id: 'tutoring', name: 'Peer tutoring session', x: 2.3, y: 1.2, durationMin: 25, windowStart: '15:30', windowEnd: '17:15', priority: 3, category: 'study', dependsOn: 'library' },
    ],
  },
  {
    id: 'sugar-land-family', title: 'Saturday Family Groceries & Library Loop', mode: 'car', metric: 'manhattan',
    startTime: '09:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Home base', x: 0, y: 0 },
    stops: [
      { id: 'market', name: 'Weekend groceries', x: 0.5, y: 0.2, durationMin: 25, windowStart: '10:30', windowEnd: '13:00', priority: 2, category: 'family', dependsOn: null },
      { id: 'library', name: 'Family library return', x: 3.5, y: 2, durationMin: 15, windowStart: '09:00', windowEnd: '10:15', priority: 3, category: 'study', dependsOn: null },
      { id: 'parcel', name: 'Parcel drop-off', x: 3.2, y: 1.8, durationMin: 10, windowStart: '09:00', windowEnd: '11:30', priority: 2, category: 'errand', dependsOn: null },
      { id: 'bakery', name: 'Lunch bread pickup', x: 1.4, y: 0.8, durationMin: 10, windowStart: '09:30', windowEnd: '12:30', priority: 1, category: 'family', dependsOn: null },
      { id: 'repair', name: 'Bike repair collection', x: -0.6, y: 1.4, durationMin: 15, windowStart: '09:00', windowEnd: '12:00', priority: 2, category: 'errand', dependsOn: null },
    ],
  },
  {
    id: 'houston-hackathon', title: 'Hackathon Supply & Hardware Pickup', mode: 'car', metric: 'manhattan',
    startTime: '08:30', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Team base', x: 0, y: 0 },
    stops: [
      { id: 'posters', name: 'Print demo posters', x: 4.5, y: 0.5, durationMin: 15, windowStart: '08:30', windowEnd: '11:30', priority: 2, category: 'club', dependsOn: null },
      { id: 'hardware', name: 'Hardware & cable pickup', x: 1.4, y: -2.2, durationMin: 20, windowStart: '08:30', windowEnd: '10:30', priority: 3, category: 'errand', dependsOn: null },
      { id: 'build', name: 'Prototype assembly', x: 1.8, y: -2.4, durationMin: 25, windowStart: '09:00', windowEnd: '11:15', priority: 3, category: 'club', dependsOn: 'hardware' },
      { id: 'snacks', name: 'Team water & fruit', x: 4.2, y: 0.8, durationMin: 12, windowStart: '08:30', windowEnd: '12:15', priority: 1, category: 'family', dependsOn: null },
      { id: 'setup', name: 'Demo table setup', x: 3.8, y: 1.2, durationMin: 30, windowStart: '09:30', windowEnd: '12:45', priority: 3, category: 'club', dependsOn: 'posters' },
      { id: 'battery', name: 'Battery pack collection', x: 0.6, y: 0.9, durationMin: 10, windowStart: '09:00', windowEnd: '13:00', priority: 2, category: 'errand', dependsOn: null },
    ],
  },
  {
    id: 'honest-overload', title: 'Intentional Overload (Honest Infeasibility)', mode: 'walk', metric: 'manhattan',
    startTime: '16:00', returnToAnchor: true, transitJitterMin: 0,
    anchor: { name: 'Home base', x: 0, y: 0 },
    stops: [
      { id: 'clinic', name: 'Far clinic counter', x: 3.5, y: 2, durationMin: 30, windowStart: '16:00', windowEnd: '16:40', priority: 3, category: 'health', dependsOn: null },
      { id: 'library', name: 'Opposite library return', x: -3, y: -1.5, durationMin: 25, windowStart: '16:00', windowEnd: '16:45', priority: 3, category: 'study', dependsOn: null },
      { id: 'store', name: 'Corner store pickup', x: 0.5, y: 0.3, durationMin: 15, windowStart: '16:00', windowEnd: '17:30', priority: 1, category: 'errand', dependsOn: null },
    ],
  },
];
