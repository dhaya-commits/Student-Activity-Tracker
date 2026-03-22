const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret123';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
fs.ensureDirSync(dataDir);
fs.ensureDirSync(uploadsDir);

const files = {
  users: path.join(dataDir, 'users.json'),
  activities: path.join(dataDir, 'activities.json'),
  chats: path.join(dataDir, 'chats.json'),
  schedules: path.join(dataDir, 'schedules.json'),
  attendance: path.join(dataDir, 'attendance.json'),
  placements: path.join(dataDir, 'placements.json'),
};

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) {
    fs.writeJsonSync(file, {});
  }
}

function readJson(file) { return fs.readJsonSync(file); }
function writeJson(file, data) { fs.writeJsonSync(file, data, { spaces: 2 }); }

function assertAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// Root route
app.get('/', (req, res) => {
  res.json({ message: 'Design Thinking Backend running on port 5000', status: 'OK' });
});

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { role, name, email, username, password, collegeName, department, registerNumber, year, section } = req.body;
  if (!role || !name || !email || !username || !password || !collegeName || !department) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const users = readJson(files.users);
  const existing = Object.values(users).find(u => u.username === username || u.email === email);
  if (existing) return res.status(400).json({ message: 'Username or email already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const id = Date.now().toString();

  const user = {
    id,
    role,
    name,
    email,
    username,
    password: hashedPassword,
    collegeName,
    department,
    registerNumber: registerNumber || null,
    year: year || null,
    section: section || null,
    createdAt: new Date().toISOString(),
  };

  users[id] = user;
  writeJson(files.users, users);

  return res.status(201).json({ message: 'User registered successfully' });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Missing username/password' });

  const users = readJson(files.users);
  const user = Object.values(users).find(u => u.username === username);
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  const userSafe = { ...user }; delete userSafe.password;

  return res.json({ token, user: userSafe });
});

// Activities and uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

app.post('/api/activities/upload', assertAuth, upload.single('doc'), (req, res) => {
  const user = req.user;
  const { category, name, date, activityDepartment, activityInstitute, details } = req.body;
  if (!category || !name || !date || !activityDepartment || !activityInstitute) {
    return res.status(400).json({ message: 'Missing required values' });
  }

  const users = readJson(files.users);
  const studentUser = users[user.id];
  
  const activities = readJson(files.activities);
  if (!activities[user.username]) activities[user.username] = [];

  const entry = {
    id: `${Date.now()}`,
    studentId: user.id,
    studentUsername: user.username,
    category,
    name,
    date,
    activityDepartment,
    activityInstitute,
    department: activityDepartment,
    institute: activityInstitute,
    studentCollegeName: studentUser ? studentUser.collegeName : '',
    studentDepartment: studentUser ? studentUser.department : '',
    details: details || '',
    docUrl: req.file ? `/uploads/${req.file.filename}` : null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  activities[user.username].push(entry);
  writeJson(files.activities, activities);

  return res.json({ message: 'Activity uploaded', activity: entry });
});

app.get('/api/activities/my-files', assertAuth, (req, res) => {
  const activities = readJson(files.activities);
  const studentActivities = activities[req.user.username] || [];

  // Flatten by category
  const grouped = {};
  studentActivities.forEach(act => {
    if (!grouped[act.category]) grouped[act.category] = [];
    grouped[act.category].push(act);
  });

  res.json(grouped);
});

app.get('/api/activities/mine', assertAuth, (req, res) => {
  const activities = readJson(files.activities);
  const studentActivities = activities[req.user.username] || [];
  res.json(studentActivities);
});

app.get('/api/admin/activities/pending', assertAuth, (req, res) => {
  const users = readJson(files.users);
  const activities = readJson(files.activities);
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

  const adminUser = users[req.user.id];
  const pending = [];
  
  for (const username in activities) {
    activities[username].forEach(act => {
      // Only include if activity's institute and department match admin's college and department
      if (act.status === 'pending' && 
          act.activityInstitute === adminUser.collegeName && 
          act.activityDepartment === adminUser.department) {
        
        // Get student details
        const student = Object.values(users).find(u => u.username === username);
        
        pending.push({ 
          ...act, 
          student: username,
          studentName: student ? student.name : 'N/A',
          studentRegNo: student ? student.registerNumber : 'N/A',
          studentDept: student ? student.department : 'N/A',
          studentCollege: student ? student.collegeName : 'N/A'
        });
      }
    });
  }

  res.json(pending);
});

app.get('/api/admin/activities/department', assertAuth, (req, res) => {
  const users = readJson(files.users);
  const activities = readJson(files.activities);
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

  const adminUser = users[req.user.id];
  const departmentActivities = [];
  
  for (const username in activities) {
    activities[username].forEach(act => {
      // Include all activities (any status) from the admin's college and department
      if (act.activityInstitute === adminUser.collegeName && 
          act.activityDepartment === adminUser.department) {
        
        // Get student details
        const student = Object.values(users).find(u => u.username === username);
        
        departmentActivities.push({ 
          ...act, 
          student: username,
          studentName: student ? student.name : 'N/A',
          studentRegNo: student ? student.registerNumber : 'N/A',
          studentDept: student ? student.department : 'N/A',
          studentCollege: student ? student.collegeName : 'N/A'
        });
      }
    });
  }

  res.json(departmentActivities);
});

app.post('/api/admin/activities/:username/:activityId/status', assertAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  const { username, activityId } = req.params;
  const { status } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const activities = readJson(files.activities);
  const userActs = activities[username] || [];
  const act = userActs.find(a => a.id === activityId);
  if (!act) return res.status(404).json({ message: 'Activity not found' });
  act.status = status;
  writeJson(files.activities, activities);
  res.json({ message: 'Status updated', activity: act });
});

app.post('/api/chat/send', assertAuth, (req, res) => {
  const { targetUser, text } = req.body;
  if (!targetUser || !text) return res.status(400).json({ message: 'Missing chat fields' });

  const users = readJson(files.users);
  const recipient = Object.values(users).find(u => u.username === targetUser);
  if (!recipient) return res.status(404).json({ message: 'Target user not found' });

  const chats = readJson(files.chats);
  const key = [req.user.username, targetUser].sort().join('::');
  if (!chats[key]) chats[key] = [];

  chats[key].push({ from: req.user.username, to: targetUser, text, createdAt: new Date().toISOString() });
  writeJson(files.chats, chats);
  res.json({ message: 'Sent' });
});

app.get('/api/chat/history', assertAuth, (req, res) => {
  const { withUser } = req.query;
  if (!withUser) return res.status(400).json({ message: 'withUser required' });

  const chats = readJson(files.chats);
  const key = [req.user.username, withUser].sort().join('::');
  res.json(chats[key] || []);
});

app.post('/api/schedule', assertAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  const { date, time, subject, message } = req.body;
  if (!date || !time || !subject || !message) return res.status(400).json({ message: 'Missing schedule values' });

  const schedules = readJson(files.schedules);
  const id = `${Date.now()}`;
  schedules[id] = { id, admin: req.user.username, date, time, subject, message, createdAt: new Date().toISOString() };
  writeJson(files.schedules, schedules);
  res.json({ message: 'Schedule posted', schedule: schedules[id] });
});

app.get('/api/schedule', assertAuth, (req, res) => {
  const schedules = readJson(files.schedules);
  res.json(Object.values(schedules).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)));
});

app.post('/api/attendance', assertAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  const { department, section, year, presentStudents } = req.body;
  if (!department || !section || !year || !Array.isArray(presentStudents)) {
    return res.status(400).json({ message: 'Missing attendance fields' });
  }

  const attendance = readJson(files.attendance);
  const recordId = `${Date.now()}`;
  attendance[recordId] = { id: recordId, department, section, year, presentStudents, createdAt: new Date().toISOString(), admin: req.user.username };
  writeJson(files.attendance, attendance);
  res.json({ message: 'Attendance recorded', record: attendance[recordId] });
});

app.get('/api/attendance', assertAuth, (req, res) => {
  const attendance = readJson(files.attendance);
  res.json(Object.values(attendance));
});

app.post('/api/placements', assertAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
  const { company, role, lastDate, ctc, description } = req.body;
  if (!company || !role || !lastDate) return res.status(400).json({ message: 'Missing placement fields' });
  const placements = readJson(files.placements);
  const id = `${Date.now()}`;
  placements[id] = { id, company, role, lastDate, ctc, description, createdAt: new Date().toISOString(), admin: req.user.username };
  writeJson(files.placements, placements);
  res.json({ message: 'Placement drive posted', placement: placements[id] });
});

app.get('/api/placements', assertAuth, (req, res) => {
  const placements = readJson(files.placements);
  res.json(Object.values(placements).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});

app.get('/api/users/me', assertAuth, (req, res) => {
  const users = readJson(files.users);
  const user = users[req.user.id];
  if (!user) return res.status(404).json({ message: 'User not found' });
  const safe = { ...user }; delete safe.password;
  res.json(safe);
});

const server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${3000}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try with a different PORT environment variable.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
