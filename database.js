// database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'blaxgram.db');
const db = new sqlite3.Database(dbPath);

// Инициализация таблиц
db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lastName TEXT,
    username TEXT UNIQUE NOT NULL,
    phone TEXT,
    bio TEXT,
    stars INTEGER DEFAULT 1000000,
    premium TEXT,
    twoFAEnabled INTEGER DEFAULT 0,
    twoFAPassword TEXT,
    avatar TEXT DEFAULT '👤',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Чаты
  db.run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY,
    type TEXT CHECK(type IN ('private', 'channel', 'group', 'bot')) NOT NULL,
    name TEXT NOT NULL,
    username TEXT,
    avatar TEXT DEFAULT '👤',
    lastMessage TEXT,
    lastMessageTime TEXT,
    unread INTEGER DEFAULT 0,
    online INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    createdBy INTEGER,
    botId TEXT,
    FOREIGN KEY(createdBy) REFERENCES users(id)
  )`);

  // Сообщения
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId INTEGER NOT NULL,
    userId INTEGER,
    text TEXT,
    sender TEXT CHECK(sender IN ('me', 'them', 'system', 'channel')) NOT NULL,
    senderName TEXT,
    time TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT DEFAULT 'text' CHECK(type IN ('text', 'file', 'sticker', 'gift', 'call')),
    fileName TEXT,
    fileSize TEXT,
    giftId INTEGER,
    giftData TEXT,
    reactions TEXT DEFAULT '{}',
    starReactions INTEGER DEFAULT 0,
    edited INTEGER DEFAULT 0,
    replyTo INTEGER,
    callInfo TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(chatId) REFERENCES chats(id),
    FOREIGN KEY(userId) REFERENCES users(id),
    FOREIGN KEY(replyTo) REFERENCES messages(id)
  )`);

  // Боты
  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    description TEXT,
    token TEXT UNIQUE NOT NULL,
    commands TEXT DEFAULT '[]',
    chats INTEGER DEFAULT 0,
    users INTEGER DEFAULT 0,
    createdBy INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(createdBy) REFERENCES users(id)
  )`);

  // Gift ссылки
  db.run(`CREATE TABLE IF NOT EXISTS giftLinks (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    createdBy INTEGER NOT NULL,
    createdByUsername TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL,
    activatedBy INTEGER,
    activatedByUsername TEXT,
    activatedAt DATETIME,
    FOREIGN KEY(createdBy) REFERENCES users(id),
    FOREIGN KEY(activatedBy) REFERENCES users(id)
  )`);

  // Xost Bots
  db.run(`CREATE TABLE IF NOT EXISTS xostBots (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    requests INTEGER DEFAULT 0,
    uptime TEXT DEFAULT '0ч',
    ram TEXT DEFAULT '32MB',
    paymentDeadline DATETIME,
    logs TEXT DEFAULT '[]',
    userId INTEGER,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);

  // Занятые юзернеймы
  db.run(`CREATE TABLE IF NOT EXISTS takenUsernames (
    username TEXT PRIMARY KEY
  )`);

  // Участники чатов (для групп)
  db.run(`CREATE TABLE IF NOT EXISTS chatParticipants (
    chatId INTEGER,
    userId INTEGER,
    role TEXT DEFAULT 'member',
    joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(chatId, userId),
    FOREIGN KEY(chatId) REFERENCES chats(id),
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);

  // Подарки пользователей
  db.run(`CREATE TABLE IF NOT EXISTS userGifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    giftId INTEGER NOT NULL,
    giftName TEXT NOT NULL,
    giftIcon TEXT NOT NULL,
    giftPrice INTEGER NOT NULL,
    receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(id)
  )`);

  // Добавляем начальные данные
  db.get("SELECT COUNT(*) as count FROM takenUsernames", (err, row) => {
    if (err) {
      console.error(err);
      return;
    }
    
    if (row.count === 0) {
      const defaultUsernames = [
        '@blaxgram', '@bot', '@anna_s', '@ivan_p', '@blaxgram_chat', '@botfather'
      ];
      
      const stmt = db.prepare("INSERT INTO takenUsernames (username) VALUES (?)");
      defaultUsernames.forEach(username => {
        stmt.run(username);
      });
      stmt.finalize();
    }
  });
});

console.log('Database initialized');

module.exports = db;