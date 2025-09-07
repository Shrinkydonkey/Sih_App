const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Import your auth routes
const authRoutes = require('./routes/auth');

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'https://localhost:3000'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit image serving
app.use('/img', express.static(path.join(__dirname, 'public/img')));

// Debug middleware for images
app.use((req, res, next) => {
    if (req.url.includes('.png') || req.url.includes('.jpg') || req.url.includes('.jpeg')) {
        console.log('Image request:', req.url);
        console.log('File path:', path.join(__dirname, 'public', req.url));
    }
    next();
});

// Routes
app.use('/api/auth', authRoutes);

// Helper verification endpoint for WebSocket server
app.post('/api/verify-helper', authenticateToken, (req, res) => {
    try {
        const helperData = {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
            role: 'helper'
        };
        res.json(helperData);
    } catch (error) {
        res.status(401).json({error: 'Invalid token'});
    }
});

// JWT Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        services: {
            database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            websocket: 'running'
        }
    });
});

// Status monitoring endpoint - UPDATED WITH MORE INFO
app.get('/voice-status', (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        voice: {
            waitingUsers: waitingUsers.length,
            activeRooms: activeRooms.size,
            waitingDetails: waitingUsers.map(u => ({
                id: u.id,
                role: u.role,
                language: u.language
            }))
        },
        chat: {
            waitingUsers: chatWaitingUsers.length,
            activeRooms: chatActiveRooms.size,
            waitingDetails: chatWaitingUsers.map(u => ({
                id: u.id,
                role: u.role,
                language: u.language
            }))
        }
    });
});

// =============================================================================
// WEBSOCKET SERVERS - UNIFIED APPROACH
// =============================================================================

// Voice chat variables
let waitingUsers = [];
let activeRooms = new Map();

// Text chat variables
let chatWaitingUsers = [];
let chatActiveRooms = new Map();

// Unified WebSocket Server
const wsServer = new WebSocket.Server({
    server,
    verifyClient: (info) => {
        return true; // Accept all connections
    }
});

wsServer.on('connection', (ws, request) => {
    const url = request.url;
    console.log('WebSocket connection to:', url);
    
    if (url === '/api/voice') {
        handleVoiceConnection(ws, request);
    } else if (url === '/api/chat') {
        handleChatConnection(ws, request);
    } else {
        console.log('Unknown WebSocket path:', url);
        ws.close();
    }
});

// =============================================================================
// VOICE CHAT WEBSOCKET HANDLERS
// =============================================================================

function handleVoiceConnection(ws, request) {
    console.log('New Voice WebSocket connection');
    
    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);
            console.log('Voice received:', msg.type);
            
            if (msg.type === 'join') {
                await handleVoiceJoin(ws, msg);
            } else if (msg.type === 'signal') {
                handleVoiceSignal(ws, msg);
            } else if (msg.type === 'end') {
                handleVoiceEnd(ws);
            }
        } catch (error) {
            console.error('Error parsing voice message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Voice WebSocket connection closed');
        handleVoiceDisconnect(ws);
    });
}

// Helper authentication for WebSocket
async function verifyHelperToken(token) {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        return decoded;
    } catch (error) {
        console.error('Helper token verification failed:', error);
        return null;
    }
}

async function handleVoiceJoin(ws, msg) {
    ws.role = msg.role;
    ws.language = msg.language;
    ws.id = generateId();
    
    console.log(`=== DEBUG: Voice User Joining ===`);
    console.log(`ID: ${ws.id}, Role: ${ws.role}, Language: ${ws.language}`);
    console.log(`Current waiting users:`, waitingUsers.length);
    console.log(`Waiting users:`, waitingUsers.map(u => `${u.id}(${u.role})`));
    
    // If helper role, verify authentication
    if (msg.role === 'helper') {
        console.log('🔍 Verifying helper token...');
        if (!msg.token) {
            console.log('❌ No token provided');
            ws.send(JSON.stringify({type: 'error', message: 'Helper authentication required'}));
            ws.close();
            return;
        }
        
        const helperData = await verifyHelperToken(msg.token);
        if (!helperData) {
            console.log('❌ Token verification failed');
            ws.send(JSON.stringify({type: 'error', message: 'Invalid helper credentials'}));
            ws.close();
            return;
        }
        
        ws.helperData = helperData;
        console.log(`✅ Helper authenticated: ${helperData.name || helperData.id}`);
    }
    
    // Try to match with waiting user
    console.log('🔍 Looking for match...');
    const match = waitingUsers.find(user => 
        user.language === msg.language && user.role !== msg.role
    );
    
    if (match) {
        console.log(`🎉 MATCH FOUND: ${ws.id}(${ws.role}) ↔ ${match.id}(${match.ws.role})`);
        
        // Create room
        const roomId = generateId();
        waitingUsers = waitingUsers.filter(user => user !== match);
        
        // Set up room
        ws.peerId = match.id;
        match.ws.peerId = ws.id;
        ws.roomId = roomId;
        match.ws.roomId = roomId;
        
        activeRooms.set(roomId, [ws, match.ws]);
        
        // Notify both users
        const matchMessage1 = {
            type: 'matched',
            roomId: roomId,
            role: ws.role,
            peerId: match.id
        };
        const matchMessage2 = {
            type: 'matched',
            roomId: roomId,
            role: match.ws.role,
            peerId: ws.id
        };
        
        console.log(`📤 Sending to ${ws.id}:`, matchMessage1);
        console.log(`📤 Sending to ${match.id}:`, matchMessage2);
        
        ws.send(JSON.stringify(matchMessage1));
        match.ws.send(JSON.stringify(matchMessage2));
        
        console.log(`✅ Voice matched: ${ws.id} (${ws.role}) with ${match.id} (${match.ws.role})`);
        
    } else {
        console.log(`⏳ No match found. Adding ${ws.id}(${ws.role}) to waiting list`);
        // Add to waiting list
        waitingUsers.push({ ws, id: ws.id, role: msg.role, language: msg.language });
        ws.send(JSON.stringify({ type: 'waiting' }));
        console.log(`Voice user ${ws.id} waiting as ${msg.role}`);
        console.log(`Total waiting users now:`, waitingUsers.length);
    }
}

function handleVoiceSignal(ws, msg) {
    if (ws.peerId) {
        for (const [roomId, users] of activeRooms.entries()) {
            const peer = users.find(user => user.id === ws.peerId);
            if (peer) {
                peer.send(JSON.stringify({
                    type: 'signal',
                    from: ws.id,
                    data: msg.data
                }));
                break;
            }
        }
    }
}

function handleVoiceEnd(ws) {
    handleVoiceDisconnect(ws);
}

function handleVoiceDisconnect(ws) {
    waitingUsers = waitingUsers.filter(user => user.ws !== ws);
    
    if (ws.roomId) {
        const room = activeRooms.get(ws.roomId);
        if (room) {
            const peer = room.find(user => user !== ws);
            if (peer) {
                peer.send(JSON.stringify({ type: 'peer_disconnected' }));
            }
            activeRooms.delete(ws.roomId);
        }
    }
}

// =============================================================================
// TEXT CHAT WEBSOCKET HANDLERS
// =============================================================================

function handleChatConnection(ws, request) {
    console.log('New Chat WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            console.log('Chat received:', msg.type);
            
            if (msg.type === 'join') {
                handleChatJoin(ws, msg);
            } else if (msg.type === 'message') {
                handleChatMessage(ws, msg);
            } else if (msg.type === 'end') {
                handleChatEnd(ws);
            }
        } catch (error) {
            console.error('Error parsing chat message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Chat WebSocket connection closed');
        handleChatDisconnect(ws);
    });
}

function handleChatJoin(ws, msg) {
    ws.role = msg.role;
    ws.language = msg.language;
    ws.reason = msg.reason;
    ws.id = generateId();
    
    console.log(`=== DEBUG: Chat User Joining ===`);
    console.log(`ID: ${ws.id}, Role: ${ws.role}, Language: ${ws.language}`);
    
    // Try to match with waiting user - ALLOW ANY ROLE FOR TEXT CHAT
    const match = chatWaitingUsers.find(user => 
        user.language === msg.language
    );
    
    if (match) {
        console.log(`🎉 CHAT MATCH: ${ws.id}(${ws.role}) ↔ ${match.id}(${match.ws.role})`);
        
        // Create room
        const roomId = generateId();
        chatWaitingUsers = chatWaitingUsers.filter(user => user !== match);
        
        // Set up room
        ws.peerId = match.id;
        match.ws.peerId = ws.id;
        ws.roomId = roomId;
        match.ws.roomId = roomId;
        
        chatActiveRooms.set(roomId, [ws, match.ws]);
        
        // Notify both users
        ws.send(JSON.stringify({
            type: 'matched',
            roomId: roomId,
            peerId: match.id
        }));
        
        match.ws.send(JSON.stringify({
            type: 'matched',
            roomId: roomId,
            peerId: ws.id
        }));
        
        console.log(`✅ Chat matched: ${ws.id} with ${match.id}`);
        
    } else {
        console.log(`⏳ No chat match. Adding ${ws.id}(${ws.role}) to waiting`);
        // Add to waiting list
        chatWaitingUsers.push({ 
            ws, 
            id: ws.id, 
            role: msg.role, 
            language: msg.language,
            reason: msg.reason 
        });
        ws.send(JSON.stringify({ type: 'waiting' }));
        console.log(`Chat user ${ws.id} waiting`);
    }
}

function handleChatMessage(ws, msg) {
    if (ws.peerId && msg.to === ws.peerId) {
        // Find peer and forward message
        for (const [roomId, users] of chatActiveRooms.entries()) {
            const peer = users.find(user => user.id === ws.peerId);
            if (peer) {
                peer.send(JSON.stringify({
                    type: 'message',
                    from: ws.id,
                    content: msg.content
                }));
                break;
            }
        }
    }
}

function handleChatEnd(ws) {
    handleChatDisconnect(ws);
}

function handleChatDisconnect(ws) {
    // Remove from waiting list
    chatWaitingUsers = chatWaitingUsers.filter(user => user.ws !== ws);
    
    // Handle active room disconnection
    if (ws.roomId) {
        const room = chatActiveRooms.get(ws.roomId);
        if (room) {
            const peer = room.find(user => user !== ws);
            if (peer) {
                peer.send(JSON.stringify({ type: 'peer_disconnected' }));
            }
            chatActiveRooms.delete(ws.roomId);
        }
    }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// =============================================================================
// DATABASE CONNECTION & SERVER STARTUP
// =============================================================================

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/userauth', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.log('❌ MongoDB connection error:', err));

// Start the unified server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('🚀 MindCare Gateway Server Started!');
    console.log(`📱 Web Server: http://localhost:${PORT}`);
    console.log(`🎤 WebSocket Voice Chat: ws://localhost:${PORT}/api/voice`);
    console.log(`💬 WebSocket Text Chat: ws://localhost:${PORT}/api/chat`);
    console.log(`📊 Status Monitor: http://localhost:${PORT}/voice-status`);
    console.log(`💾 Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting...'}`);
    console.log(`📋 Static files served from: ${path.join(__dirname, 'public')}`);
    console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    server.close(() => {
        mongoose.connection.close();
        process.exit(0);
    });
});
