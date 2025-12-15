const socket = io();
const myCodeEl = document.getElementById('my-code');
const radarGrid = document.getElementById('radar-grid');
const transferList = document.getElementById('transfer-list');
const fileInput = document.getElementById('fileInput');

let myRoomId = Math.floor(100000 + Math.random() * 900000).toString();
let peers = {}; 
let targetPeerId = null; 

// --- 1. INITIAL SETUP ---
myCodeEl.innerText = myRoomId;
socket.emit('join-room', myRoomId);

document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('join-input').value;
    if(code.length === 6) {
        socket.emit('join-room', code);
        // Clear the "Waiting" text
        radarGrid.innerHTML = ''; 
    } else {
        alert("Enter a valid 6-digit code.");
    }
});

// --- 2. SOCKET EVENTS ---
socket.on('user-connected', userId => createPeer(userId, true));
socket.on('room-joined', data => {
    if(data.peers.length > 0) radarGrid.innerHTML = ''; // Clear placeholder
    data.peers.forEach(id => createPeer(id, false));
});

socket.on('user-disconnected', id => {
    if(peers[id]) peers[id].destroy();
    delete peers[id];
    const el = document.getElementById(`dev-${id}`);
    if(el) el.remove();
});

socket.on('signal', data => {
    if(peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- 3. PEER CONNECTION (THE FIX) ---
function createPeer(userId, initiator) {
    const p = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { 
            // GOOGLE STUN SERVERS - CRITICAL FOR CONNECTING OVER INTERNET
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' }, 
                { urls: 'stun:global.stun.twilio.com:3478' }
            ] 
        }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    
    p.on('connect', () => addDeviceUI(userId));

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
        fileInput.click();
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

// --- 5. SEND FILE ---
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(!file || !targetPeerId) return;
    
    const peer = peers[targetPeerId];
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));
    
    addTransferUI(targetPeerId, file.name, "outgoing");

    const chunkSize = 64 * 1024;
    let offset = 0;
    const reader = new FileReader();
    
    reader.onload = e => {
        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        updateProgress(targetPeerId, offset, file.size);
        if(offset < file.size) readNext();
    };

    const readNext = () => reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
    readNext();
});
