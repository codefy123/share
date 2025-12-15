const socket = io({ 
    transports: ['websocket', 'polling'],
    reconnection: true
});

const deviceContainer = document.getElementById('device-container');
const transferList = document.getElementById('transfer-list');
const fileInput = document.getElementById('fileInput');

let peers = {};
let targetPeerId = null;

// --- STATUS INDICATORS ---
socket.on('connect', () => {
    document.getElementById('net-status').innerText = "Online";
    document.getElementById('net-status').style.color = "#10B981";
});

socket.on('disconnect', () => {
    document.getElementById('net-status').innerText = "Offline";
    document.getElementById('net-status').style.color = "#EF4444";
});

socket.on('init-info', data => {
    document.getElementById('my-code').innerText = data.code;
});

socket.on('error-toast', msg => alert(msg));

// --- MANUAL CONNECT ---
document.getElementById('manual-btn').addEventListener('click', () => {
    const code = document.getElementById('manual-input').value;
    if (code.length === 5) socket.emit('join-manual', code);
    else alert("Enter 5-digit code");
});

// --- PEER DISCOVERY ---
socket.on('peers-found', users => users.forEach(id => createPeer(id, true)));
socket.on('peer-joined', id => createPeer(id, false));
socket.on('peer-left', id => {
    if (peers[id]) { peers[id].destroy(); delete peers[id]; }
    const el = document.getElementById(`dev-${id}`);
    if (el) el.remove();
});

socket.on('signal', data => {
    if (peers[data.sender]) peers[data.sender].signal(data.signal);
});

// --- CORE P2P CONNECTION ---
function createPeer(userId, initiator) {
    if (peers[userId]) return;

    const p = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    p.on('signal', signal => socket.emit('signal', { target: userId, signal }));
    p.on('connect', () => addDeviceUI(userId));
    
    // RECEIVER LOGIC
    p.on('data', data => handleIncomingData(userId, data));
    
    p.on('error', err => console.log('Peer error:', err));
    peers[userId] = p;
}

// --- RECEIVER: HANDLE INCOMING DATA ---
let incomingMap = {};
let lastRxUpdate = 0;

function handleIncomingData(userId, data) {
    togglePanel(true);

    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if (json.meta) {
            // New File Started
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

    // REAL-TIME UPDATE (Throttled to 50ms for performance)
    const now = Date.now();
    if (now - lastRxUpdate > 50 || file.received >= file.size) {
        updateProgress(userId, file.received, file.size);
        lastRxUpdate = now;
    }

    // File Complete
    if (file.received >= file.size) {
        const blob = new Blob(file.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click(); // Trigger Download
        document.body.removeChild(a);
        delete incomingMap[userId];
        
        // Show 100% Green
        updateProgress(userId, file.size, file.size); 
    }
}

// --- SENDER: SEND FILE LOGIC ---
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !targetPeerId) return;

    togglePanel(true);
    addTransferUI(targetPeerId, file.name, 'Tx');
    
    const peer = peers[targetPeerId];
    
    // 1. Send Metadata
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));

    // 2. Start Slicing
    const chunkSize = 64 * 1024; // 64KB chunks
    let offset = 0;
    let lastTxUpdate = 0;
    
    const reader = new FileReader();

    reader.onload = e => {
        if(peer.destroyed) return; // Stop if disconnected

        peer.send(e.target.result); // Send Chunk
        offset += e.target.result.byteLength;
        
        // REAL-TIME UPDATE (Sender Side)
        const now = Date.now();
        if (now - lastTxUpdate > 50 || offset >= file.size) {
            updateProgress(targetPeerId, offset, file.size);
            lastTxUpdate = now;
        }
        
        // Loop until finished
        if (offset < file.size) {
            reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        }
    };

    // Start first chunk
    reader.readAsArrayBuffer(file.slice(0, chunkSize));
});

// --- UI FUNCTIONS ---
function addDeviceUI(userId) {
    if (document.getElementById(`dev-${userId}`)) return;
    const div = document.createElement('div');
    div.className = 'device-item';
    div.id = `dev-${userId}`;
    div.innerHTML = `<div class="status-dot"></div><div class="device-icon">📱</div><div class="device-name">User ${userId.substr(0,4)}</div>`;
    div.onclick = () => { targetPeerId = userId; togglePanel(true); };
    deviceContainer.appendChild(div);
}

function addTransferUI(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    // Unique ID for the progress bar based on User ID
    div.innerHTML = `
        <div style="font-size:20px;">${type === 'Tx' ? '⬆️' : '⬇️'}</div>
        <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:500;">${name}</div>
            <div class="progress-track">
                <div class="progress-fill" id="bar-${userId}"></div>
            </div>
            <div style="font-size:10px; color:#888; text-align:right;" id="txt-${userId}">0%</div>
        </div>
    `;
    transferList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    const txt = document.getElementById(`txt-${userId}`);
    
    if (bar && txt) {
        const percent = Math.round((current / total) * 100);
        bar.style.width = percent + "%";
        txt.innerText = percent + "%";
        
        if(percent >= 100) {
            bar.style.background = "#10B981"; // Turn Green on Finish
            txt.innerText = "Complete";
        }
    }
}
