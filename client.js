const socket = io();

// State
let myId = null;
let myRole = null;
let isAlive = true;
let isHost = false;
let currentPhase = 'lobby';
let roomCode = null;
let selectedTarget = null;
let timerInterval = null;
let isDemo = false;

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`#screen-${id}`);
  if (el) el.classList.add('active');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatTime(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Navigation
$$('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

$('#btn-create').addEventListener('click', () => showScreen('create'));
$('#btn-join').addEventListener('click', () => showScreen('join'));
$('#btn-home').addEventListener('click', () => {
  location.reload();
});

// Create room
$('#btn-create-confirm').addEventListener('click', () => {
  const name = $('#create-name').value.trim();
  if (!name) return toast('İsim giriniz');

  socket.emit('createRoom', {
    name,
    maxPlayers: $('#create-max').value,
    numVampires: $('#create-vamps').value,
    discussionTime: $('#create-disc').value,
    voteTime: $('#create-vote').value
  });
});

// Join room
$('#btn-join-confirm').addEventListener('click', () => {
  const name = $('#join-name').value.trim();
  const code = $('#join-code').value.trim();
  if (!name) return toast('İsim giriniz');
  if (!code) return toast('Oda kodu giriniz');

  socket.emit('joinRoom', { name, code });
});

// Demo
$('#btn-demo').addEventListener('click', () => {
  const name = prompt('Demo için ismin:', 'Sen') || 'Sen';
  isDemo = true;
  socket.emit('createDemo', { name });
});

// Start game
$('#btn-start').addEventListener('click', () => {
  socket.emit('startGame');
});

// Copy link
$('#btn-copy-link').addEventListener('click', () => {
  const link = `${location.origin}?room=${roomCode}`;
  navigator.clipboard.writeText(link).then(() => {
    toast('Link kopyalandı!');
  }).catch(() => {
    toast(`Kod: ${roomCode}`);
  });
});

// URL ile otomatik katıl
window.addEventListener('load', () => {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) {
    showScreen('join');
    $('#join-code').value = room.toUpperCase();
  }
});

// Socket events
socket.on('error', (msg) => toast(msg));

socket.on('roomCreated', ({ code, isDemo: demo }) => {
  roomCode = code;
  isDemo = !!demo;
  showScreen('lobby');
  $('#lobby-code').textContent = code;
});

socket.on('joinedRoom', ({ code }) => {
  roomCode = code;
  showScreen('lobby');
  $('#lobby-code').textContent = code;
});

socket.on('roomUpdate', (data) => {
  currentPhase = data.phase;

  // Lobby
  if (data.phase === 'lobby') {
    showScreen('lobby');
    $('#lobby-code').textContent = data.code;
    $('#player-count').textContent = `${data.players.length}/${data.settings.maxPlayers}`;

    const list = $('#player-list');
    list.innerHTML = '';
    data.players.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="player-avatar">${p.name.charAt(0).toUpperCase()}</div>
        <span class="player-name">${escapeHtml(p.name)}</span>
        ${p.isHost ? '<span class="host-badge">Host</span>' : ''}
      `;
      list.appendChild(li);
    });

    $('#lobby-settings').textContent =
      `Vampir: ${data.settings.numVampires} • Tartışma: ${data.settings.discussionTime}s • Oy: ${data.settings.voteTime}s`;

    const amIHost = isHost || (myId && data.hostId === myId);
    if (amIHost) {
      $('#btn-start').style.display = 'block';
      $('#waiting-text').style.display = 'none';
    } else {
      $('#btn-start').style.display = 'none';
      $('#waiting-text').style.display = 'block';
    }
  }

  // Role reveal
  if (data.phase === 'role_reveal') {
    showScreen('role');
  }

  // Game phases
  if (['night', 'day_discussion', 'day_vote'].includes(data.phase)) {
    showScreen('game');
    renderGame(data);
  }

  // Game over
  if (data.phase === 'game_over') {
    showScreen('end');
    renderEnd(data);
  }
});

socket.on('privateState', (data) => {
  myId = data.myId;
  myRole = data.myRole;
  isAlive = data.isAlive;
  isHost = data.isHost;
  currentPhase = data.phase;

  // Role screen
  if (data.phase === 'role_reveal' || data.myRole) {
    const isVamp = data.myRole === 'vampir';
    $('#role-emoji').textContent = isVamp ? '🧛' : '🧑‍🌾';
    $('#role-name').textContent = isVamp ? 'VAMPİR' : 'KÖYLÜ';
    $('#role-name').className = 'role-name ' + data.myRole;
    $('#role-desc').textContent = isVamp
      ? 'Geceleri bir köylüyü öldür. Gündüz kendini gizle.'
      : 'Vampirleri bul ve oylamayla elenmelerini sağla.';

    if (isVamp && data.fellowVampires.length > 1) {
      const others = data.fellowVampires
        .filter(v => v.id !== myId)
        .map(v => v.name)
        .join(', ');
      $('#role-fellows').innerHTML = others
        ? `Diğer vampirler: <strong>${escapeHtml(others)}</strong>`
        : '';
    } else {
      $('#role-fellows').textContent = '';
    }
  }

  // Update my status in game
  if (['night', 'day_discussion', 'day_vote'].includes(data.phase)) {
    updateMyStatus(data);
    renderActionPanel(data);
  }
});

function updateMyStatus(data) {
  const badge = $('#my-role-badge');
  badge.textContent = data.myRole === 'vampir' ? '🧛 Vampir' : '🧑‍🌾 Köylü';
  badge.className = data.myRole;

  $('#alive-status').textContent = data.isAlive ? '• Yaşıyorsun' : '• Öldün (izleyici)';
}

function renderGame(data) {
  // Phase badge
  const badge = $('#phase-badge');
  badge.className = 'phase-badge';
  if (data.phase === 'night') {
    badge.textContent = 'GECE';
    badge.classList.add('night');
  } else if (data.phase === 'day_discussion') {
    badge.textContent = 'TARTIŞMA';
    badge.classList.add('day');
  } else if (data.phase === 'day_vote') {
    badge.textContent = 'OYLAMA';
    badge.classList.add('vote');
  }

  // Timer
  clearInterval(timerInterval);
  const timerEl = $('#game-timer');
  if (data.phase === 'day_discussion' && data.discussionEndsAt) {
    updateTimer(data.discussionEndsAt, timerEl);
  } else if (data.phase === 'day_vote' && data.voteEndsAt) {
    updateTimer(data.voteEndsAt, timerEl);
  } else {
    timerEl.textContent = '';
  }

  // Announcement
  const ann = $('#announcement');
  if (data.phase === 'night') {
    ann.innerHTML = '🌙 <strong>Gece oldu.</strong> Vampirler bir kurban seçiyor...';
  } else if (data.phase === 'day_discussion') {
    if (data.killedTonight) {
      ann.innerHTML = `💀 <strong>${escapeHtml(data.killedTonight.name)}</strong> bu gece öldürüldü. Tartışın!`;
    } else {
      ann.innerHTML = '☀️ <strong>Kimse ölmedi.</strong> Tartışmaya devam edin.';
    }
  } else if (data.phase === 'day_vote') {
    ann.innerHTML = '🗳️ <strong>Oylama zamanı!</strong> Şüpheli kişiyi seçin veya geçin.';
  }

  // Players grid
  const grid = $('#players-grid');
  grid.innerHTML = '';

  data.players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card' + (p.isAlive ? '' : ' dead');
    card.dataset.id = p.id;

    let emoji = p.isAlive ? '👤' : '💀';
    if (!p.isAlive) emoji = '💀';

    card.innerHTML = `
      <div class="p-emoji">${emoji}</div>
      <div class="p-name">${escapeHtml(p.name)}</div>
    `;

    if (p.isAlive && isAlive && (currentPhase === 'night' || currentPhase === 'day_vote')) {
      card.addEventListener('click', () => selectPlayer(p.id, card));
    }

    grid.appendChild(card);
  });
}

function selectPlayer(id, cardEl) {
  if (!isAlive) return;
  if (id === myId && currentPhase === 'night') return; // Kendini öldüremezsin

  selectedTarget = id;
  $$('.player-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  // Action panel'i güncelle
  const confirmBtn = $('#confirm-vote');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = currentPhase === 'night' ? 'Öldür' : 'Oy Ver';
  }
}

function renderActionPanel(data) {
  const panel = $('#action-panel');
  selectedTarget = null;

  if (!isAlive) {
    panel.innerHTML = '<p style="color:var(--text-dim);text-align:center;">Öldün. İzleyici modundasın.</p>';
    return;
  }

  if (data.phase === 'night') {
    if (data.myRole === 'vampir') {
      panel.innerHTML = `
        <h3>Bir köylü seç ve öldür</h3>
        <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:12px;">
          Diğer vampirlerle aynı kişiyi seçmeye çalışın.
        </p>
        <button class="btn btn-primary" id="confirm-vote" disabled>Öldür</button>
      `;
      $('#confirm-vote').addEventListener('click', () => {
        if (selectedTarget) {
          socket.emit('nightVote', { targetId: selectedTarget });
          panel.innerHTML = '<p style="text-align:center;color:var(--success);">✓ Oyunuz alındı. Diğer vampirler bekleniyor...</p>';
        }
      });
    } else {
      panel.innerHTML = '<p style="text-align:center;color:var(--text-dim);">🌙 Vampirler karar veriyor. Bekleyin...</p>';
    }
  } else if (data.phase === 'day_discussion') {
    panel.innerHTML = `
      <h3>Tartışma devam ediyor</h3>
      <p style="font-size:0.85rem;color:var(--text-dim);">
        Birbirinizle konuşun (sesli veya mesaj). Süre bitince oylama başlar.
      </p>
      ${isHost ? '<button class="btn btn-skip" id="btn-skip-disc">Tartışmayı Bitir (Host)</button>' : ''}
    `;
    const skipBtn = $('#btn-skip-disc');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => socket.emit('skipDiscussion'));
    }
  } else if (data.phase === 'day_vote') {
    panel.innerHTML = `
      <h3>Kimi elenmesini istiyorsun?</h3>
      <div class="vote-actions">
        <button class="btn btn-primary" id="confirm-vote" disabled>Oy Ver</button>
        <button class="btn btn-secondary" id="btn-skip-vote">Geç</button>
      </div>
    `;
    $('#confirm-vote').addEventListener('click', () => {
      if (selectedTarget) {
        socket.emit('dayVote', { targetId: selectedTarget });
        panel.innerHTML = '<p style="text-align:center;color:var(--success);">✓ Oyunuz alındı.</p>';
      }
    });
    $('#btn-skip-vote').addEventListener('click', () => {
      socket.emit('dayVote', { targetId: 'skip' });
      panel.innerHTML = '<p style="text-align:center;color:var(--success);">✓ Geçtiniz.</p>';
    });
  }
}

function updateTimer(endsAt, el) {
  function tick() {
    const left = endsAt - Date.now();
    el.textContent = formatTime(left);
    if (left <= 0) {
      clearInterval(timerInterval);
      el.textContent = '0:00';
    }
  }
  tick();
  timerInterval = setInterval(tick, 200);
}

function renderEnd(data) {
  const isVampWin = data.winner === 'vampir';
  $('#end-emoji').textContent = isVampWin ? '🧛' : '🧑‍🌾';
  $('#end-title').textContent = isVampWin ? 'Vampirler Kazandı!' : 'Köylüler Kazandı!';
  $('#end-desc').textContent = isVampWin
    ? 'Vampirler köylüleri alt etti.'
    : 'Tüm vampirler elendi. Köy güvende!';

  const container = $('#final-roles');
  if (data.players && data.players.length) {
    container.innerHTML = data.players.map(p => `
      <div class="role-row">
        <span>${escapeHtml(p.name)} ${p.isAlive ? '' : '(öldü)'}</span>
        <span class="role-tag ${p.role}">${p.role === 'vampir' ? 'Vampir' : 'Köylü'}</span>
      </div>
    `).join('');
  } else {
    container.innerHTML = '<p style="color:var(--text-dim);font-size:0.9rem;">Oyun sona erdi.</p>';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Bağlantı durumu
socket.on('connect', () => {
  console.log('Bağlandı');
});

socket.on('disconnect', () => {
  toast('Bağlantı koptu. Yenileniyor...');
  setTimeout(() => location.reload(), 2000);
});
