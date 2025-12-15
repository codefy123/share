const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.set('trust proxy', true); // Critical for Render/Heroku
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. GENERATE A FALLBACK CODE (Just in case)
    const myCode = Math.floor(1000 + Math.random() * 9000).toString();
    socket.emit('my-code', myCode);

    // 2. AUTO-DISCOVERY: DETECT PUBLIC IP
    let clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    
    // Clean IP string (handle "IP1, IP2" format from proxies)
    if (clientIp.indexOf(',') > -1) clientIp = clientIp.split(',')[0].trim();
    if (clientIp.includes('::ffff:')) clientIp = clientIp.replace('::ffff:', '');

    // Join the "IP Room"
    socket.join(clientIp);
    socket.join(myCode); // Also listen for manual code connections

    // 3. INSTANTLY NOTIFY OTHERS ON SAME IP
    const room = io.sockets.adapter.rooms.get(clientIp);
    if(room && room.size > 1) {
        // Tell this user about existing peers
        const others = Array.from(room).filter(id => id !== socket.id);
        socket.emit('peers-existing', others);

        // Tell others about this new user
        socket.to(clientIp).emit('peer-joined', socket.id);
    }

    // 4. MANUAL CONNECTION (Fallback)
    socket.on('join-manual', (code) => {
        const targetRoom = io.sockets.adapter.rooms.get(code);
        if(targetRoom && targetRoom.size > 0) {
            // Tell the Host (code owner) to initiate connection with Me
            socket.to(code).emit('peer-joined', socket.id);
        } else {
            socket.emit('error', 'Device not found with that code.');
        }
    });

    // 5. WEBRTC SIGNALING
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        // Notify everyone on the same IP that I left
        socket.to(clientIp).emit('peer-left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
