// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'blaxgram-secret-key-2024';

app.use(cors());
app.use(bodyParser.json());

// Отдаем статические файлы из корневой папки
app.use(express.static(__dirname));

// API Routes (те же самые, что и раньше)
// ========== API Routes ==========

// Регистрация
app.post('/api/register', (req, res) => {
  const { name, lastName, username, phone } = req.body;
  
  if (!name || !username) {
    return res.status(400).json({ error: 'Name and username required' });
  }
  
  // Проверяем занят ли юзернейм
  db.get('SELECT username FROM takenUsernames WHERE username = ?', [username], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Создаем пользователя
    db.run(
      `INSERT INTO users (name, lastName, username, phone) VALUES (?, ?, ?, ?)`,
      [name, lastName || '', username, phone || ''],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        const userId = this.lastID;
        
        // Добавляем в takenUsernames
        db.run('INSERT INTO takenUsernames (username) VALUES (?)', [username]);
        
        // Создаем токен
        const token = jwt.sign({ id: userId, username }, JWT_SECRET);
        
        // Получаем созданного пользователя
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          res.json({ user, token });
        });
      }
    );
  });
});

// Вход
app.post('/api/login', (req, res) => {
  const { username, twoFAPassword } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Проверка 2FA если включена
    if (user.twoFAEnabled && user.twoFAPassword !== twoFAPassword) {
      return res.status(401).json({ error: 'Invalid 2FA password', twoFARequired: true });
    }
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ user, token });
  });
});

// Получить все чаты пользователя
app.get('/api/chats', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM chats 
     WHERE id IN (
       SELECT chatId FROM chatParticipants WHERE userId = ?
       UNION
       SELECT id FROM chats WHERE type IN ('channel', 'bot') OR createdBy = ?
     )
     ORDER BY lastMessageTime DESC`,
    [req.user.id, req.user.id],
    (err, chats) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json(chats);
    }
  );
});

// Получить сообщения чата
app.get('/api/chats/:chatId/messages', authenticateToken, (req, res) => {
  const { chatId } = req.params;
  
  db.all(
    'SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC',
    [chatId],
    (err, messages) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Парсим JSON поля
      messages.forEach(msg => {
        if (msg.reactions) {
          try {
            msg.reactions = JSON.parse(msg.reactions);
          } catch {
            msg.reactions = {};
          }
        }
        if (msg.giftData) {
          try {
            msg.giftData = JSON.parse(msg.giftData);
          } catch {
            msg.giftData = null;
          }
        }
        if (msg.callInfo) {
          try {
            msg.callInfo = JSON.parse(msg.callInfo);
          } catch {
            msg.callInfo = null;
          }
        }
      });
      
      res.json(messages);
    }
  );
});

// Отправить сообщение
app.post('/api/messages', authenticateToken, (req, res) => {
  const { chatId, text, type, fileName, fileSize, giftData, replyTo } = req.body;
  
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                  now.getMinutes().toString().padStart(2, '0');
  const dateStr = 'Сегодня';
  
  db.run(
    `INSERT INTO messages (chatId, userId, text, sender, time, date, type, fileName, fileSize, giftData, replyTo, reactions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      chatId, 
      req.user.id, 
      text || '', 
      'me', 
      timeStr, 
      dateStr, 
      type || 'text', 
      fileName || null, 
      fileSize || null,
      giftData ? JSON.stringify(giftData) : null,
      replyTo || null,
      '{}'
    ],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Обновляем последнее сообщение в чате
      db.run(
        'UPDATE chats SET lastMessage = ?, lastMessageTime = ? WHERE id = ?',
        [text || (type === 'file' ? '📎 ' + fileName : type === 'sticker' ? '😊 Стикер' : 'Новое сообщение'), now.toISOString(), chatId]
      );
      
      db.get('SELECT * FROM messages WHERE id = ?', [this.lastID], (err, msg) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (msg.reactions) {
          try {
            msg.reactions = JSON.parse(msg.reactions);
          } catch {
            msg.reactions = {};
          }
        }
        if (msg.giftData) {
          try {
            msg.giftData = JSON.parse(msg.giftData);
          } catch {
            msg.giftData = null;
          }
        }
        
        res.json(msg);
      });
    }
  );
});

// Добавить реакцию
app.post('/api/messages/:msgId/reactions', authenticateToken, (req, res) => {
  const { msgId } = req.params;
  const { emoji } = req.body;
  
  db.get('SELECT reactions FROM messages WHERE id = ?', [msgId], (err, msg) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    let reactions = {};
    try {
      reactions = JSON.parse(msg.reactions) || {};
    } catch {
      reactions = {};
    }
    
    if (!reactions[emoji]) {
      reactions[emoji] = [];
    }
    
    const userIndex = reactions[emoji].indexOf(req.user.username);
    if (userIndex === -1) {
      reactions[emoji].push(req.user.username);
    } else {
      reactions[emoji].splice(userIndex, 1);
      if (reactions[emoji].length === 0) {
        delete reactions[emoji];
      }
    }
    
    db.run(
      'UPDATE messages SET reactions = ? WHERE id = ?',
      [JSON.stringify(reactions), msgId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, reactions });
      }
    );
  });
});

// Создать чат
app.post('/api/chats', authenticateToken, (req, res) => {
  const { id, type, name, username, avatar, verified } = req.body;
  
  db.run(
    `INSERT INTO chats (id, type, name, username, avatar, verified, createdBy, lastMessageTime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, name, username || null, avatar || '👤', verified ? 1 : 0, req.user.id, new Date().toISOString()],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Добавляем создателя в участники для приватных чатов
      if (type === 'private' || type === 'group') {
        db.run(
          'INSERT INTO chatParticipants (chatId, userId, role) VALUES (?, ?, ?)',
          [id, req.user.id, type === 'group' ? 'admin' : 'member']
        );
      }
      
      // Добавляем юзернейм если есть
      if (username) {
        db.run('INSERT INTO takenUsernames (username) VALUES (?)', [username]);
      }
      
      db.get('SELECT * FROM chats WHERE id = ?', [id], (err, chat) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json(chat);
      });
    }
  );
});

// Создать бота
app.post('/api/bots', authenticateToken, (req, res) => {
  const { id, name, username, description, token, commands } = req.body;
  
  db.run(
    `INSERT INTO bots (id, name, username, description, token, commands, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, username, description || '', token, JSON.stringify(commands || []), req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM bots WHERE id = ?', [id], (err, bot) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (bot.commands) {
          try {
            bot.commands = JSON.parse(bot.commands);
          } catch {
            bot.commands = [];
          }
        }
        
        res.json(bot);
      });
    }
  );
});

// Получить ботов пользователя
app.get('/api/bots', authenticateToken, (req, res) => {
  db.all('SELECT * FROM bots WHERE createdBy = ?', [req.user.id], (err, bots) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    bots.forEach(bot => {
      if (bot.commands) {
        try {
          bot.commands = JSON.parse(bot.commands);
        } catch {
          bot.commands = [];
        }
      }
    });
    
    res.json(bots);
  });
});

// Создать Gift ссылку
app.post('/api/gift-links', authenticateToken, (req, res) => {
  const { code, expiresAt } = req.body;
  
  db.get('SELECT username FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.run(
      `INSERT INTO giftLinks (id, code, createdBy, createdByUsername, expiresAt)
       VALUES (?, ?, ?, ?, ?)`,
      ['gift_' + Date.now(), code, req.user.id, user.username, expiresAt],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        // Списываем звезды
        db.run('UPDATE users SET stars = stars - 100000 WHERE id = ?', [req.user.id]);
        
        db.get('SELECT * FROM giftLinks WHERE id = ?', [this.lastID], (err, link) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(link);
        });
      }
    );
  });
});

// Активировать Gift ссылку
app.post('/api/gift-links/:code/activate', authenticateToken, (req, res) => {
  const { code } = req.params;
  
  db.get('SELECT * FROM giftLinks WHERE code = ?', [code], (err, link) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!link) {
      return res.status(404).json({ error: 'Gift link not found' });
    }
    
    if (link.activatedBy) {
      return res.status(400).json({ error: 'Gift link already activated' });
    }
    
    const now = new Date();
    if (new Date(link.expiresAt) < now) {
      return res.status(400).json({ error: 'Gift link expired' });
    }
    
    db.get('SELECT username FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.run(
        `UPDATE giftLinks SET activatedBy = ?, activatedByUsername = ?, activatedAt = ?
         WHERE code = ?`,
        [req.user.id, user.username, now.toISOString(), code],
        function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Даем Premium на 30 дней
          const premiumDate = new Date();
          premiumDate.setDate(premiumDate.getDate() + 30);
          
          db.run(
            'UPDATE users SET premium = ? WHERE id = ?',
            [premiumDate.toISOString(), req.user.id]
          );
          
          res.json({ success: true });
        }
      );
    });
  });
});

// Создать Xost бота
app.post('/api/xost-bots', authenticateToken, (req, res) => {
  const { id, token, language, code, name } = req.body;
  
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 7);
  
  db.run(
    `INSERT INTO xostBots (id, token, language, code, name, status, paymentDeadline, userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, token, language, code, name || 'Без имени', 'running', deadline.toISOString(), req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      db.get('SELECT * FROM xostBots WHERE id = ?', [id], (err, bot) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        if (bot.logs) {
          try {
            bot.logs = JSON.parse(bot.logs);
          } catch {
            bot.logs = [];
          }
        }
        
        res.json(bot);
      });
    }
  );
});

// Получить пользователя
app.get('/api/user', authenticateToken, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Получаем подарки пользователя
    db.all('SELECT * FROM userGifts WHERE userId = ? ORDER BY receivedAt DESC', [req.user.id], (err, gifts) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      user.gifts = gifts;
      res.json(user);
    });
  });
});

// Обновить пользователя
app.put('/api/user', authenticateToken, (req, res) => {
  const { name, lastName, bio, twoFAEnabled, twoFAPassword } = req.body;
  
  let query = 'UPDATE users SET name = ?, lastName = ?, bio = ?, twoFAEnabled = ?';
  const params = [name, lastName || '', bio || '', twoFAEnabled ? 1 : 0];
  
  if (twoFAPassword) {
    query += ', twoFAPassword = ?';
    params.push(twoFAPassword);
  }
  
  query += ' WHERE id = ?';
  params.push(req.user.id);
  
  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(user);
    });
  });
});

// Добавить звезды
app.post('/api/user/stars', authenticateToken, (req, res) => {
  const { amount } = req.body;
  
  db.run('UPDATE users SET stars = stars + ? WHERE id = ?', [amount, req.user.id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.get('SELECT stars FROM users WHERE id = ?', [req.user.id], (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ stars: user.stars });
    });
  });
});

// Купить подарок
app.post('/api/user/gifts', authenticateToken, (req, res) => {
  const { giftId, giftName, giftIcon, giftPrice } = req.body;
  
  db.get('SELECT stars FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (user.stars < giftPrice) {
      return res.status(400).json({ error: 'Insufficient stars' });
    }
    
    db.run('UPDATE users SET stars = stars - ? WHERE id = ?', [giftPrice, req.user.id]);
    
    db.run(
      `INSERT INTO userGifts (userId, giftId, giftName, giftIcon, giftPrice)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.id, giftId, giftName, giftIcon, giftPrice],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ success: true });
      }
    );
  });
});

// Middleware для проверки JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});