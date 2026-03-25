const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TorrentDownload = sequelize.define('TorrentDownload', {
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'Users',
            key: 'id'
        }
    },
    magnet_link: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    title: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT
    },
    status: {
        type: DataTypes.ENUM('descargando', 'completado', 'pausado', 'error'),
        defaultValue: 'descargando',
        allowNull: false
    },
    progress: {
        type: DataTypes.FLOAT,
        defaultValue: 0,
        allowNull: false
    },
    downloaded_bytes: {
        type: DataTypes.BIGINT,
        defaultValue: 0
    },
    total_bytes: {
        type: DataTypes.BIGINT,
        defaultValue: 0
    },
    speed: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    peers: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    file_path: {
        type: DataTypes.STRING(500)
    },
    infohash: {
        type: DataTypes.STRING(255),
        unique: true
    },
    error_message: {
        type: DataTypes.TEXT
    },
    started_at: {
        type: DataTypes.DATE
    },
    completed_at: {
        type: DataTypes.DATE
    }
}, {
    timestamps: true,
    tableName: 'TorrentDownloads'
});

module.exports = TorrentDownload;
