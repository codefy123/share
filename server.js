const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } // Allow all connections to fix potential blocks
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Helper: Get a clean IP address
function getClientIp(socket) {
    const header = socket.handshake.headers['x-forwarded-for'];
    let ip = header ? header.split(',')[0] : socket.handshake.address;
    
    // Clean up IPv6 prefixes (::ffff:) so 127.0.0.1 matches localhost
    if (ip.includes('::ffff:')) {
        ip = ip.replace('::ffff:', '');
    }
    return ip;
}

io.on('connection', (socket) => {
    const ip = getClientIp(socket);
    console.log(`User connected: ${socket.id} | IP: ${ip}`);

    // Join a room based on IP
    socket.join(ip);

    // Notify others on THIS IP that someone new is here
    socket.to(ip).emit('peer-joined', { id: socket.id });

    // Send the user the list of people ALREADY in the room
    const room = io.sockets.adapter.rooms.get(ip);
    if (room) {
        const others = Array.from(room).filter(id => id !== socket.id);
        if (others.length > 0) {
            console.log(`Found ${others.length} existing peers for ${socket.id}`);
            socket.emit('peers-existing', others);
        }
    }

    // Handle Signals (Handshake)
    socket.on('signal', (data) => {
        console.log(`Signal from ${socket.id} to ${data.target}`);
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        socket.to(ip).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`\n--- SERVER RUNNING ON PORT ${PORT} ---`);
    console.log(`1. If testing locally, ensure both devices use the LAN IP (e.g. 192.168.1.5:3000)`);
    console.log(`2. Do NOT mix 'localhost' and '192.168.x.x'`);
});
