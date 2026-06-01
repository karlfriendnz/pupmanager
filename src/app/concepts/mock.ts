// Mock data for the client-home redesign concept previews. Self-contained —
// these pages render without auth or DB so Karl can compare the three
// directions. Photos are Unsplash hotlinks (fine for a throwaway preview).

export const MOCK = {
  business: 'Demo Dog Training',
  website: 'demodogtraining.co.nz',
  phone: '021 555 0134',
  trainer: 'Sarah',
  client: 'Aria',
  dog: {
    name: 'Poppy',
    breed: 'Golden Retriever',
    photo: 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=600&q=80',
  },

  // The client's trainers — one client can work with several. Each carries its
  // own accent (wayfinding colour, NOT white-label) so the owner can tell them
  // apart. The chooser screen lists these; tapping one opens that trainer's home.
  trainers: [
    { id: 't1', business: 'Demo Dog Training', person: 'Sarah', accent: '#2a9da9', dogs: ['Poppy'], next: 'Thu 4:00pm', unread: 1, week: '3/5' },
    { id: 't2', business: 'Citywide K9 Behaviour', person: 'Marcus', accent: '#7c3aed', dogs: ['Scout'], next: 'Mon 10:00am', unread: 0, week: '1/3' },
  ],
  // Trainer-curated media of the dog — drives the hero carousel. `video: true`
  // items render with a play overlay. This is the trainer's to upload/manage,
  // so it doubles as another white-label / personalisation hook.
  gallery: [
    { id: 'g1', src: 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=800&q=80', video: false },
    { id: 'g2', src: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&q=80', video: true },
    { id: 'g3', src: 'https://images.unsplash.com/photo-1612536057832-2ff7ead58194?w=800&q=80', video: false },
    { id: 'g4', src: 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=800&q=80', video: false },
  ],
  momentum: { streakDays: 7, trainingDays: 12, badges: 4 },

  // A client can have more than one dog — the home scopes to one at a time
  // via a switcher. Each dog has its own gallery + momentum.
  dogs: [
    {
      id: 'poppy', name: 'Poppy', breed: 'Golden Retriever',
      photo: 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=200&q=80',
      momentum: { streakDays: 7, trainingDays: 12, badges: 4 },
      gallery: [
        { id: 'pg1', src: 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=800&q=80', video: false },
        { id: 'pg2', src: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&q=80', video: true },
        { id: 'pg3', src: 'https://images.unsplash.com/photo-1612536057832-2ff7ead58194?w=800&q=80', video: false },
        { id: 'pg4', src: 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=800&q=80', video: false },
      ],
    },
    {
      id: 'scout', name: 'Scout', breed: 'Border Collie',
      photo: 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=200&q=80',
      momentum: { streakDays: 3, trainingDays: 5, badges: 2 },
      gallery: [
        { id: 'sg1', src: 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?w=800&q=80', video: false },
        { id: 'sg2', src: 'https://images.unsplash.com/photo-1612536057832-2ff7ead58194?w=800&q=80', video: true },
        { id: 'sg3', src: 'https://images.unsplash.com/photo-1552053831-71594a27632d?w=800&q=80', video: false },
      ],
    },
  ],
  week: { done: 3, total: 5 },
  nextSession: {
    title: 'Loose-lead walk',
    when: 'Thursday 4:00pm',
    countdown: 'In 2 days',
    location: 'Riverside Park',
  },
  homework: [
    { id: '1', title: 'Sit-stay', reps: 10, done: true },
    { id: '2', title: 'Recall practice', reps: null, done: true },
    { id: '3', title: 'Loose-lead, 10 min', reps: null, done: true },
    { id: '4', title: 'Place command', reps: 8, done: false },
    { id: '5', title: 'Settle on the mat', reps: null, done: false },
  ],
  nextBadge: { name: '7-day streak', current: 5, target: 7, icon: '🔥' },
  recentBadges: [
    { name: '5-day streak', icon: '🔥' },
    { name: 'Perfect week', icon: '⭐' },
    { name: 'First recall', icon: '🎯' },
    { name: 'Homework hero', icon: '🏅' },
  ],
  message: {
    from: 'Sarah',
    preview: 'Great job with Poppy this week — her recall is really coming along! 🎉',
    when: '2h ago',
  },
  // Clean white-background product photos (generated via fal, served locally).
  recommended: [
    { id: 'p1', name: 'Long line — 10m', price: '$45', photo: '/concept-products/leash.jpg' },
    { id: 'p2', name: 'Puppy starter kit', price: '$55', photo: '/concept-products/puppykit.jpg' },
    { id: 'p3', name: 'Treat pouch', price: '$28', photo: '/concept-products/treats.jpg' },
    { id: 'p4', name: 'Training clicker', price: '$12', photo: '/concept-products/clicker.jpg' },
    { id: 'p5', name: 'Chew toy bundle', price: '$34', photo: '/concept-products/chewtoy.jpg' },
    { id: 'p6', name: 'Calming dog bed', price: '$89', photo: '/concept-products/bed.jpg' },
  ],
  // ── Sessions screen ──
  sessions: {
    upcoming: [
      { id: 'u1', title: 'Loose-lead walk', when: 'Thu 4:00pm', location: 'Riverside Park', trainer: 'Sarah', dog: 'Poppy', type: 'IN_PERSON' as const },
      { id: 'u2', title: 'Recall in distractions', when: 'Next Tue 4:00pm', location: 'Riverside Park', trainer: 'Sarah', dog: 'Poppy', type: 'IN_PERSON' as const },
    ],
    past: [
      { id: 'p1', title: 'Sit-stays & place', when: 'Tue 6 May', trainer: 'Sarah', dog: 'Poppy', notes: true },
      { id: 'p2', title: 'Loose-lead intro', when: '29 Apr', trainer: 'Sarah', dog: 'Poppy', notes: true },
      { id: 'p3', title: 'Assessment & plan', when: '22 Apr', trainer: 'Sarah', dog: 'Poppy', notes: true },
    ],
  },

  // ── Classes screen ──
  classes: [
    { id: 'c1', name: 'Puppy Foundations', when: 'Wed 6:00pm · 6 wks', spots: 'Enrolled', dog: 'Poppy', enrolled: true, photo: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=400&q=80' },
    { id: 'c2', name: 'Loose-Lead Workshop', when: 'Sat 9:30am · 1 day', spots: '3 spots left', dog: 'Poppy', enrolled: false, photo: 'https://images.unsplash.com/photo-1558788353-f76d92427f16?w=400&q=80' },
    { id: 'c3', name: 'Reactive Rover', when: 'Tue 7:00pm · 5 wks', spots: '5 spots left', dog: 'Scout', enrolled: false, photo: 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=400&q=80' },
  ],

  // ── Messages screen (thread per trainer — multi-trainer) ──
  threads: [
    { id: 'th1', trainer: 'Sarah', business: 'Demo Dog Training', accent: '#2a9da9', last: 'Great job with Poppy this week — her recall is really coming along! 🎉', when: '2h', unread: 1 },
    { id: 'th2', trainer: 'Marcus', business: 'Citywide K9 Behaviour', accent: '#7c3aed', last: 'Let’s try the threshold exercise with Scout on Monday.', when: '1d', unread: 0 },
  ],

  // ── Achievements screen ──
  trophies: [
    { name: '5-day streak', icon: '🔥', earned: true },
    { name: 'Perfect week', icon: '⭐', earned: true },
    { name: 'First recall', icon: '🎯', earned: true },
    { name: 'Homework hero', icon: '🏅', earned: true },
    { name: '10 sessions', icon: '🎓', earned: false, progress: '6/10' },
    { name: '30-day club', icon: '📅', earned: false, progress: '12/30' },
    { name: 'Social pup', icon: '🦋', earned: false, progress: '2/5' },
    { name: 'Trick master', icon: '🎩', earned: false, progress: '1/8' },
  ],

  // ── My details screen ──
  profile: {
    name: 'Aria Stewart',
    email: 'aria@example.com',
    phone: '021 555 0177',
    suburb: 'Mount Eden, Auckland',
    emergency: 'Tom Stewart · 021 555 0190',
  },

  feed: [
    { id: 'f1', group: 'Today', kind: 'badge', title: 'Poppy earned a 5-day streak!', sub: 'Five days of homework in a row 🔥', icon: '🔥', celebrate: true },
    { id: 'f2', group: 'Today', kind: 'homework', title: 'Sarah added 3 new tasks', sub: 'This week’s plan is ready', icon: '🎯' },
    { id: 'f3', group: 'Yesterday', kind: 'done', title: 'Nailed it: Recall practice', sub: 'Marked complete', icon: '✅' },
    { id: 'f4', group: 'Yesterday', kind: 'message', title: 'Sarah: “Great job this week!”', sub: 'Tap to reply', icon: '💬' },
    { id: 'f5', group: 'This week', kind: 'session', title: 'Session recap · Sit-stays', sub: 'Tue · 45 min · Riverside Park', icon: '📅' },
    { id: 'f6', group: 'This week', kind: 'shop', title: 'Sarah recommends a 10m long line', sub: 'For Saturday’s recall work · $45', icon: '🛍️' },
  ],
}
