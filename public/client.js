const socket = io();
const devicesList = document.getElementById('devices-list');
const scanStatus = document.getElementById('scan-status');
const transferZone = document.getElementById('transfer-zone');
const historyList = document.getElementById('history-list');
const fileInput = document.getElementById('fileInput');

let peers = {}; 
let targetPeerId = null;

// --- 1. INITIALIZATION ---
socket.on('my-code', code => {
    document.getElementById('my-code-display').innerText = `Your Code: ${code}`;
});

// Manual Connect
document.getElementById('manual-btn').addEventListener('click', () => {
    const code = document.getElementById('manual-code').value;
    if(code) socket.emit('join-manual', code);
});

// --- 2. DISCOVERY LOGIC ---
function addDeviceToRadar(userId) {
    if(document.getElementById(`dev-${userId}`)) return;

    scanStatus.style.display = 'none'; // Hide "Scanning..." text

    const node = document.createElement('div');
    node.className = 'device-node';
    node.id = `dev-${userId}`;
    node.innerHTML = `
        <div class="badge"></div>
        <div class="device-icon">📱</div>
        <div class="device-label">User ${userId.substr(0,4)}</div>
    `;
    
    // CLICK TO SEND
    node.onclick = () => {
        targetPeerId = userId;
        fileInput.click();
    };

    devicesList.appendChild(node);
}

socket.on('peers-existing', users => users.forEach(id => createPeer(id, false)));
socket.on('peer-joined', id => createPeer(id, true));

socket.on('peer-left', id => {
    if(peers[id]) {
        peers[id].destroy();
        delete peers[id];
    }
    const el = document.getElementById(`dev-${id}`);
    if(el) el.remove();
    
    if(Object.keys(peers).length === 0) {
        scanStatus.style.display = 'block'; // Show scanning again if empty
    }
});

// --- 3. PEER CONNECTION (STUN/TURN) ---
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
        addDeviceToRadar(userId);
    });

    // DATA HANDLER
    let incoming = { name: null, size: 0, chunks: [], received: 0 };
    
    p.on('data', data => {
        // Show the bottom panel on first data
        transferZone.style.display = 'block';

        try {
            const json = JSON.parse(new TextDecoder().decode(data));
            if(json.meta) {
                incoming = { name: json.meta.name, size: json.meta.size, chunks: [], received: 0 };
                addHistoryItem(userId, incoming.name, "Incoming");
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
            incoming.name = null;
        }
    });

    peers[userId] = p;
}

// --- 4. FILE SENDING ---
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(!file || !targetPeerId) return;

    transferZone.style.display = 'block'; // Show panel
    addHistoryItem(targetPeerId, file.name, "Sending");

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

// --- 5. UI HELPERS ---
function addHistoryItem(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.id = `hist-${userId}`;
    div.innerHTML = `
        <div>
            <div style="font-weight:600; font-size:14px;">${name}</div>
            <div style="font-size:12px; color:#888;">${type}</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="bar-${userId}"></div></div>
    `;
    historyList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    if(bar) bar.style.width = Math.round((current/total)*100) + "%";
}
