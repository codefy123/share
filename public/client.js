const socket = io();
const deviceList = document.getElementById('device-list');
const scanText = document.getElementById('scan-text');
const uploadZone = document.getElementById('upload-zone');
const transferList = document.getElementById('transfers');
const fileInput = document.getElementById('fileInput');

let peers = {}; // Keep track of connections
let targetPeerId = null;

// --- 1. SETUP ---
socket.on('connect', () => console.log('Connected to Signaling Server'));

socket.on('my-code', code => {
    document.getElementById('my-code').innerText = `Code: ${code}`;
});

document.getElementById('manual-btn').addEventListener('click', () => {
    const code = document.getElementById('manual-input').value;
    if(code) {
        socket.emit('join-manual', code);
        scanText.innerText = `Connecting to ${code}...`;
    }
});

socket.on('error-toast', msg => alert(msg));

// --- 2. PEER DISCOVERY ---

// A. I just joined -> Call existing users
socket.on('peers-existing', users => {
    users.forEach(id => createPeer(id, true));
});

// B. Someone else joined -> Wait for their call
socket.on('peer-joined', id => {
    createPeer(id, false);
});

socket.on('peer-left', id => {
    if(peers[id]) {
        peers[id].destroy();
        delete peers[id];
    }
    const el = document.getElementById(`dev-${id}`);
    if(el) el.remove();
    
    if(Object.keys(peers).length === 0) {
        scanText.style.display = 'block';
    }
});

// --- 3. CREATE CONNECTION (Robust) ---
function createPeer(userId, initiator) {
    if(peers[userId]) return; // Already exists

    const p = new SimplePeer({
        initiator: initiator,
        trickle: false, // Simple signaling
        config: { 
            // GOOGLE STUN SERVERS (Fixes connection issues)
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ] 
        }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    
    p.on('connect', () => {
        console.log("P2P Connected to", userId);
        addDeviceUI(userId);
    });

    p.on('data', data => handleData(userId, data));
    
    p.on('error', err => console.log('Peer Error (Ignored):', err));

    peers[userId] = p;
}

// Handle Incoming Signals
socket.on('signal', data => {
    if(peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- 4. DATA HANDLER ---
let incomingMap = {}; 

function handleData(userId, data) {
    uploadZone.style.display = 'block'; // Show panel

    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if(json.meta) {
            incomingMap[userId] = { 
                name: json.meta.name, 
                size: json.meta.size, 
                chunks: [], 
                received: 0 
            };
            addTransferUI(userId, json.meta.name, "Incoming");
            return;
        }
    } catch(e) {}

    const file = incomingMap[userId];
    if(!file) return;

    file.chunks.push(data);
    file.received += data.byteLength;
    updateProgress(userId, file.received, file.size);

    if(file.received >= file.size) {
        const blob = new Blob(file.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        delete incomingMap[userId];
    }
}

// --- 5. SEND FILE ---
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(!file || !targetPeerId || !peers[targetPeerId]) return;

    uploadZone.style.display = 'block';
    addTransferUI(targetPeerId, file.name, "Sending");

    const peer = peers[targetPeerId];
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));

    const chunkSize = 64 * 1024;
    let offset = 0;
    const reader = new FileReader();

    reader.onload = e => {
        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        updateProgress(targetPeerId, offset, file.size);
        if(offset < file.size) reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
    };
    reader.readAsArrayBuffer(file.slice(0, chunkSize));
});

// --- 6. UI HELPERS ---
function addDeviceUI(userId) {
    if(document.getElementById(`dev-${userId}`)) return;
    scanText.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'device';
    div.id = `dev-${userId}`;
    div.innerHTML = `
        <div class="device-icon">👤</div>
        <div class="device-name">User ${userId.substr(0,4)}</div>
    `;
    div.onclick = () => {
        targetPeerId = userId;
        document.getElementById('upload-zone').style.display = 'block';
    };
    deviceList.appendChild(div);
}

function addTransferUI(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.innerHTML = `
        <div>
            <div style="font-weight:600; font-size:12px;">${name}</div>
            <div style="font-size:10px; color:#888;">${type}</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="bar-${userId}"></div></div>
    `;
    transferList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    if(bar) bar.style.width = Math.round((current/total)*100) + "%";
}
