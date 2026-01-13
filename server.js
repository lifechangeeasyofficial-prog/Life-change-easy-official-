const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/zip',
            'application/x-zip-compressed',
            'application/x-rar-compressed',
            'application/octet-stream',
            'image/jpeg',
            'image/png',
            'image/gif'
        ];
        
        if (allowedMimes.includes(file.mimetype) || 
            file.originalname.endsWith('.apk') ||
            file.originalname.endsWith('.zip') ||
            file.originalname.endsWith('.rar')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// In-memory database (in production, use a real database)
let apps = [];
let domainMappings = {}; // Store custom domain to app ID mappings
let stats = {
    totalDownloads: 0,
    totalUsers: 0
};

// Load apps from file on startup
const appsFile = path.join(__dirname, 'apps.json');
if (fs.existsSync(appsFile)) {
    try {
        apps = JSON.parse(fs.readFileSync(appsFile, 'utf8'));
    } catch (err) {
        console.error('Error loading apps:', err);
    }
}

// Load domain mappings from file on startup
const domainsFile = path.join(__dirname, 'domains.json');
if (fs.existsSync(domainsFile)) {
    try {
        domainMappings = JSON.parse(fs.readFileSync(domainsFile, 'utf8'));
    } catch (err) {
        console.error('Error loading domain mappings:', err);
    }
}

// Save apps to file
function saveApps() {
    try {
        fs.writeFileSync(appsFile, JSON.stringify(apps, null, 2));
    } catch (err) {
        console.error('Error saving apps:', err);
    }
}

// Save domain mappings to file
function saveDomainMappings() {
    try {
        fs.writeFileSync(domainsFile, JSON.stringify(domainMappings, null, 2));
    } catch (err) {
        console.error('Error saving domain mappings:', err);
    }
}

// Routes

// Get all apps
app.get('/api/apps', (req, res) => {
    res.json(apps);
});

// Get single app
app.get('/api/apps/:id', (req, res) => {
    const app = apps.find(a => a.id === req.params.id);
    if (app) {
        res.json(app);
    } else {
        res.status(404).json({ error: 'App not found' });
    }
});

// Create new app
app.post('/api/apps', upload.single('file'), (req, res) => {
    try {
        const newApp = {
            id: Date.now().toString(),
            name: req.body.name,
            description: req.body.description,
            size: req.body.size || 'Unknown',
            emoji: req.body.emoji || '📦',
            downloads: 0,
            users: 0,
            status: 'published',
            filePath: req.file ? `/uploads/${req.file.filename}` : null,
            createdAt: new Date().toISOString(),
            githubUrl: req.body.githubUrl || null,
            customLink: req.body.customLink || null, // Custom domain/link
            slug: req.body.slug || Date.now().toString() // URL-friendly slug
        };
        
        apps.push(newApp);
        
        // If custom link is provided, create mapping
        if (newApp.customLink) {
            domainMappings[newApp.customLink] = newApp.id;
            saveDomainMappings();
        }
        
        saveApps();
        
        res.status(201).json(newApp);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update app (including custom link)
app.put('/api/apps/:id', (req, res) => {
    const appIndex = apps.findIndex(a => a.id === req.params.id);
    
    if (appIndex === -1) {
        return res.status(404).json({ error: 'App not found' });
    }
    
    const oldApp = apps[appIndex];
    const oldLink = oldApp.customLink;
    
    // Update app
    apps[appIndex] = { ...apps[appIndex], ...req.body };
    
    // Handle domain mapping changes
    if (req.body.customLink && req.body.customLink !== oldLink) {
        // Remove old mapping if it exists
        if (oldLink && domainMappings[oldLink] === req.params.id) {
            delete domainMappings[oldLink];
        }
        
        // Add new mapping
        domainMappings[req.body.customLink] = req.params.id;
        saveDomainMappings();
    }
    
    saveApps();
    
    res.json(apps[appIndex]);
});

// Delete app
app.delete('/api/apps/:id', (req, res) => {
    const appIndex = apps.findIndex(a => a.id === req.params.id);
    
    if (appIndex === -1) {
        return res.status(404).json({ error: 'App not found' });
    }
    
    const app = apps[appIndex];
    
    // Delete associated file
    if (app.filePath) {
        const filePath = path.join(__dirname, app.filePath);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    
    // Remove domain mapping
    if (app.customLink && domainMappings[app.customLink] === req.params.id) {
        delete domainMappings[app.customLink];
        saveDomainMappings();
    }
    
    apps.splice(appIndex, 1);
    saveApps();
    
    res.json({ message: 'App deleted successfully' });
});

// Download app
app.get('/api/apps/:id/download', (req, res) => {
    const app = apps.find(a => a.id === req.params.id);
    
    if (!app || !app.filePath) {
        return res.status(404).json({ error: 'App not found' });
    }
    
    const filePath = path.join(__dirname, app.filePath);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    // Update download count
    app.downloads = (app.downloads || 0) + 1;
    saveApps();
    
    res.download(filePath, `${app.name}${path.extname(filePath)}`);
});

// Upload file
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    res.json({
        success: true,
        filename: req.file.filename,
        path: `/uploads/${req.file.filename}`,
        size: req.file.size
    });
});

// Get statistics
app.get('/api/stats', (req, res) => {
    const totalDownloads = apps.reduce((sum, app) => sum + (app.downloads || 0), 0);
    const totalUsers = apps.reduce((sum, app) => sum + (app.users || 0), 0);
    
    res.json({
        totalApps: apps.length,
        totalDownloads: totalDownloads,
        totalUsers: totalUsers,
        stats: stats
    });
});

// Search apps
app.get('/api/search', (req, res) => {
    const query = req.query.q?.toLowerCase() || '';
    
    if (!query) {
        return res.json(apps);
    }
    
    const results = apps.filter(app =>
        app.name.toLowerCase().includes(query) ||
        app.description.toLowerCase().includes(query)
    );
    
    res.json(results);
});

// Get all domain mappings
app.get('/api/domains', (req, res) => {
    res.json(domainMappings);
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// ============================================
// CUSTOM DOMAIN/LINK ROUTING (Yeh sabse zaroori hai!)
// ============================================

// Dynamic routing for custom links
app.get('/:customLink', (req, res) => {
    const customLink = req.params.customLink;
    
    // Skip if it's a known route
    if (['api', 'dashboard', 'uploads'].includes(customLink)) {
        return res.status(404).json({ error: 'Not found' });
    }
    
    // Check if this custom link maps to an app
    const appId = domainMappings[customLink];
    
    if (!appId) {
        return res.status(404).json({ error: 'Project not found' });
    }
    
    const app = apps.find(a => a.id === appId);
    
    if (!app) {
        return res.status(404).json({ error: 'App not found' });
    }
    
    // If app has a file path (hosted HTML/project), serve it
    if (app.filePath) {
        const filePath = path.join(__dirname, app.filePath);
        
        // If it's a ZIP file, extract and serve index.html
        if (app.filePath.endsWith('.zip')) {
            // For now, return app info
            return res.json({
                message: 'Project found',
                app: app,
                downloadLink: `/api/apps/${app.id}/download`
            });
        }
        
        // If file exists, serve it
        if (fs.existsSync(filePath)) {
            return res.download(filePath);
        }
    }
    
    // Return app info as JSON
    res.json(app);
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve dashboard.html
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'FILE_TOO_LARGE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 500MB' });
        }
    }
    
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🚀 Hosting Server Started!           ║
╠════════════════════════════════════════╣
║   Server: http://localhost:${PORT}              ║
║   Public: http://localhost:${PORT}              ║
║   Dashboard: http://localhost:${PORT}/dashboard ║
║                                        ║
║   Custom Links Enabled! ✅             ║
║   Upload projects aur apni marzi       ║
║   ki link set karein!                  ║
╚════════════════════════════════════════╝
    `);
    console.log('Press Ctrl+C to stop the server');
});

module.exports = app;
