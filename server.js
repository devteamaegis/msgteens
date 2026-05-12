/**
 * MSG Teens — Backend Server
 * Node.js + Express
 *
 * Endpoints:
 *   POST /api/signup        — register a new member
 *   GET  /api/members       — list all members (admin)
 *   POST /api/submit-story  — submit a teen story for review
 *   GET  /api/stories       — get approved stories
 *   POST /api/award-points  — award points to a member
 *   GET  /api/leaderboard   — get current month leaderboard
 *
 * Storage: JSON flat files (no database needed to start)
 * Upgrade path: swap db.js for MongoDB/Postgres later
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html from /public

// ── Flat-file "database" helpers ──────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readDB(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeDB(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function uid() {
  return crypto.randomBytes(6).toString('hex');
}

// ── Current month key e.g. "2026-05" ─────────────────────
function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ══════════════════════════════════════════════════════════
//  POST /api/signup
//  Body: { name, email, school, role }
// ══════════════════════════════════════════════════════════
app.post('/api/signup', (req, res) => {
  const { name, email, school, role } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const members = readDB('members.json');

  // prevent duplicate emails
  if (members.find(m => m.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'This email is already registered.' });
  }

  const member = {
    id: uid(),
    name,
    email: email.toLowerCase(),
    school: school || '',
    role:   role   || 'teen',
    points: {},        // { "2026-05": 12, "2026-06": 7 }
    joinedAt: new Date().toISOString()
  };

  members.push(member);
  writeDB('members.json', members);

  console.log(`[signup] New member: ${name} <${email}>`);
  res.status(201).json({ message: 'Welcome to MSG Teens!', memberId: member.id });
});

// ══════════════════════════════════════════════════════════
//  GET /api/members   (simple admin — add auth before going live)
// ══════════════════════════════════════════════════════════
app.get('/api/members', (req, res) => {
  const members = readDB('members.json');
  // strip emails for public exposure — keep for admin
  const safe = members.map(({ id, name, school, role, points, joinedAt }) =>
    ({ id, name, school, role, points, joinedAt })
  );
  res.json(safe);
});

// ══════════════════════════════════════════════════════════
//  POST /api/submit-story
//  Body: { teenName, submitterName, submitterEmail, description, imageUrl? }
// ══════════════════════════════════════════════════════════
app.post('/api/submit-story', (req, res) => {
  const { teenName, submitterName, submitterEmail, description, imageUrl } = req.body;

  if (!teenName || !submitterName || !description) {
    return res.status(400).json({ error: 'teenName, submitterName, and description are required.' });
  }

  const stories = readDB('stories.json');

  const story = {
    id: uid(),
    teenName,
    submitterName,
    submitterEmail: submitterEmail || '',
    description,
    imageUrl: imageUrl || '',
    status: 'pending',   // pending | approved | rejected
    submittedAt: new Date().toISOString()
  };

  stories.push(story);
  writeDB('stories.json', stories);

  console.log(`[story] Submitted for: ${teenName} by ${submitterName}`);
  res.status(201).json({ message: 'Story submitted! We will review it soon.', storyId: story.id });
});

// ══════════════════════════════════════════════════════════
//  GET /api/stories   — only approved stories go public
// ══════════════════════════════════════════════════════════
app.get('/api/stories', (req, res) => {
  const stories = readDB('stories.json');
  const approved = stories.filter(s => s.status === 'approved');
  res.json(approved);
});

// ══════════════════════════════════════════════════════════
//  POST /api/award-points
//  Body: { memberId, action }
//  action: "small" (1pt) | "medium" (3pt) | "big" (5pt)
// ══════════════════════════════════════════════════════════
const POINT_VALUES = { small: 1, medium: 3, big: 5 };

app.post('/api/award-points', (req, res) => {
  const { memberId, action } = req.body;

  if (!memberId || !action) {
    return res.status(400).json({ error: 'memberId and action are required.' });
  }
  const pts = POINT_VALUES[action];
  if (!pts) {
    return res.status(400).json({ error: 'action must be small, medium, or big.' });
  }

  const members = readDB('members.json');
  const member  = members.find(m => m.id === memberId);

  if (!member) {
    return res.status(404).json({ error: 'Member not found.' });
  }

  const month = monthKey();
  member.points[month] = (member.points[month] || 0) + pts;

  writeDB('members.json', members);

  console.log(`[points] +${pts} to ${member.name} (total this month: ${member.points[month]})`);
  res.json({
    message: `Awarded ${pts} point(s) to ${member.name}`,
    monthlyTotal: member.points[month]
  });
});

// ══════════════════════════════════════════════════════════
//  GET /api/leaderboard   — top 10 for current month
// ══════════════════════════════════════════════════════════
app.get('/api/leaderboard', (req, res) => {
  const members = readDB('members.json');
  const month   = monthKey();

  const ranked = members
    .map(m => ({ id: m.id, name: m.name, school: m.school, points: m.points[month] || 0 }))
    .filter(m => m.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 10)
    .map((m, i) => ({ rank: i + 1, ...m }));

  res.json({ month, leaderboard: ranked });
});

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nMSG Teens server running on http://localhost:${PORT}`);
  console.log('Data stored in ./data/');
  console.log('Routes:');
  console.log('  POST /api/signup');
  console.log('  GET  /api/members');
  console.log('  POST /api/submit-story');
  console.log('  GET  /api/stories');
  console.log('  POST /api/award-points');
  console.log('  GET  /api/leaderboard\n');
});
