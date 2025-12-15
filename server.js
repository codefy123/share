const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static('public'));

// CRITICAL: Keep track of every user by their code
// Format: { "12345": "socket_id_here" }
const activeUsers = {};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // 1. ASSIGN A SIMPLE CODE
    const myCode = Math.floor(10000 + Math.random() * 90000).toString();
    activeUsers[myCode] = socket.id;
    
    // Send code to user
    socket.emit('init-info', { code: myCode });
    
    // 2. HANDLE MANUAL CONNECT
    socket.on('connect-to-peer', (targetCode) => {
        const targetSocketId = activeUsers[targetCode];

        if (targetSocketId) {
            console.log(`Bridge: ${socket.id} connects to ${targetSocketId}`);
            
            // Tell the Target (Host) to call the Connector (Joiner)
            io.to(targetSocketId).emit('peer-request', { 
                peerId: socket.id 
            });
            
        } else {
            socket.emit('error-toast', "User not found! Check the code.");
        }
    });

    // 3. WEBRTC SIGNALING
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    // 4. CLEANUP
    socket.on('disconnect', () => {
        delete activeUsers[myCode];
        // Notify any connected peers (optional enhancement)
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
