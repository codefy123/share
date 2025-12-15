const socket = io();
const devicesList = document.getElementById('devices-list');
const scanStatus = document.getElementById('scan-status');
const transferZone = document.getElementById('transfer-zone');
const historyList = document.getElementById('history-list');
const fileInput = document.getElementById('fileInput');

let peers = {}; 
let targetPeerId = null;

// --- 1. INITIALIZATION ---
socket.on('connect', () => {
    console.log("Connected to server");
});

socket.on('my-code', code => {
    const el = document.getElementById('my-code-display');
    if(el) el.innerText = `Code: ${code}`;
});

// Manual Connect Button
const manualBtn = document.getElementById('manual-btn');
if(manualBtn) {
    manualBtn.addEventListener('click', () => {
        const code = document.getElementById('manual-code').value;
        if(code.length === 6) {
            socket.emit('join-manual', code);
            // Show feedback
            scanStatus.innerText = "Connecting to " + code + "...";
        } else {
            alert("Please enter a 6-digit code");
        }
    });
}

socket.on('error-toast', msg => alert(msg));

// --- 2. PEER DISCOVERY ---

// Scenario A: I just joined, and the server sent me a list of people already here.
// Action: I must call them (Initiator = true)
socket.on('peers-existing', (users) => {
    users.forEach(id => {
        createPeer(id, true);
    });
});

// Scenario B: I was already here, and someone new joined.
// Action: I wait for them to call me (Initiator = false)
// We just add them to UI placeholder for now
socket.on('peer-joined', (id) => {
    // We don't createPeer here immediately; we wait for their signal.
    // OR we can create a passive peer. 
    // Best practice: Create passive peer immediately so we are ready.
    createPeer(id, false);
});

socket.on('peer-left', id => {
    if(peers[id]) peers[id].destroy();
    delete peers[id];
    const el = document.getElementById(`dev-${id}`);
    if(el) el.remove();
    
    // If no peers left, show scanning text
    if(Object.keys(peers).length === 0) {
        if(scanStatus) scanStatus.style.display = 'block';
    }
});

socket.on('signal', data => {
    // If peer doesn't exist yet (rare race condition), create it passive
    if (!peers[data.sender]) {
        createPeer(data.sender, false);
    }
    peers[data.sender].signal(data.signal);
});

// --- 3. CREATE PEER (The Core) ---
function createPeer(userId, initiator) {
    if (peers[userId]) return; // Already exists

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

    p.on('signal', signal => {
        socket.emit('signal', { target: userId, signal: signal });
    });

    p.on('connect', () => {
        console.log("Connected to", userId);
        addDeviceToRadar(userId);
    });

    p.on('data', data => handleIncomingData(userId, data));
    
    p.on('error', err => console.log('Peer error:', err));
    
    peers[userId] = p;
}

// --- 4. DATA HANDLING ---
let incomingFiles = {}; // Store chunks per user

function handleIncomingData(userId, data) {
    // Reveal transfer zone
    if(transferZone) transferZone.style.display = 'block';

    try {
        // Try parsing metadata
        const json = JSON.parse(new TextDecoder().decode(data));
        if(json.meta) {
            incomingFiles[userId] = { 
                name: json.meta.name, 
                size: json.meta.size, 
                chunks: [], 
                received: 0 
            };
            addHistoryItem(userId, incomingFiles[userId].name, "Incoming");
            return;
        }
    } catch(e) {}

    const file = incomingFiles[userId];
    if(!file) return;

    file.chunks.push(data);
    file.received += data.byteLength;
    
    updateProgress(userId, file.received, file.size);

    if(file.received >= file.size) {
        // Download
        const blob = new Blob(file.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Cleanup
        delete incomingFiles[userId];
    }
}

// --- 5. UI HELPERS ---
function addDeviceToRadar(userId) {
    if(document.getElementById(`dev-${userId}`)) return;
    if(scanStatus) scanStatus.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'device-node';
    div.id = `dev-${userId}`;
    div.innerHTML = `
        <div class="badge"></div>
        <div class="device-icon">👤</div>
        <div class="device-label">User ${userId.substr(0,4)}</div>
    `;
    div.onclick = () => {
        targetPeerId = userId;
        fileInput.click();
    };
    if(devicesList) devicesList.appendChild(div);
}

function addHistoryItem(userId, name, type) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.innerHTML = `
        <div>
            <div style="font-weight:600; font-size:14px;">${name}</div>
            <div style="font-size:12px; color:#888;">${type}</div>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="bar-${userId}"></div></div>
    `;
    if(historyList) historyList.prepend(div);
}

function updateProgress(userId, current, total) {
    const bar = document.getElementById(`bar-${userId}`);
    if(bar) bar.style.width = Math.round((current/total)*100) + "%";
}

// --- 6. SEND FILE ---
fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if(!file || !targetPeerId || !peers[targetPeerId]) return;

    if(transferZone) transferZone.style.display = 'block';
    addHistoryItem(targetPeerId, file.name, "Sending");

    const peer = peers[targetPeerId];
    
    // Send Meta
    peer.send(JSON.stringify({ meta: { name: file.name, size: file.size } }));

    // Send Chunks
    const chunkSize = 64 * 1024; // 64KB
    let offset = 0;
    const reader = new FileReader();

    reader.onload = e => {
        peer.send(e.target.result);
        offset += e.target.result.byteLength;
        updateProgress(targetPeerId, offset, file.size);
        
        if(offset < file.size) {
            reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
        }
    };
    reader.readAsArrayBuffer(file.slice(0, chunkSize));
});
