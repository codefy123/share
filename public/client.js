const socket = io();
const myCodeEl = document.getElementById('my-code');
const radarGrid = document.getElementById('radar-grid');
const historyList = document.getElementById('history-list');
const fileInput = document.getElementById('fileInput');

let myRoomId = null;
let peers = {}; // Store peer connections: { socketId: PeerObj }
let targetPeerId = null; // Who are we currently trying to send to?

// --- 1. INITIALIZATION ---

// Generate a random 6-digit room code for myself
myRoomId = Math.floor(100000 + Math.random() * 900000).toString();
myCodeEl.innerText = myRoomId;

// Auto-join my own room so others can connect to me
socket.emit('join-room', myRoomId);

// Handle "Join" button
document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('join-input').value;
    if(code.length === 6) {
        socket.emit('join-room', code);
        alert(`Joined Room ${code}`);
    } else {
        alert("Please enter a valid 6-digit code");
    }
});

// --- 2. SOCKET EVENTS ---

// A new user connected to the room
socket.on('user-connected', userId => {
    createPeer(userId, true); // true = I am the initiator
});

// I joined a room, here is who is already there
socket.on('room-joined', data => {
    data.peers.forEach(peerId => createPeer(peerId, false)); // false = They are waiting
});

// Someone disconnected
socket.on('user-disconnected', userId => {
    if(peers[userId]) peers[userId].destroy();
    delete peers[userId];
    const el = document.getElementById(`peer-${userId}`);
    if(el) el.remove();
});

// WebRTC Signal Relay
socket.on('signal', data => {
    if(peers[data.sender]) {
        peers[data.sender].signal(data.signal);
    }
});

// --- 3. PEER & FILE LOGIC ---

function createPeer(userId, initiator) {
    if(peers[userId]) return; // Already exists

    const p = new SimplePeer({
        initiator: initiator,
        trickle: false
    });

    // Handle Signaling
    p.on('signal', signal => {
        socket.emit('signal', { target: userId, signal: signal });
    });

    // Connection Established
    p.on('connect', () => {
        addPeerUI(userId);
    });

    // Handle Incoming Data (Chunks or Metadata)
    let incomingFile = {
        name: null,
        size: 0,
        chunks: [],
        receivedSize: 0
    };

    p.on('data', data => {
        // 1. Is it JSON Metadata? (Try-catch is fast)
        try {
            const str = new TextDecoder().decode(data);
            if(str.startsWith('{"meta":')) {
                const meta = JSON.parse(str);
                incomingFile.name = meta.meta.name;
                incomingFile.size = meta.meta.size;
                incomingFile.chunks = [];
                incomingFile.receivedSize = 0;
                
                // Show UI Prompt
                addToHistory(userId, incomingFile.name, "Receiving...", "incoming");
                return; 
            }
        } catch(e) {}

        // 2. It is a File Chunk
        if(!incomingFile.name) return; // Ignore if no metadata yet

        incomingFile.chunks.push(data);
        incomingFile.receivedSize += data.byteLength;

        // Update Progress Bar in History
        updateHistoryProgress(userId, incomingFile.receivedSize, incomingFile.size);

        // 3. File Complete?
        if(incomingFile.receivedSize >= incomingFile.size) {
            const blob = new Blob(incomingFile.chunks);
            downloadFile(blob, incomingFile.name);
            
            // Reset state for next file
            incomingFile.name = null;
            incomingFile.chunks = [];
        }
    });

    peers[userId] = p;
}

// --- 4. UI FUNCTIONS ---

function addPeerUI(userId) {
    if(document.getElementById(`peer-${userId}`)) return;

    const card = document.createElement('div');
    card.className = 'peer-card';
    card.id = `peer-${userId}`;
    card.innerHTML = `
        <div class="peer-status"></div>
        <div class="peer-icon">👤</div>
        <div style="font-weight:600;">User ${userId.substr(0,4)}</div>
        <div style="font-size:12px; color:#888;">Connected</div>
    `;
    card.onclick = () => {
        targetPeerId = userId;
        fileInput.click();
    };
    radarGrid.appendChild(card);
}

function addToHistory(userId, fileName, status, type) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.id = `hist-${userId}`; // Simple ID for update
    item.innerHTML = `
        <div class="history-meta">
            <div class="file-name">${fileName}</div>
            <div class="file-info">${type === 'incoming' ? 'From' : 'To'} User ${userId.substr(0,4)}</div>
        </div>
        <div style="text-align:right;">
            <div style="font-size:11px; color:#888;">${status}</div>
            <div class="progress-container" style="display:block; width:100px;">
                <div class="progress-bar" id="prog-${userId}"></div>
            </div>
        </div>
    `;
    historyList.prepend(item);
}

function updateHistoryProgress(userId, current, total) {
    const bar = document.getElementById(`prog-${userId}`);
    if(bar) {
        const percent = Math.floor((current / total) * 100);
        bar.style.width = percent + '%';
        if(percent >= 100) bar.style.background = '#10b981'; // Green on done
    }
}

function downloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- 5. SENDING FILE (CHUNKING) ---

fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if(!file || !targetPeerId || !peers[targetPeerId]) return;

    const peer = peers[targetPeerId];

    // 1. Send Metadata
    const metaData = JSON.stringify({ meta: { name: file.name, size: file.size } });
    peer.send(metaData);

    // Add to UI
    addToHistory(targetPeerId, file.name, "Sending...", "outgoing");

    // 2. Read & Send Chunks
    const chunkSize = 64 * 1024; // 64KB per chunk
    let offset = 0;

    const reader = new FileReader();

    reader.onload = (e) => {
        peer.send(e.target.result); // Send the chunk
        offset += e.target.result.byteLength;
        
        updateHistoryProgress(targetPeerId, offset, file.size);

        if (offset < file.size) {
            readNextChunk();
        } else {
            console.log("File Sent Complete");
        }
    };

    function readNextChunk() {
        const slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
    }

    // Start sending
    readNextChunk();
});
