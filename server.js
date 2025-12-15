const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    pingTimeout: 60000,
});

// 1. TRUST PROXY: Essential for Render/Heroku to see real IPs
app.set('trust proxy', 1); 

app.use(express.static('public'));

io.on('connection', (socket) => {
    // 2. GET REAL IP ADDRESS (Fix for Cloud Hosting)
    // Render sends the real IP in the 'x-forwarded-for' header.
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    // If multiple IPs (proxy chain), take the first one
    if (typeof ip === 'string' && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0].trim();
    }
    
    // Clean up IPv6 prefix if present
    if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');

    console.log(`User connected: ${socket.id} | Real IP: ${ip}`);

    // 3. AUTO-JOIN ROOM (Snapdrop Style)
    // Users on the same Wi-Fi will have the same Public IP, so they join the same room.
    const roomName = `room-${ip}`;
    socket.join(roomName);

    // Generate a 4-digit manual code (Fallback)
    const myCode = Math.floor(1000 + Math.random() * 9000).toString();
    socket.emit('my-code', myCode);
    socket.join(`manual-${myCode}`); // Join a private room for manual code

    // 4. CHECK FOR PEERS
    const room = io.sockets.adapter.rooms.get(roomName);
    const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];

    if (peers.length > 0) {
        console.log(`Found ${peers.length} peers for ${socket.id}`);
        // Tell the NEW user to call the EXISTING users
        socket.emit('peers-existing', peers);
    }

    // 5. MANUAL CONNECT HANDLER
    socket.on('join-manual', (targetCode) => {
        const targetRoom = io.sockets.adapter.rooms.get(`manual-${targetCode}`);
        if (targetRoom && targetRoom.size > 0) {
            const targetId = Array.from(targetRoom)[0];
            console.log(`Manual connection: ${socket.id} -> ${targetId}`);
            // Tell Me (Joiner) to call Him (Host)
            socket.emit('peers-existing', [targetId]);
        } else {
            socket.emit('error-toast', "Device not found. Check the code.");
        }
    });

    // 6. SIGNALING (The Handshake)
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
http.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));
