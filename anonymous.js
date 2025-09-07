document.addEventListener("DOMContentLoaded", () => {
  const reasonSelect = document.getElementById("reason");
  const chatBox = document.getElementById("chatBox");
  const chatMessages = document.getElementById("chatMessages");
  const sendBtn = document.getElementById("sendBtn");
  const chatInput = document.getElementById("chatInput");

  // Jab user reason select kare
  reasonSelect.addEventListener("change", () => {
    chatBox.style.display = "flex"; // Chat box open ho jaye

    // Clear old messages
    chatMessages.innerHTML = "";

    // Welcome message
    const welcome = document.createElement("div");
    welcome.classList.add("message", "bot");
    welcome.textContent = "👋 Welcome! You're chatting anonymously. Feel free to share your thoughts.";
    chatMessages.appendChild(welcome);

    // Show confirmation instead of reason
    const confirm = document.createElement("div");
    confirm.classList.add("message", "bot");
    confirm.textContent = "✅ Got it!";
    chatMessages.appendChild(confirm);

    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.focus();
  });

  // Message bhejne ka function
  sendBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  function sendMessage() {
    const userMsg = chatInput.value.trim();
    if (userMsg !== "") {
      const msgEl = document.createElement("div");
      msgEl.classList.add("message", "user");
      msgEl.textContent = userMsg;
      chatMessages.appendChild(msgEl);

      chatInput.value = "";
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }
});
