const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Setup multer for file uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// 1. Connect to MongoDB Compass (Local)
mongoose.connect('mongodb://localhost:27017/studentDB');

// 2. Define the User Schema
const userSchema = new mongoose.Schema({
    role: String,
    name: String,
    email: String,
    username: String,
    password: String,
    collegeName: String,
    department: String,
    registerNumber: String,
    year: String,
    section: String,
    facultyId: String,
    profilePhotoPath: String
});
const User = mongoose.model('User', userSchema);

// 2b. Define the Activity Schema
const activitySchema = new mongoose.Schema({
    studentUsername: String,
    studentName: String,
    studentRegNo: String,
    category: String,
    name: String,
    date: String,
    department: String,
    institute: String,
    docPath: String,
    status: { type: String, default: 'pending' }, // pending, approved, rejected
    submittedAt: { type: Date, default: Date.now },
    approvedAt: Date,
    approvedBy: String
});
const Activity = mongoose.model('Activity', activitySchema);

// 3. POST Route: Save data from Register Page
app.post('/api/register', upload.single('profilePhoto'), async (req, res) => {
    try {
        console.log('Registration attempt:', {
            username: req.body.username,
            file: req.file ? { fieldname: req.file.fieldname, filename: req.file.filename, size: req.file.size } : 'No file'
        });
        
        const newUser = new User({
            role: req.body.role,
            name: req.body.name,
            email: req.body.email,
            username: req.body.username,
            password: req.body.password,
            collegeName: req.body.collegeName,
            department: req.body.department,
            registerNumber: req.body.registerNumber,
            year: req.body.year,
            section: req.body.section,
            facultyId: req.body.facultyId,
            profilePhotoPath: req.file ? req.file.filename : null
        });
        
        await newUser.save();
        console.log('User registered successfully:', newUser.username);
        res.json({ message: "Registration successful!" });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ message: "Registration failed: " + error.message });
    }
});

// 4. GET Route: Fetch data by username
app.get('/api/user/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch (error) {
        res.status(400).json({ message: "Error fetching user: " + error.message });
    }
});

// 5. POST Route: Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        
        if (user) {
            res.json({ 
                message: "Login successful!",
                user: user,
                token: "dummy-token-" + user._id
            });
        } else {
            res.status(401).json({ message: "Invalid username or password" });
        }
    } catch (error) {
        res.status(400).json({ message: "Login failed: " + error.message });
    }
});

// 6. Serve static files from uploads folder
app.use('/uploads', express.static(uploadsDir));

// 7. GET Route: Fetch profile photo by token
app.get('/api/user/profile-photo', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '').trim();
        
        if (!token) {
            console.log('No token provided');
            return res.status(401).json({ message: "No token provided" });
        }
        
        // Extract user ID from token (format: "dummy-token-<userId>")
        const userId = token.replace('dummy-token-', '').trim();
        
        if (!userId) {
            console.log('Invalid token format:', token);
            return res.status(401).json({ message: "Invalid token format" });
        }
        
        const user = await User.findById(userId);
        
        if (!user) {
            console.log('User not found for ID:', userId);
            return res.status(404).json({ message: "User not found" });
        }
        
        if (!user.profilePhotoPath) {
            console.log('No profile photo path for user:', userId);
            return res.status(404).json({ message: "No profile photo found" });
        }
        
        const photoPath = path.join(uploadsDir, user.profilePhotoPath);
        console.log('Serving photo from:', photoPath);
        
        if (!fs.existsSync(photoPath)) {
            console.log('Photo file does not exist:', photoPath);
            return res.status(404).json({ message: "Photo file not found on disk" });
        }
        
        res.sendFile(photoPath);
    } catch (error) {
        console.error('Error fetching photo:', error);
        res.status(400).json({ message: "Error fetching photo: " + error.message });
    }
});

// 8. GET Route: Fetch pending activities for admin
app.get('/api/admin/activities/pending', async (req, res) => {
    try {
        console.log('🔍 Fetching pending activities...');
        const activities = await Activity.find({ status: 'pending' });
        console.log('✅ Found pending activities:', activities.length);
        activities.forEach((act, idx) => {
            console.log(`  Activity ${idx + 1}:`, {
                id: act._id,
                name: act.name,
                studentName: act.studentName,
                studentRegNo: act.studentRegNo,
                studentUsername: act.studentUsername,
                status: act.status
            });
        });
        res.json(activities);
    } catch (error) {
        console.error('❌ Error fetching pending activities:', error.message);
        res.status(400).json({ message: "Error fetching pending activities: " + error.message });
    }
});
// DEBUG: GET all activities
app.get('/api/debug/all-activities', async (req, res) => {
    try {
        const activities = await Activity.find({});
        console.log('All activities in database:', activities.length);
        activities.forEach((act, idx) => {
            console.log(`Activity ${idx + 1}:`, {
                name: act.name,
                studentUsername: act.studentUsername,
                status: act.status
            });
        });
        res.json({ 
            totalCount: activities.length, 
            activities: activities.map(a => ({
                id: a._id,
                name: a.name,
                studentUsername: a.studentUsername,
                studentName: a.studentName,
                studentRegNo: a.studentRegNo,
                category: a.category,
                status: a.status,
                date: a.date
            }))
        });
    } catch (error) {
        console.error('Error fetching activities:', error);
        res.status(400).json({ message: "Error fetching activities: " + error.message });
    }
});

// DEBUG: Get activities for specific student
app.get('/api/debug/student/:username', async (req, res) => {
    try {
        const username = req.params.username;
        console.log('Searching for activities with username:', username);
        
        const activities = await Activity.find({ studentUsername: username });
        console.log('Found activities:', activities.length);
        
        res.json({ 
            username: username,
            count: activities.length,
            activities: activities
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(400).json({ message: error.message });
    }
});

// DEBUG: Get all users (for troubleshooting)
app.get('/api/debug/all-users', async (req, res) => {
    try {
        const users = await User.find({}, { username: 1, role: 1, department: 1, collegeName: 1, name: 1 });
        console.log('All users in database:');
        users.forEach((user, idx) => {
            console.log(`  User ${idx + 1}:`, {
                username: user.username,
                role: user.role,
                name: user.name,
                department: user.department,
                college: user.collegeName
            });
        });
        res.json(users);
    } catch (error) {
        console.error('Error:', error);
        res.status(400).json({ message: error.message });
    }
});
// 9. GET Route: Fetch department activities for admin
app.get('/api/admin/activities/department', async (req, res) => {
    try {
        const activities = await Activity.find({});
        res.json(activities);
    } catch (error) {
        res.status(400).json({ message: "Error fetching department activities: " + error.message });
    }
});

// 10. POST Route: Update activity status
app.post('/api/admin/activities/:studentUsername/:activityId/status', async (req, res) => {
    try {
        const { activityId } = req.params;
        const { status } = req.body;
        
        const updatedActivity = await Activity.findByIdAndUpdate(
            activityId,
            { status: status, approvedAt: new Date() },
            { new: true }
        );
        
        res.json({ message: `Activity ${status}!`, activity: updatedActivity });
    } catch (error) {
        res.status(400).json({ message: "Error updating activity status: " + error.message });
    }
});

// 11. POST Route: Upload Activity
app.post('/api/activities/upload', upload.single('doc'), async (req, res) => {
    try {
        console.log('=== Activity Upload Request ===');
        console.log('Headers:', req.headers);
        console.log('Body:', req.body);
        console.log('File:', req.file);
        
        const token = req.headers.authorization?.replace('Bearer ', '').trim();
        if (!token) {
            console.log('No token provided');
            return res.status(401).json({ message: "No token provided" });
        }

        // Validate required fields
        const { studentUsername, studentName, studentRegNo, category, name, date, activityDepartment, activityInstitute } = req.body;
        
        if (!studentUsername || !studentName || !studentRegNo || !category || !name || !date || !activityDepartment || !activityInstitute) {
            console.log('Missing required fields:', { studentUsername, studentName, studentRegNo, category, name, date, activityDepartment, activityInstitute });
            return res.status(400).json({ message: "Missing required fields" });
        }

        const newActivity = new Activity({
            studentUsername: studentUsername,
            studentName: studentName,
            studentRegNo: studentRegNo,
            category: category,
            name: name,
            date: date,
            department: activityDepartment,
            institute: activityInstitute,
            docPath: req.file ? req.file.filename : null,
            status: 'pending'
        });

        await newActivity.save();
        console.log('Activity saved successfully:', newActivity._id);
        res.json({ message: "Activity submitted successfully!", activityId: newActivity._id });
    } catch (error) {
        console.error('=== Error uploading activity ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        res.status(400).json({ message: "Activity upload failed: " + error.message });
    }
});

// 12. GET Route: Get activities by student register number
app.get('/api/activities/student/:studentRegNo', async (req, res) => {
    try {
        const activities = await Activity.find({ studentRegNo: req.params.studentRegNo });
        res.json(activities);
    } catch (error) {
        res.status(400).json({ message: "Error fetching activities: " + error.message });
    }
});

// 13. GET Route: Get activity counts for student dashboard
app.get('/api/activities/counts/:studentUsername', async (req, res) => {
    try {
        const studentUsername = req.params.studentUsername;
        console.log('=== Fetching activity counts ===');
        console.log('Student username:', studentUsername);
        
        const approved = await Activity.countDocuments({ studentUsername: studentUsername, status: 'approved' });
        const pending = await Activity.countDocuments({ studentUsername: studentUsername, status: 'pending' });
        const rejected = await Activity.countDocuments({ studentUsername: studentUsername, status: 'rejected' });
        
        console.log('Counts:', { approved, pending, rejected });
        res.json({ approved, pending, rejected });
    } catch (error) {
        console.error('Error in counts endpoint:', error);
        res.status(400).json({ message: "Error fetching counts: " + error.message });
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));