// FORCE WEBSOCKET TO PREVENT NETWORK ERRORS
const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true
});

const deviceList = document.getElementById('device-list');
const scanMsg = document.getElementById('scan-msg');
const statusBanner = document.getElementById('connection-status');
const uploadOverlay = document.getElementById('upload-overlay');
const transferList = document.getElementById('transfer-list');
const fileInput = document.getElementById('fileInput');

let peers = {};
let targetPeerId = null;

// --- 1. CONNECTION HEALTH CHECK ---
socket.on('connect', () => {
    statusBanner.style.display = 'none';
    console.log('Connected to Server');
});

socket.on('disconnect', () => {
    statusBanner.style.display = 'block';
    statusBanner.innerText = "🔴 Disconnected - Check Internet Connection";
});

socket.on('connect_error', () => {
    statusBanner.style.display = 'block';
});

socket.on('my-code', code => {
    document.getElementById('my-code').innerText = `Code: ${code}`;
});

socket.on('error-toast', msg => alert(msg));

// --- 2. MANUAL CONNECT ---
document.getElementById('manual-btn').addEventListener('click', () => {
    const code = document.getElementById('manual-input').value;
    if (code.length === 6) {
        socket.emit('join-manual', code);
        scanMsg.innerText = "Searching for code " + code + "...";
    } else {
        alert("Please enter a 6-digit code");
    }
});

// --- 3. PEER DISCOVERY HANDLERS ---
socket.on('peers-existing', users => {
    users.forEach(id => createPeer(id, true)); // I call them
});

socket.on('peer-joined', id => {
    createPeer(id, false); // I wait for them
});

socket.on('peer-left', id => {
    if (peers[id]) { peers[id].destroy(); delete peers[id]; }
    const el = document.getElementById(`dev-${id}`);
    if (el) el.remove();
    if (Object.keys(peers).length === 0) scanMsg.style.display = 'block';
});

// --- 4. WEBRTC CORE ---
function createPeer(userId, initiator) {
    if (peers[userId]) return;

    const p = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    
    p.on('connect', () => {
        addDeviceUI(userId);
    });

    p.on('data', data => handleData(userId, data));
    
    // Silent Error Handling
    p.on('error', err => console.log('Peer Error:', err));

    peers[userId] = p;
}

socket.on('signal', data => {
    if (peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- 5. DATA & UI ---
let incomingMap = {};

function handleData(userId, data) {
    uploadOverlay.style.display = 'flex';
    
    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if (json.meta) {
            incomingMap[userId] = { name: json.meta.name, size: json.meta.size, chunks: [], received: 0 };
            addTransferUI(userId, json.meta.name, 'Incoming');
            return;
        }
    } catch (e) {}

    const file = incomingMap[userId];
    if (!file) return;

    file.chunks.push(data);
    file.received += data.byteLength;
    updateProgress(userId, file.received, file.size);

    if (file.received >= file.size) {
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

// Send File
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !targetPeerId) return;

    addTransferUI(targetPeerId, file.name, 'Sending');
    const peer = peers[targetPeerId];
    
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));

    const chunkSize = 64 * 1024;
    let offset = 0;
    const reader = new FileReader();

    reader.onload = e => {
        if(peer.destroyed) return;
        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        updateProgress(targetPeerId, offset, file.size);
        if (offset < file.size) reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
    };
    reader.readAsArrayBuffer(file.slice(0, chunkSize));
});

// UI Helpers
function addDeviceUI(userId) {
    if (document.getElementById(`dev-${userId}`)) return;
    scanMsg.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'device';
    div.id = `dev-${userId}`;
    div.innerHTML = `<div class="device-icon">👤</div><div class="device-name">User ${userId.substr(0,4)}</div>`;
    div.onclick = () => {
        targetPeerId = userId;
        uploadOverlay.style.display = 'flex';
    };
    deviceList.appendChild(div);
}

function addTransferUI(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.innerHTML = `<div><b>${name}</b><br><small>${type}</small></div><div class="progress-bar"><div class="progress-fill" id="bar-${userId}"></div></div>`;
    transferList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    if (bar) bar.style.width = Math.round((current / total) * 100) + "%";
}
