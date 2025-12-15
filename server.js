const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    pingTimeout: 60000, // Keep connection alive longer
});

// 1. TRUST PROXY - CRITICAL FOR RENDER/CLOUD
app.set('trust proxy', 1); 

app.use(express.static('public'));

io.on('connection', (socket) => {
    // 2. ROBUST IP DETECTION (The Snapdrop Logic)
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    // If multiple IPs (proxy chain), take the first one (the real client)
    if (typeof ip === 'string' && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0].trim();
    }
    
    // Clean IPv6
    if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');

    // console.log(`New User: ${socket.id} | IP: ${ip}`);

    // 3. AUTO-JOIN "IP ROOM"
    const roomName = `room-${ip}`;
    socket.join(roomName);

    // Generate a fallback manual code
    const manualCode = Math.floor(100000 + Math.random() * 900000).toString();
    socket.join(manualCode); // Also join a room for the code
    socket.emit('my-code', manualCode);

    // 4. INSTANT DISCOVERY LOGIC
    const room = io.sockets.adapter.rooms.get(roomName);
    const peersInRoom = room ? Array.from(room).filter(id => id !== socket.id) : [];

    if (peersInRoom.length > 0) {
        // Step A: Tell the NEW user to initiate connections to existing peers
        socket.emit('peers-existing', peersInRoom);
        
        // Step B: Tell existing peers that a new user joined (Prepare to receive)
        socket.to(roomName).emit('peer-joined', socket.id);
    }

    // 5. MANUAL CONNECTION LOGIC
    socket.on('join-manual', (targetCode) => {
        const targetRoom = io.sockets.adapter.rooms.get(targetCode);
        
        if (targetRoom && targetRoom.size > 0) {
            // Get the socket ID of the host (owner of the code)
            const hostId = Array.from(targetRoom)[0]; // Simplified for 1-to-1
            
            // Tell the Joiner (me) to call the Host
            socket.emit('peers-existing', [hostId]);
            
            // Tell the Host someone is joining
            io.to(hostId).emit('peer-joined', socket.id);
        } else {
            socket.emit('error-toast', 'ID not found or user offline');
        }
    });

    // 6. SIGNALING RELAY
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        socket.to(roomName).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
