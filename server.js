const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Group users by their Public IP Address
const usersByIp = {};

io.on('connection', (socket) => {
    // 1. Detect the user's Public IP
    // (This works even on cloud hosting like Render/Heroku)
    let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    // Normalize IP (handle multiple IPs in header)
    if (clientIp.indexOf(',') > -1) {
        clientIp = clientIp.split(',')[0];
    }

    console.log(`User ${socket.id} connected from IP: ${clientIp}`);

    // 2. Join a "Room" based on IP
    socket.join(clientIp);

    // 3. Notify others in this IP-Room that a new peer joined
    socket.to(clientIp).emit('peer-joined', {
        id: socket.id
    });

    // 4. Send list of existing peers to the new user
    const room = io.sockets.adapter.rooms.get(clientIp);
    if (room) {
        const otherUsers = Array.from(room).filter(id => id !== socket.id);
        socket.emit('peers-existing', otherUsers);
    }

    // 5. Handle WebRTC Signals (Offer/Answer/ICE)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    // 6. Cleanup
    socket.on('disconnect', () => {
        socket.to(clientIp).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Production Server running on port ${PORT}`);
});