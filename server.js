const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });

app.set('trust proxy', true);
app.use(express.static('public'));

io.on('connection', (socket) => {
    // 1. Join a Room
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        const room = io.sockets.adapter.rooms.get(roomId);
        const peers = room ? Array.from(room).filter(id => id !== socket.id) : [];
        
        // Tell the user who is already there
        socket.emit('room-joined', { peers });
        // Tell others a new user arrived
        socket.to(roomId).emit('user-connected', socket.id);
    });

    // 2. Relay Signals
    socket.on('signal', (data) => {
        io.to(data.target).emit('signal', {
            sender: socket.id,
            signal: data.signal
        });
    });

    socket.on('disconnect', () => {
        io.emit('user-disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on ${PORT}`));
