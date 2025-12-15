const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.set('trust proxy', true);
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. Assign a unique ID to every user
    console.log(`User Connected: ${socket.id}`);

    // 2. Join a Specific Room (Code)
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        // Tell this user who else is already here
        const room = io.sockets.adapter.rooms.get(roomId);
        const others = room ? Array.from(room).filter(id => id !== socket.id) : [];
        
        socket.emit('room-joined', { roomId, peers: others });
        
        // Tell others a new user arrived
        socket.to(roomId).emit('user-connected', socket.id);
    });

    // 3. WebRTC Signaling (The Tunnel)
    socket.on('signal', (payload) => {
        io.to(payload.target).emit('signal', {
            sender: socket.id,
            signal: payload.signal
        });
    });

    // 4. Cleanup
    socket.on('disconnect', () => {
        io.emit('user-disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server Running on Port ${PORT}`));
