document.addEventListener("DOMContentLoaded", () => {
    const reasonSelect = document.getElementById("reason");
    const chatOption = document.getElementById("chatOption");
    const chatBox = document.getElementById("chatBox");
    const chatMessages = document.getElementById("chatMessages");
    const sendBtn = document.getElementById("sendBtn");
    const chatInput = document.getElementById("chatInput");

    // READ STORED ROLE FROM LOGIN - THIS IS THE KEY FIX
    const userRole = localStorage.getItem('role') || 'user';
    console.log('User role from localStorage:', userRole);

    // WebSocket connection variables
    let ws = null;
    let isConnected = false;
    let peerId = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    
    // WebSocket URL
    const wsUrl = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/api/chat';

    // Start chat when button is clicked
    chatOption.addEventListener("click", startChat);

    // Message sending functionality
    sendBtn.addEventListener("click", sendMessage);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    function startChat() {
        const reason = reasonSelect.value || "General chat";
        const language = document.getElementById("language").value || "en";
        
        // Show chat box
        chatBox.style.display = "flex";
        
        // Clear old messages
        chatMessages.innerHTML = "";
        
        // Show welcome message
        addMessage("👋 Welcome! Connecting you to someone anonymously...", "bot");
        
        // Connect to WebSocket
        connectToChat(language, reason);
        
        // Focus on input
        chatInput.focus();
    }

    function connectToChat(language, reason) {
        try {
            console.log('Attempting to connect to:', wsUrl);
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('Connected to chat server');
                isConnected = true;
                reconnectAttempts = 0;
                
                // JOIN WITH STORED ROLE - FIXED
                const joinMessage = {
                    type: 'join',
                    role: userRole, // Use the stored role instead of hardcoded 'user'
                    language: language,
                    reason: reason,
                    chatType: 'text'
                };
                
                console.log('Sending join message:', joinMessage);
                ws.send(JSON.stringify(joinMessage));
                
                addMessage("🔍 Looking for someone to chat with...", "bot");
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    console.log('Received message:', message);
                    handleWebSocketMessage(message);
                } catch (error) {
                    console.error('Error parsing received message:', error);
                }
            };

            ws.onclose = () => {
                console.log('Chat connection closed');
                isConnected = false;
                
                if (reconnectAttempts < maxReconnectAttempts) {
                    addMessage("🔄 Connection lost. Attempting to reconnect...", "bot");
                    reconnectAttempts++;
                    setTimeout(() => connectToChat(language, reason), 2000);
                } else {
                    addMessage("❌ Connection lost. Please refresh to reconnect.", "bot");
                }
            };

            ws.onerror = (error) => {
                console.error('Chat connection error:', error);
                addMessage("❌ Connection failed. Please try again.", "bot");
            };

        } catch (error) {
            console.error('Failed to connect to chat:', error);
            addMessage("❌ Failed to connect. Please try again.", "bot");
        }
    }

    function handleWebSocketMessage(message) {
        switch (message.type) {
            case 'waiting':
                addMessage("⏳ Waiting for someone to join...", "bot");
                break;
                
            case 'matched':
                peerId = message.peerId;
                console.log('Matched with peer:', peerId);
                addMessage("✅ Connected! You can now chat anonymously.", "bot");
                addMessage("💡 Remember: Be kind and respectful.", "bot");
                break;
                
            case 'message':
                addMessage(message.content, "other");
                break;
                
            case 'peer_disconnected':
                addMessage("👋 The other person has left the chat.", "bot");
                addMessage("🔄 Looking for someone new...", "bot");
                peerId = null;
                break;
                
            case 'error':
                addMessage(`❌ Error: ${message.message}`, "bot");
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    }

    function sendMessage() {
        const userMsg = chatInput.value.trim();
        
        if (userMsg === "") return;
        
        if (isConnected && peerId) {
            // Add message to chat UI
            addMessage(userMsg, "user");
            
            // Send to peer via WebSocket
            const messageData = {
                type: 'message',
                to: peerId,
                content: userMsg
            };
            
            console.log('Sending message:', messageData);
            ws.send(JSON.stringify(messageData));
            
            chatInput.value = "";
        } else {
            addMessage("⚠️ Not connected to anyone yet. Please wait...", "bot");
            chatInput.value = "";
        }
    }

    function addMessage(text, sender) {
        const msgEl = document.createElement("div");
        msgEl.classList.add("message", sender);
        msgEl.textContent = text;
        chatMessages.appendChild(msgEl);
        
        // Auto-scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Handle page close/refresh
    window.addEventListener('beforeunload', () => {
        if (ws && isConnected) {
            ws.send(JSON.stringify({type: 'end'}));
            ws.close();
        }
    });
});
