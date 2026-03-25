const path = require('path');
const fs = require('fs');
const TorrentDownload = require('../models/TorrentDownload');

let WebTorrent;

// Cargar WebTorrent con import dinámico
async function initializeWebTorrent() {
    if (!WebTorrent) {
        const wt = await import('webtorrent');
        WebTorrent = wt.default;
    }
    return WebTorrent;
}

const DOWNLOADS_PATH = path.join(__dirname, '../descargas');

// Crear carpeta de descargas si no existe
if (!fs.existsSync(DOWNLOADS_PATH)) {
    fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

class TorrentService {
    constructor() {
        this.client = null;
        this.torrents = new Map(); // Map para rastrear torrents activos
        this.initialized = false;
    }

    /**
     * Inicializa el cliente de WebTorrent
     */
    async initialize() {
        if (this.initialized) return;
        
        const WT = await initializeWebTorrent();
        this.client = new WT();
        
        this.client.on('error', (error) => {
            console.error('Error en WebTorrent:', error);
        });
        
        this.initialized = true;
    }

    /**
     * Inicia descarga de un torrent desde un enlace magnético
     */
    async startDownload(userId, magnetLink, title, description = '') {
        await this.initialize();
        
        return new Promise((resolve, reject) => {
            try {
                const source = String(magnetLink || '').trim();
                const isMagnet = source.startsWith('magnet:?');
                const isTorrentUrl = /^https?:\/\/.+\.torrent(\?.*)?$/i.test(source);

                // Permitimos magnet o URL .torrent para integraciones automáticas.
                if (!isMagnet && !isTorrentUrl) {
                    return reject(new Error('Fuente de torrent invalida (usa magnet o URL .torrent)'));
                }

                // Crear registro en la BD
                TorrentDownload.create({
                    user_id: userId,
                    magnet_link: magnetLink,
                    title,
                    description,
                    status: 'descargando',
                    started_at: new Date()
                }).then(async (record) => {
                    const torrentId = record.id;
                    const downloadPath = path.join(DOWNLOADS_PATH, `torrent_${torrentId}`);

                    fs.mkdirSync(downloadPath, { recursive: true });

                    // Iniciar descarga del torrent
                    this.client.add(source, { path: downloadPath }, async (torrent) => {
                        // Guardar referencia del torrent
                        this.torrents.set(torrentId, torrent);

                        // Actualizar infohash en la BD
                        await record.update({ infohash: torrent.infoHash });

                        // Monitorear progreso
                        torrent.on('download', async () => {
                            const total = Number(torrent.length || 0);
                            const progress = total > 0 ? (torrent.downloaded / total) * 100 : 0;
                            const speed = torrent.downloadSpeed;

                            await record.update({
                                progress: parseFloat(progress.toFixed(2)),
                                downloaded_bytes: torrent.downloaded,
                                total_bytes: total,
                                speed: parseFloat(speed.toFixed(2)),
                                peers: torrent.numPeers
                            });
                        });

                        // Cuando se completa la descarga
                        torrent.on('done', async () => {
                            await record.update({
                                status: 'completado',
                                progress: 100,
                                file_path: downloadPath,
                                completed_at: new Date()
                            });
                            this.torrents.delete(torrentId);

                            console.log(`✓ Torrent completado: ${title}`);
                        });

                        // Manejar errores
                        torrent.on('error', async (error) => {
                            await record.update({
                                status: 'error',
                                error_message: error.message
                            });
                            this.torrents.delete(torrentId);
                            console.error(`✗ Error en torrent ${title}:`, error.message);
                        });

                        resolve({
                            id: torrentId,
                            status: 'descargando',
                            message: `Descarga iniciada: ${title}`
                        });
                    });

                }).catch(reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Pausa una descarga
     */
    async pauseDownload(torrentId) {
        await this.initialize();
        const torrent = this.torrents.get(torrentId);
        if (!torrent) throw new Error('Torrent no encontrado');

        const record = await TorrentDownload.findByPk(torrentId);
        if (!record) throw new Error('Registro de descarga no encontrado');

        torrent.pause();
        await record.update({ status: 'pausado' });

        return { message: 'Descarga pausada' };
    }

    /**
     * Reanuda una descarga pausada
     */
    async resumeDownload(torrentId) {
        await this.initialize();
        const torrent = this.torrents.get(torrentId);
        if (!torrent) throw new Error('Torrent no encontrado');

        const record = await TorrentDownload.findByPk(torrentId);
        if (!record) throw new Error('Registro de descarga no encontrado');

        torrent.resume();
        await record.update({ status: 'descargando' });

        return { message: 'Descarga reanudada' };
    }

    /**
     * Detiene y elimina una descarga
     */
    async cancelDownload(torrentId) {
        await this.initialize();
        const torrent = this.torrents.get(torrentId);
        
        if (torrent) {
            this.client.remove(torrent);
            this.torrents.delete(torrentId);
        }

        const record = await TorrentDownload.findByPk(torrentId);
        if (record) {
            const downloadPath = path.join(DOWNLOADS_PATH, `torrent_${torrentId}`);
            
            // Eliminar archivos descargados
            if (fs.existsSync(downloadPath)) {
                fs.rmSync(downloadPath, { recursive: true, force: true });
            }

            await record.destroy();
        }

        return { message: 'Descarga cancelada y eliminada' };
    }

    /**
     * Obtiene el estado de una descarga
     */
    async getDownloadStatus(torrentId) {
        const record = await TorrentDownload.findByPk(torrentId);
        if (!record) throw new Error('Descarga no encontrada');

        const torrent = this.torrents.get(torrentId);
        let additionalInfo = {};

        if (torrent) {
            additionalInfo = {
                peers: torrent.numPeers,
                seeds: torrent.numSeeds,
                uploadSpeed: torrent.uploadSpeed
            };
        }

        return {
            ...record.toJSON(),
            ...additionalInfo
        };
    }

    /**
     * Lista todas las descargas de un usuario
     */
    async getUserDownloads(userId) {
        return await TorrentDownload.findAll({
            where: { user_id: userId },
            order: [['createdAt', 'DESC']]
        });
    }

    /**
     * Obtiene archivos de video del torrent descargado
     */
    getVideoFiles(directoryPath) {
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm'];
        const videoFiles = [];

        const walkDir = (dir) => {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                
                if (stat.isDirectory()) {
                    walkDir(filePath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (videoExtensions.includes(ext)) {
                        videoFiles.push({
                            name: file,
                            path: filePath,
                            size: stat.size
                        });
                    }
                }
            });
        };

        if (fs.existsSync(directoryPath)) {
            walkDir(directoryPath);
        }

        return videoFiles;
    }

    /**
     * Obtiene archivos de una descarga completada
     */
    async getDownloadFiles(torrentId) {
        const record = await TorrentDownload.findByPk(torrentId);
        if (!record) throw new Error('Descarga no encontrada');

        if (record.status !== 'completado') {
            throw new Error('La descarga no está completada');
        }

        const downloadPath = path.join(DOWNLOADS_PATH, `torrent_${torrentId}`);
        return this.getVideoFiles(downloadPath);
    }

    /**
     * Cierra la conexión de WebTorrent
     */
    destroy() {
        if (this.client) {
            this.client.destroy();
        }
    }
}

module.exports = TorrentService;
