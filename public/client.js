const socket = io({ transports: ['websocket', 'polling'] });

const deviceContainer = document.getElementById('device-container');
const transferList = document.getElementById('transfer-list');
const fileInput = document.getElementById('fileInput');

let peers = {};
let targetPeerId = null;

// --- INITIALIZATION ---
socket.on('connect', () => {
    document.getElementById('network-id').innerText = "Online";
    document.getElementById('network-id').style.color = "#10B981";
});

socket.on('disconnect', () => {
    document.getElementById('network-id').innerText = "Offline";
    document.getElementById('network-id').style.color = "#EF4444";
});

socket.on('init-info', data => {
    document.getElementById('my-code').innerText = data.code;
    document.getElementById('network-id').innerText = `IP: ${data.ip}`; // Debug info for user
});

socket.on('error-toast', msg => alert(msg));

// --- CONNECT LOGIC ---
document.getElementById('manual-btn').addEventListener('click', () => {
    const code = document.getElementById('manual-input').value;
    if (code.length === 5) {
        socket.emit('join-manual', code);
    } else {
        alert("Please enter a valid 5-digit code");
    }
});

// --- PEER DISCOVERY ---
socket.on('peers-found', users => users.forEach(id => createPeer(id, true)));
socket.on('peer-joined', id => createPeer(id, false)); // Passive connect

socket.on('peer-left', id => {
    if (peers[id]) { peers[id].destroy(); delete peers[id]; }
    const el = document.getElementById(`dev-${id}`);
    if (el) el.remove();
});

socket.on('signal', data => {
    if (peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- CORE P2P LOGIC ---
function createPeer(userId, initiator) {
    if (peers[userId]) return;

    const p = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    
    p.on('connect', () => addDeviceUI(userId));
    
    // DATA HANDLING
    p.on('data', data => handleIncomingData(userId, data));
    
    p.on('error', err => console.error("Peer error:", err));
    
    peers[userId] = p;
}

// --- FILE HANDLING (THROTTLED) ---
let incomingMap = {};
let lastUpdate = 0;

function handleIncomingData(userId, data) {
    togglePanel(true);

    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if (json.meta) {
            incomingMap[userId] = { 
                name: json.meta.name, 
                size: json.meta.size, 
                chunks: [], 
                received: 0 
            };
            addTransferUI(userId, json.meta.name, 'Rx');
            return;
        }
    } catch (e) {}

    const file = incomingMap[userId];
    if (!file) return;

    file.chunks.push(data);
    file.received += data.byteLength;

    // THROTTLE UI UPDATES (Fix for Large Files)
    const now = Date.now();
    if (now - lastUpdate > 100 || file.received >= file.size) {
        updateProgress(userId, file.received, file.size);
        lastUpdate = now;
    }

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

// SEND FILE
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !targetPeerId) return;

    togglePanel(true);
    addTransferUI(targetPeerId, file.name, 'Tx');
    
    const peer = peers[targetPeerId];
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));

    const chunkSize = 64 * 1024; // 64KB
    let offset = 0;
    const reader = new FileReader();

    reader.onload = e => {
        if(peer.destroyed) return;
        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        
        // Throttle UI updates for sender too
        const now = Date.now();
        if (now - lastUpdate > 100 || offset >= file.size) {
            updateProgress(targetPeerId, offset, file.size);
            lastUpdate = now;
        }
        
        if (offset < file.size) {
            reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        }
    };
    reader.readAsArrayBuffer(file.slice(0, chunkSize));
});

// --- UI HELPERS ---
function addDeviceUI(userId) {
    if (document.getElementById(`dev-${userId}`)) return;
    
    const div = document.createElement('div');
    div.className = 'device-item';
    div.id = `dev-${userId}`;
    div.innerHTML = `
        <div class="status-dot"></div>
        <div class="device-icon">📱</div>
        <div class="device-name">User ${userId.substr(0,4)}</div>
    `;
    div.onclick = () => {
        targetPeerId = userId;
        togglePanel(true);
    };
    deviceContainer.appendChild(div);
}

function addTransferUI(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.innerHTML = `
        <div class="file-icon">${type === 'Tx' ? '⬆️' : '⬇️'}</div>
        <div class="file-details">
            <div class="filename">${name}</div>
            <div class="progress-track"><div class="progress-fill" id="bar-${userId}"></div></div>
        </div>
    `;
    transferList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    if (bar) bar.style.width = Math.round((current / total) * 100) + "%";
}
