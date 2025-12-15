const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 1e8, // Allow large packets just in case
    pingTimeout: 60000 
});

app.set('trust proxy', 1);
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. SMART IP DETECTION
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (typeof ip === 'string' && ip.indexOf(',') > -1) ip = ip.split(',')[0].trim();
    
    // Create a simple "Network Room" name
    const roomName = `network-${ip}`;
    socket.join(roomName);

    // 2. GENERATE SIMPLE CODE (Fallback)
    const myCode = Math.floor(10000 + Math.random() * 90000).toString(); // 5 digits
    socket.emit('init-info', { code: myCode, ip: ip });
    socket.join(`manual-${myCode}`);

    // 3. AUTO-DISCOVERY
    const room = io.sockets.adapter.rooms.get(roomName);
    const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];

    if (peers.length > 0) {
        // Tell this user to call the existing users
        socket.emit('peers-found', peers);
    }

    // 4. MANUAL CONNECT
    socket.on('join-manual', (targetCode) => {
        const targetRoom = io.sockets.adapter.rooms.get(`manual-${targetCode}`);
        if (targetRoom && targetRoom.size > 0) {
            const hostId = Array.from(targetRoom)[0];
            socket.emit('peers-found', [hostId]); // Initiate call
        } else {
            socket.emit('error-toast', "Device not found. Check code.");
        }
    });

    // 5. SIGNALING
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
