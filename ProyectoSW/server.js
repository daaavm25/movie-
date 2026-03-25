const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8000;
const sequelize = require('./config/database');
const Watchlist = require('./models/Watchlist');
const User = require('./models/User');
const Session = require('./models/Session');
const TorrentDownload = require('./models/TorrentDownload');
const TorrentService = require('./services/torrentService');

// Instanciar servicio de torrents
const torrentService = new TorrentService();

// Model associations
User.hasMany(Session, { foreignKey: 'user_id' });
Session.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(TorrentDownload, { foreignKey: 'user_id' });
TorrentDownload.belongsTo(User, { foreignKey: 'user_id' });

// ---------- Auth helpers ----------
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function getSessionUser(req) {
    const token = req.headers['x-auth-token'];
    if (!token) return null;
    const session = await Session.findOne({
        where: { token },
        include: [{ model: User, attributes: ['id', 'username', 'email'] }]
    });
    if (!session) return null;
    if (new Date() > session.expires_at) {
        await session.destroy();
        return null;
    }
    return session.User || null;
}
// ----------------------------------

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_API_KEY = process.env.TMDB_API_KEY || "9115aceaac03a2230e88a6347b2e7209";
const DEFAULT_PROVIDER_COUNTRY = String(process.env.TMDB_PROVIDER_COUNTRY || 'MX').toUpperCase();

app.use(cors());
app.use(express.json());
app.use(express.static('movie-plus-frontend'));

// Health Check
app.get('/', (req, res) => {
    res.json({
        status: "online",
        message: "Servidor Arriba",
        server_time: new Date()
    });
});

function mapMovieFromTmdb(movie) {
    return {
        id: movie.id,
        titulo: movie.title,
        categoria: movie.genre_ids,
        imagen: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        fecha: movie.release_date || null,
        descripcion: movie.overview || ""
    };
}

async function searchTmdb(query) {
    const response = await axios.get(
        `${TMDB_BASE_URL}/search/movie`,
        {
            params: {
                api_key: TMDB_API_KEY,
                query,
                language: 'es-MX',
                include_adult: false
            }
        }
    );

    return Array.isArray(response.data?.results) ? response.data.results : [];
}

function resolveProviderRegion(resultsByCountry, preferredCountry) {
    if (!resultsByCountry || typeof resultsByCountry !== 'object') {
        return null;
    }

    if (resultsByCountry[preferredCountry]) {
        return {
            country: preferredCountry,
            data: resultsByCountry[preferredCountry]
        };
    }

    const fallbackCode = Object.keys(resultsByCountry).find((countryCode) => {
        const regionData = resultsByCountry[countryCode];

        if (!regionData || typeof regionData !== 'object') {
            return false;
        }

        return [regionData.flatrate, regionData.rent, regionData.buy].some(
            (collection) => Array.isArray(collection) && collection.length > 0
        );
    });

    if (!fallbackCode) {
        return null;
    }

    return {
        country: fallbackCode,
        data: resultsByCountry[fallbackCode]
    };
}

function normalizeProviders(regionData) {
    const mergedProviders = [
        ...(Array.isArray(regionData?.flatrate) ? regionData.flatrate : []),
        ...(Array.isArray(regionData?.rent) ? regionData.rent : []),
        ...(Array.isArray(regionData?.buy) ? regionData.buy : [])
    ];

    const seenIds = new Set();

    return mergedProviders
        .filter((provider) => provider && provider.provider_id && provider.provider_name)
        .filter((provider) => {
            if (seenIds.has(provider.provider_id)) {
                return false;
            }

            seenIds.add(provider.provider_id);
            return true;
        })
        .map((provider) => ({
            id: provider.provider_id,
            nombre: provider.provider_name,
            logo: provider.logo_path
                ? `https://image.tmdb.org/t/p/w92${provider.logo_path}`
                : null
        }));
}

async function getTmdbProviders(movieId, countryCode) {
    const response = await axios.get(
        `${TMDB_BASE_URL}/movie/${movieId}/watch/providers`,
        {
            params: {
                api_key: TMDB_API_KEY
            }
        }
    );

    const resultsByCountry = response.data?.results || {};
    const regionMatch = resolveProviderRegion(resultsByCountry, countryCode);

    if (!regionMatch) {
        return {
            country: countryCode,
            providers: [],
            watchUrl: `https://www.themoviedb.org/movie/${movieId}/watch?locale=${countryCode}`
        };
    }

    return {
        country: regionMatch.country,
        providers: normalizeProviders(regionMatch.data),
        watchUrl: regionMatch.data.link || `https://www.themoviedb.org/movie/${movieId}/watch?locale=${regionMatch.country}`
    };
}

async function getTmdbMovieDetails(movieId) {
    const response = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
        params: {
            api_key: TMDB_API_KEY,
            language: 'es-MX'
        }
    });

    return response.data || {};
}

async function searchLegalTorrentsByTmdb(movieId) {
    const details = await getTmdbMovieDetails(movieId);
    const title = String(details?.title || '').trim();
    const releaseDate = String(details?.release_date || '').trim();
    const year = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : '';

    if (!title) {
        return {
            title: '',
            year,
            results: []
        };
    }

    const searchTerms = year ? `title:(\"${title}\") AND year:(${year})` : `title:(\"${title}\")`;
    const query = `mediatype:(movies) AND ${searchTerms}`;

    const response = await axios.get('https://archive.org/advancedsearch.php', {
        params: {
            q: query,
            fl: ['identifier', 'title', 'year', 'mediatype'],
            rows: 8,
            page: 1,
            output: 'json'
        }
    });

    const docs = Array.isArray(response.data?.response?.docs) ? response.data.response.docs : [];

    const results = docs
        .filter((doc) => doc && doc.identifier)
        .map((doc) => {
            const identifier = String(doc.identifier);
            return {
                id: identifier,
                title: String(doc.title || identifier),
                year: String(doc.year || ''),
                torrentUrl: `https://archive.org/download/${identifier}/${identifier}_archive.torrent`,
                detailsUrl: `https://archive.org/details/${identifier}`
            };
        });

    return {
        title,
        year,
        results
    };
}

app.get('/peliculas', async (req, res) => {
    try {
        const query = String(req.query.query || '').trim();
        const requestedLimit = Number(req.query.limit || 8);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 20)
            : 8;

        if (query.length < 2) {
            return res.status(400).json({
                error: 'Debes enviar al menos 2 caracteres para buscar.'
            });
        }

        const tmdbResults = await searchTmdb(query);
        const results = tmdbResults
            .slice(0, limit)
            .map(mapMovieFromTmdb)
            .filter((movie) => movie.id && movie.titulo);

        return res.json({
            results,
            total: results.length
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al consultar TMDB',
            details: error.message
        });
    }
});

// ---------- Popular Movies (must be before /:id routes) ----------
app.get('/peliculas/populares', async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const response = await axios.get(`${TMDB_BASE_URL}/movie/popular`, {
            params: { api_key: TMDB_API_KEY, language: 'es-MX', page }
        });
        const results = (response.data?.results || []).slice(0, 20).map(mapMovieFromTmdb).filter(m => m.id && m.titulo);
        return res.json({ results, total: results.length });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener películas populares.', details: error.message });
    }
});

// ---------- Movies by Genre (must be before /:id routes) ----------
app.get('/peliculas/genero/:genero', async (req, res) => {
    try {
        const key = String(req.params.genero || '').toLowerCase().replace(/[^a-z_]/g, '');
        const genreId = TMDB_GENRES[key];
        if (!genreId) {
            return res.status(400).json({ error: `Género desconocido: ${req.params.genero}` });
        }
        const sortBy = req.query.sort === 'menos_populares' ? 'popularity.asc' : 'popularity.desc';
        const response = await axios.get(`${TMDB_BASE_URL}/discover/movie`, {
            params: { api_key: TMDB_API_KEY, language: 'es-MX', with_genres: genreId, sort_by: sortBy, page: 1 }
        });
        const results = (response.data?.results || []).slice(0, 20).map(mapMovieFromTmdb).filter(m => m.id && m.titulo);
        return res.json({ results, total: results.length, genre: key, genreId });
    } catch (error) {
        return res.status(500).json({ error: 'Error al obtener películas por género.', details: error.message });
    }
});

app.get('/peliculas/:id/proveedores', async (req, res) => {
    try {
        const movieId = Number(req.params.id);
        const requestedCountry = String(req.query.country || DEFAULT_PROVIDER_COUNTRY)
            .toUpperCase()
            .slice(0, 2);

        if (!Number.isInteger(movieId) || movieId <= 0) {
            return res.status(400).json({
                error: 'Debes enviar un id de pelicula valido.'
            });
        }

        const providersPayload = await getTmdbProviders(movieId, requestedCountry);

        return res.json({
            movieId,
            country: providersPayload.country,
            providers: providersPayload.providers,
            total: providersPayload.providers.length,
            watchUrl: providersPayload.watchUrl,
            refreshedAt: new Date().toISOString()
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al consultar proveedores de streaming',
            details: error.message
        });
    }
});

app.get('/peliculas/:id/torrents-legales', async (req, res) => {
    try {
        const movieId = Number(req.params.id);

        if (!Number.isInteger(movieId) || movieId <= 0) {
            return res.status(400).json({ error: 'Debes enviar un id de pelicula valido.' });
        }

        const payload = await searchLegalTorrentsByTmdb(movieId);

        return res.json({
            movieId,
            movieTitle: payload.title,
            movieYear: payload.year,
            total: payload.results.length,
            results: payload.results,
            source: 'Internet Archive'
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Error al buscar torrents legales',
            details: error.message
        });
    }
});

// Endpoint dinámico de búsqueda
app.get('/pelicula/:nombre', async (req, res) => {

    try {
        const nombre = String(req.params.nombre || '').trim();

        if (nombre.length < 2) {
            return res.status(400).json({
                error: 'Debes enviar al menos 2 caracteres para buscar.'
            });
        }

        const results = await searchTmdb(nombre);

        if (results.length === 0) {
            return res.status(404).json({
                error: 'Pelicula no encontrada'
            });
        }

        const filteredData = mapMovieFromTmdb(results[0]);

        res.json(filteredData);

    } catch (error) {
        res.status(500).json({
            error: 'Error al consultar TMDB',
            details: error.message
        });
    }

});

// ---------- TMDB Genre IDs ----------
const TMDB_GENRES = {
    accion: 28, aventura: 12, animacion: 16, comedia: 35, crimen: 80,
    documental: 99, drama: 18, fantasia: 14, historia: 36, terror: 27,
    musica: 10402, misterio: 9648, romance: 10749, scifi: 878, ciencia_ficcion: 878,
    pelicula_tv: 10770, suspenso: 53, guerra: 10752, western: 37
};

// ---------- Auth Endpoints ----------
app.post('/auth/register', async (req, res) => {
    try {
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!username || username.length < 3) {
            return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Email inválido.' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
        }

        const existing = await User.findOne({ where: { username } });
        if (existing) {
            return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
        }
        const existingEmail = await User.findOne({ where: { email } });
        if (existingEmail) {
            return res.status(409).json({ error: 'Ese email ya está registrado.' });
        }

        const salt = User.generateSalt();
        const password_hash = User.hashPassword(password, salt);
        const user = await User.create({ username, email, password_hash, salt });

        return res.status(201).json({ id: user.id, username: user.username, email: user.email });
    } catch (error) {
        return res.status(500).json({ error: 'Error al registrar usuario.', details: error.message });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const identifier = String(req.body.username || req.body.email || '').trim();
        const password = String(req.body.password || '');

        if (!identifier || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
        }

        const isEmail = identifier.includes('@');
        const user = await User.findOne({ where: isEmail ? { email: identifier.toLowerCase() } : { username: identifier } });

        if (!user) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        const hashed = User.hashPassword(password, user.salt);
        if (hashed !== user.password_hash) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        const token = generateToken();
        const expires_at = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days
        await Session.create({ token, user_id: user.id, expires_at });

        return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        return res.status(500).json({ error: 'Error al iniciar sesión.', details: error.message });
    }
});

app.post('/auth/logout', async (req, res) => {
    try {
        const token = req.headers['x-auth-token'];
        if (token) {
            await Session.destroy({ where: { token } });
        }
        return res.json({ message: 'Sesión cerrada.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error al cerrar sesión.' });
    }
});

app.get('/auth/me', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });
        return res.json({ id: user.id, username: user.username, email: user.email });
    } catch (error) {
        return res.status(500).json({ error: 'Error al verificar sesión.' });
    }
});

sequelize.sync().then(() => {

    console.log("Base de datos sincronizada");

    app.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });

}).catch(err => console.error(err));

app.post('/watchlist', async (req, res) => {
    try {
        // validar datos obligatorios
        const { id_usuario, external_id, titulo } = req.body;
        if (!id_usuario || !external_id || !titulo) {
            return res.status(400).json({
                error: "Faltan datos obligatorios"
            });
        }
        // verificar si ya existe la película en la colección
        const existe = await Watchlist.findOne({
            where: {
                external_id: req.body.external_id,
                id_usuario: req.body.id_usuario
            }
        });
        if (existe) {
            return res.status(400).json({
                message: "La película ya está en tu colección"
            });
        }
        // crear registro
        const nueva = await Watchlist.create(req.body);
        res.status(201).json(nueva);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/watchlist', async (req, res) => {
    try {
        const idUsuario = req.query.id_usuario;
        const where = {};

        if (typeof idUsuario !== 'undefined') {
            const parsed = Number(idUsuario);

            if (!Number.isInteger(parsed) || parsed <= 0) {
                return res.status(400).json({
                    error: 'id_usuario invalido'
                });
            }

            where.id_usuario = parsed;
        }

        const lista = await Watchlist.findAll({
            where,
            order: [['createdAt', 'DESC']]
        });

        return res.json(lista);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.put('/watchlist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [updatedRows] = await Watchlist.update(req.body, { where: { id } });

        if (!updatedRows) {
            return res.status(404).json({
                error: 'Elemento no encontrado'
            });
        }

        return res.json({ message: 'Actualizado correctamente' });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

app.delete('/watchlist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedRows = await Watchlist.destroy({ where: { id } });

        if (!deletedRows) {
            return res.status(404).json({
                error: 'Elemento no encontrado'
            });
        }

        return res.json({ message: 'Eliminado correctamente' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// =====================================================
// ============ ENDPOINTS DE TORRENTS ================
// =====================================================

/**
 * POST /torrents/iniciar
 * Inicia una descarga de torrent
 */
app.post('/torrents/iniciar', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const magnetLink = String(req.body.magnet_link || req.body.magnetLink || '').trim();
        const title = String(req.body.title || '').trim();
        const description = String(req.body.description || '').trim();

        if (!magnetLink || !title) {
            return res.status(400).json({
                error: 'Faltan campos obligatorios: magnet_link y title'
            });
        }

        const isMagnet = magnetLink.startsWith('magnet:?');
        const isTorrentUrl = /^https?:\/\/.+\.torrent(\?.*)?$/i.test(magnetLink);

        if (!isMagnet && !isTorrentUrl) {
            return res.status(400).json({
                error: 'magnet_link invalido (usa magnet o URL .torrent)'
            });
        }

        const result = await torrentService.startDownload(
            user.id,
            magnetLink,
            title,
            description
        );

        return res.status(201).json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

app.post('/torrents/auto/tmdb/:id', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const movieId = Number(req.params.id);
        if (!Number.isInteger(movieId) || movieId <= 0) {
            return res.status(400).json({ error: 'Debes enviar un id de pelicula valido.' });
        }

        const searchPayload = await searchLegalTorrentsByTmdb(movieId);
        const firstMatch = searchPayload.results[0];

        if (!firstMatch) {
            return res.status(404).json({
                error: 'No se encontraron torrents legales para esta pelicula.'
            });
        }

        const result = await torrentService.startDownload(
            user.id,
            firstMatch.torrentUrl,
            searchPayload.title || firstMatch.title,
            `Fuente legal: ${firstMatch.detailsUrl}`
        );

        return res.status(201).json({
            ...result,
            movieId,
            auto: true,
            source: 'Internet Archive',
            match: firstMatch
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

/**
 * GET /torrents/descargas
 * Obtiene todas las descargas del usuario autenticado
 */
app.get('/torrents/descargas', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const downloads = await torrentService.getUserDownloads(user.id);
        return res.json({
            total: downloads.length,
            descargas: downloads
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /torrents/:id
 * Obtiene el estado de una descarga específica
 */
app.get('/torrents/:id', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const download = await torrentService.getDownloadStatus(id);

        // Verificar que el usuario sea propietario de la descarga
        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para acceder a esta descarga.' });
        }

        return res.json(download);
    } catch (error) {
        return res.status(404).json({ error: error.message });
    }
});

/**
 * PUT /torrents/:id/pausar
 * Pausa una descarga
 */
app.put('/torrents/:id/pausar', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const download = await TorrentDownload.findByPk(id);

        if (!download) {
            return res.status(404).json({ error: 'Descarga no encontrada.' });
        }

        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para pausar esta descarga.' });
        }

        const result = await torrentService.pauseDownload(id);
        return res.json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /torrents/:id/reanudar
 * Reanuda una descarga pausada
 */
app.put('/torrents/:id/reanudar', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const download = await TorrentDownload.findByPk(id);

        if (!download) {
            return res.status(404).json({ error: 'Descarga no encontrada.' });
        }

        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para reanudar esta descarga.' });
        }

        const result = await torrentService.resumeDownload(id);
        return res.json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /torrents/:id
 * Cancela y elimina una descarga
 */
app.delete('/torrents/:id', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const download = await TorrentDownload.findByPk(id);

        if (!download) {
            return res.status(404).json({ error: 'Descarga no encontrada.' });
        }

        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar esta descarga.' });
        }

        const result = await torrentService.cancelDownload(id);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /torrents/:id/archivos
 * Obtiene los archivos de una descarga completada
 */
app.get('/torrents/:id/archivos', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const download = await TorrentDownload.findByPk(id);

        if (!download) {
            return res.status(404).json({ error: 'Descarga no encontrada.' });
        }

        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para acceder a estos archivos.' });
        }

        const files = await torrentService.getDownloadFiles(id);
        return res.json({
            torrent_id: id,
            title: download.title,
            archivos: files
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

/**
 * GET /torrents/:id/stream?file=<nombre>
 * Reproduce un archivo de video descargado
 */
app.get('/torrents/:id/stream', async (req, res) => {
    try {
        const user = await getSessionUser(req);
        if (!user) return res.status(401).json({ error: 'No autenticado.' });

        const { id } = req.params;
        const requestedFile = String(req.query.file || '').trim();
        const download = await TorrentDownload.findByPk(id);

        if (!download) {
            return res.status(404).json({ error: 'Descarga no encontrada.' });
        }

        if (download.user_id !== user.id) {
            return res.status(403).json({ error: 'No tienes permiso para reproducir esta descarga.' });
        }

        const files = await torrentService.getDownloadFiles(id);
        if (!files.length) {
            return res.status(404).json({ error: 'No se encontraron archivos de video.' });
        }

        const selected = requestedFile
            ? files.find((file) => file.name === requestedFile)
            : files.reduce((largest, file) => (file.size > largest.size ? file : largest), files[0]);

        if (!selected) {
            return res.status(404).json({ error: 'Archivo solicitado no encontrado.' });
        }

        const safeBase = path.resolve(path.join(__dirname, 'descargas', `torrent_${id}`));
        const safeFilePath = path.resolve(selected.path);

        if (!safeFilePath.startsWith(safeBase + path.sep)) {
            return res.status(400).json({ error: 'Ruta de archivo invalida.' });
        }

        if (!fs.existsSync(safeFilePath)) {
            return res.status(404).json({ error: 'Archivo no existe en disco.' });
        }

        return res.sendFile(safeFilePath);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

// =====================================================
// ==================== FIN TORRENTS =================
// =====================================================