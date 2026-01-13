const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Directories setup
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);
if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, JSON.stringify({}));

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const projectId = req.params.projectId;
        const projectDir = path.join(UPLOADS_DIR, projectId);
        if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
        cb(null, projectDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for videos
});

// Serve static files (Uploaded images/videos)
app.use('/uploads', express.static(UPLOADS_DIR));

// --- API Endpoints ---

// 1. Create Project
app.post('/api/projects', (req, res) => {
    const { name, format } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name is required' });

    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    const projectId = uuidv4();
    const apiKey = 'sk_' + Math.random().toString(36).substr(2, 16);

    projects[projectId] = {
        id: projectId,
        name: name,
        apiKey: apiKey,
        format: format || '{}',
        createdAt: new Date().toISOString(),
        stats: { uploads: 0, errors: 0 }
    };

    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
    res.json(projects[projectId]);
});

// 2. Get All Projects
app.get('/api/projects', (req, res) => {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    res.json(Object.values(projects));
});

// 3. Update Project Format (Tab Editor)
app.put('/api/projects/:id', (req, res) => {
    const { format } = req.body;
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    if (!projects[req.params.id]) return res.status(404).json({ error: 'Project not found' });

    projects[req.params.id].format = format;
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
    res.json({ success: true });
});

// 4. Delete Project
app.delete('/api/projects/:id', (req, res) => {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    if (projects[req.params.id]) {
        delete projects[req.params.id];
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        // Note: We don't delete physical files for safety, but could be added
    }
    res.json({ success: true });
});

// 5. Upload File (DP, Video, Post)
app.post('/api/upload/:projectId', upload.single('file'), (req, res) => {
    const { projectId } = req.params;
    const apiKey = req.headers['x-api-key'];

    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    const project = projects[projectId];

    if (!project || project.apiKey !== apiKey) {
        return res.status(401).json({ error: 'Invalid Project ID or API Key' });
    }

    if (!req.file) {
        project.stats.errors++;
        fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${projectId}/${req.file.filename}`;
    
    project.stats.uploads++;
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));

    res.json({
        success: true,
        url: fileUrl,
        filename: req.file.filename,
        mimetype: req.file.mimetype
    });
});

// 6. Store Metadata (Likes, Comments, Names)
app.post('/api/data/:projectId', (req, res) => {
    const { projectId } = req.params;
    const { type, data } = req.body; // type: 'profile', 'comment', 'like'
    const apiKey = req.headers['x-api-key'];

    const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE));
    if (!projects[projectId] || projects[projectId].apiKey !== apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const projectDataFile = path.join(DATA_DIR, `${projectId}_data.json`);
    let store = [];
    if (fs.existsSync(projectDataFile)) {
        store = JSON.parse(fs.readFileSync(projectDataFile));
    }

    const entry = {
        id: uuidv4(),
        type,
        data,
        timestamp: new Date().toISOString()
    };

    store.push(entry);
    fs.writeFileSync(projectDataFile, JSON.stringify(store, null, 2));

    res.json({ success: true, id: entry.id });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});