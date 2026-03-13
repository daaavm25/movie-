const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Watchlist = sequelize.define('Watchlist', {
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    external_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    titulo: {
        type: DataTypes.STRING,
        allowNull: false
    },
    categoria: {
        type: DataTypes.STRING
    },
    imagen: {
        type: DataTypes.STRING
    },
    nota_personal: {
        type: DataTypes.TEXT
    }
}, {
    timestamps: true
});

module.exports = Watchlist;