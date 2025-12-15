const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

// TRUST PROXY: Required for Render/Heroku/Vercel to get real IPs
app.set('trust proxy', true);

app.use(express.static(path.join(__dirname, 'public')));

// Helper to get the clean Public IP
function getPublicIp(socket) {
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    // If multiple IPs (e.g. "client, proxy1, proxy2"), take the first one
    if (ip && ip.indexOf(',') > -1) {
        ip = ip.split(',')[0].trim();
    }
    
    // Clean IPv6 prefix if present
    if (ip.includes('::ffff:')) {
        ip = ip.replace('::ffff:', '');
    }
    
    return ip;
}

io.on('connection', (socket) => {
    const userIp = getPublicIp(socket);
    
    console.log(`User: ${socket.id} | Detected IP: ${userIp}`);

    // Join a room specifically for this Public IP
    socket.join(userIp);
    
    // Send the detected IP back to the user (For Debugging UI)
    socket.emit('your-ip', userIp);

    // Notify others in this room (Same Wi-Fi/Hotspot)
    socket.to(userIp).emit('peer-joined', { id: socket.id });

    // Send list of existing users
    const room = io.sockets.adapter.rooms.get(userIp);
    if (room) {
        const others = Array.from(room).filter(id => id !== socket.id);
        socket.emit('peers-existing', others);
    }

    // Signaling Logic
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        socket.to(userIp).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
