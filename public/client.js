const socket = io();
const myCodeEl = document.getElementById('my-code');
const radarGrid = document.getElementById('radar-grid');
const transferList = document.getElementById('transfer-list');
const fileInput = document.getElementById('fileInput');

// Generate Random Room ID
let myRoomId = Math.floor(100000 + Math.random() * 900000).toString();
let peers = {}; 
let targetPeerId = null; 

// --- 1. INITIAL SETUP ---
if (myCodeEl) myCodeEl.innerText = myRoomId;

// Auto-Join Room on Connect
socket.on('connect', () => {
    console.log("Connected to Signaling Server");
    socket.emit('join-room', myRoomId);
});

// Join Button Logic
document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('join-input').value;
    if(code.length === 6) {
        socket.emit('join-room', code);
        radarGrid.innerHTML = ''; // Clear waiting text
    } else {
        alert("Enter a valid 6-digit code.");
    }
});

// --- 2. SOCKET EVENTS ---
socket.on('user-connected', userId => createPeer(userId, true));

socket.on('room-joined', data => {
    if(data.peers.length > 0) radarGrid.innerHTML = ''; 
    data.peers.forEach(id => createPeer(id, false));
});

socket.on('user-disconnected', id => {
    // FIX: Only destroy if the P2P connection is NOT active
    // This allows file transfer to continue even if Internet/Socket drops
    if(peers[id] && !peers[id].connected) {
        peers[id].destroy();
        delete peers[id];
        const el = document.getElementById(`dev-${id}`);
        if(el) el.remove();
    }
});

socket.on('signal', data => {
    if(peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- 3. PEER CONNECTION (ROBUST) ---
function createPeer(userId, initiator) {
    const p = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { 
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }, 
                { urls: 'stun:global.stun.twilio.com:3478' }
            ] 
        }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    
    p.on('connect', () => {
        console.log("P2P Connection Established");
        addDeviceUI(userId);
    });

    // CRITICAL FIX: Handle Errors Gracefully
    p.on('error', (err) => {
        console.log('Peer Error:', err);
        // Do not alert user, just log it. Prevents UI spam.
    });

    p.on('close', () => {
        const el = document.getElementById(`dev-${userId}`);
        if(el) el.remove();
        delete peers[userId];
    });

    // Handle Data (Chunks)
    let incoming = { name: null, size: 0, chunks: [], received: 0 };
    
    p.on('data', data => {
        try {
            const json = JSON.parse(new TextDecoder().decode(data));
            if(json.meta) {
                incoming = { name: json.meta.name, size: json.meta.size, chunks: [], received: 0 };
                addTransferUI(userId, incoming.name, "incoming");
                return;
            }
        } catch(e) {}

        if(!incoming.name) return;

        incoming.chunks.push(data);
        incoming.received += data.byteLength;
        updateProgress(userId, incoming.received, incoming.size);

        if(incoming.received >= incoming.size) {
            const blob = new Blob(incoming.chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = incoming.name;
            a.click();
            incoming.name = null; // Reset
        }
    });

    peers[userId] = p;
}

// --- 4. UI LOGIC ---
function addDeviceUI(userId) {
    if(document.getElementById(`dev-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'device-card';
    div.id = `dev-${userId}`;
    div.innerHTML = `
        <div class="device-icon">💻</div>
        <div class="device-name">User ${userId.substr(0,4)}</div>
        <div class="device-status"><div class="dot"></div> Connected</div>
    `;
    div.onclick = () => {
        targetPeerId = userId;
        // Scroll to upload area
        document.getElementById('upload-area').scrollIntoView({ behavior: 'smooth' });
    };
    radarGrid.appendChild(div);
}

function addTransferUI(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.id = `trans-${userId}`;
    div.innerHTML = `
        <div class="file-info">
            <div class="filename">${name}</div>
            <div class="meta">${type === 'incoming' ? 'From' : 'To'} User ${userId.substr(0,4)}</div>
        </div>
        <div class="progress-wrapper">
            <div class="meta" id="txt-${userId}">0%</div>
            <div class="progress-bg"><div class="progress-fill" id="bar-${userId}"></div></div>
        </div>
    `;
    transferList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    const txt = document.getElementById(`txt-${userId}`);
    if(bar) {
        const pct = Math.round((current/total)*100);
        bar.style.width = pct + "%";
        txt.innerText = pct + "%";
        if(pct >= 100) txt.innerText = "Done";
    }
}

// --- 5. SEND FILE LOGIC ---
function sendFile(file) {
    if(!file || !targetPeerId || !peers[targetPeerId]) {
        alert("Please select a Connected Device first!");
        return;
    }
    
    const peer = peers[targetPeerId];
    
    // FIX: Check if peer is destroyed before sending
    if (peer.destroyed) {
        alert("Connection lost. Please reconnect.");
        return;
    }

    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));
    
    addTransferUI(targetPeerId, file.name, "outgoing");

    const chunkSize = 64 * 1024; // 64KB
    let offset = 0;
    const reader = new FileReader();
    
    reader.onload = e => {
        if (peer.destroyed) return; // Stop if connection dies

        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        updateProgress(targetPeerId, offset, file.size);
        if(offset < file.size) readNext();
    };

    const readNext = () => reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
    readNext();
}

// Handle File Input Change
fileInput.addEventListener('change', () => {
    sendFile(fileInput.files[0]);
});

// Handle Drag & Drop
const dropZone = document.getElementById('upload-area');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#3b82f6';
    dropZone.style.background = '#1e1e24';
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#27272a';
    dropZone.style.background = 'transparent';
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#27272a';
    dropZone.style.background = 'transparent';
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        sendFile(files[0]);
    }
});
