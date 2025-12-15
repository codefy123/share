const socket = io({ transports: ['websocket', 'polling'] });
const statusMsg = document.getElementById('status-msg');
const connectBtn = document.getElementById('connect-btn');
const transferArea = document.getElementById('transfer-area');
const fileInput = document.getElementById('fileInput');

let peer = null; // Only one peer for manual connection
let targetId = null;

// 1. SETUP
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

socket.on('error-toast', msg => {
    statusMsg.innerText = msg;
    statusMsg.style.color = "#EF4444";
    connectBtn.disabled = false;
    connectBtn.innerText = "Connect";
});

// 2. START CONNECTION (You typed the code)
connectBtn.addEventListener('click', () => {
    const code = document.getElementById('friend-code').value;
    if (code.length !== 5) return alert("Enter 5-digit code");

    statusMsg.innerText = "Searching for user...";
    connectBtn.disabled = true;
    connectBtn.innerText = "Wait...";
    
    socket.emit('connect-to-peer', code);
});

// 3. RECEIVE REQUEST (You are the Host)
socket.on('peer-request', data => {
    // Someone wants to connect to me! I will initiate the WebRTC call.
    statusMsg.innerText = "Incoming connection...";
    createPeer(data.peerId, true); // True = Initiator
});

// 4. SIGNALING
socket.on('signal', data => {
    if (!peer) {
        // I am the Joiner (Passive)
        createPeer(data.sender, false);
    }
    peer.signal(data.signal);
});

// 5. WEBRTC LOGIC
function createPeer(userId, initiator) {
    peer = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('signal', signal => socket.emit('signal', { target: userId, signal }));

    peer.on('connect', () => {
        statusMsg.innerText = "🟢 Connected!";
        statusMsg.style.color = "#10B981";
        transferArea.style.display = 'block';
        document.getElementById('connect-card').style.display = 'none';
        targetId = userId;
    });

    peer.on('data', data => handleData(data));
    peer.on('error', err => {
        console.error(err);
        statusMsg.innerText = "Connection failed.";
        connectBtn.disabled = false;
    });
}

// 6. FILE TRANSFER (Simplified)
let incomingFile = {};

function handleData(data) {
    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if (json.meta) {
            incomingFile = { name: json.meta.name, chunks: [] };
            document.getElementById('progress').innerText = `Receiving ${json.meta.name}...`;
            return;
        }
    } catch(e) {}

    if (incomingFile.name) {
        incomingFile.chunks.push(data);
        const blob = new Blob(incomingFile.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = incomingFile.name;
        document.body.appendChild(a);
        a.click();
        document.getElementById('progress').innerText = "✅ Downloaded!";
        incomingFile = {}; // Reset
    }
}

fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file || !peer) return;

    document.getElementById('progress').innerText = `Sending ${file.name}...`;
    
    // Send Meta
    peer.send(JSON.stringify({ meta: { name: file.name } }));

    // Send File (Simple for now, non-chunked for immediate test)
    // NOTE: For files >50MB, the previous throttled version is better, 
    // but this is to prove connection works first.
    const reader = new FileReader();
    reader.onload = () => {
        peer.send(reader.result);
        document.getElementById('progress').innerText = "✅ Sent!";
    };
    reader.readAsArrayBuffer(file);
});
