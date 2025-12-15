const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

app.set('trust proxy', true);
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. Generate unique 6-digit code for every user
    const myCode = Math.floor(100000 + Math.random() * 900000).toString();
    socket.join(myCode); // User sits in their own room waiting
    socket.emit('init-info', { code: myCode, id: socket.id });

    // 2. Handle Manual Join
    socket.on('join-manual', (targetCode) => {
        // Check if room exists
        const room = io.sockets.adapter.rooms.get(targetCode);
        
        if (!room || room.size === 0) {
            return socket.emit('error-msg', "Code not found or user offline.");
        }

        // Notify the HOST that someone is joining them
        // The HOST will be the "Initiator" of the P2P call to ensure stability
        socket.to(targetCode).emit('request-connection', { 
            requesterId: socket.id 
        });
    });

    // 3. WebRTC Signaling (The Tunnel)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    // 4. Cleanup
    socket.on('disconnect', () => {
        // In a real app, we might notify peers here
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Ready on port ${PORT}`));
