const socket = io({ 
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity
});

const myCodeEl = document.getElementById('my-code');
const friendCodeInput = document.getElementById('friend-code');
const connectBtn = document.getElementById('connect-btn');
const statusBar = document.getElementById('status-bar');
const errorMsg = document.getElementById('error-msg');
const transferArea = document.getElementById('transfer-area');
const mainCard = document.getElementById('main-card');
const fileInput = document.getElementById('fileInput');
const progressText = document.getElementById('progress-text');

let peer = null;

// 1. CONNECTION STATUS
socket.on('connect', () => {
    statusBar.innerText = "🟢 Online - Ready to Connect";
    statusBar.className = "status-bar online";
});

socket.on('disconnect', () => {
    statusBar.innerText = "🔴 Offline - Check Internet";
    statusBar.className = "status-bar offline";
});

socket.on('init-info', data => {
    if(myCodeEl) myCodeEl.innerText = data.code;
});

socket.on('error-toast', msg => {
    if(errorMsg) errorMsg.innerText = msg;
    if(connectBtn) {
        connectBtn.disabled = false;
        connectBtn.innerText = "GO";
    }
});

// 2. CONNECT BUTTON (Wrapped in safety check)
if(connectBtn) {
    connectBtn.addEventListener('click', () => {
        const code = friendCodeInput.value;
        if(code.length !== 4) {
            errorMsg.innerText = "Please enter 4 digits";
            return;
        }
        
        errorMsg.innerText = "";
        connectBtn.disabled = true;
        connectBtn.innerText = "Connecting...";
        socket.emit('connect-to-peer', code);
    });
}

// 3. PEER LOGIC
socket.on('peer-request', data => {
    // I am the Host, I received a call
    createPeer(data.peerId, true);
});

socket.on('signal', data => {
    if(!peer) createPeer(data.sender, false); // I am the Joiner
    peer.signal(data.signal);
});

function createPeer(targetId, initiator) {
    peer = new SimplePeer({
        initiator: initiator,
        trickle: false,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('signal', signal => socket.emit('signal', { target: targetId, signal }));
    
    peer.on('connect', () => {
        mainCard.style.display = 'none';
        transferArea.style.display = 'block';
        statusBar.innerText = "🟢 P2P CONNECTED";
    });

    peer.on('data', data => handleData(data));
    
    // Fix: Handle errors without crashing app
    peer.on('error', err => {
        console.log(err);
        statusBar.innerText = "⚠️ Connection Error";
    });
}

// 4. FILE TRANSFER
let incomingFile = {};

function handleData(data) {
    try {
        const json = JSON.parse(new TextDecoder().decode(data));
        if(json.meta) {
            incomingFile = { name: json.meta.name, chunks: [] };
            progressText.innerText = `Receiving ${json.meta.name}...`;
            return;
        }
    } catch(e) {}

    if(incomingFile.name) {
        incomingFile.chunks.push(data);
        const blob = new Blob(incomingFile.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = incomingFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        progressText.innerText = "✅ File Received!";
        incomingFile = {};
    }
}

// 5. SEND FILE
if(fileInput) {
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if(!file || !peer) return;

        progressText.innerText = `Sending ${file.name}...`;
        peer.send(JSON.stringify({ meta: { name: file.name } }));

        const reader = new FileReader();
        reader.onload = () => {
            peer.send(reader.result);
            progressText.innerText = "✅ Sent Successfully!";
        };
        reader.readAsArrayBuffer(file);
    });
}
