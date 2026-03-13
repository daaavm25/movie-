const API = "http://localhost:8000";

const STORAGE_KEYS = {
	authToken: "movieplus:token",
	userId: "movieplus:userId",
	username: "movieplus:username",
	logged: "movieplus:logged"
};

const state = {
	isLampOn: false,
	logged: false,
	token: null,
	username: null,
	activeTab: "login"
};

const elements = {
	body: document.body,
	authCard: document.getElementById("authCard"),
	authTitle: document.getElementById("authTitle"),
	authHint: document.getElementById("authHint"),
	sessionLabel: document.getElementById("sessionLabel"),
	authError: document.getElementById("authError"),
	lampToggleBtn: document.getElementById("lampToggleBtn"),
	authSwitch: document.getElementById("authSwitch"),
	switchLoginBtn: document.getElementById("switchLoginBtn"),
	switchRegisterBtn: document.getElementById("switchRegisterBtn"),
	loginForm: document.getElementById("loginForm"),
	registerForm: document.getElementById("registerForm"),
	loginUsername: document.getElementById("loginUsername"),
	loginPassword: document.getElementById("loginPassword"),
	registerUsername: document.getElementById("registerUsername"),
	registerEmail: document.getElementById("registerEmail"),
	registerPassword: document.getElementById("registerPassword"),
	loginSubmitBtn: document.getElementById("loginSubmitBtn"),
	registerSubmitBtn: document.getElementById("registerSubmitBtn"),
	loggedPanel: document.getElementById("loggedPanel"),
	loggedText: document.getElementById("loggedText"),
	logoutBtn: document.getElementById("logoutBtn")
};

function init() {
	hydrateSession();
	bindEvents();
	renderAuthView();
}

function bindEvents() {
	elements.lampToggleBtn.addEventListener("click", toggleLamp);
	elements.switchLoginBtn.addEventListener("click", () => setActiveTab("login"));
	elements.switchRegisterBtn.addEventListener("click", () => setActiveTab("register"));
	elements.loginForm.addEventListener("submit", handleLogin);
	elements.registerForm.addEventListener("submit", handleRegister);
	elements.logoutBtn.addEventListener("click", handleLogout);
}

function hydrateSession() {
	state.token = localStorage.getItem(STORAGE_KEYS.authToken) || null;
	state.username = localStorage.getItem(STORAGE_KEYS.username) || null;
	state.logged = Boolean(state.token);
	state.isLampOn = state.logged;
}

function setLampState(isOn) {
	state.isLampOn = Boolean(isOn);
	elements.body.setAttribute("data-on", state.isLampOn ? "1" : "0");
	elements.authCard.classList.toggle("is-visible", state.isLampOn);
}

function toggleLamp() {
	elements.lampToggleBtn.classList.remove("is-pulling");
	void elements.lampToggleBtn.offsetWidth;
	elements.lampToggleBtn.classList.add("is-pulling");

	setLampState(!state.isLampOn);

	if (!state.isLampOn) {
		hideError();
	}
}

function setActiveTab(tab) {
	state.activeTab = tab === "register" ? "register" : "login";

	elements.authSwitch.classList.toggle("is-register", state.activeTab === "register");
	elements.switchLoginBtn.classList.toggle("is-active", state.activeTab === "login");
	elements.switchRegisterBtn.classList.toggle("is-active", state.activeTab === "register");
	elements.switchLoginBtn.setAttribute("aria-pressed", String(state.activeTab === "login"));
	elements.switchRegisterBtn.setAttribute("aria-pressed", String(state.activeTab === "register"));

	elements.loginForm.hidden = state.activeTab !== "login";
	elements.registerForm.hidden = state.activeTab !== "register";
	elements.loggedPanel.hidden = true;
	elements.authTitle.textContent = state.activeTab === "login" ? "Welcome" : "Create Account";
	elements.authHint.textContent = "Enciende la lampara para mostrar el formulario.";
	hideError();
}

function renderAuthView() {
	elements.sessionLabel.textContent = state.logged
		? `Sesion activa: ${state.username || "usuario"}`
		: "Sesion cerrada";

	setLampState(state.isLampOn);

	if (state.logged) {
		elements.authSwitch.hidden = true;
		elements.loginForm.hidden = true;
		elements.registerForm.hidden = true;
		elements.loggedPanel.hidden = false;
		elements.loggedText.textContent = `Bienvenido, ${state.username || "usuario"}.`;
		elements.authTitle.textContent = "Welcome Back";
		elements.authHint.textContent = "Tu sesion ya esta activa.";
		return;
	}

	elements.authSwitch.hidden = false;
	elements.loggedPanel.hidden = true;
	setActiveTab(state.activeTab);
}

function showError(message) {
	elements.authError.hidden = false;
	elements.authError.textContent = message;
}

function hideError() {
	elements.authError.hidden = true;
	elements.authError.textContent = "";
}

function persistSession(token, user) {
	state.token = token;
	state.username = user.username;
	state.logged = true;
	localStorage.setItem(STORAGE_KEYS.authToken, token);
	localStorage.setItem(STORAGE_KEYS.userId, String(user.id));
	localStorage.setItem(STORAGE_KEYS.username, user.username);
	localStorage.setItem(STORAGE_KEYS.logged, "1");
}

function clearSession() {
	state.token = null;
	state.username = null;
	state.logged = false;
	localStorage.removeItem(STORAGE_KEYS.authToken);
	localStorage.removeItem(STORAGE_KEYS.userId);
	localStorage.removeItem(STORAGE_KEYS.username);
	localStorage.removeItem(STORAGE_KEYS.logged);
}

async function handleLogin(event) {
	event.preventDefault();
	if (!state.isLampOn) {
		showError("Primero enciende la lampara.");
		return;
	}

	const username = elements.loginUsername.value.trim();
	const password = elements.loginPassword.value;

	hideError();
	elements.loginSubmitBtn.disabled = true;
	elements.loginSubmitBtn.textContent = "Entrando...";

	try {
		const response = await fetch(`${API}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password })
		});
		const payload = await safeJson(response);

		if (!response.ok) {
			throw new Error(payload?.error || "No se pudo iniciar sesion.");
		}

		persistSession(payload.token, payload.user);
		renderAuthView();
		window.setTimeout(() => {
			window.location.href = "index.html";
		}, 350);
	} catch (error) {
		showError(error.message || "Error de autenticacion.");
	} finally {
		elements.loginSubmitBtn.disabled = false;
		elements.loginSubmitBtn.textContent = "Sign In";
	}
}

async function handleRegister(event) {
	event.preventDefault();
	if (!state.isLampOn) {
		showError("Primero enciende la lampara.");
		return;
	}

	const username = elements.registerUsername.value.trim();
	const email = elements.registerEmail.value.trim();
	const password = elements.registerPassword.value;

	hideError();
	elements.registerSubmitBtn.disabled = true;
	elements.registerSubmitBtn.textContent = "Creando...";

	try {
		const registerResponse = await fetch(`${API}/auth/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, email, password })
		});
		const registerPayload = await safeJson(registerResponse);

		if (!registerResponse.ok) {
			throw new Error(registerPayload?.error || "No se pudo registrar.");
		}

		const loginResponse = await fetch(`${API}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username, password })
		});
		const loginPayload = await safeJson(loginResponse);

		if (!loginResponse.ok) {
			setActiveTab("login");
			showError("Cuenta creada. Inicia sesion para continuar.");
			return;
		}

		persistSession(loginPayload.token, loginPayload.user);
		renderAuthView();
		window.setTimeout(() => {
			window.location.href = "index.html";
		}, 350);
	} catch (error) {
		showError(error.message || "No se pudo registrar.");
	} finally {
		elements.registerSubmitBtn.disabled = false;
		elements.registerSubmitBtn.textContent = "Create Account";
	}
}

async function handleLogout() {
	try {
		if (state.token) {
			await fetch(`${API}/auth/logout`, {
				method: "POST",
				headers: { "x-auth-token": state.token }
			});
		}
	} catch (_) {
		// ignore logout network failures
	}

	clearSession();
	setLampState(false);
	renderAuthView();
}

async function safeJson(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

init();
