const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

app.set('trust proxy', true);
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. Generate a random 4-digit code for this user (Fallback)
    const myCode = Math.floor(1000 + Math.random() * 9000).toString();
    socket.emit('my-code', myCode);

    // 2. Try Auto-Discovery (IP Based)
    let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.includes('::ffff:')) ip = ip.replace('::ffff:', '');
    
    // Join the "IP Room" automatically
    socket.join(ip);
    socket.join(myCode); // Also join a room named after their code

    // Notify others on the same IP
    const room = io.sockets.adapter.rooms.get(ip);
    if(room && room.size > 1) {
        // Tell everyone else "I am here"
        socket.to(ip).emit('peer-found', { id: socket.id });
        // Tell me "Who is already here"
        const others = Array.from(room).filter(id => id !== socket.id);
        socket.emit('existing-peers', others);
    }

    // 3. Manual Join (If user types a code)
    socket.on('join-code', (code) => {
        console.log(`${socket.id} joining room ${code}`);
        socket.join(code);
        // Notify the person who OWNS that code
        io.to(code).emit('peer-found', { id: socket.id, initiator: true });
    });

    // 4. Signaling (The Handshake)
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        io.emit('peer-left', socket.id); // Broadcast to be safe
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
