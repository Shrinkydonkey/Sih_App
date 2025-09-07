// WebSocket URL configuration
const wsUrl = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/api/voice';
let pc, localStream;
let ws;
let myId = null;
let peerId = null;
let pendingCandidates = [];
let isMuted = false;
let isSpeakerMuted = false;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeVoiceChat();
});

function initializeVoiceChat() {
    // Dark mode toggle functionality
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('change', function() {
            document.body.classList.toggle('dark-mode', this.checked);
        });
    }

    // Setup control buttons
    setupControls();

    // Auto-join functionality
    autoJoinCall();
    
    // Handle autoplay restrictions with user interaction
    document.addEventListener('click', enableAudioPlayback, { once: true });
}

function getUserRole() {
    // Get role from localStorage set by index.html button
    const role = localStorage.getItem('role');
    
    if (role) {
        localStorage.removeItem('role'); // Clean up after use
        return role;
    }
    
    // Default role if none specified
    return 'user';
}

function getHelperToken() {
    return localStorage.getItem('helperToken') || localStorage.getItem('token');
}

async function autoJoinCall() {
    try {
        // Get role from localStorage
        const role = getUserRole();
        const language = 'en'; // Default language
        const tags = ['anonymous']; // Default tag

        console.log('Joining voice chat as:', role);

        // Start local audio FIRST
        await startLocalAudio();
        
        // Update UI to show connecting status
        updateStatus(`Connecting as ${role}...`);
        
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            log('WebSocket connected through gateway');
            
            const joinMessage = {
                type: 'join', 
                role, 
                language, 
                tags
            };
            
            // Add token for helper authentication
            if (role === 'helper') {
                joinMessage.token = getHelperToken();
            }
            
            ws.send(JSON.stringify(joinMessage));
            updateStatus(`Searching for someone to talk to... (${role})`);
        };

        ws.onmessage = async (evt) => {
            const msg = JSON.parse(evt.data);
            log(`Received: ${msg.type}`);
            
            if (msg.type === 'error') {
                console.error('Server error:', msg.message);
                if (msg.message.includes('authentication')) {
                    alert('Helper authentication failed. Please log in again.');
                    window.location.href = '/'; // Redirect to login page
                }
                return;
            }
            
            if(msg.type === 'waiting') {
                log('Added to waiting queue');
                updateStatus('Waiting for another person...');
                
            } else if (msg.type === 'matched') {
                log(`Matched! RoomId: ${msg.roomId} as ${msg.role} | peer: ${msg.peerId}`);
                peerId = msg.peerId;
                
                // Initialize peer connection for BOTH roles
                await preparePeerConnection();
                
                if (msg.role === 'seeker' || msg.role === 'user') {
                    log('Creating offer...');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    ws.send(JSON.stringify({type: 'signal', to: peerId, data: {sdp: pc.localDescription}}));
                } else {
                    log('Waiting for offer...');
                }
                
                updateStatus('Connecting to peer...');

            } else if (msg.type === 'signal') {
                console.log("Signal received:", msg.data);
                await handleSignal(msg.data, msg.from);
                
            } else if (msg.type === 'ended' || msg.type === 'peer_disconnected') {
                log('Peer ended or disconnected');
                endCall();
            }
        };

        ws.onclose = () => {
            log('WebSocket connection closed');
            updateStatus('Disconnected');
        };

        ws.onerror = (error) => {
            log('WebSocket error: ' + error);
            updateStatus('Connection error');
            showError('Connection failed. Please try again.');
        };

    } catch (error) {
        log('Connection error: ' + error.message);
        updateStatus('Failed to connect');
        showError('Failed to start voice chat. Please check your microphone permissions.');
    }
}

async function handleSignal(data, from) {
    if (!pc) {
        log('ERROR: No peer connection when handling signal');
        return;
    }

    if (data.sdp) {
        const sdp = data.sdp;
        log(`Handling SDP: ${sdp.type}`);

        if (sdp.type === 'offer') {
            log('Processing offer...');
            
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                log('Remote description set successfully');

                // Process any pending ICE candidates
                if (pendingCandidates.length > 0) {
                    log(`Processing ${pendingCandidates.length} pending candidates`);
                    for (const candidate of pendingCandidates) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (err) {
                            console.error('Error adding pending candidate:', err);
                        }
                    }
                    pendingCandidates = [];
                }

                // Create and send answer
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                ws.send(JSON.stringify({ type: 'signal', to: from, data: { sdp: pc.localDescription } }));
                log('Answer sent');

            } catch (err) {
                log('Error processing offer: ' + err.message);
            }

        } else if (sdp.type === 'answer') {
            log('Processing answer...');
            
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                log('Remote description set successfully');

                // Process any pending ICE candidates
                if (pendingCandidates.length > 0) {
                    log(`Processing ${pendingCandidates.length} pending candidates`);
                    for (const candidate of pendingCandidates) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (err) {
                            console.error('Error adding pending candidate:', err);
                        }
                    }
                    pendingCandidates = [];
                }

            } catch (err) {
                log('Error processing answer: ' + err.message);
            }
        }

    } else if (data.candidate) {
        log('Processing ICE candidate...');
        
        try {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                log('ICE candidate added successfully');
            } else {
                log('Remote description not ready, queuing candidate');
                pendingCandidates.push(data.candidate);
            }
        } catch (err) {
            console.error('Error handling ICE candidate:', err);
        }
    }
}

async function startLocalAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            }
        });
        log('Microphone access granted');
        return true;
    } catch(err) {
        log('Microphone error: ' + err.message);
        alert('Microphone access is required for voice chat. Please allow microphone access and try again.');
        throw err;
    }
}

async function preparePeerConnection() {
    if (pc) {
        log('Peer connection already exists');
        return;
    }
    
    log('Creating peer connection...');
    
    pc = new RTCPeerConnection({
        iceServers: [
            {urls: "stun:stun.l.google.com:19302"},
            {urls: "stun:stun1.l.google.com:19302"},
            {urls: "stun:stun2.l.google.com:19302"}
        ]
    });

    // Add local stream tracks BEFORE creating offer/answer
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            log(`Added ${track.kind} track to peer connection`);
        });
    }

    // Handle remote stream - FIXED VERSION
    pc.ontrack = (event) => {
        log('Remote stream received!');
        const remoteStream = event.streams[0];
        
        // Remove any existing audio elements
        const existingAudio = document.querySelector('#remoteAudio');
        if (existingAudio) {
            existingAudio.remove();
        }
        
        // Create new audio element with comprehensive settings
        const audioEl = document.createElement('audio');
        audioEl.id = 'remoteAudio';
        audioEl.autoplay = true;
        audioEl.playsInline = true; // Important for mobile
        audioEl.controls = false; // Remove for production
        audioEl.volume = 1.0;
        audioEl.muted = isSpeakerMuted;
        
        // Set the stream
        audioEl.srcObject = remoteStream;
        
        // Add event listeners for debugging
        audioEl.onloadedmetadata = () => {
            log('Audio metadata loaded');
        };
        
        audioEl.oncanplay = () => {
            log('Audio can play');
            const playPromise = audioEl.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    log('Remote audio started playing successfully');
                }).catch(error => {
                    console.error('Audio play failed:', error);
                    log('Audio blocked by browser - click anywhere to enable');
                });
            }
        };
        
        audioEl.onerror = (e) => {
            console.error('Audio element error:', e);
        };
        
        // Add to DOM
        document.body.appendChild(audioEl);
        
        updateStatus('Connected! You can now talk.');
        log('Audio element created and added to DOM');
        
        // Show connected state on avatars
        showConnectedState();
        
        // Debug info
        setTimeout(() => {
            debugAudioStatus();
        }, 1000);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate && peerId && ws) {
            log('Sending ICE candidate...');
            ws.send(JSON.stringify({ 
                type: 'signal', 
                to: peerId, 
                data: { candidate: event.candidate } 
            }));
        }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
        log(`Connection state: ${pc.connectionState}`);
        
        if (pc.connectionState === 'connected') {
            updateStatus('Connected! You can now talk.');
            showConnectedState();
        } else if (pc.connectionState === 'disconnected') {
            updateStatus('Call disconnected');
            showDisconnectedState();
        } else if (pc.connectionState === 'failed') {
            log('Connection failed, attempting to restart...');
            showError('Connection failed. Please try again.');
            endCall();
        }
    };

    // Monitor ICE connection state
    pc.oniceconnectionstatechange = () => {
        log(`ICE connection state: ${pc.iceConnectionState}`);
    };

    log('Peer connection prepared successfully');
}

// Enhanced audio debugging function
function debugAudioStatus() {
    const remoteAudio = document.querySelector('#remoteAudio');
    if (remoteAudio) {
        console.log('=== Remote Audio Debug ===');
        console.log('- Element exists:', !!remoteAudio);
        console.log('- Source object:', !!remoteAudio.srcObject);
        console.log('- Volume:', remoteAudio.volume);
        console.log('- Muted:', remoteAudio.muted);
        console.log('- Paused:', remoteAudio.paused);
        console.log('- Ready state:', remoteAudio.readyState);
        console.log('- Current time:', remoteAudio.currentTime);
        
        // Check if stream has audio tracks
        if (remoteAudio.srcObject) {
            const audioTracks = remoteAudio.srcObject.getAudioTracks();
            console.log('- Audio tracks count:', audioTracks.length);
            audioTracks.forEach((track, index) => {
                console.log(`  Track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
            });
        }
        console.log('========================');
    } else {
        console.log('❌ No remote audio element found');
    }
}

// Function to handle autoplay restrictions
function enableAudioPlayback() {
    const remoteAudio = document.querySelector('#remoteAudio');
    if (remoteAudio && remoteAudio.paused) {
        remoteAudio.play().then(() => {
            log('Audio playback enabled after user interaction');
        }).catch(error => {
            console.error('Failed to enable audio playback:', error);
        });
    }
}

// Control button functionality
function setupControls() {
    // Get all control buttons
    const controlButtons = document.querySelectorAll('.vc-btn');
    
    if (controlButtons.length >= 3) {
        // Mute microphone (first button)
        controlButtons[0].addEventListener('click', toggleMicrophone);
        
        // Mute speaker (second button)
        controlButtons[1].addEventListener('click', toggleSpeaker);
        
        // Question/Help button (third button)
        controlButtons[2].addEventListener('click', showHelp);
    }
    
    // End call button
    const endBtn = document.querySelector('.end-call');
    if (endBtn) {
        endBtn.addEventListener('click', handleEndCall);
    }
}

function toggleMicrophone() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isMuted = !audioTrack.enabled;
            log(`Microphone ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
            
            // Update button appearance
            const muteBtn = document.querySelector('.vc-btn:nth-child(1)');
            if (muteBtn) {
                muteBtn.classList.toggle('muted', isMuted);
                muteBtn.style.opacity = isMuted ? '0.5' : '1';
                muteBtn.style.backgroundColor = isMuted ? '#ff4444' : '';
            }
        }
    }
}

function toggleSpeaker() {
    const remoteAudio = document.querySelector('#remoteAudio');
    if (remoteAudio) {
        isSpeakerMuted = !isSpeakerMuted;
        remoteAudio.muted = isSpeakerMuted;
        
        // Also adjust volume as backup
        remoteAudio.volume = isSpeakerMuted ? 0 : 1.0;
        
        log(`Speaker ${isSpeakerMuted ? 'muted' : 'unmuted'}`);
        
        // Update button appearance
        const speakerBtn = document.querySelector('.vc-btn:nth-child(2)');
        if (speakerBtn) {
            speakerBtn.classList.toggle('muted', isSpeakerMuted);
            speakerBtn.style.opacity = isSpeakerMuted ? '0.5' : '1';
            speakerBtn.style.backgroundColor = isSpeakerMuted ? '#ff4444' : '';
        }
        
        // Debug current state
        setTimeout(debugAudioStatus, 100);
    } else {
        log('❌ No remote audio element found');
        alert('No audio connection found. Please wait for connection to establish.');
    }
}

function showHelp() {
    alert('Voice Chat Help:\n\n• First button: Mute/Unmute your microphone\n• Second button: Mute/Unmute the other person\n• Third button: This help message\n• Red button: End the call\n\nYour conversation is anonymous and private.\n\nTrouble hearing? Try clicking the speaker button twice.');
}

function handleEndCall() {
    if (confirm('Are you sure you want to end the call?')) {
        if(ws && peerId) {
            ws.send(JSON.stringify({type: 'end'}));
        }
        endCall();
    }
}

function endCall() {
    log('Ending call...');
    
    if(pc) {
        pc.close(); 
        pc = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }

    // Remove remote audio element
    const remoteAudio = document.querySelector('#remoteAudio');
    if (remoteAudio) {
        remoteAudio.remove();
    }

    peerId = null;
    pendingCandidates = [];
    
    if (ws) {
        ws.close();
        ws = null;
    }
    
    updateStatus('Call ended');
    showDisconnectedState();
    
    log('Call ended successfully');
    
    // Redirect back to anonymous page after a short delay
    setTimeout(() => {
        window.location.href = 'anonymous.html';
    }, 2000);
}

// UI Helper Functions
function updateStatus(message) {
    console.log('Status:', message);
    // If you add a status element to your HTML, uncomment the line below
    // const statusEl = document.getElementById('status');
    // if (statusEl) statusEl.textContent = message;
}

function showConnectedState() {
    const avatars = document.querySelectorAll('.vc-avatar-box');
    avatars.forEach(avatar => {
        avatar.classList.add('connected');
        avatar.style.borderColor = '#4CAF50';
        avatar.style.boxShadow = '0 0 20px rgba(76, 175, 80, 0.5)';
    });
}

function showDisconnectedState() {
    const avatars = document.querySelectorAll('.vc-avatar-box');
    avatars.forEach(avatar => {
        avatar.classList.remove('connected');
        avatar.style.borderColor = '#ccc';
        avatar.style.boxShadow = 'none';
    });
}

function showError(message) {
    console.error('Error:', message);
    // Optional: Show error in UI
    updateStatus(message);
}

function log(message) {
    console.log(`[VoiceChat] ${new Date().toISOString()}: ${message}`);
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.send(JSON.stringify({type: 'end'}));
    }
    endCall();
});

// Handle visibility change (tab switching)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        log('Page hidden - maintaining connection');
    } else {
        log('Page visible - connection active');
        // Try to resume audio if needed
        enableAudioPlayback();
    }
});

// Add global click handler to ensure audio can play
document.addEventListener('click', () => {
    const remoteAudio = document.querySelector('#remoteAudio');
    if (remoteAudio && remoteAudio.paused) {
        remoteAudio.play().catch(console.error);
    }
}, { once: true });
