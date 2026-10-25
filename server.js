const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Oda yönetimi
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoom(hostSocketId, hostName, settings) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    hostId: hostSocketId,
    settings: {
      maxPlayers: settings.maxPlayers || 8,
      numVampires: settings.numVampires || 1,
      discussionTime: settings.discussionTime || 60,
      voteTime: settings.voteTime || 30
    },
    players: new Map(),
    phase: 'lobby',
    nightVotes: {},      // vampireId -> targetId
    dayVotes: {},       // playerId -> targetId
    killedTonight: null,
    eliminatedToday: null,
    winner: null,
    discussionEndsAt: null,
    voteEndsAt: null,
    timers: {}
  };

  rooms.set(code, room);
  return room;
}

function getAlivePlayers(room) {
  return Array.from(room.players.values()).filter(p => p.isAlive);
}

function getAliveVampires(room) {
  return getAlivePlayers(room).filter(p => p.role === 'vampir');
}

function getAliveVillagers(room) {
  return getAlivePlayers(room).filter(p => p.role === 'koylu');
}

function assignRoles(room) {
  const playerList = Array.from(room.players.values());
  const numVampires = Math.min(room.settings.numVampires, Math.floor(playerList.length / 2));
  
  // Karıştır
  for (let i = playerList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
  }

  playerList.forEach((p, idx) => {
    p.role = idx < numVampires ? 'vampir' : 'koylu';
    p.isAlive = true;
    p.hasVoted = false;
  });
}

function checkWinCondition(room) {
  const aliveVamps = getAliveVampires(room);
  const aliveVillagers = getAliveVillagers(room);

  if (aliveVamps.length === 0) {
    room.winner = 'koylu';
    room.phase = 'game_over';
    return true;
  }
  if (aliveVamps.length >= aliveVillagers.length) {
    room.winner = 'vampir';
    room.phase = 'game_over';
    return true;
  }
  return false;
}

function broadcastRoom(room) {
  const publicPlayers = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    isAlive: p.isAlive,
    isHost: p.id === room.hostId,
    // Rol sadece oyun sonunda gösterilir
    role: room.phase === 'game_over' ? p.role : undefined
  }));

  io.to(room.code).emit('roomUpdate', {
    code: room.code,
    phase: room.phase,
    players: publicPlayers,
    settings: room.settings,
    hostId: room.hostId,
    killedTonight: room.killedTonight,
    eliminatedToday: room.eliminatedToday,
    winner: room.winner,
    discussionEndsAt: room.discussionEndsAt,
    voteEndsAt: room.voteEndsAt,
    aliveCount: getAlivePlayers(room).length
  });
}

function sendPrivateState(socket, room) {
  const player = room.players.get(socket.id);
  if (!player) return;

  const isVampire = player.role === 'vampir';
  const vampires = isVampire
    ? Array.from(room.players.values())
        .filter(p => p.role === 'vampir')
        .map(p => ({ id: p.id, name: p.name, isAlive: p.isAlive }))
    : [];

  socket.emit('privateState', {
    myId: player.id,
    myName: player.name,
    myRole: player.role,
    isAlive: player.isAlive,
    isHost: player.id === room.hostId,
    fellowVampires: vampires,
    nightVotes: isVampire ? room.nightVotes : {},
    dayVotes: room.dayVotes,
    phase: room.phase
  });
}

function clearTimers(room) {
  if (room.timers.discussion) clearTimeout(room.timers.discussion);
  if (room.timers.vote) clearTimeout(room.timers.vote);
  room.timers = {};
}

function startNight(room) {
  clearTimers(room);
  room.phase = 'night';
  room.nightVotes = {};
  room.killedTonight = null;
  room.eliminatedToday = null;

  Array.from(room.players.values()).forEach(p => {
    p.hasVoted = false;
  });

  broadcastRoom(room);
  Array.from(room.players.keys()).forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) sendPrivateState(s, room);
  });

  // Demo botları varsa gece aksiyonu başlat
  if (Array.from(room.players.values()).some(p => p.isBot)) {
    setTimeout(() => botNightAction(room), 1500);
  }
}

function resolveNight(room) {
  // En çok oy alan kişi ölür (eşitlikte rastgele)
  const voteCounts = {};
  Object.values(room.nightVotes).forEach(targetId => {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let candidates = [];
  for (const [id, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [id];
    } else if (count === maxVotes) {
      candidates.push(id);
    }
  }

  if (candidates.length > 0 && maxVotes > 0) {
    const killedId = candidates[Math.floor(Math.random() * candidates.length)];
    const killed = room.players.get(killedId);
    if (killed && killed.isAlive) {
      killed.isAlive = false;
      room.killedTonight = { id: killed.id, name: killed.name };
    }
  } else {
    room.killedTonight = null; // Kimse ölmedi
  }

  if (checkWinCondition(room)) {
    broadcastRoom(room);
    Array.from(room.players.keys()).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPrivateState(s, room);
    });
    return;
  }

  startDayDiscussion(room);
}

function startDayDiscussion(room) {
  clearTimers(room);
  room.phase = 'day_discussion';
  room.dayVotes = {};
  room.discussionEndsAt = Date.now() + room.settings.discussionTime * 1000;

  broadcastRoom(room);
  Array.from(room.players.keys()).forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) sendPrivateState(s, room);
  });

  room.timers.discussion = setTimeout(() => {
    startDayVote(room);
  }, room.settings.discussionTime * 1000);
}

function startDayVote(room) {
  clearTimers(room);
  room.phase = 'day_vote';
  room.dayVotes = {};
  room.voteEndsAt = Date.now() + room.settings.voteTime * 1000;

  Array.from(room.players.values()).forEach(p => {
    p.hasVoted = false;
  });

  broadcastRoom(room);
  Array.from(room.players.keys()).forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) sendPrivateState(s, room);
  });

  room.timers.vote = setTimeout(() => {
    resolveDayVote(room);
  }, room.settings.voteTime * 1000);

  // Demo botları oy versin
  if (Array.from(room.players.values()).some(p => p.isBot)) {
    scheduleBotDayVotes(room);
  }
}

function resolveDayVote(room) {
  const voteCounts = {};
  Object.values(room.dayVotes).forEach(targetId => {
    if (targetId === 'skip') return;
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let candidates = [];
  for (const [id, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      candidates = [id];
    } else if (count === maxVotes) {
      candidates.push(id);
    }
  }

  // En az 1 oy ve tek aday varsa elenir (eşitlikte kimse elenmez basitlik için)
  if (candidates.length === 1 && maxVotes > 0) {
    const eliminatedId = candidates[0];
    const eliminated = room.players.get(eliminatedId);
    if (eliminated && eliminated.isAlive) {
      eliminated.isAlive = false;
      room.eliminatedToday = { id: eliminated.id, name: eliminated.name, role: eliminated.role };
    }
  } else {
    room.eliminatedToday = null;
  }

  if (checkWinCondition(room)) {
    broadcastRoom(room);
    Array.from(room.players.keys()).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPrivateState(s, room);
    });
    return;
  }

  // Yeni gece
  startNight(room);
}

// Socket bağlantıları
io.on('connection', (socket) => {
  console.log('Bağlandı:', socket.id);

  socket.on('createRoom', ({ name, maxPlayers, numVampires, discussionTime, voteTime }) => {
    if (!name || name.trim().length < 1) {
      socket.emit('error', 'İsim gerekli');
      return;
    }

    const settings = {
      maxPlayers: Math.min(16, Math.max(3, parseInt(maxPlayers) || 8)),
      numVampires: Math.max(1, parseInt(numVampires) || 1),
      discussionTime: Math.min(180, Math.max(15, parseInt(discussionTime) || 60)),
      voteTime: Math.min(90, Math.max(15, parseInt(voteTime) || 30))
    };

    // Vampir sayısı kontrolü
    if (settings.numVampires >= settings.maxPlayers) {
      settings.numVampires = Math.max(1, Math.floor(settings.maxPlayers / 3));
    }

    const room = createRoom(socket.id, name.trim(), settings);
    room.players.set(socket.id, {
      id: socket.id,
      name: name.trim().substring(0, 16),
      role: null,
      isAlive: true,
      hasVoted: false
    });

    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code });
    broadcastRoom(room);
    sendPrivateState(socket, room);
  });

  socket.on('joinRoom', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', 'Oda bulunamadı');
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('error', 'Oyun zaten başlamış');
      return;
    }
    if (room.players.size >= room.settings.maxPlayers) {
      socket.emit('error', 'Oda dolu');
      return;
    }
    if (!name || name.trim().length < 1) {
      socket.emit('error', 'İsim gerekli');
      return;
    }

    // Aynı isim kontrolü
    const nameExists = Array.from(room.players.values()).some(
      p => p.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (nameExists) {
      socket.emit('error', 'Bu isim zaten kullanılıyor');
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: name.trim().substring(0, 16),
      role: null,
      isAlive: true,
      hasVoted: false
    });

    socket.join(code);
    socket.emit('joinedRoom', { code });
    broadcastRoom(room);
    sendPrivateState(socket, room);
  });

  socket.on('startGame', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('error', 'Sadece oda sahibi başlatabilir');
      return;
    }
    if (room.players.size < 3) {
      socket.emit('error', 'En az 3 oyuncu gerekli');
      return;
    }
    if (room.phase !== 'lobby') return;

    assignRoles(room);
    room.phase = 'role_reveal';

    broadcastRoom(room);
    Array.from(room.players.keys()).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPrivateState(s, room);
    });

    // 5 saniye rol göster, sonra gece başlasın
    setTimeout(() => {
      if (rooms.has(room.code) && room.phase === 'role_reveal') {
        startNight(room);
      }
    }, 5000);
  });

  socket.on('nightVote', ({ targetId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== 'night') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isAlive || player.role !== 'vampir') return;

    const target = room.players.get(targetId);
    if (!target || !target.isAlive || target.role === 'vampir') return; // Vampirler birbirini öldüremez

    room.nightVotes[socket.id] = targetId;
    player.hasVoted = true;

    // Tüm canlı vampirler oy verdiyse hemen çöz
    const aliveVamps = getAliveVampires(room);
    const votedCount = aliveVamps.filter(v => room.nightVotes[v.id]).length;

    broadcastRoom(room);
    Array.from(room.players.keys()).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPrivateState(s, room);
    });

    if (votedCount >= aliveVamps.length) {
      resolveNight(room);
    }
  });

  socket.on('dayVote', ({ targetId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== 'day_vote') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isAlive) return;

    // skip veya canlı oyuncu
    if (targetId !== 'skip') {
      const target = room.players.get(targetId);
      if (!target || !target.isAlive) return;
    }

    room.dayVotes[socket.id] = targetId;
    player.hasVoted = true;

    broadcastRoom(room);
    Array.from(room.players.keys()).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) sendPrivateState(s, room);
    });

    // Herkes oy verdiyse erken bitir
    const alive = getAlivePlayers(room);
    const votedCount = alive.filter(p => room.dayVotes[p.id]).length;
    if (votedCount >= alive.length) {
      clearTimers(room);
      resolveDayVote(room);
    }
  });

  socket.on('skipDiscussion', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== 'day_discussion') return;
    if (room.hostId !== socket.id) return;

    clearTimers(room);
    startDayVote(room);
  });

  // Demo modu: Botlarla dolu oda oluştur
  socket.on('createDemo', ({ name }) => {
    const settings = {
      maxPlayers: 6,
      numVampires: 2,
      discussionTime: 20,
      voteTime: 15
    };

    const room = createRoom(socket.id, name || 'DemoHost', settings);

    // Gerçek oyuncu
    room.players.set(socket.id, {
      id: socket.id,
      name: (name || 'Sen').substring(0, 16),
      role: null,
      isAlive: true,
      hasVoted: false
    });

    // 5 bot ekle
    const botNames = ['Ayse', 'Mehmet', 'Zeynep', 'Can', 'Elif'];
    botNames.forEach((botName, i) => {
      const botId = 'bot_' + i + '_' + Date.now();
      room.players.set(botId, {
        id: botId,
        name: botName,
        role: null,
        isAlive: true,
        hasVoted: false,
        isBot: true
      });
    });

    socket.join(room.code);
    socket.emit('roomCreated', { code: room.code, isDemo: true });
    broadcastRoom(room);
    sendPrivateState(socket, room);

    // Demo için otomatik başlat (2 sn sonra)
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      assignRoles(room);
      room.phase = 'role_reveal';
      broadcastRoom(room);
      sendPrivateState(socket, room);

      setTimeout(() => {
        if (rooms.has(room.code) && room.phase === 'role_reveal') {
          startNight(room);
          // Bot vampirleri otomatik oy versin
          setTimeout(() => botNightAction(room), 2000);
        }
      }, 4000);
    }, 1500);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      clearTimers(room);
      rooms.delete(room.code);
      return;
    }

    // Host gittiyse yeni host ata
    if (room.hostId === socket.id) {
      const newHost = room.players.keys().next().value;
      room.hostId = newHost;
    }

    // Oyun sırasında biri çıkarsa ve yetersiz kalırsa
    if (room.phase !== 'lobby' && room.phase !== 'game_over') {
      if (getAlivePlayers(room).length < 3 || checkWinCondition(room)) {
        // devam et veya bitir
      }
    }

    broadcastRoom(room);
  });
});

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

// Bot davranışları (Demo için)
function botNightAction(room) {
  if (room.phase !== 'night') return;

  const aliveVamps = getAliveVampires(room).filter(p => p.isBot);
  const possibleTargets = getAliveVillagers(room);

  if (possibleTargets.length === 0) return;

  aliveVamps.forEach(vamp => {
    if (!room.nightVotes[vamp.id]) {
      const target = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
      room.nightVotes[vamp.id] = target.id;
    }
  });

  // Gerçek oyuncu da vampirse bekle, değilse çöz
  const realVamps = getAliveVampires(room).filter(p => !p.isBot);
  if (realVamps.length === 0 || realVamps.every(v => room.nightVotes[v.id])) {
    setTimeout(() => resolveNight(room), 1000);
  } else {
    // Gerçek oyuncu oy verene kadar bekle, ama timeout koy
    setTimeout(() => {
      if (room.phase === 'night') {
        // Kalan botlar zaten oy verdi, gerçek oyuncu vermediyse rastgele bir şey yapma, sadece çöz
        const stillNeeded = getAliveVampires(room).filter(v => !room.nightVotes[v.id]);
        stillNeeded.forEach(v => {
          if (v.isBot) {
            const t = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
            room.nightVotes[v.id] = t.id;
          }
        });
        // Eğer gerçek oyuncu hâlâ vermediyse bile çöz (demo rahatlığı)
        resolveNight(room);
      }
    }, 12000);
  }
}

// Day vote botları
function scheduleBotDayVotes(room) {
  if (room.phase !== 'day_vote') return;

  const bots = getAlivePlayers(room).filter(p => p.isBot);
  bots.forEach((bot, idx) => {
    setTimeout(() => {
      if (room.phase !== 'day_vote' || !room.players.has(bot.id)) return;
      const alive = getAlivePlayers(room).filter(p => p.id !== bot.id);
      if (alive.length === 0) return;

      // %70 oy ver, %30 skip
      if (Math.random() < 0.7) {
        const target = alive[Math.floor(Math.random() * alive.length)];
        room.dayVotes[bot.id] = target.id;
      } else {
        room.dayVotes[bot.id] = 'skip';
      }

      broadcastRoom(room);
      // Host'a private güncelle (sadece gerçek oyuncu var)
      const hostSocket = io.sockets.sockets.get(room.hostId);
      if (hostSocket) sendPrivateState(hostSocket, room);

      // Herkes oy verdi mi kontrol
      const allAlive = getAlivePlayers(room);
      const voted = allAlive.filter(p => room.dayVotes[p.id]).length;
      if (voted >= allAlive.length) {
        clearTimers(room);
        resolveDayVote(room);
      }
    }, 1500 + idx * 800 + Math.random() * 1000);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Vampir-Köylü oyunu çalışıyor: http://localhost:${PORT}`);
});
