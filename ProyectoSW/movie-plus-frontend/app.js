const API = "http://localhost:8000";
const PLACEHOLDER_IMAGE = "https://placehold.co/500x750/e4edf3/5f7383?text=Sin+imagen";

const STORAGE_KEYS = {
	logged: "movieplus:logged",
	activeView: "movieplus:activeView",
	query: "movieplus:lastQuery",
	theme: "movieplus:theme",
	fontScale: "movieplus:fontScale",
	colorblind: "movieplus:colorblind",
	authToken: "movieplus:token",
	userId: "movieplus:userId",
	username: "movieplus:username"
};

const FONT_SCALE_MIN = 0.9;
const FONT_SCALE_MAX = 1.35;
const FONT_SCALE_STEP = 0.1;

// Genre filter → genre slug for backend
const FILTER_GENRE_MAP = {
	genero_accion: "accion",
	genero_fantasia: "fantasia",
	genero_terror: "terror",
	genero_scifi: "scifi",
	genero_comedia: "comedia",
	genero_drama: "drama",
	genero_animacion: "animacion"
};

// Internal developer-only stream links by TMDB id.
// Add links here so users can watch from the movie card icon.
// Example:
// 603: ["https://cdn.example.com/matrix.mp4", "https://player.example.com/matrix/embed"]
const INTERNAL_STREAM_LINKS = {
};

function registerInternalMovieLinks(movieId, links) {
	const parsedId = Number(movieId);
	if (!Number.isInteger(parsedId) || parsedId <= 0) {
		throw new Error("movieId invalido");
	}

	if (!Array.isArray(links)) {
		throw new Error("links debe ser un arreglo");
	}

	INTERNAL_STREAM_LINKS[parsedId] = links
		.map((entry) => String(entry || "").trim())
		.filter((entry) => entry.length > 0);

	renderSearchResults(state.searchResults);
	renderCollection();
}

window.MoviePlusDev = {
	registerInternalMovieLinks
};

const state = {
	logged: false,
	authToken: null,
	userId: null,
	username: null,
	activeView: "searchView",
	activeFilter: "populares",
	searchQuery: "",
	theme: "light",
	fontScale: 1,
	colorblind: false,
	searchResults: [],
	watchlist: [],
	debounceId: null,
	searchController: null,
	activeSearchId: 0,
	lastFocusBeforeModal: null,
	modalMovie: null,
	savingIds: new Set(),
	removingIds: new Set(),
	providersIntervalId: null,
	providersAbortController: null,
	activeProvidersRequestId: 0,
	carouselMovies: [],
	carouselIndex: 0,
	carouselIntervalId: null
};

const AVAILABLE_VIEWS = ["searchView", "collectionView", "aboutView"];

const elements = {
	loginBtn: document.getElementById("loginBtn"),
	authText: document.getElementById("authText"),
	themeSwitchBtn: document.getElementById("themeSwitchBtn"),
	themeSwitchLabel: document.getElementById("themeSwitchLabel"),
	fontDecreaseBtn: document.getElementById("fontDecreaseBtn"),
	fontIncreaseBtn: document.getElementById("fontIncreaseBtn"),
	fontScaleLabel: document.getElementById("fontScaleLabel"),
	colorblindModeBtn: document.getElementById("colorblindModeBtn"),
	colorblindModeLabel: document.getElementById("colorblindModeLabel"),
	navButtons: Array.from(document.querySelectorAll(".nav-btn")),
	searchView: document.getElementById("searchView"),
	collectionView: document.getElementById("collectionView"),
	aboutView: document.getElementById("aboutView"),
	searchForm: document.getElementById("searchForm"),
	searchInput: document.getElementById("searchInput"),
	searchBtn: document.getElementById("searchBtn"),
	goSearchBtn: document.getElementById("goSearchBtn"),
	refreshCollectionBtn: document.getElementById("refreshCollectionBtn"),
	resultados: document.getElementById("resultados"),
	coleccion: document.getElementById("coleccion"),
	searchStatus: document.getElementById("searchStatus"),
	collectionStatus: document.getElementById("collectionStatus"),
	toastRegion: document.getElementById("toastRegion"),
	movieModal: document.getElementById("movieModal"),
	movieModalContent: document.getElementById("movieModalContent"),
	closeMovieModalBtn: document.getElementById("closeMovieModalBtn"),
	movieModalImage: document.getElementById("movieModalImage"),
	movieModalTag: document.getElementById("movieModalTag"),
	movieModalTitle: document.getElementById("movieModalTitle"),
	movieModalMeta: document.getElementById("movieModalMeta"),
	movieModalDescription: document.getElementById("movieModalDescription"),
	movieModalFavoriteBtn: document.getElementById("movieModalFavoriteBtn"),
	movieModalProvidersStatus: document.getElementById("movieModalProvidersStatus"),
	movieModalProvidersList: document.getElementById("movieModalProvidersList"),
	moviePlayerLinks: document.getElementById("moviePlayerLinks"),
	moviePlayerContainer: document.getElementById("moviePlayerContainer"),
	moviePlayerFrame: document.getElementById("moviePlayerFrame"),
	moviePlayerStatus: document.getElementById("moviePlayerStatus"),
	filterBar: document.getElementById("filterBar"),
	filterChips: Array.from(document.querySelectorAll(".filter-chip")),
	carouselSection: document.getElementById("carouselSection"),
	carouselTrack: document.getElementById("carouselTrack"),
	carouselPrev: document.getElementById("carouselPrev"),
	carouselNext: document.getElementById("carouselNext"),
	carouselRefreshBtn: document.getElementById("carouselRefreshBtn")
};

function init() {
	hydrateState();
	bindEvents();
	renderAuthState();
	applyUserPreferences();
	setActiveView(state.activeView, false);

	elements.searchInput.value = state.searchQuery;
	renderModalFavoriteState();

	if (state.searchQuery.trim().length >= 2) {
		searchMovies(state.searchQuery.trim(), "trigger");
	} else {
		setStatus(elements.searchStatus, "Escribe al menos 2 letras para comenzar.");
		renderEmptyState(elements.resultados, "Todavia no hay resultados.", "Busca una pelicula para verla aqui.");
	}

	loadCollection();
	loadCarousel();
	updateFilterChips();
}

function bindEvents() {
	elements.loginBtn.addEventListener("click", () => {
		window.location.href = "login.html";
	});

	elements.themeSwitchBtn.addEventListener("click", toggleTheme);
	elements.fontIncreaseBtn.addEventListener("click", () => adjustFontScale(FONT_SCALE_STEP));
	elements.fontDecreaseBtn.addEventListener("click", () => adjustFontScale(-FONT_SCALE_STEP));
	elements.colorblindModeBtn.addEventListener("click", toggleColorblindMode);

	elements.navButtons.forEach((button) => {
		button.addEventListener("click", (event) => {
			event.preventDefault();
			const targetView = button.dataset.view;
			setActiveView(targetView);
		});
	});

	elements.searchForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const query = elements.searchInput.value.trim();
		searchMovies(query, "trigger");
	});

	elements.searchInput.addEventListener("input", (event) => {
		const value = event.target.value.trim();
		state.searchQuery = value;
		persistValue(STORAGE_KEYS.query, value);

		if (state.debounceId) {
			clearTimeout(state.debounceId);
		}

		if (value.length === 0) {
			cancelActiveSearch();
			state.searchResults = [];
			renderEmptyState(elements.resultados, "Sin busqueda activa.", "Escribe el nombre de una pelicula para buscar.");
			setStatus(elements.searchStatus, "Escribe al menos 2 letras para buscar.");
			return;
		}

		if (value.length < 2) {
			cancelActiveSearch();
			setStatus(elements.searchStatus, "Necesitas al menos 2 letras para buscar.");
			return;
		}

		state.debounceId = window.setTimeout(() => {
			searchMovies(value, "realtime");
		}, 450);
	});

	elements.refreshCollectionBtn.addEventListener("click", () => {
		loadCollection({ notify: true });
	});

	elements.goSearchBtn.addEventListener("click", () => {
		setActiveView("searchView");
		elements.searchInput.focus();
	});

	elements.closeMovieModalBtn.addEventListener("click", closeMovieModal);
	elements.movieModalFavoriteBtn.addEventListener("click", handleModalFavoriteAction);

	elements.movieModal.addEventListener("click", (event) => {
		if (event.target.dataset.closeModal === "true") {
			closeMovieModal();
		}
	});

	elements.filterChips.forEach((chip) => {
		chip.addEventListener("click", () => {
			const filter = chip.dataset.filter;
			setActiveFilter(filter);
		});
	});

	elements.carouselPrev.addEventListener("click", () => shiftCarousel(-1));
	elements.carouselNext.addEventListener("click", () => shiftCarousel(1));
	elements.carouselRefreshBtn.addEventListener("click", loadCarousel);

	window.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			if (!elements.movieModal.hidden) {
				closeMovieModal();
				return;
			}
		}

		if (event.key === "Tab" && !elements.movieModal.hidden) {
			trapModalFocus(event);
		}
	});
}

function hydrateState() {
	state.authToken = localStorage.getItem(STORAGE_KEYS.authToken) || null;
	state.userId = Number(localStorage.getItem(STORAGE_KEYS.userId)) || null;
	state.username = localStorage.getItem(STORAGE_KEYS.username) || null;
	state.logged = Boolean(state.authToken);

	const savedView = localStorage.getItem(STORAGE_KEYS.activeView);
	if (AVAILABLE_VIEWS.includes(savedView)) {
		state.activeView = savedView;
	}

	const savedQuery = localStorage.getItem(STORAGE_KEYS.query);
	if (typeof savedQuery === "string") {
		state.searchQuery = savedQuery;
	}

	const savedTheme = localStorage.getItem(STORAGE_KEYS.theme);
	if (savedTheme === "light" || savedTheme === "dark") {
		state.theme = savedTheme;
	}

	const savedFontScale = Number(localStorage.getItem(STORAGE_KEYS.fontScale));
	if (Number.isFinite(savedFontScale)) {
		state.fontScale = clampNumber(savedFontScale, FONT_SCALE_MIN, FONT_SCALE_MAX);
	}

	state.colorblind = localStorage.getItem(STORAGE_KEYS.colorblind) === "1";
}

function persistValue(key, value) {
	localStorage.setItem(key, value);
}

function clampNumber(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function setTheme(theme) {
	if (theme !== "light" && theme !== "dark") {
		return;
	}

	state.theme = theme;
	persistValue(STORAGE_KEYS.theme, theme);
	applyUserPreferences();
}

function toggleTheme() {
	setTheme(state.theme === "light" ? "dark" : "light");
}

function adjustFontScale(delta) {
	const nextScale = clampNumber(
		Number((state.fontScale + delta).toFixed(2)),
		FONT_SCALE_MIN,
		FONT_SCALE_MAX
	);

	if (nextScale === state.fontScale) {
		return;
	}

	state.fontScale = nextScale;
	persistValue(STORAGE_KEYS.fontScale, String(state.fontScale));
	applyUserPreferences();
}

function toggleColorblindMode() {
	state.colorblind = !state.colorblind;
	persistValue(STORAGE_KEYS.colorblind, state.colorblind ? "1" : "0");
	applyUserPreferences();

	if (state.colorblind) {
		showToast("Vista daltonismo activada.", "info");
		return;
	}

	showToast("Vista daltonismo desactivada.", "info");
}

function applyUserPreferences() {
	document.body.setAttribute("data-theme", state.theme);
	document.body.setAttribute("data-vision", state.colorblind ? "colorblind" : "default");
	document.documentElement.style.setProperty("--font-scale", String(state.fontScale));
	renderPreferenceControls();
}

function renderPreferenceControls() {
	const isDarkTheme = state.theme === "dark";

	elements.themeSwitchBtn.classList.toggle("is-dark", isDarkTheme);
	elements.themeSwitchBtn.setAttribute("aria-checked", String(isDarkTheme));
	elements.themeSwitchLabel.textContent = isDarkTheme ? "Modo oscuro activo" : "Modo claro activo";

	elements.fontScaleLabel.textContent = `${Math.round(state.fontScale * 100)}%`;
	elements.fontDecreaseBtn.disabled = state.fontScale <= FONT_SCALE_MIN + 0.001;
	elements.fontIncreaseBtn.disabled = state.fontScale >= FONT_SCALE_MAX - 0.001;

	elements.colorblindModeBtn.classList.toggle("is-active", state.colorblind);
	elements.colorblindModeBtn.setAttribute("aria-pressed", String(state.colorblind));
	elements.colorblindModeLabel.textContent = state.colorblind
		? "Vista daltonismo activa"
		: "Vista daltonismo";
}

// ===================== AUTH =====================
function renderAuthState() {
	elements.loginBtn.classList.toggle("lamp-on", state.logged);
	elements.loginBtn.classList.toggle("lamp-off", !state.logged);
	elements.loginBtn.textContent = state.logged ? "🔓" : "💡";
	elements.loginBtn.title = state.logged ? "Gestionar sesion" : "Iniciar o registrarse";
	elements.authText.textContent = state.logged
		? `Hola, ${state.username || "usuario"}`
		: "Sesion cerrada";
}

// ===================== FILTER & CAROUSEL =====================
function setActiveFilter(filter) {
	state.activeFilter = filter;
	updateFilterChips();
	loadCarousel();
}

function updateFilterChips() {
	elements.filterChips.forEach((chip) => {
		chip.classList.toggle("is-active", chip.dataset.filter === state.activeFilter);
	});
}

async function loadCarousel() {
	elements.carouselTrack.innerHTML = "";
	const skeletonCount = 8;
	for (let i = 0; i < skeletonCount; i++) {
		const s = document.createElement("div");
		s.className = "card-skeleton carousel-card";
		s.setAttribute("aria-hidden", "true");
		elements.carouselTrack.appendChild(s);
	}

	try {
		let endpoint = `${API}/peliculas/populares`;
		const filter = state.activeFilter;

		if (filter === "menos_populares") {
			endpoint = `${API}/peliculas/genero/accion?sort=menos_populares`;
		} else if (filter && filter.startsWith("genero_")) {
			const genre = FILTER_GENRE_MAP[filter];
			if (genre) {
				endpoint = `${API}/peliculas/genero/${genre}`;
			}
		}

		const response = await fetch(endpoint);
		const payload = await safeJson(response);

		if (!response.ok) {
			throw new Error(payload?.error || "No se pudieron cargar peliculas.");
		}

		const movies = Array.isArray(payload?.results) ? payload.results : [];
		// Shuffle for variety
		const shuffled = [...movies].sort(() => Math.random() - 0.5);
		state.carouselMovies = shuffled.map(normalizeMovie).filter(m => m.id && m.titulo);
		renderCarousel();
	} catch (_) {
		elements.carouselTrack.innerHTML = "";
	}
}

function renderCarousel() {
	elements.carouselTrack.innerHTML = "";
	const fragment = document.createDocumentFragment();

	state.carouselMovies.forEach((movie) => {
		const card = document.createElement("div");
		card.className = "carousel-card";
		card.setAttribute("role", "button");
		card.setAttribute("tabindex", "0");
		card.setAttribute("aria-label", `Ver detalle de ${movie.titulo}`);

		const img = document.createElement("img");
		img.src = movie.imagen || PLACEHOLDER_IMAGE;
		img.alt = `Poster de ${movie.titulo}`;
		img.loading = "lazy";
		img.onerror = () => { img.src = PLACEHOLDER_IMAGE; };

		const label = document.createElement("div");
		label.className = "carousel-card__label";
		label.textContent = movie.titulo;

		card.append(img, label);
		card.addEventListener("click", () => openMovieModal(movie, "Carrusel"));
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openMovieModal(movie, "Carrusel");
			}
		});

		fragment.appendChild(card);
	});

	elements.carouselTrack.appendChild(fragment);
}

function shiftCarousel(direction) {
	const cardWidth = 132; // 120px width + 12px gap
	elements.carouselTrack.scrollBy({ left: direction * cardWidth * 3, behavior: "smooth" });
}

// ===================== PLAYER =====================
function getInternalLinksForMovie(movie) {
	const movieId = Number(movie?.id || movie?.external_id || 0);
	const rawLinks = INTERNAL_STREAM_LINKS[movieId];

	if (!Array.isArray(rawLinks)) {
		return [];
	}

	return rawLinks
		.map((entry) => String(entry || "").trim())
		.filter((entry) => entry.length > 0);
}

function loadPlayerUrl(rawUrl) {
	const raw = String(rawUrl || "").trim();

	if (!raw) {
		elements.moviePlayerContainer.hidden = true;
		elements.moviePlayerFrame.src = "";
		elements.moviePlayerStatus.textContent = "Reproduccion no disponible por el momento.";
		return;
	}

	let url;
	try {
		url = new URL(raw);
	} catch (_) {
		elements.moviePlayerStatus.textContent = "Enlace interno invalido.";
		return;
	}

	if (url.protocol !== "https:" && url.protocol !== "http:") {
		elements.moviePlayerStatus.textContent = "Solo se permiten enlaces https:// o http://";
		return;
	}

	elements.moviePlayerFrame.src = url.href;
	elements.moviePlayerContainer.hidden = false;
	elements.moviePlayerStatus.textContent = `Reproduciendo desde ${url.hostname}`;
}

function renderMoviePlayerLinks(movie, preferredUrl = "") {
	const links = getInternalLinksForMovie(movie);
	elements.moviePlayerLinks.innerHTML = "";

	if (!links.length) {
		elements.moviePlayerLinks.hidden = true;
		elements.moviePlayerStatus.textContent = "Reproduccion no disponible por el momento.";
		elements.moviePlayerContainer.hidden = true;
		elements.moviePlayerFrame.src = "";
		return;
	}

	elements.moviePlayerLinks.hidden = false;

	links.forEach((link, index) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "movie-link-pill";
		button.innerHTML = `<span aria-hidden="true">▶</span> Ver pelicula ${index + 1}`;
		button.addEventListener("click", () => {
			loadPlayerUrl(link);
		});
		elements.moviePlayerLinks.appendChild(button);
	});

	loadPlayerUrl(preferredUrl || links[0]);
}

function setActiveView(viewId, persist = true) {
	const target = AVAILABLE_VIEWS.includes(viewId) ? viewId : "searchView";
	state.activeView = target;

	if (persist) {
		persistValue(STORAGE_KEYS.activeView, target);
	}

	const viewElements = [elements.searchView, elements.collectionView, elements.aboutView];
	viewElements.forEach((viewElement) => {
		const isVisible = viewElement.id === target;
		viewElement.hidden = !isVisible;
		viewElement.classList.toggle("is-visible", isVisible);
	});

	elements.navButtons.forEach((button) => {
		const isActive = button.dataset.view === target;
		button.classList.toggle("is-active", isActive);
		button.setAttribute("aria-current", isActive ? "page" : "false");
	});

	if (target === "collectionView") {
		loadCollection();
	}
}

async function searchMovies(query, mode) {
	if (!query || query.length < 2) {
		setStatus(elements.searchStatus, "Escribe al menos 2 letras para buscar.", "error");
		return;
	}

	if (state.searchController) {
		state.searchController.abort();
	}

	state.searchController = new AbortController();
	state.activeSearchId += 1;
	const requestId = state.activeSearchId;

	setStatus(
		elements.searchStatus,
		mode === "realtime" ? "Buscando en tiempo real..." : "Buscando peliculas...",
		"loading"
	);
	setLoadingState(elements.resultados, true);
	renderSkeleton(elements.resultados, 6);

	try {
		const endpoint = `${API}/peliculas?query=${encodeURIComponent(query)}&limit=12`;
		const response = await fetch(endpoint, {
			signal: state.searchController.signal
		});
		const payload = await safeJson(response);

		if (requestId !== state.activeSearchId) {
			return;
		}

		if (!response.ok) {
			throw new Error(payload?.error || "No se pudo completar la busqueda.");
		}

		const movies = Array.isArray(payload?.results) ? payload.results : [];
		state.searchResults = movies.map(normalizeMovie).filter((movie) => movie.id && movie.titulo);
		renderSearchResults(state.searchResults);

		if (state.searchResults.length === 0) {
			setStatus(elements.searchStatus, `No resultados para "${query}".`);
		} else {
			setStatus(elements.searchStatus, `${state.searchResults.length} resultados para "${query}".`, "success");
		}
	} catch (error) {
		if (error.name === "AbortError") {
			return;
		}

		state.searchResults = [];
		renderEmptyState(
			elements.resultados,
			"No fue posible cargar resultados.",
			"Verifica tu conexion e intenta nuevamente."
		);
		setStatus(elements.searchStatus, error.message || "Error inesperado en la busqueda.", "error");
		showToast(error.message || "Error de busqueda", "error");
	} finally {
		if (requestId === state.activeSearchId) {
			setLoadingState(elements.resultados, false);
			state.searchController = null;
		}
	}
}

function renderSearchResults(movies) {
	elements.resultados.innerHTML = "";

	if (!movies.length) {
		renderEmptyState(elements.resultados, "No resultados.", "Prueba con otro titulo o una palabra mas corta.");
		return;
	}

	const fragment = document.createDocumentFragment();

	movies.forEach((movie, index) => {
		const card = document.createElement("article");
		card.className = "card";
		card.style.animationDelay = `${Math.min(index * 30, 220)}ms`;

		const image = document.createElement("img");
		image.src = movie.imagen || PLACEHOLDER_IMAGE;
		image.alt = `Poster de ${movie.titulo}`;
		image.loading = "lazy";
		image.decoding = "async";
		image.addEventListener("error", () => {
			image.src = PLACEHOLDER_IMAGE;
		});

		const posterBtn = document.createElement("button");
		posterBtn.type = "button";
		posterBtn.className = "poster-btn";
		posterBtn.setAttribute("aria-label", `Abrir detalle de ${movie.titulo}`);
		posterBtn.appendChild(image);
		posterBtn.addEventListener("click", () => {
			openMovieModal(movie, "Resultado de busqueda");
		});

		const details = document.createElement("p");
		details.className = "card-summary";
		details.textContent = String(movie.descripcion || "Sin descripcion disponible para esta pelicula.");

		const actions = document.createElement("div");
		actions.className = "card-actions";

		const internalLinks = getInternalLinksForMovie(movie);
		if (internalLinks.length) {
			const watchBtn = document.createElement("button");
			watchBtn.type = "button";
			watchBtn.className = "watch-icon-btn";
			watchBtn.innerHTML = '<span aria-hidden="true">▶</span> Ver pelicula';
			watchBtn.setAttribute("aria-label", `Ver pelicula ${movie.titulo}`);
			watchBtn.addEventListener("click", () => {
				openMovieModal(movie, "Reproduccion interna", { autoplayUrl: internalLinks[0] });
			});
			actions.appendChild(watchBtn);
		}

		card.append(posterBtn, details, actions);
		fragment.appendChild(card);
	});

	elements.resultados.appendChild(fragment);
}

async function saveMovie(movie) {
	if (!state.logged) {
		showToast("Inicia sesion para guardar peliculas.", "info");
		return;
	}

	if (isMovieSaved(movie.id)) {
		showToast("La pelicula ya estaba en tu coleccion.", "info");
		return;
	}

	if (state.savingIds.has(movie.id)) {
		return;
	}

	state.savingIds.add(movie.id);
	renderSearchResults(state.searchResults);
	renderModalFavoriteState();

	try {
		const response = await fetch(`${API}/watchlist`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-auth-token": state.authToken || ""
			},
			body: JSON.stringify({
				id_usuario: state.userId,
				external_id: movie.id,
				titulo: movie.titulo,
				categoria: Array.isArray(movie.categoria) ? movie.categoria.join(",") : String(movie.categoria || "General"),
				imagen: movie.imagen || PLACEHOLDER_IMAGE,
				nota_personal: String(movie.descripcion || "Sin descripcion disponible para esta pelicula.")
			})
		});

		const payload = await safeJson(response);

		if (!response.ok) {
			throw new Error(payload?.message || payload?.error || "No se pudo guardar la pelicula.");
		}

		showToast(`"${movie.titulo}" agregada a tu coleccion.`, "success");
		setStatus(elements.collectionStatus, "Coleccion actualizada.", "success");
		await loadCollection({ silentStatus: true });
	} catch (error) {
		showToast(error.message || "Error al guardar", "error");
	} finally {
		state.savingIds.delete(movie.id);
		renderSearchResults(state.searchResults);
		renderModalFavoriteState();
	}
}

async function loadCollection(options = {}) {
	const { notify = false, silentStatus = false } = options;

	if (!state.logged || !state.userId) {
		state.watchlist = [];
		renderCollection();
		if (!silentStatus) {
			setStatus(elements.collectionStatus, "Inicia sesion para ver tu coleccion.");
		}
		return;
	}

	if (!silentStatus) {
		setStatus(elements.collectionStatus, "Cargando coleccion...", "loading");
	}

	setLoadingState(elements.coleccion, true);
	renderSkeleton(elements.coleccion, 4);

	try {
		const response = await fetch(`${API}/watchlist?id_usuario=${state.userId}`, {
			headers: { "x-auth-token": state.authToken || "" }
		});
		const payload = await safeJson(response);

		if (!response.ok) {
			throw new Error(payload?.error || "No se pudo cargar la coleccion.");
		}

		const items = Array.isArray(payload) ? payload : [];
		state.watchlist = items.map(normalizeWatchlistMovie).filter((movie) => movie.id);
		renderCollection();
		renderSearchResults(state.searchResults);
		renderModalFavoriteState();

		if (!silentStatus) {
			const text = state.watchlist.length
				? `${state.watchlist.length} peliculas en tu coleccion.`
				: "Tu coleccion aun esta vacia.";
			setStatus(elements.collectionStatus, text, state.watchlist.length ? "success" : "");
		}

		if (notify) {
			showToast("Coleccion actualizada.", "info");
		}
	} catch (error) {
		state.watchlist = [];
		renderEmptyState(elements.coleccion, "No se pudo cargar la coleccion.", "Intenta nuevamente en unos segundos.");
		renderModalFavoriteState();
		setStatus(elements.collectionStatus, error.message || "Error al cargar coleccion.", "error");

		if (notify) {
			showToast(error.message || "Error al actualizar coleccion", "error");
		}
	} finally {
		setLoadingState(elements.coleccion, false);
	}
}

function renderCollection() {
	elements.coleccion.innerHTML = "";

	if (!state.watchlist.length) {
		renderEmptyState(
			elements.coleccion,
			"Tu coleccion esta vacia.",
			state.logged ? "Guarda peliculas desde la busqueda para verlas aqui." : "Inicia sesion para gestionar favoritos."
		);
		return;
	}

	const fragment = document.createDocumentFragment();

	state.watchlist.forEach((movie, index) => {
		const isRemoving = state.removingIds.has(movie.id);

		const card = document.createElement("article");
		card.className = "card";
		card.style.animationDelay = `${Math.min(index * 30, 220)}ms`;

		const image = document.createElement("img");
		image.src = movie.imagen || PLACEHOLDER_IMAGE;
		image.alt = `Poster de ${movie.titulo}`;
		image.loading = "lazy";
		image.decoding = "async";
		image.addEventListener("error", () => {
			image.src = PLACEHOLDER_IMAGE;
		});

		const posterBtn = document.createElement("button");
		posterBtn.type = "button";
		posterBtn.className = "poster-btn";
		posterBtn.setAttribute("aria-label", `Abrir detalle de ${movie.titulo}`);
		posterBtn.appendChild(image);
		posterBtn.addEventListener("click", () => {
			openMovieModal(movie, "Pelicula en tu coleccion");
		});

		const details = document.createElement("p");
		details.className = "card-summary";
		details.textContent = String(movie.descripcion || "Sin descripcion disponible para esta pelicula.");

		const actions = document.createElement("div");
		actions.className = "card-actions";

		const internalLinks = getInternalLinksForMovie(movie);
		if (internalLinks.length) {
			const watchBtn = document.createElement("button");
			watchBtn.type = "button";
			watchBtn.className = "watch-icon-btn";
			watchBtn.innerHTML = '<span aria-hidden="true">▶</span> Ver pelicula';
			watchBtn.setAttribute("aria-label", `Ver pelicula ${movie.titulo}`);
			watchBtn.addEventListener("click", () => {
				openMovieModal(movie, "Reproduccion interna", { autoplayUrl: internalLinks[0] });
			});
			actions.appendChild(watchBtn);
		}

		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "remove-btn";
		removeBtn.textContent = isRemoving ? "Eliminando..." : "Eliminar";
		removeBtn.disabled = !state.logged || isRemoving;

		if (!state.logged) {
			removeBtn.title = "Inicia sesion para eliminar favoritos";
		}

		removeBtn.addEventListener("click", () => {
			removeMovie(movie.id);
		});

		actions.appendChild(removeBtn);
		card.append(posterBtn, details, actions);
		fragment.appendChild(card);
	});

	elements.coleccion.appendChild(fragment);
}

async function removeMovie(watchlistId) {
	if (!state.logged) {
		showToast("Inicia sesion para eliminar peliculas.", "info");
		return;
	}

	if (state.removingIds.has(watchlistId)) {
		return;
	}

	state.removingIds.add(watchlistId);
	renderCollection();
	renderModalFavoriteState();

	try {
		const response = await fetch(`${API}/watchlist/${watchlistId}`, {
			method: "DELETE",
			headers: { "x-auth-token": state.authToken || "" }
		});

		const payload = await safeJson(response);

		if (!response.ok) {
			throw new Error(payload?.error || "No se pudo eliminar la pelicula.");
		}

		state.watchlist = state.watchlist.filter((movie) => movie.id !== watchlistId);
		renderCollection();
		renderSearchResults(state.searchResults);
		setStatus(elements.collectionStatus, "Pelicula eliminada de favoritos.", "success");
		showToast("Pelicula eliminada de tu coleccion.", "success");
	} catch (error) {
		setStatus(elements.collectionStatus, error.message || "Error al eliminar pelicula.", "error");
		showToast(error.message || "Error al eliminar", "error");
	} finally {
		state.removingIds.delete(watchlistId);
		renderCollection();
		renderModalFavoriteState();
	}
}

function isMovieSaved(externalId) {
	return state.watchlist.some((movie) => Number(movie.external_id) === Number(externalId));
}

function setStatus(target, text, type = "") {
	const baseText = String(text || "");
	let visibleText = baseText;

	if (state.colorblind) {
		if (type === "loading") {
			visibleText = `[Cargando] ${baseText}`;
		}

		if (type === "error") {
			visibleText = `[Error] ${baseText}`;
		}

		if (type === "success") {
			visibleText = `[OK] ${baseText}`;
		}
	}

	target.textContent = visibleText;
	target.classList.remove("is-loading", "is-error", "is-success");

	if (type === "loading") {
		target.classList.add("is-loading");
	}

	if (type === "error") {
		target.classList.add("is-error");
	}

	if (type === "success") {
		target.classList.add("is-success");
	}
}

function setLoadingState(container, isLoading) {
	container.setAttribute("aria-busy", String(isLoading));
}

function cancelActiveSearch() {
	if (state.searchController) {
		state.searchController.abort();
		state.searchController = null;
	}

	state.activeSearchId += 1;
	setLoadingState(elements.resultados, false);
}

function renderSkeleton(container, count) {
	container.innerHTML = "";

	for (let i = 0; i < count; i += 1) {
		const skeleton = document.createElement("div");
		skeleton.className = "card-skeleton";
		skeleton.setAttribute("aria-hidden", "true");
		container.appendChild(skeleton);
	}
}

function renderEmptyState(container, title, description) {
	container.innerHTML = `
		<div class="empty-state">
			<strong>${title}</strong>
			<p>${description}</p>
		</div>
	`;
}

function normalizeMovie(movie) {
	if (!movie || typeof movie !== "object") {
		return {};
	}

	return {
		id: Number(movie.id || movie.external_id || 0),
		external_id: Number(movie.external_id || movie.id || 0),
		titulo: String(movie.titulo || movie.title || "Sin titulo"),
		categoria: movie.categoria || movie.genre_ids || "General",
		imagen: movie.imagen || movie.poster || PLACEHOLDER_IMAGE,
		fecha: movie.fecha || movie.release_date || "",
		descripcion: movie.descripcion || movie.overview || ""
	};
}

function normalizeWatchlistMovie(movie) {
	if (!movie || typeof movie !== "object") {
		return {};
	}

	const personalNote = String(movie.nota_personal || "").trim();
	const normalizedDescription =
		personalNote && personalNote !== "Guardada desde Movie+"
			? personalNote
			: "Sin descripcion disponible para esta pelicula.";

	return {
		id: Number(movie.id || 0),
		external_id: Number(movie.external_id || 0),
		titulo: String(movie.titulo || "Sin titulo"),
		categoria: movie.categoria || "General",
		imagen: movie.imagen || PLACEHOLDER_IMAGE,
		nota_personal: personalNote,
		descripcion: normalizedDescription,
		fecha: ""
	};
}

function buildModalMovie(movie, sourceLabel) {
	const safeMovie = movie && typeof movie === "object" ? movie : {};
	const tmdbId = Number(safeMovie.external_id || safeMovie.id || 0);

	return {
		id: tmdbId,
		external_id: tmdbId,
		titulo: String(safeMovie.titulo || safeMovie.title || "Sin titulo"),
		categoria: safeMovie.categoria || safeMovie.genre_ids || "General",
		imagen: safeMovie.imagen || safeMovie.poster || PLACEHOLDER_IMAGE,
		fecha: safeMovie.fecha || safeMovie.release_date || "",
		descripcion: safeMovie.descripcion || safeMovie.nota_personal || "",
		sourceLabel: sourceLabel || "Detalle"
	};
}

function openMovieModal(movie, sourceLabel, options = {}) {
	const safeMovie = buildModalMovie(movie, sourceLabel);
	const movieImage = safeMovie.imagen || PLACEHOLDER_IMAGE;
	const movieTitle = safeMovie.titulo || "Sin titulo";
	const movieDescription = safeMovie.descripcion || "Sin informacion disponible.";
	const yearText = safeMovie.fecha ? String(safeMovie.fecha).slice(0, 4) : "Sin fecha";
	const categoryText = formatCategory(safeMovie.categoria);

	elements.movieModalImage.src = movieImage;
	elements.movieModalImage.alt = `Poster ampliado de ${movieTitle}`;
	elements.movieModalImage.onerror = () => {
		elements.movieModalImage.src = PLACEHOLDER_IMAGE;
	};

	elements.movieModalTitle.textContent = movieTitle;
	elements.movieModalTag.textContent = yearText;
	elements.movieModalMeta.textContent = `${categoryText} | ${safeMovie.sourceLabel}`;
	elements.movieModalDescription.textContent = movieDescription;
	state.modalMovie = safeMovie;
	renderModalFavoriteState();
	resetProvidersState();
	resetPlayerState();
	renderMoviePlayerLinks(safeMovie, options.autoplayUrl || "");
	startProvidersRealtimeUpdate();

	state.lastFocusBeforeModal = document.activeElement;
	elements.movieModal.hidden = false;
	document.body.classList.add("modal-open");
	elements.movieModalContent.focus();
}

function closeMovieModal() {
	stopProvidersRealtimeUpdate();
	state.modalMovie = null;
	elements.movieModal.hidden = true;
	document.body.classList.remove("modal-open");

	if (state.lastFocusBeforeModal && typeof state.lastFocusBeforeModal.focus === "function") {
		state.lastFocusBeforeModal.focus();
	}
}

function resetPlayerState() {
	elements.moviePlayerLinks.innerHTML = "";
	elements.moviePlayerLinks.hidden = true;
	elements.moviePlayerFrame.src = "";
	elements.moviePlayerContainer.hidden = true;
	elements.moviePlayerStatus.textContent = "Reproduccion no disponible por el momento.";
}

function resetProvidersState() {
	elements.movieModalProvidersList.innerHTML = "";
	setStatus(elements.movieModalProvidersStatus, "Consultando plataformas disponibles...", "loading");
}

function startProvidersRealtimeUpdate() {
	stopProvidersRealtimeUpdate();

	if (!state.modalMovie || !state.modalMovie.id) {
		setStatus(elements.movieModalProvidersStatus, "No hay id valido para consultar plataformas.", "error");
		return;
	}

	fetchMovieProviders(state.modalMovie.id);

	state.providersIntervalId = window.setInterval(() => {
		if (elements.movieModal.hidden || !state.modalMovie || !state.modalMovie.id) {
			return;
		}

		fetchMovieProviders(state.modalMovie.id, { silent: true });
	}, 60000);
}

function stopProvidersRealtimeUpdate() {
	if (state.providersIntervalId) {
		window.clearInterval(state.providersIntervalId);
		state.providersIntervalId = null;
	}

	if (state.providersAbortController) {
		state.providersAbortController.abort();
		state.providersAbortController = null;
	}

	state.activeProvidersRequestId += 1;
}

async function fetchMovieProviders(movieId, options = {}) {
	const { silent = false } = options;

	if (!silent) {
		setStatus(elements.movieModalProvidersStatus, "Consultando plataformas disponibles...", "loading");
	}

	if (state.providersAbortController) {
		state.providersAbortController.abort();
	}

	state.providersAbortController = new AbortController();
	state.activeProvidersRequestId += 1;
	const requestId = state.activeProvidersRequestId;

	try {
		const response = await fetch(`${API}/peliculas/${movieId}/proveedores?country=MX`, {
			signal: state.providersAbortController.signal
		});
		const payload = await safeJson(response);

		if (requestId !== state.activeProvidersRequestId) {
			return;
		}

		if (!response.ok) {
			throw new Error(payload?.error || "No fue posible consultar plataformas.");
		}

		const providers = Array.isArray(payload?.providers) ? payload.providers : [];
		renderProviders(providers);

		if (!providers.length) {
			setStatus(
				elements.movieModalProvidersStatus,
				"No hay plataformas activas reportadas para esta pelicula en este momento."
			);
			return;
		}

		setStatus(
			elements.movieModalProvidersStatus,
			`${providers.length} plataformas encontradas.`,
			"success"
		);
	} catch (error) {
		if (error.name === "AbortError") {
			return;
		}

		if (requestId !== state.activeProvidersRequestId) {
			return;
		}

		renderProviders([]);
		setStatus(elements.movieModalProvidersStatus, error.message || "Error al consultar plataformas.", "error");
	} finally {
		if (requestId === state.activeProvidersRequestId) {
			state.providersAbortController = null;
		}
	}
}

function renderProviders(providers) {
	elements.movieModalProvidersList.innerHTML = "";

	if (!providers.length) {
		const emptyItem = document.createElement("li");
		emptyItem.className = "provider-chip";
		emptyItem.textContent = "Sin plataformas disponibles";
		elements.movieModalProvidersList.appendChild(emptyItem);
	} else {
		providers.forEach((provider) => {
			const item = document.createElement("li");
			const chip = document.createElement("span");
			chip.className = "provider-chip";
			chip.textContent = provider?.nombre || "Plataforma";
			item.appendChild(chip);
			elements.movieModalProvidersList.appendChild(item);
		});
	}

}

function getSavedMovieByExternalId(externalId) {
	return state.watchlist.find((movie) => Number(movie.external_id) === Number(externalId)) || null;
}

function renderModalFavoriteState() {
	const modalMovie = state.modalMovie;

	if (!modalMovie || !modalMovie.id) {
		elements.movieModalFavoriteBtn.disabled = true;
		elements.movieModalFavoriteBtn.classList.remove("remove");
		elements.movieModalFavoriteBtn.textContent = "Selecciona una pelicula";
		elements.movieModalFavoriteBtn.title = "";
		return;
	}

	const savedMovie = getSavedMovieByExternalId(modalMovie.id);
	const isSaved = Boolean(savedMovie);
	const isSaving = state.savingIds.has(modalMovie.id);
	const isRemoving = savedMovie ? state.removingIds.has(savedMovie.id) : false;

	if (!state.logged) {
		elements.movieModalFavoriteBtn.disabled = true;
		elements.movieModalFavoriteBtn.classList.remove("remove");
		elements.movieModalFavoriteBtn.textContent = "Inicia sesion para favoritos";
		elements.movieModalFavoriteBtn.title = "Debes iniciar sesion para gestionar favoritos";
		return;
	}

	elements.movieModalFavoriteBtn.title = "";
	elements.movieModalFavoriteBtn.disabled = isSaving || isRemoving;

	if (isSaving) {
		elements.movieModalFavoriteBtn.classList.remove("remove");
		elements.movieModalFavoriteBtn.textContent = "Guardando...";
		return;
	}

	if (isRemoving) {
		elements.movieModalFavoriteBtn.classList.add("remove");
		elements.movieModalFavoriteBtn.textContent = "Eliminando...";
		return;
	}

	elements.movieModalFavoriteBtn.classList.toggle("remove", isSaved);
	elements.movieModalFavoriteBtn.textContent = isSaved ? "Quitar de favoritos" : "Agregar a favoritos";
}

async function handleModalFavoriteAction() {
	if (!state.modalMovie || !state.modalMovie.id) {
		return;
	}

	if (!state.logged) {
		showToast("Inicia sesion para gestionar favoritos.", "info");
		return;
	}

	const savedMovie = getSavedMovieByExternalId(state.modalMovie.id);

	if (savedMovie) {
		await removeMovie(savedMovie.id);
		return;
	}

	await saveMovie(state.modalMovie);
}

function getModalFocusableElements() {
	return Array.from(
		elements.movieModalContent.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		)
	).filter((element) => {
		if (element.hasAttribute("disabled")) {
			return false;
		}

		return !element.hasAttribute("hidden");
	});
}

function trapModalFocus(event) {
	const focusable = getModalFocusableElements();

	if (!focusable.length) {
		return;
	}

	const firstElement = focusable[0];
	const lastElement = focusable[focusable.length - 1];

	if (!focusable.includes(document.activeElement)) {
		event.preventDefault();
		firstElement.focus();
		return;
	}

	if (event.shiftKey && document.activeElement === firstElement) {
		event.preventDefault();
		lastElement.focus();
		return;
	}

	if (!event.shiftKey && document.activeElement === lastElement) {
		event.preventDefault();
		firstElement.focus();
	}
}

function formatCategory(category) {
	if (Array.isArray(category)) {
		if (!category.length) {
			return "Sin categoria";
		}

		return `Generos: ${category.join(", ")}`;
	}

	if (typeof category === "string" && category.trim()) {
		return `Categoria: ${category}`;
	}

	return "Sin categoria";
}

function showToast(message, type = "info") {
	const toast = document.createElement("div");
	toast.className = `toast ${type}`;
	toast.textContent = message;
	elements.toastRegion.appendChild(toast);

	window.setTimeout(() => {
		toast.remove();
	}, 2800);
}

async function safeJson(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

init();