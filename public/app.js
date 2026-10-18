const joinModal = document.getElementById('join-modal');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const btnEnterRoom = document.getElementById('btn-enter-room');

const roomCodeBadge = document.getElementById('room-code-badge');
const btnCopyInvite = document.getElementById('btn-copy-invite');
const latencyPill = document.getElementById('latency-pill');
const driftPill = document.getElementById('drift-pill');
const hostIndicator = document.getElementById('host-indicator');
const connBadge = document.getElementById('conn-badge');

const sharedVideo = document.getElementById('shared-video');
const currentVideoTitle = document.getElementById('current-video-title');
const playbackStatus = document.getElementById('playback-status');
const emojiFloatingLayer = document.getElementById('emoji-floating-layer');
const syncNotice = document.getElementById('sync-notice');

const customVideoInput = document.getElementById('custom-video-input');
const btnLoadCustom = document.getElementById('btn-load-custom');
const btnQueueCustom = document.getElementById('btn-queue-custom');

const movieSearch = document.getElementById('movie-search');
const categoryFilters = document.getElementById('category-filters');
const movieGrid = document.getElementById('movie-grid');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const chatStream = document.getElementById('chat-stream');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const queueStream = document.getElementById('queue-stream');
const queueCount = document.getElementById('queue-count');
const usersStream = document.getElementById('users-stream');
const userCount = document.getElementById('user-count');

const activePollCard = document.getElementById('active-poll-card');
const pollQuestionDisplay = document.getElementById('poll-question-display');
const pollOptionsContainer = document.getElementById('poll-options-container');
const pollVoteCount = document.getElementById('poll-vote-count');
const pollQInput = document.getElementById('poll-q-input');
const pollOpt1Input = document.getElementById('poll-opt1-input');
const pollOpt2Input = document.getElementById('poll-opt2-input');
const btnLaunchPoll = document.getElementById('btn-launch-poll');

let ws = null;
let currentRoom = null;
let currentUserName = null;
let currentUserId = null;
let isHost = false;
let isHandlingRemote = false;
let moviesCatalog = [];
let activeCategory = 'all';

const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
  roomInput.value = roomParam;
}

btnEnterRoom.addEventListener('click', () => {
  const name = usernameInput.value.trim() || 'Guest' + Math.floor(Math.random() * 900 + 100);
  const code = (roomInput.value.trim() || 'PARTY1').toUpperCase();
  currentUserName = name;
  currentRoom = code;
  joinModal.classList.add('hidden');
  initWebSocket();
});

btnCopyInvite.addEventListener('click', () => {
  const inviteUrl = `${location.origin}/?room=${currentRoom}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showNotice('Invite Link Copied!');
  });
});

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  connBadge.textContent = 'Connecting';
  connBadge.className = 'connection-status';

  ws.onopen = () => {
    connBadge.textContent = 'Online';
    connBadge.className = 'connection-status connected';
    ws.send(JSON.stringify({
      type: 'join',
      room: currentRoom,
      name: currentUserName
    }));
    startDriftPingLoop();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'room_state') {
      currentRoom = data.room;
      currentUserId = data.userId;
      isHost = data.isHost;
      roomCodeBadge.textContent = currentRoom;
      updateHostBadge();

      currentVideoTitle.textContent = data.playback.title;
      isHandlingRemote = true;
      sharedVideo.src = data.playback.videoUrl;
      sharedVideo.currentTime = data.playback.currentTime;
      if (data.playback.isPlaying) {
        sharedVideo.play().catch(() => {});
        playbackStatus.textContent = 'Playing';
      } else {
        sharedVideo.pause();
        playbackStatus.textContent = 'Paused';
      }
      setTimeout(() => { isHandlingRemote = false; }, 300);

      renderChat(data.chat);
      renderUsers(data.participants);
      renderQueue(data.playlist);
      renderPoll(data.poll);
    } else if (data.type === 'play') {
      isHandlingRemote = true;
      if (Math.abs(sharedVideo.currentTime - data.currentTime) > 0.4) {
        sharedVideo.currentTime = data.currentTime;
      }
      sharedVideo.play().catch(() => {});
      playbackStatus.textContent = 'Playing';
      showNotice(`${data.triggeredBy} played`);
      setTimeout(() => { isHandlingRemote = false; }, 500);
    } else if (data.type === 'pause') {
      isHandlingRemote = true;
      if (Math.abs(sharedVideo.currentTime - data.currentTime) > 0.4) {
        sharedVideo.currentTime = data.currentTime;
      }
      sharedVideo.pause();
      playbackStatus.textContent = 'Paused';
      showNotice(`${data.triggeredBy} paused`);
      setTimeout(() => { isHandlingRemote = false; }, 500);
    } else if (data.type === 'seek') {
      isHandlingRemote = true;
      sharedVideo.currentTime = data.currentTime;
      if (data.isPlaying && sharedVideo.paused) {
        sharedVideo.play().catch(() => {});
      }
      showNotice(`${data.triggeredBy} seeked to ${formatTime(data.currentTime)}`);
      setTimeout(() => { isHandlingRemote = false; }, 300);
    } else if (data.type === 'video_changed') {
      isHandlingRemote = true;
      currentVideoTitle.textContent = data.title;
      sharedVideo.src = data.videoUrl;
      sharedVideo.currentTime = data.currentTime;
      if (data.isPlaying) {
        sharedVideo.play().catch(() => {});
        playbackStatus.textContent = 'Playing';
      }
      showNotice(`Now Playing: ${data.title}`);
      setTimeout(() => { isHandlingRemote = false; }, 400);
    } else if (data.type === 'drift_pong') {
      const now = Date.now();
      const rtt = now - data.clientPingTimestamp;
      latencyPill.textContent = `RTT: ${rtt} ms`;

      if (data.isPlaying) {
        const estimatedMaster = data.masterTime + (rtt / 2000);
        const drift = Math.abs(sharedVideo.currentTime - estimatedMaster);
        driftPill.textContent = `Drift: ${Math.round(drift * 1000)} ms`;

        if (drift > 0.5) {
          isHandlingRemote = true;
          sharedVideo.currentTime = estimatedMaster;
          showNotice('Drift Corrected');
          setTimeout(() => { isHandlingRemote = false; }, 300);
        } else if (drift > 0.15) {
          if (sharedVideo.currentTime < estimatedMaster) {
            sharedVideo.playbackRate = 1.05;
          } else {
            sharedVideo.playbackRate = 0.95;
          }
        } else {
          sharedVideo.playbackRate = 1.0;
        }
      } else {
        driftPill.textContent = 'Drift: 0 ms';
        sharedVideo.playbackRate = 1.0;
      }
    } else if (data.type === 'chat_message') {
      appendChatMessage(data.message);
    } else if (data.type === 'reaction') {
      spawnFloatingEmoji(data.emoji);
    } else if (data.type === 'user_joined') {
      renderUsers(data.participants);
      appendSystemMessage(`${data.user.name} joined the watch party`);
    } else if (data.type === 'user_left') {
      renderUsers(data.participants);
      appendSystemMessage(`${data.userName} left the room`);
    } else if (data.type === 'playlist_updated') {
      renderQueue(data.playlist);
    } else if (data.type === 'poll_updated') {
      renderPoll(data.poll);
    } else if (data.type === 'host_transferred') {
      isHost = (data.newHostId === currentUserId);
      updateHostBadge();
      renderUsers(data.participants);
      showNotice('Host transferred');
    }
  };

  ws.onclose = () => {
    connBadge.textContent = 'Reconnecting';
    connBadge.className = 'connection-status';
    setTimeout(initWebSocket, 1500);
  };
}

sharedVideo.addEventListener('play', () => {
  if (!isHandlingRemote && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'play',
      currentTime: sharedVideo.currentTime
    }));
  }
});

sharedVideo.addEventListener('pause', () => {
  if (!isHandlingRemote && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'pause',
      currentTime: sharedVideo.currentTime
    }));
  }
});

sharedVideo.addEventListener('seeked', () => {
  if (!isHandlingRemote && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'seek',
      currentTime: sharedVideo.currentTime
    }));
  }
});

function startDriftPingLoop() {
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'drift_ping',
        pingTimestamp: Date.now()
      }));
    }
  }, 2000);
}

function updateHostBadge() {
  if (isHost) {
    hostIndicator.textContent = '👑 Room Host';
    hostIndicator.className = 'host-badge is-host';
  } else {
    hostIndicator.textContent = 'Participant';
    hostIndicator.className = 'host-badge';
  }
}

function showNotice(msg) {
  syncNotice.textContent = msg;
  syncNotice.classList.remove('hidden');
  setTimeout(() => {
    syncNotice.classList.add('hidden');
  }, 2000);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

document.querySelectorAll('.btn-reaction').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    spawnFloatingEmoji(emoji);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'reaction',
        emoji: emoji
      }));
    }
  });
});

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  el.style.left = `${Math.random() * 80 + 10}%`;
  emojiFloatingLayer.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2500);
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'chat',
      text: text
    }));
    chatInput.value = '';
  }
});

function renderChat(chatList) {
  chatStream.innerHTML = '';
  chatList.forEach(appendChatMessage);
}

function appendChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-user">${escapeHtml(msg.userName)}</span>
      <span class="chat-time">${escapeHtml(msg.time)}</span>
    </div>
    <div class="chat-text">${escapeHtml(msg.text)}</div>
  `;
  chatStream.appendChild(div);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-sys';
  div.textContent = text;
  chatStream.appendChild(div);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[s]);
}

btnLoadCustom.addEventListener('click', () => {
  const url = customVideoInput.value.trim();
  if (url && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'change_video',
      videoUrl: url,
      title: 'Custom Stream'
    }));
    customVideoInput.value = '';
  }
});

btnQueueCustom.addEventListener('click', () => {
  const url = customVideoInput.value.trim();
  if (url && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'playlist_add',
      videoUrl: url,
      title: 'Custom Video'
    }));
    customVideoInput.value = '';
  }
});

fetch('movies.json')
  .then(res => res.json())
  .then(data => {
    moviesCatalog = data;
    renderMovies();
  })
  .catch(() => {});

function renderMovies() {
  const q = movieSearch.value.toLowerCase().trim();
  movieGrid.innerHTML = '';

  const filtered = moviesCatalog.filter(m => {
    const matchesCat = activeCategory === 'all' || m.category === activeCategory;
    const matchesQuery = !q || m.title.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  filtered.forEach(m => {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.innerHTML = `
      <img src="${m.thumbnail}" class="movie-card-thumb" alt="${m.title}">
      <div class="movie-card-body">
        <div class="movie-card-title">${m.title}</div>
        <div class="movie-card-tags">
          <span class="tag-cat">${m.category}</span>
          <span class="tag-year">${m.year} • ${m.duration}</span>
        </div>
        <div class="movie-card-desc">${m.description}</div>
        <div class="movie-card-actions">
          <button class="btn-card-play" data-id="${m.id}">▶ Watch Now</button>
          <button class="btn-card-queue" data-id="${m.id}">+ Queue</button>
        </div>
      </div>
    `;

    card.querySelector('.btn-card-play').addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'change_video',
          videoUrl: m.videoUrl,
          title: m.title
        }));
      }
    });

    card.querySelector('.btn-card-queue').addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'playlist_add',
          videoUrl: m.videoUrl,
          title: m.title
        }));
      }
    });

    movieGrid.appendChild(card);
  });
}

movieSearch.addEventListener('input', renderMovies);

categoryFilters.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    categoryFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = btn.dataset.cat;
    renderMovies();
  });
});

function renderQueue(queue) {
  queueCount.textContent = queue.length;
  queueStream.innerHTML = '';

  if (queue.length === 0) {
    queueStream.innerHTML = '<div class="empty-state">Queue is empty. Browse movies below to add!</div>';
    return;
  }

  queue.forEach(item => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <div>
        <div class="queue-title">${escapeHtml(item.title)}</div>
        <div class="queue-by">Added by ${escapeHtml(item.addedBy)}</div>
      </div>
      <button class="btn-secondary btn-play-queued" data-id="${item.id}">Play</button>
    `;

    div.querySelector('.btn-play-queued').addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'playlist_play',
          id: item.id
        }));
      }
    });

    queueStream.appendChild(div);
  });
}

btnLaunchPoll.addEventListener('click', () => {
  const q = pollQInput.value.trim();
  const opt1 = pollOpt1Input.value.trim();
  const opt2 = pollOpt2Input.value.trim();

  if (q && opt1 && opt2 && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'create_poll',
      question: q,
      options: [opt1, opt2]
    }));
    pollQInput.value = '';
    pollOpt1Input.value = '';
    pollOpt2Input.value = '';
  }
});

function renderPoll(poll) {
  if (!poll) {
    activePollCard.classList.add('hidden');
    return;
  }

  activePollCard.classList.remove('hidden');
  pollQuestionDisplay.textContent = poll.question;
  pollOptionsContainer.innerHTML = '';

  const totalVotes = Object.keys(poll.votes || {}).length;
  pollVoteCount.textContent = `${totalVotes} vote${totalVotes === 1 ? '' : 's'}`;

  poll.options.forEach((opt, idx) => {
    const count = Object.values(poll.votes || {}).filter(v => v === idx).length;
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

    const btn = document.createElement('button');
    btn.className = 'poll-opt-btn';
    btn.innerHTML = `
      <div class="poll-bar" style="width: ${pct}%"></div>
      <span style="position: relative; z-index: 1;">${escapeHtml(opt)} (${pct}%)</span>
    `;

    btn.addEventListener('click', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'vote_poll',
          optionIndex: idx
        }));
      }
    });

    pollOptionsContainer.appendChild(btn);
  });
}

function renderUsers(users) {
  userCount.textContent = users.length;
  usersStream.innerHTML = '';

  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.innerHTML = `
      <div class="user-name-tag">
        <span>${u.isHost ? '👑' : '👤'}</span>
        <span>${escapeHtml(u.name)}${u.id === currentUserId ? ' (You)' : ''}</span>
      </div>
      ${isHost && u.id !== currentUserId ? `<button class="btn-transfer" data-id="${u.id}">Make Host</button>` : ''}
    `;

    const transferBtn = div.querySelector('.btn-transfer');
    if (transferBtn) {
      transferBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transfer_host',
            targetUserId: u.id
          }));
        }
      });
    }

    usersStream.appendChild(div);
  });
}
