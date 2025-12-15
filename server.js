const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    // FORCE WEBSOCKET: Fixes the 'polling' and network errors in your logs
    transports: ['websocket', 'polling'] 
});

app.set('trust proxy', 1);
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // 1. AUTO-DISCOVERY (IP Based)
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (typeof ip === 'string' && ip.indexOf(',') > -1) ip = ip.split(',')[0].trim();
    
    // Join a room based on Public IP (for auto-scan)
    const ipRoom = `room-${ip}`;
    socket.join(ipRoom);

    // 2. MANUAL CODE SYSTEM (The Fallback)
    // Generate a simple 6-digit code
    const myCode = Math.floor(100000 + Math.random() * 900000).toString();
    socket.emit('my-code', myCode);
    
    // Join a private room specifically for this code
    socket.join(myCode);

    // 3. CHECK FOR EXISTING PEERS (Auto-Scan)
    const room = io.sockets.adapter.rooms.get(ipRoom);
    const others = room ? Array.from(room).filter(id => id !== socket.id) : [];
    
    if(others.length > 0) {
        socket.emit('peers-existing', others); // Tell me to call them
        socket.to(ipRoom).emit('peer-joined', socket.id); // Tell them I arrived
    }

    // 4. MANUAL JOIN HANDLER (Simplified)
    socket.on('join-manual', (targetCode) => {
        // Check if the room exists
        const targetRoom = io.sockets.adapter.rooms.get(targetCode);
        
        if (targetRoom && targetRoom.size > 0) {
            // Get the socket ID of the person who owns this code
            const hostId = Array.from(targetRoom)[0];
            
            console.log(`Manual Bridge: ${socket.id} -> ${hostId}`);
            
            // Force them to connect
            socket.emit('peers-existing', [hostId]); // I call Host
            io.to(hostId).emit('peer-joined', socket.id); // Host receives me
        } else {
            socket.emit('error-toast', "Code not found. Is the other device online?");
        }
    });

    // 5. SIGNALING RELAY (The Tunnel)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        socket.to(ipRoom).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server Running on ${PORT}`));
