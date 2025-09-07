const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const server = http.createServer(app);

// Serve static files from public folder
app.use(express.static('public'));

// Simple matching system
let waitingUsers = [];
let activeRooms = new Map();

const wss = new WebSocket.Server({ 
    server,
    path: '/api/voice'
});

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            console.log('Received:', msg.type);
            
            if (msg.type === 'join') {
                handleJoin(ws, msg);
            } else if (msg.type === 'signal') {
                handleSignal(ws, msg);
            } else if (msg.type === 'end') {
                handleEnd(ws);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        handleDisconnect(ws);
    });
});

function handleJoin(ws, msg) {
    ws.role = msg.role;
    ws.language = msg.language;
    ws.id = generateId();
    
    // Try to match with waiting user
    const match = waitingUsers.find(user => 
        user.language === msg.language && user.role !== msg.role
    );
    
    if (match) {
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
        ws.send(JSON.stringify({
            type: 'matched',
            roomId: roomId,
            role: ws.role,
            peerId: match.id
        }));
        
        match.ws.send(JSON.stringify({
            type: 'matched',
            roomId: roomId,
            role: match.ws.role,
            peerId: ws.id
        }));
        
        console.log(`Matched users: ${ws.id} (${ws.role}) with ${match.id} (${match.ws.role})`);
        
    } else {
        // Add to waiting list
        waitingUsers.push({ ws, id: ws.id, role: msg.role, language: msg.language });
        ws.send(JSON.stringify({ type: 'waiting' }));
        console.log(`User ${ws.id} waiting as ${msg.role}`);
    }
}

function handleSignal(ws, msg) {
    if (ws.peerId) {
        // Find peer and forward signal
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

function handleEnd(ws) {
    handleDisconnect(ws);
}

function handleDisconnect(ws) {
    // Remove from waiting list
    waitingUsers = waitingUsers.filter(user => user.ws !== ws);
    
    // Handle active room disconnection
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

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Static files served from public folder`);
});
