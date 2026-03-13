const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const crypto = require('crypto');

const User = sequelize.define('User', {
    username: {
        type: DataTypes.STRING(60),
        allowNull: false,
        unique: true,
        validate: { len: [3, 60] }
    },
    email: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
        validate: { isEmail: true }
    },
    password_hash: {
        type: DataTypes.STRING(128),
        allowNull: false
    },
    salt: {
        type: DataTypes.STRING(32),
        allowNull: false
    }
}, { timestamps: true });

User.hashPassword = function (plain, salt) {
    return crypto.createHmac('sha256', salt).update(plain).digest('hex');
};

User.generateSalt = function () {
    return crypto.randomBytes(16).toString('hex');
};

module.exports = User;
