// DOM Elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const dashboard = document.getElementById('dashboard');
const messageDiv = document.getElementById('message');

const showRegisterBtn = document.getElementById('showRegister');
const showLoginBtn = document.getElementById('showLogin');
const logoutBtn = document.getElementById('logout-btn');

const loginFormElement = document.getElementById('login-form');
const registerFormElement = document.getElementById('register-form');

const registerBtn = document.getElementById('register-btn');
const loginBtn = document.getElementById('login-btn');

// API Base URL
const API_URL = '/api/auth';

// Show/Hide Forms
showRegisterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
});

showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

// Show Message
function showMessage(message, type = 'success') {
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.add('show');
    
    setTimeout(() => {
        messageDiv.classList.remove('show');
    }, 4000);
}

// Login Form Handler - UPDATED WITH ROLE STORAGE
loginFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const loginData = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        const data = await response.json();

        if (response.ok) {
            // STORE ROLE AND TOKEN - THIS IS THE KEY FIX
            localStorage.setItem('token', data.token);
            localStorage.setItem('helperToken', data.token); // For voice chat auth
            localStorage.setItem('user', JSON.stringify(data.user));
            
            // STORE USER ROLE - CRUCIAL FOR VOICE CHAT MATCHING
            localStorage.setItem('role', data.user.role || 'helper'); // Default to helper for logged-in users
            
            console.log('Login successful, stored role:', data.user.role || 'helper');
            
            showDashboard(data.user);
            showMessage('Login successful! Redirecting...', 'success');

            setTimeout(() => {
                window.location.href = 'anonymous.html';
            }, 1000);
        } else {
            showMessage(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showMessage('Network error. Please try again.', 'error');
    }
});

// Register Form Handler
registerFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const registerData = {
        name: formData.get('name'),
        age: parseInt(formData.get('age')),
        email: formData.get('email'),
        password: formData.get('password')
    };

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registerData)
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Registration successful! Please login with your credentials.', 'success');
            
            registerFormElement.reset();
            
            setTimeout(() => {
                registerForm.classList.add('hidden');
                loginForm.classList.remove('hidden');
                showMessage('Please login with your new account', 'success');
            }, 1000);
            
        } else {
            showMessage(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showMessage('Network error. Please try again.', 'error');
    }
});

// Show Dashboard
function showDashboard(user) {
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    dashboard.classList.remove('hidden');
    
    document.getElementById('user-info').innerHTML = `
        <p><strong>Name:</strong> ${user.name}</p>
        <p><strong>User ID:</strong> ${user.customId}</p>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Age:</strong> ${user.age}</p>
        <p><strong>Reputation:</strong> ${user.reputation}</p>
        <p><strong>Role:</strong> ${user.role || 'helper'}</p>
    `;
}

// Logout Handler
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('helperToken');
    localStorage.removeItem('user');
    localStorage.removeItem('role'); // Clear stored role
    dashboard.classList.add('hidden');
    loginForm.classList.remove('hidden');
    showMessage('Logged out successfully!', 'success');
});

// Check if user is already logged in
window.addEventListener('load', () => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
        try {
            const userData = JSON.parse(user);
            
            // Ensure role is set for existing users
            if (!localStorage.getItem('role')) {
                localStorage.setItem('role', userData.role || 'helper');
            }
            
            showDashboard(userData);
        } catch (error) {
            console.error('Error parsing user data:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('helperToken');
            localStorage.removeItem('user');
            localStorage.removeItem('role');
        }
    }
});
